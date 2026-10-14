--- Tree-sitter based indentation for Razor buffers.
---
--- Neovim has no tree-sitter indentation engine of its own: this module reads
--- the captures of queries/indents.scm (see that file for their meaning) and
--- turns them into an 'indentexpr'.
---
--- Usage: vim.bo.indentexpr = "v:lua.require'treesitter-razor.indent'.indentexpr()"

local M = {}

-- Per buffer: { tick = changedtick, events = {...}, autos = {...} }
local cache = {}

--- Collects the indentation events of the buffer, sorted by position.
--- An event is { row, col, ecol = end column of the token when it is on one
--- row } and either `open` (true/false) with `leading` = whether it may dedent
--- the line it starts, or `branch`.
local function collect(buf)
	local tick = vim.api.nvim_buf_get_changedtick(buf)
	local c = cache[buf]
	if c and c.tick == tick then
		return c
	end

	local ok, parser = pcall(vim.treesitter.get_parser, buf, "razor")
	if not ok or not parser then
		return nil
	end
	local query = vim.treesitter.query.get("razor", "indents")
	if not query then
		return nil
	end
	-- the razor tree is enough, the injected languages don't matter here
	local root = parser:parse()[1]:root()

	local events, autos = {}, {}
	for id, node in query:iter_captures(root, buf) do
		local name = query.captures[id]
		local sr, sc, er, ec = node:range()
		if node:missing() then
			-- a `}` not typed yet doesn't close anything
		elseif name == "indent.open" or name == "indent.close" then
			events[#events + 1] = {
				row = sr,
				col = sc,
				ecol = (er == sr) and ec or nil,
				open = name == "indent.open",
				leading = true,
			}
		elseif name == "indent.branch" then
			events[#events + 1] = { row = sr, col = sc, ecol = (er == sr) and ec or nil, branch = true }
		elseif name == "indent.begin" then
			events[#events + 1] = { row = sr, col = sc, open = true }
			events[#events + 1] = { row = er, col = ec, open = false }
		elseif name == "indent.auto" then
			autos[#autos + 1] = { sr, er }
		end
	end

	-- at the same position, close the previous indent before opening the next
	table.sort(events, function(a, b)
		if a.row ~= b.row then
			return a.row < b.row
		elseif a.col ~= b.col then
			return a.col < b.col
		end
		return not a.open and b.open
	end)

	cache[buf] = { tick = tick, root = root, events = events, autos = autos }
	return cache[buf]
end

local VOID = {}
for _, tag in ipairs({ "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr" }) do
	VOID[tag] = true
end

--- How much `line` opens (> 0) or closes (< 0) for the next lines, read from
--- its text: brackets and tags, without the closing tokens it starts with.
local function text_delta(line)
	line = line:gsub('"[^"]*"', '""'):gsub("^%s*[})%]]+", ""):gsub("^%s*</[^>]*>", "")
	local delta = 0
	for c in line:gmatch("[{}()%[%]]") do
		delta = delta + (c:find("[{(%[]") and 1 or -1)
	end
	line = line:gsub("<[^<>]-/>", "")
	for _ in line:gmatch("</%a") do
		delta = delta - 1
	end
	-- an opening tag starts the line or follows a space or a tag: List<int>
	-- isn't one
	for tag in (" " .. line):gmatch("[%s>]<(%a[%w%-:%.]*)") do
		if not VOID[tag:lower()] then
			delta = delta + 1
		end
	end
	if line:match("^%s*case%s.*:%s*$") or line:match("^%s*default%s*:%s*$") then
		delta = delta + 1
	end
	return delta
end

--- The indent level of row `lnum` when the tree is broken around it (code
--- being typed): the indent of the previous line, adjusted from the text.
local function fallback_level(buf, lnum, prow, line)
	local prev = vim.api.nvim_buf_get_lines(buf, prow, prow + 1, false)[1]
	local level = vim.fn.indent(prow + 1) / vim.fn.shiftwidth()
	local delta = text_delta(prev)
	level = level + (delta > 0 and 1 or delta < 0 and -1 or 0)
	if line:match("^%s*[})%]]") or line:match("^%s*</") then
		level = level - 1
	end
	return math.max(0, math.floor(level))
end

--- Whether the end of row `prow` is in an ERROR node of the tree.
local function in_error(root, buf, prow)
	local prev = vim.api.nvim_buf_get_lines(buf, prow, prow + 1, false)[1]
	local col = math.max(0, #prev:gsub("%s+$", "") - 1)
	local node = root:named_descendant_for_range(prow, col, prow, col)
	while node do
		if node:type() == "ERROR" then
			return true
		end
		node = node:parent()
	end
	return false
end

--- The indent level of row `lnum` (0-based), or -1 to keep its indent.
function M.get_level(buf, lnum)
	local data = collect(buf)
	if not data then
		return -1
	end

	local line = vim.api.nvim_buf_get_lines(buf, lnum, lnum + 1, false)[1] or ""
	local expected = (line:find("%S") or 1) - 1

	local prow = vim.fn.prevnonblank(lnum) - 1
	if prow >= 0 and in_error(data.root, buf, prow) then
		return fallback_level(buf, lnum, prow, line)
	end

	-- rows of the indents still open; several indents opened on one row only
	-- count once: `Foo(() => {` indents its body by one level
	local stack = {}
	local dedented, branches = false, 0
	for _, ev in ipairs(data.events) do
		if ev.row < lnum then
			if ev.open then
				stack[#stack + 1] = ev.row
			elseif ev.open == false then
				stack[#stack] = nil
			end
		elseif ev.row == lnum then
			-- closing tokens at the start of the line: `}`, `</div>`, `});`
			if ev.col == expected then
				if ev.branch then
					-- the indent stays open for the next lines
					branches = branches + 1
				elseif ev.open or not ev.leading then
					break
				else
					stack[#stack] = nil
				end
				expected = ev.ecol or -1
				dedented = true
			end
		else
			break
		end
	end

	if not dedented then
		for _, a in ipairs(data.autos) do
			if lnum > a[1] and lnum <= a[2] then
				return -1
			end
		end
	end

	local level, last = 0, nil
	for _, row in ipairs(stack) do
		if row ~= last then
			level = level + 1
			last = row
		end
	end
	return math.max(0, level - branches)
end

function M.indentexpr()
	local buf = vim.api.nvim_get_current_buf()
	local level = M.get_level(buf, vim.v.lnum - 1)
	if level < 0 then
		return -1
	end
	return level * vim.fn.shiftwidth()
end

return M
