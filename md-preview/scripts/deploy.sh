#!/bin/bash
set -e

VERSION="v1"
echo "=== Building Markdown Preview App on Windows ==="

# Sync source files to Windows
echo "=== Syncing source files ==="
scp -P 2222 /tmp/md-preview-app/package.json hgj@localhost:/mnt/c/software/markdown/md-preview-app/package.json
scp -P 2222 /tmp/md-preview-app/package-lock.json hgj@localhost:/mnt/c/software/markdown/md-preview-app/package-lock.json
scp -P 2222 /tmp/md-preview-app/src/App.tsx hgj@localhost:/mnt/c/software/markdown/md-preview-app/src/App.tsx
scp -P 2222 /tmp/md-preview-app/src/index.css hgj@localhost:/mnt/c/software/markdown/md-preview-app/src/index.css
scp -P 2222 /tmp/md-preview-app/src/main.tsx hgj@localhost:/mnt/c/software/markdown/md-preview-app/src/main.tsx
scp -P 2222 /tmp/md-preview-app/src-tauri/Cargo.toml hgj@localhost:/mnt/c/software/markdown/md-preview-app/src-tauri/Cargo.toml
scp -P 2222 /tmp/md-preview-app/src-tauri/src/main.rs hgj@localhost:/mnt/c/software/markdown/md-preview-app/src-tauri/src/main.rs
scp -P 2222 /tmp/md-preview-app/src-tauri/tauri.conf.json hgj@localhost:/mnt/c/software/markdown/md-preview-app/src-tauri/tauri.conf.json
scp -P 2222 /tmp/md-preview-app/src-tauri/capabilities/default.json hgj@localhost:/mnt/c/software/markdown/md-preview-app/src-tauri/capabilities/default.json

# Run native Windows build
echo "=== Running Windows build ==="
ssh -p 2222 hgj@localhost '/mnt/c/Windows/System32/cmd.exe /c "C:\software\markdown\build_windows.cmd"'

echo "=== Build complete ==="
echo "Deployed to: C:\data\markdown-preview_${VERSION}.exe"
