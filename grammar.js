/**
 * @file Razor grammar for tree-sitter
 * @author Gael Mahfoudi
 * @license MIT
 *
 * Forked from the initial implementation of tree-sitter-razor by Tristan Knight
 * (https://github.com/tris203/tree-sitter-razor), released under the MIT license.
 * See LICENSE for the full notices.
 *
 * Razor mixes three languages in one file: Razor itself (`@` directives,
 * expressions and control structures), C# (inside `@code` blocks and
 * expressions) and HTML (the markup). This grammar:
 *
 * - extends the C# grammar of tree-sitter-c-sharp, so every C# construct is
 *   available as is, and adds the Razor rules on top of it;
 * - parses HTML only coarsely: an `element` node covers a whole tag with its
 *   content, and the editor re-parses it with the real HTML grammar through an
 *   injection (see queries/injections.scm). The rules below only need to find
 *   where markup starts and ends, and where Razor code is nested inside it.
 *
 * Naming conventions:
 * - `razor_*` nodes are Razor constructs (`razor_if`, `razor_block`, ...);
 * - `at_*` anonymous nodes are the `@keyword` that starts a construct
 *   (`@if` is aliased to "at_if"), so highlight queries can target them;
 * - rules starting with `_` are hidden: they don't show up in the tree.
 */

const CSHARP = require("tree-sitter-c-sharp/grammar").default;

/**
 * Attributes of an HTML start tag: plain HTML attributes, Razor attributes
 * (`@onclick="..."`) and Razor comments, in any order, optionally separated
 * by a space.
 *
 * @param {GrammarSymbols<string>} $
 */
const tagAttributes = ($) =>
  optional(
    repeat(
      prec.left(
        seq(
          choice(
            $._html_attribute,
            $._boolean_html_attribute,
            $.razor_html_attribute,
            $.razor_comment,
          ),
          optional(" "),
        ),
      ),
    ),
  );

