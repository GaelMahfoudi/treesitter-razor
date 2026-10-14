; Indentation rules, applied by lua/treesitter-razor/indent.lua.
;
; The depth of a line is the number of rows holding an indent that is still
; open at the start of the line. An indent is opened and closed by:
;
;   @indent.open / @indent.close   tokens (brackets, tags). A line that starts
;                                  with closing tokens is dedented right away.
;   @indent.begin                  a whole node: it indents the rows after its
;                                  first one, up to its end.
;   @indent.branch                 a token that dedents the line it starts,
;                                  inside an @indent.begin node.
;   @indent.auto                   multi-line text (comments, strings, raw
;                                  text): its inner lines keep their indent.

; Brackets: C# blocks, Razor blocks and structures, argument lists...
[ "{" "(" "[" ] @indent.open
[ "}" ")" "]" ] @indent.close

; Elements: from the opening `<` to the closing tag
(element . "<" @indent.open)
(element [ "</" "/>" ] @indent.close)
; void elements without `/>` (<br>, <input ...>) close on their `>`
(element
  . "<"
  . [ "area" "base" "br" "col" "embed" "hr" "img" "input"
      "link" "meta" "source" "track" "wbr" ]
  ">" @indent.close .)

; Switch cases: their body is indented under the label
[
  (razor_switch_case)
  (razor_switch_default)
  (switch_section)
] @indent.begin
; several labels may share a body: the next ones line up with the first
(razor_switch_case ":" "case" @indent.branch)

; Text spanning several lines
[
  (razor_comment)
  (html_comment)
  (comment)
  (verbatim_string_literal)
  (raw_string_literal)
  (interpolated_string_expression)
] @indent.auto

; script and style hold JavaScript and CSS
(element . "<" . [ "script" "style" ]) @indent.auto
