# Markdown Preview App

A Windows desktop application for real-time Markdown preview, built with Tauri v2 + React + Rust. Connects to a Python HTTP server serving rendered markdown from any `.md` file.

## Features

| Feature | Description |
|---------|-------------|
| **Real-time Preview** | Polls server every 1s, auto-updates on file change |
| **Image Display** | Rust backend fetches images as base64 data URIs (bypasses WebView2 restrictions) |
| **Image Captions** | Shows markdown `alt` text below images |
| **Math Formulas** | `$...$` inline and `$$...$$` block math via KaTeX |
| **Bookmarks/TOC** | Auto-extracted heading tree, click to jump |
| **Light/Dark Theme** | Toggle via toolbar button |
| **PDF Export** | Export markdown content to PDF |
| **Font Settings** | 10 font families + 8-32px size slider |
| **Window Size** | Configurable + persistent |
| **Always-on-Top** | Pin/unpin window |
| **Image Lightbox** | Click any image to zoom |
| **ETag Caching** | 304 Not Modified support |

## Project Structure

```
md-preview/
├── src/                      # React frontend
│   ├── App.tsx               # Main component
│   ├── index.css             # Theme CSS variables
│   └── main.tsx              # Entry point
├── src-tauri/                # Tauri backend (Rust)
│   ├── src/
│   │   └── main.rs           # Rust commands
│   ├── Cargo.toml            # Rust dependencies
│   ├── tauri.conf.json       # Tauri config
│   └── icons/
├── neovim-plugin/            # Neovim plugin
│   └── md_preview.lua
├── server/                   # Python HTTP server
│   └── md_preview_server.py
└── package.json
```

## Architecture

```
┌─────────────┐     Tauri IPC      ┌─────────────────┐     HTTP      ┌──────────────────┐
│  React UI   │ ◄───────────────► │  Rust Backend   │ ◄──────────► │ Python HTTP      │
│  (WebView2) │                    │  (reqwest)      │              │  Server          │
└─────────────┘                    └─────────────────┘              │  (markdown)      │
                                                                     └──────────────────┘
```

- **Windows App** (Tauri + React): UI + Rust commands for fetching markdown and images
- **Python Server** (`md_preview_server.py`): Serves rendered markdown HTML at `/` and `/raw`, static files at `/file/<path>`, file switching at `/switch`

## Dependencies

### Windows (App)
- Node.js 18+ with npm
- Rust toolchain (MSVC target)
- `cargo-tauri` CLI: `cargo install cargo-tauri`
- `@tauri-apps/cli` npm package

### Linux Server
- Python 3.7+
- `pip3 install markdown`

### Neovim
- curl (for `/switch` API call)

## Build & Deploy

### One-time Setup

```bash
# On Windows machine
cd C:\software\markdown\md-preview-app

# Install npm dependencies
npm install

# Install Rust Tauri CLI
cargo install cargo-tauri
```

### Build

```bash
# 1. Build frontend (Vite)
cd C:\software\markdown\md-preview-app
"C:\Program Files\nodejs\node.exe" node_modules/vite/bin/vite.js build

# 2. Build Tauri app (packages into exe)
"C:\Program Files\nodejs\node.exe" node_modules/@tauri-apps/cli/tauri.js build

# Output: src-tauri/target/release/markdown-preview.exe
# Also generates installer: src-tauri/target/release/bundle/nsis/MarkdownPreview_1.0.0_x64-setup.exe
```

### Deploy

```bash
# Copy exe to data directory
cp C:\software\markdown\md-preview-app\src-tauri\target\release\markdown-preview.exe C:\data\markdown-preview.exe
```

### From Linux Dev Machine (via SSH to Windows WSL2)

```bash
# 1. Sync source files
scp -P 2222 src/App.tsx hgj@localhost:/mnt/c/software/markdown/md-preview-app/src/
scp -P 2222 src-tauri/src/main.rs hgj@localhost:/mnt/c/software/markdown/md-preview-app/src-tauri/src/

# 2. Build on Windows
ssh -p 2222 hgj@localhost 'bash -lc "cd /mnt/c/software/markdown/md-preview-app && \
  /mnt/c/Program\ Files/nodejs/node.exe ./node_modules/vite/bin/vite.js build && \
  /mnt/c/Program\ Files/nodejs/node.exe C:/software/markdown/md-preview-app/node_modules/@tauri-apps/cli/tauri.js build"'

# 3. Copy exe
ssh -p 2222 hgj@localhost 'cp /mnt/c/software/markdown/md-preview-app/src-tauri/target/release/markdown-preview.exe /mnt/c/data/markdown-preview.exe'
```

## Server Setup

### Start Server

```bash
python3 md_preview_server.py <path/to/file.md> --port 6666 --host 0.0.0.0
```

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Full HTML page with markdown rendered |
| `GET /raw` | Body-only HTML fragment |
| `GET /file/<path>` | Static files (images, etc.) |
| `GET /switch?file=<path>` | Switch to a different markdown file |
| `GET /health` | Health check |

### Usage with Neovim

In your Neovim config, map a key to `:lua require('hgj.md_preview').start_preview()`. The plugin will:
1. Start the Python server for the current buffer's `.md` file
2. Launch the Windows app
3. On subsequent calls, use `/switch` to point to the new file (URL-encoded for Chinese paths)

## Rust Commands (Tauri IPC)

| Command | Description |
|---------|-------------|
| `fetch_markdown(host, port, etag)` | Fetch markdown HTML from server with ETag caching |
| `fetch_image(host, port, path)` | Fetch image as base64 data URI |
| `set_always_on_top(on_top)` | Toggle always-on-top |
| `set_window_size(width, height)` | Set window dimensions |
| `save_window_size(width, height)` | Persist window size to `C:\data\md-preview-config.json` |

## Image Loading Pipeline

1. Markdown rendered HTML contains `<img src="/file/./media/image1.png">`
2. React finds `<img>` tags matching `/file/(.+)` pattern
3. Removes original `src` to prevent browser error on broken URL
4. Calls Rust `fetch_image(host, port, relPath)`
5. Rust fetches `http://<host>:<port>/file/<path>` and returns base64
6. React sets `img.src = "data:image/png;base64,..."`
7. If `alt` text is meaningful, inserts `<div class="img-caption">alt</div>` below image

## Configuration

- **localStorage `md_preview_config`**: host, port, fontFamily, fontSize, winWidth, winHeight
- **localStorage `md_preview_theme`**: "light" or "dark"
- **`C:\data\md-preview-config.json`**: persisted window size (Rust side)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Toggle Bookmarks sidebar |
| `Ctrl+P` | Export PDF |
| `Ctrl+Scroll` | Font size adjustment |
