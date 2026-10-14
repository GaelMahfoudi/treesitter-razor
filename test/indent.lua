-- Indentation tests: each file of test/indent/ is indented as expected. Its
-- lines are stripped of their indentation, reindented with `=`, then compared
-- with the original.
--
-- Run from the repository root (see `npm run test:indent`):
--   mkdir -p build && tree-sitter build -o build/razor.so
--   nvim --headless --clean -l test/indent.lua [file...]

local root = vim.fn.getcwd()
vim.opt.runtimepath:prepend(root)
vim.treesitter.language.add("razor", { path = root .. "/build/razor.so" })
local function read(path)
	return table.concat(vim.fn.readfile(path), "\n")
end
vim.treesitter.query.set("razor", "indents", read(root .. "/queries/indents.scm"))
local indent = require("treesitter-razor.indent")

local files = #_G.arg > 0 and _G.arg or vim.fn.glob(root .. "/test/indent/*.razor", false, true)
local failed = 0
for _, file in ipairs(files) do
	local expected = vim.fn.readfile(file)
	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_set_current_buf(buf)
	vim.bo.shiftwidth = 4
	vim.bo.expandtab = true
	vim.bo.indentexpr = "v:lua.require'treesitter-razor.indent'.indentexpr()"

	-- lines kept as they are by @indent.auto can't be checked once stripped
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, expected)
	local kept = {}
	for i = 1, #expected do
		kept[i] = indent.get_level(buf, i - 1) < 0
	end

	local stripped = {}
	for i, l in ipairs(expected) do
		stripped[i] = kept[i] and l or (l:gsub("^%s+", ""))
	end
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, stripped)
	vim.cmd("silent normal! gg=G")
	local got = vim.api.nvim_buf_get_lines(buf, 0, -1, false)

	local errors = {}
	for i, l in ipairs(expected) do
		if got[i] ~= l and l:find("%S") then
			errors[#errors + 1] = ("  %d: expected |%s|\n  %s   got      |%s|"):format(i, l, (" "):rep(#tostring(i)), got[i])
		end
	end
	local name = vim.fn.fnamemodify(file, ":t")
	if #errors == 0 then
		print("ok    " .. name)
	else
		failed = failed + 1
		print("FAIL  " .. name .. "\n" .. table.concat(errors, "\n"))
	end
	vim.api.nvim_buf_delete(buf, { force = true })
end
print(("%d/%d passed"):format(#files - failed, #files))
os.exit(failed == 0 and 0 or 1)
