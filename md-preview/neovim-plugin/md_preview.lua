--[[
  hgj.md_preview - Start/stop local Markdown preview server
  Keymaps:
    <leader>pm  Start preview server (0.0.0.0:6666)
    <leader>pc  Stop preview server
--]]

local M = {}

local default_config = {
    port = 6666,
    host = "0.0.0.0",
    server_script = vim.fn.expand(vim.fn.stdpath("config") .. "/md_preview_server.py"),
    server_pid_file = vim.fn.expand(vim.fn.stdpath("state") .. "/md_preview.pid"),
}

local config = {}

local function get_md_file()
    if vim.bo.filetype ~= "markdown" then
        vim.notify("md_preview: current buffer is not markdown", vim.log.levels.WARN)
        return nil
    end
    local bufname = vim.api.nvim_buf_get_name(0)
    if bufname == "" then
        vim.notify("md_preview: please save the file first", vim.log.levels.WARN)
        return nil
    end
    return vim.fn.fnamemodify(bufname, ":p")
end

local function save_pid(pid)
    local f = io.open(config.server_pid_file, "w")
    if f then
        f:write(pid)
        f:close()
    end
end

local function read_pid()
    local f = io.open(config.server_pid_file, "r")
    if f then
        local pid = f:read("*l")
        f:close()
        return pid
    end
    return nil
end

local function delete_pid()
    vim.fn.delete(config.server_pid_file)
end

local function start_preview()
    local md_file = get_md_file()
    if not md_file then return end

    if vim.fn.filereadable(config.server_script) == 0 then
        vim.notify("md_preview: script not found at " .. config.server_script, vim.log.levels.ERROR)
        return
    end

    -- Check if server is already running
    local pid = read_pid()
    if pid then
        local alive = vim.fn.system(string.format("kill -0 %s 2>/dev/null && echo yes || echo no", pid))
        if vim.trim(alive) == "yes" then
            -- Server running: switch to the new file via curl with URL-encoded path
            local escaped = vim.fn.shellescape(md_file)
            local cmd = string.format("curl -s --get --data-urlencode 'file=%s' 'http://localhost:%d/switch'", escaped, config.port)
            local resp = vim.fn.system(cmd)
            vim.notify(string.format("md_preview: server switched to %s", vim.trim(resp)), vim.log.levels.INFO)
            return
        end
    end

    -- Server not running: start it
    vim.notify(string.format("md_preview: starting server on %s:%d ...", config.host, config.port), vim.log.levels.INFO)

    local cmd = string.format("nohup python3 %s %q --port %d --host %s </dev/null >/dev/null 2>&1 & echo $!",
        config.server_script, md_file, config.port, config.host)
    local result = vim.fn.system(cmd)
    if vim.v.shell_error ~= 0 then
        vim.notify("md_preview: failed to start server:\n" .. result, vim.log.levels.ERROR)
        return
    end

    local pid = vim.trim(result)
    save_pid(pid)
    vim.notify(string.format("md_preview: server started (PID %s)", pid), vim.log.levels.INFO)
    vim.notify(string.format("Connect from Windows: http://<SERVER_IP>:%d", config.port), vim.log.levels.INFO)
end

local function stop_preview()
    vim.notify("md_preview: stopping server...", vim.log.levels.INFO)

    local pid = read_pid()
    if pid then
        vim.fn.system(string.format("kill %s 2>/dev/null", pid))
    end
    -- Fallback: always kill by process name to catch any leftover
    vim.fn.system("pkill -f md_preview_server.py 2>/dev/null || true")
    delete_pid()
    vim.notify("md_preview: server stopped", vim.log.levels.INFO)
end

function M.setup(opts)
    config = vim.tbl_deep_extend("force", default_config, opts or {})

    vim.keymap.set("n", "<leader>pm", start_preview, {
        desc = "Start Markdown preview server (0.0.0.0:" .. config.port .. ")",
        noremap = true,
        silent = true,
    })

    vim.keymap.set("n", "<leader>pc", stop_preview, {
        desc = "Stop Markdown preview server",
        noremap = true,
        silent = true,
    })

    vim.notify("md_preview: keymaps registered (<leader>pm / <leader>pc)", vim.log.levels.INFO)
end

return M