module.exports = grammar(CSHARP, {
  name: "razor",

  externals: ($, original) => [
    ...original,
    // `.`, `?`, `(` and `[` continuing an implicit expression: they must
    // follow it without a space, and take precedence over markup text (see
    // src/scanner.c)
    $._implicit_dot,
    $._implicit_question_mark,
    $._implicit_open_paren,
    $._implicit_open_bracket,
  ],

  // razor_comment is deliberately NOT an extra: a node that is both an extra
  // and part of other rules makes the parser fail at the end of the file as
  // soon as a comment is nested in an element or a block. It is listed
  // explicitly wherever it can appear instead (_node, razor_switch, tags).
  extras: ($) => [$.comment, /\s+/],

  // Mostly inherited from the C# grammar (preprocessor directives can appear
  // at several levels), plus the ambiguities added by Razor.
  conflicts: ($, o) => [
    [
      $.preproc_if,
      $.preproc_if_in_top_level,
      $.preproc_if_in_expression,
      $.preproc_if_in_attribute_list,
    ],
    [$.preproc_if, $.preproc_if_in_top_level],
    [$.preproc_if, $.preproc_if_in_top_level, $.preproc_if_in_expression],
    [$.preproc_if, $.preproc_if_in_top_level, $.preproc_if_in_attribute_list],
    [
      $.preproc_else,
      $.preproc_else_in_top_level,
      $.preproc_else_in_expression,
      $.preproc_else_in_attribute_list,
    ],
    [$.declaration, $.preproc_if_in_top_level],
    [$.type_declaration, $.declaration],
    [$.method_declaration, $._local_function_declaration],
    [$.declaration, $.preproc_else_in_top_level],
    [
      $.preproc_elif,
      $.preproc_elif_in_top_level,
      $.preproc_elif_in_expression,
      $.preproc_elif_in_attribute_list,
    ],

    [$.destructor_declaration, $._simple_name],

    [$.field_declaration, $.local_declaration_statement],
    ...o,
  ],

  rules: {
    // ------------------------------------------------------------------------
    // File structure
    // ------------------------------------------------------------------------

    /**
     * A Razor file: the directives first (`@page`, `@using`, `@inject`...),
     * then the content (markup, Razor code and `@code` blocks).
     */
    compilation_unit: ($) =>
      seq(
        repeat(
          choice(
            $.shebang_directive, // this is to make sharing highlights easier
            $.razor_page_directive,
            $.razor_using_directive,
            $.razor_model_directive,
            $.razor_rendermode_directive,
            $.razor_inject_directive,
            $.razor_implements_directive,
            $.razor_layout_directive,
            $.razor_inherits_directive,
            $.razor_attribute_directive,
            $.razor_typeparam_directive,
            $.razor_namespace_directive,
            $.razor_preservewhitespace_directive,
            $.razor_addtaghelper_directive,
            $.razor_removetaghelper_directive,
            $.razor_taghelperprefix_directive,
          ),
        ),
        repeat(choice($._node, $.razor_block)),
      ),

    // ------------------------------------------------------------------------
    // C# overrides
    // ------------------------------------------------------------------------

    // Same as the C# identifier, without the optional leading `@` of verbatim
    // identifiers (`@class`): in Razor, `@` is always the Razor marker.
    _identifier_token: (_) =>
      token(
        // @ts-ignore
        /(\p{XID_Start}|_|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})(\p{XID_Continue}|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})*/,
      ),
    identifier: ($) => choice($._identifier_token, $._reserved_identifier),

    // What a C# block can contain: statements, but also markup and Razor code,
    // since Razor lets markup appear inside C# blocks.
    _csharp_nodes: ($) =>
      choice(
        $.statement,
        $._node,

        $.preproc_region,
        $.preproc_endregion,
        $.preproc_line,
        $.preproc_pragma,
        $.preproc_nullable,
        $.preproc_error,
        $.preproc_warning,
        $.preproc_define,
        $.preproc_undef,
      ),

    block: ($) => seq("{", repeat($._csharp_nodes), "}"),

    // ------------------------------------------------------------------------
    // Content nodes
    // ------------------------------------------------------------------------

    /**
     * Anything that can appear in the content of the file, of an element or of
     * a Razor block: markup, comments, Razor expressions and control
     * structures.
     */
    _node: ($) =>
      prec.right(
        choice(
          $.razor_comment,
          $.razor_escape,
          $.razor_if,
          $.razor_switch,
          $.razor_for,
          $.razor_foreach,
          $.razor_while,
          $.razor_do_while,
          $.razor_try,
          $.explicit_line_transition,
          $.razor_implicit_expression,
          $.razor_explicit_expression,
          $.razor_section,
          $.razor_compound_using,
          $.razor_lock,
          $.element,
          $.html_comment,
        ),
      ),

    // The `@` that switches from markup to Razor code.
    _razor_marker: (_) => token("@"),

    // `@@` is a literal `@` in the markup.
    razor_escape: ($) =>
      seq(alias(/@{2}/, "at_at_escape"), alias($._html_text, $.element)),

    // ------------------------------------------------------------------------
    // Directives
    // ------------------------------------------------------------------------

    // @page "/route"
    razor_page_directive: ($) =>
      seq(alias(seq($._razor_marker, "page"), "at_page"), $.string_literal),
    // @using System.Linq, @using static ..., @using Alias = Some.Type
    razor_using_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "using"), "at_using"),
        choice(
          seq(optional("unsafe"), field("name", $.identifier), "=", $.type),
          seq(optional("static"), optional("unsafe"), $._name),
        ),
      ),
    // @model MyViewModel (MVC views)
    razor_model_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "model"), "at_model"),
        field("name", $._name),
      ),
    // @preservewhitespace true
    razor_preservewhitespace_directive: ($) =>
      seq(
        alias(
          seq($._razor_marker, "preservewhitespace"),
          "at_preservewhitespace",
        ),
        $.boolean_literal,
      ),
    // @attribute [Authorize]
    razor_attribute_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "attribute"), "at_attribute"),
        $.attribute_list,
      ),
    // @implements IDisposable
    razor_implements_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "implements"), "at_implements"),
        field("name", $._name),
      ),
    // @layout MainLayout
    razor_layout_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "layout"), "at_layout"),
        field("name", $._name),
      ),
    // @inherits ComponentBase
    razor_inherits_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "inherits"), "at_inherits"),
        field("name", $._name),
      ),
    // @typeparam TItem
    razor_typeparam_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "typeparam"), "at_typeparam"),
        field("name", $._name),
      ),
    // @inject ILogger<Index> Logger
    razor_inject_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "inject"), "at_inject"),
        $.variable_declaration,
      ),
    // @namespace My.App.Pages
    razor_namespace_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "namespace"), "at_namespace"),
        $.qualified_name,
      ),
    // @rendermode InteractiveServer
    razor_rendermode_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "rendermode"), "at_rendermode"),
        $.razor_rendermode,
      ),
    razor_rendermode: (_) =>
      choice("InteractiveServer", "InteractiveWebAssembly", "InteractiveAuto"),

    // Tag helper directives (MVC): either a string, or `Target, Assembly`
    // where the target may be the `*` wildcard.
    _taghelper_target: ($) =>
      seq(
        choice($.identifier, alias("*", $.taghelper_wildcard)),
        ",",
        field("assembly", $._name),
      ),
    // @addTagHelper *, Microsoft.AspNetCore.Mvc.TagHelpers
    razor_addtaghelper_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "addTagHelper"), "at_addtaghelper"),
        choice($.string_literal, $._taghelper_target),
      ),
    // @removeTagHelper *, Microsoft.AspNetCore.Mvc.TagHelpers
    razor_removetaghelper_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "removeTagHelper"), "at_removetaghelper"),
        choice($.string_literal, $._taghelper_target),
      ),
    // @tagHelperPrefix th:
    razor_taghelperprefix_directive: ($) =>
      seq(
        alias(seq($._razor_marker, "tagHelperPrefix"), "at_taghelperprefix"),
        choice($.string_literal, $.identifier),
      ),

    // ------------------------------------------------------------------------
    // Code blocks and expressions
    // ------------------------------------------------------------------------

    /**
     * A C# code block: `@code { ... }`, `@functions { ... }` or `@{ ... }`.
     * Holds C# declarations and statements, and markup.
     */
    razor_block: ($) =>
      prec.left(
        seq(
          alias(
            seq($._razor_marker, optional(choice("code", "functions"))),
            "at_block",
          ),
          "{",
          repeat(choice($.declaration, seq($.statement), $._node)),
          "}",
        ),
      ),

    // @(expression): the expression is delimited by the parentheses.
    // (C# splits `(x)` and `(x + 1)` into two rules, any expression goes here)
    razor_explicit_expression: ($) =>
      seq(
        alias($._razor_marker, "at_explicit"),
        alias($._razor_parenthesized_expression, $.parenthesized_expression),
      ),

    _razor_parenthesized_expression: ($) => seq("(", $.expression, ")"),

    /**
     * @expression: unlike in C#, the expression can't contain spaces. It is a
     * chain of member accesses, calls and indexers (`@user.Name`,
     * `@items[0].Format("x")`, `@user?.Name`), optionally awaited
     * (`@await LoadAsync()`). It ends at the first character that can't
     * continue the chain: in `@user.Name <br />` or `@user.Name.` the `<` and
     * the final `.` are markup. Anything else needs `@(...)`.
     */
    razor_implicit_expression: ($) =>
      seq(
        alias($._razor_marker, "at_implicit"),
        choice(
          $._implicit_value,
          alias($._implicit_await_expression, $.await_expression),
        ),
      ),

    _implicit_await_expression: ($) =>
      prec(1, seq("await", $._implicit_value)),

    // The node types are the C# ones, so that the C# queries apply.
    _implicit_value: ($) =>
      choice(
        $.identifier,
        $.boolean_literal,
        $.null_literal,
        alias($._implicit_member_access, $.member_access_expression),
        alias($._implicit_conditional_access, $.conditional_access_expression),
        alias($._implicit_invocation, $.invocation_expression),
        alias($._implicit_element_access, $.element_access_expression),
      ),

    _implicit_member_access: ($) =>
      seq(
        field("expression", $._implicit_value),
        alias($._implicit_dot, "."),
        field("name", $.identifier),
      ),

    _implicit_conditional_access: ($) =>
      seq(
        field("condition", $._implicit_value),
        alias($._implicit_question_mark, "?"),
        choice(
          alias($._implicit_member_binding, $.member_binding_expression),
          alias($._implicit_element_binding, $.element_binding_expression),
        ),
      ),

    _implicit_member_binding: ($) =>
      seq(alias($._implicit_dot, "."), field("name", $.identifier)),

    _implicit_element_binding: ($) =>
      alias($._implicit_bracketed_argument_list, $.bracketed_argument_list),

    _implicit_invocation: ($) =>
      seq(
        field("function", $._implicit_value),
        field("arguments", alias($._implicit_argument_list, $.argument_list)),
      ),

    _implicit_element_access: ($) =>
      seq(
        field("expression", $._implicit_value),
        field(
          "subscript",
          alias($._implicit_bracketed_argument_list, $.bracketed_argument_list),
        ),
      ),

    _implicit_argument_list: ($) =>
      seq(
        alias($._implicit_open_paren, "("),
        optional(seq($.argument, repeat(seq(",", $.argument)))),
        ")",
      ),

    _implicit_bracketed_argument_list: ($) =>
      seq(
        alias($._implicit_open_bracket, "["),
        $.argument,
        repeat(seq(",", $.argument)),
        "]",
      ),

    // ------------------------------------------------------------------------
    // Control structures
    //
    // They mirror their C# counterpart, but their bodies hold blended content
    // (markup and C# statements mixed), and they start with `@`.
    // ------------------------------------------------------------------------

    // @lock (obj) { ... }
    razor_lock: ($) =>
      seq(
        alias(seq($._razor_marker, "lock"), "at_lock"),
        "(",
        $.expression,
        ")",
        "{",
        $._blended_content,
        "}",
      ),

    // @using (var x = ...) { ... }
    razor_compound_using: ($) =>
      seq(
        alias(seq($._razor_marker, "using"), "at_using"),
        "(",
        choice(
          alias($.using_variable_declaration, $.variable_declaration),
          $.expression,
        ),
        ")",
        "{",
        $._blended_content,
        "}",
      ),

    // @if (cond) { ... } else if (cond) { ... } else { ... }
    razor_if: ($) =>
      seq(
        alias(seq($._razor_marker, "if"), "at_if"),
        $.razor_condition,
        seq("{", $._blended_content, "}"),
        repeat(choice($.razor_else_if, $.razor_else)),
      ),

    // @try { ... } catch (Exception e) when (...) { ... } finally { ... }
    razor_try: ($) =>
      prec.right(
        seq(
          alias(seq($._razor_marker, "try"), "at_try"),
          "{",
          $._blended_content,
          "}",
          repeat(choice($.razor_catch, $.razor_finally)),
        ),
      ),

    // `catch`, `finally` and `else` get a high precedence so that they are
    // read as the continuation of the Razor structure, not as markup text.
    razor_catch: ($) =>
      seq(
        token(prec(10, "catch")),
        repeat(choice($.catch_declaration, $.catch_filter_clause)),
        "{",
        $._blended_content,
        "}",
      ),

    razor_finally: ($) =>
      seq(
        token(prec(10, "finally")),
        "{",
        $._blended_content,
        "}"
      ),

    razor_else_if: ($) =>
      seq(
        token(prec(10, "else")),
        "if",
        $.razor_condition,
        "{",
        $._blended_content,
        "}"
      ),

    razor_else: ($) =>
      seq(
        token(prec(10, "else")),
        "{",
        $._blended_content,
        "}"
      ),

    // @switch (value) { case X: ... break; default: ... }
    razor_switch: ($) =>
      seq(
        alias(seq($._razor_marker, "switch"), "at_switch"),
        $.razor_condition,
        "{",
        repeat(
          choice($.razor_switch_case, $.razor_switch_default, $.razor_comment),
        ),
        "}",
      ),

    // The parenthesized condition of @if, @switch, @while...
    razor_condition: ($) => prec(10, seq("(", $.expression, ")")),

    razor_switch_case: ($) =>
      prec.left(
        seq(
          // several labels may share one body (case A: case B:)
          repeat1(seq("case", $.razor_case_condition, ":")),
          $._blended_content,
          optional("break;"),
        ),
      ),

    razor_switch_default: ($) =>
      prec.right(seq("default", ":", $._blended_content, optional("break;"))),

    // The case label is kept as raw text, up to the colon.
    razor_case_condition: (_) => /[^:]+/,

    // @for (init; condition; update)
    _razor_for_initializer: ($) =>
      seq(
        alias(seq($._razor_marker, "for"), "at_for"),
        "(",
        field(
          "initializer",
          optional(choice($.variable_declaration, $.expression)),
        ),
        ";",
        field("condition", optional($.expression)),
        ";",
        field("update", optional($.expression)),
        ")",
      ),

    razor_for: ($) =>
      seq(
        $._razor_for_initializer,
        "{",
        field("body", $._blended_content),
        "}",
      ),

    /**
     * The body of a Razor control structure: markup, Razor code, C#
     * statements and comments, mixed freely.
     */
    _blended_content: ($) =>
      repeat1(
        prec(
          10,
          choice($._node, $.explicit_line_transition, $.statement, $.comment),
        ),
      ),

    // @foreach (var item in items), also with a tuple: (var (a, b) in pairs)
    _razor_foreach_initializer: ($) =>
      seq(
        alias(seq($._razor_marker, "foreach"), "at_foreach"),
        "(",
        choice(
          seq(
            field("type", $.type),
            field("left", choice($.identifier, $.tuple_pattern)),
          ),
          field("left", $.expression),
        ),
        "in",
        field("right", $.expression),
        ")",
      ),

    razor_foreach: ($) =>
      seq(
        $._razor_foreach_initializer,
        "{",
        field("body", $._blended_content),
        "}",
      ),

    // @while (cond) { ... }
    razor_while: ($) =>
      seq(
        alias(seq($._razor_marker, "while"), "at_while"),
        $.razor_condition,
        "{",
        $._blended_content,
        "}",
      ),

    _razor_while_condition: ($) => seq("while", $.razor_condition),

    // @do { ... } while (cond);
    razor_do_while: ($) =>
      seq(
        alias(seq($._razor_marker, "do"), "at_do"),
        "{",
        $._blended_content,
        "}",
        $._razor_while_condition,
        ";",
      ),

    // @section Scripts { ... } (MVC layouts)
    razor_section: ($) =>
      seq(
        alias(seq($._razor_marker, "section"), "at_section"),
        $.identifier,
        "{",
        $._blended_content,
        "}",
      ),

    // `@:` inside C# code: the rest of the line is markup.
    explicit_line_transition: ($) =>
      prec.left(
        seq(
          alias("@:", "at_colon_transition"),
          alias(token(prec(1, /[^\n\r]+/)), $.element),
        ),
      ),

    // ------------------------------------------------------------------------
    // Comments
    // ------------------------------------------------------------------------

    // @* ... *@ (see `extras` for why it isn't an extra)
    razor_comment: ($) => seq("@*", optional($._razor_comment_text), "*@"),
    _razor_comment_text: (_) => repeat1(/.|\n|\r/),

    // ------------------------------------------------------------------------
    // Razor attributes
    // ------------------------------------------------------------------------

    /**
     * The name of a Razor attribute: `@onclick`, `@bind`, `@ref`... and any
     * other `@Name` (component parameters). An optional modifier follows:
     * `@onclick:preventDefault`, `@bind:culture`...
     */
    razor_attribute_name: ($) =>
      seq(
        $._razor_marker,
        seq(
          choice(
            "attributes",
            "bind",
            "formname",
            token(prec(10, /on[a-z]+/i)),
            "key",
            "ref",
            // lowest precedence: only used when no keyword above matches
            token(prec(-1, /[a-zA-Z_][a-zA-Z0-9_]*/)),
          ),
          optional($.razor_attribute_modifier),
        ),
      ),

    razor_attribute_modifier: (_) =>
      choice(":culture", ":preventDefault", ":stopPropagation"),

    // <!-- ... -->
    html_comment: ($) => seq("<!--", optional($._razor_comment_text), "-->"),
    _html_comment_text: (_) => repeat1(/.|\n|\r/),

    // ------------------------------------------------------------------------
    // HTML
    //
    // Just enough HTML to delimit the markup: the editor re-parses elements
    // with the real HTML grammar (see queries/injections.scm).
    // ------------------------------------------------------------------------

    _tag_name: (_) => /[a-zA-Z0-9-:]+/,
    _end_tag: ($) => seq("</", $._tag_name, ">"),
    _html_attribute_name: (_) => /[a-zA-Z0-9-:]+/,
    _boolean_html_attribute: (_) => /[a-zA-Z0-9-:]+/,
    // A quoted value, which may contain Razor expressions: class="btn @cls"
    _html_attribute_value: ($) =>
      seq(
        '"',
        repeat(
          choice(
            $.razor_explicit_expression,
            $.razor_implicit_expression,
            /[^"@]+/,
          ),
        ),
        '"',
      ),
    // Text between tags. Stops at `@` so that Razor code is found in it.
    _html_text: (_) => /[^<>&@\s]([^<>&@]*[^<>&@\s])?/,

    /**
     * The value of a Razor attribute is C# code, not text:
     * `@onclick="Save"`, `@onclick="() => Count++"`, `@onclick="@(...)"`.
     */
    razor_attribute_value: ($) =>
      choice(
        // empty value, as its own token so the quotes aren't read as a C# string
        token(prec(1, '""')),
        seq(
          '"',
          choice(
            seq(optional($.modifier), $.expression),
            $.razor_explicit_expression,
            $.razor_implicit_expression,
          ),
          '"',
        ),
      ),

    _html_attribute: ($) =>
      seq($._html_attribute_name, "=", $._html_attribute_value),

    razor_html_attribute: ($) =>
      seq($.razor_attribute_name, optional(seq("=", $.razor_attribute_value))),

    /**
     * An HTML element or a component, with its content. The closing tag isn't
     * checked against the opening one.
     */
    element: ($) =>
      choice(
        // <tag ...>content</tag> or <tag ... />
        seq(
          "<",
          $._tag_name,
          tagAttributes($),
          choice(
            "/>",
            seq(">", repeat(choice($._node, $._html_text)), $._end_tag),
          ),
        ),
        // void elements may omit the closing "/" (<br>, <input ...>)
        seq("<", $._void_tag_name, tagAttributes($), choice("/>", ">")),
        // raw text elements: content is not parsed as razor/html
        seq(
          "<",
          $._raw_text_tag_name,
          tagAttributes($),
          ">",
          optional($._raw_text),
          "</",
          $._raw_text_tag_name,
          ">",
        ),
      ),

    // HTML elements that never have content nor closing tag.
    _void_tag_name: (_) =>
      choice(
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "source", "track", "wbr",
      ),

    // Elements whose content is another language (JavaScript, CSS).
    _raw_text_tag_name: (_) => choice("script", "style"),

    // Anything up to the closing tag (approximated as the next `</`).
    _raw_text: (_) => token(prec(-1, /([^<]|<[^\/])+/)),
  },
});
