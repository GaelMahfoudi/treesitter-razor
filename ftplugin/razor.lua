-- Tree-sitter indentation (needs the razor parser and queries/indents.scm)
vim.bo.indentexpr = "v:lua.require'treesitter-razor.indent'.indentexpr()"
-- reindent when typing a closing token at the start of a line, or `>`
vim.bo.indentkeys = "0{,0},0),0],<>>,0=break,o,O,!^F"
vim.b.undo_ftplugin = (vim.b.undo_ftplugin and vim.b.undo_ftplugin .. " | " or "")
	.. "setlocal indentexpr< indentkeys<"
