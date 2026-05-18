#!/usr/bin/env python3
"""
Markdown Preview Server - 监听 0.0.0.0 供远程 Windows App 直连。
无需 SSH 端口转发，Windows 端直接连接服务器 IP:端口。

Supports math formulas: $...$ (inline) and $$...$$ (block) rendered via KaTeX.

Usage:
    python3 md_preview_server.py <md_file> --port 6666
"""

import argparse
import hashlib
import html
import os
import mimetypes
import re
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    import markdown
except ImportError:
    print("Error: pip3 install --user markdown", file=sys.stderr)
    sys.exit(1)

MD_EXTENSIONS = ["extra", "codehilite", "toc", "fenced_code", "tables", "nl2br", "sane_lists"]

_file_path = None
_md_dir = None
_last_mtime = 0
_last_content_hash = ""
_last_html = ""
_last_error = ""


def _reset_cache():
    """Clear cached content so next request gets a fresh render."""
    global _last_content_hash, _last_html, _last_error, _last_mtime
    _last_mtime = 0
    _last_content_hash = ""
    _last_html = ""
    _last_error = ""


# Unique markers that survive markdown processing
_BLOCK_PREFIX = "MATHBLOCKPLACEHOLDER"
_INLINE_PREFIX = "MATHINLINEPLACEHOLDER"


def _extract_math(text):
    """Extract $$...$$ and $...$ blocks, return (text_with_placeholders, math_list)."""
    math_list = []

    # Extract block math $$...$$ first
    def replace_block(m):
        idx = len(math_list)
        latex = m.group(1).strip()
        math_list.append((latex, "block"))
        return "<!--" + _BLOCK_PREFIX + str(idx) + "-->"

    text = re.sub(r'\$\$(.*?)\$\$', replace_block, text, flags=re.DOTALL)

    # Extract inline math $...$
    def replace_inline(m):
        idx = len(math_list)
        latex = m.group(1).strip()
        math_list.append((latex, "inline"))
        return "<!--" + _INLINE_PREFIX + str(idx) + "-->"

    text = re.sub(r'(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)', replace_inline, text)

    return text, math_list


def _restore_math(html_text, math_list):
    """Replace comment markers with span/pre elements carrying data-latex attribute."""
    for i, (latex, mode) in enumerate(math_list):
        escaped_attr = html.escape(latex, quote=True)
        if mode == "block":
            marker = "<!--" + _BLOCK_PREFIX + str(i) + "-->"
            rendered = '<div class="math-display" data-latex="' + escaped_attr + '">' + escaped_attr + '</div>'
        else:
            marker = "<!--" + _INLINE_PREFIX + str(i) + "-->"
            rendered = '<span class="math-inline" data-latex="' + escaped_attr + '">' + escaped_attr + '</span>'

        if marker in html_text:
            html_text = html_text.replace(marker, rendered)
    return html_text


def _rewrite_image_paths(html_text):
    """Rewrite relative image src to /file/<path> for server serving."""
    def replace_img(m):
        full_tag = m.group(0)
        src = m.group(1) or m.group(2)
        if src.startswith(('http://', 'https://', 'data:', '/')):
            return full_tag
        clean_src = src.replace('\\', '/')
        return full_tag.replace(src, '/file/' + clean_src)
    html_text = re.sub(r'<img\s+[^>]*src=(?:"([^"]+)"|\'([^\']+)\')', replace_img, html_text)
    return html_text


def render_markdown(file_path):
    global _last_mtime, _last_content_hash, _last_html, _last_error

    try:
        mtime = os.path.getmtime(file_path)
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except (FileNotFoundError, PermissionError) as e:
        _last_error = str(e)
        _last_content_hash = ""
        return '<h1>Error</h1><p>' + _last_error + '</p>', '<p>' + _last_error + '</p>', time.time(), "err"

    content_hash = hashlib.md5(content.encode()).hexdigest()

    if content_hash == _last_content_hash:
        return None

    _last_mtime = mtime
    _last_content_hash = content_hash
    _last_error = ""

    # Extract math before markdown processing (uses HTML comments as placeholders)
    processed_content, math_list = _extract_math(content)

    # Convert markdown to HTML
    rendered_html = markdown.markdown(processed_content, extensions=MD_EXTENSIONS)

    # Restore math as HTML markers for frontend KaTeX rendering
    rendered_html = _restore_math(rendered_html, math_list)
    rendered_html = _rewrite_image_paths(rendered_html)

    filename = os.path.basename(file_path)
    body_html = (
        '<div class="status">' + filename + ' | ' + time.strftime("%H:%M:%S", time.localtime(mtime)) + '</div>'
        '<div class="meta">' + filename + ' | last modified: ' + time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime)) + '</div>'
        + rendered_html
    )
    html_output = (
        "<html><head><meta charset='utf-8'>"
        "<title>" + filename + " - Markdown Preview</title>"
        "<meta http-equiv='Cache-Control' content='no-cache'>"
        + CSS_STYLE + "</head><body>" + body_html + "</body></html>"
    )
    return html_output, body_html, mtime, content_hash


CSS_STYLE = """
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
         max-width: 900px; margin: 40px auto; padding: 0 20px; line-height: 1.7; color: #333; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f6f8fa; }
  blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 16px; color: #666; }
  img { max-width: 100%; }
  h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 16px; }
  hr { border: none; border-top: 1px solid #eee; margin: 24px 0; }
  a { color: #0366d6; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .meta { color: #888; font-size: 0.85em; margin-bottom: 20px; }
  .status { position: fixed; top: 8px; right: 12px; font-size: 0.75em; color: #aaa; }
</style>
"""


class PreviewHandler(BaseHTTPRequestHandler):

    def do_GET(self):
        global _file_path, _last_mtime, _last_content_hash, _last_html, _last_error

        if self.path.startswith("/file/"):
            self._serve_static_file()
        elif self.path == "/" or self.path == "/preview" or self.path == "/raw":
            client_etag = self.headers.get("If-None-Match")
            if client_etag:
                result = render_markdown(_file_path)
                if result is None:
                    self.send_response(304)
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    return
            else:
                _reset_cache()
                result = render_markdown(_file_path)

            html_output, body_html, mtime, content_hash = result

            if self.path == "/raw":
                body = body_html.encode("utf-8")
            else:
                body = html_output.encode("utf-8")

            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("ETag", '"' + content_hash + '"')
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

        elif self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")

        elif self.path.startswith("/switch"):
            from urllib.parse import parse_qs, urlparse
            params = parse_qs(urlparse(self.path).query)
            file_path = params.get("file", [None])[0]
            if not file_path:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'"file" parameter required')
                return
            file_path = os.path.abspath(file_path)
            if not os.path.isfile(file_path):
                self.send_response(404)
                self.end_headers()
                self.wfile.write(('file not found: ' + file_path).encode())
                return
            _file_path = file_path
            global _md_dir
            _md_dir = os.path.dirname(file_path)
            _reset_cache()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(('switched to ' + file_path).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def _serve_static_file(self):
        """Serve static files (images) from the markdown file's directory."""
        global _md_dir
        rel_path = self.path[len("/file/"):]
        rel_path = os.path.normpath(rel_path).lstrip('/')
        if not _md_dir:
            self.send_response(500)
            self.end_headers()
            return
        full_path = os.path.normpath(os.path.join(_md_dir, rel_path))
        if not full_path.startswith(os.path.realpath(_md_dir)):
            self.send_response(403)
            self.end_headers()
            return
        if not os.path.isfile(full_path):
            self.send_response(404)
            self.end_headers()
            return
        mime_type, _ = mimetypes.guess_type(full_path)
        if mime_type is None:
            mime_type = "application/octet-stream"
        try:
            with open(full_path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            self.send_response(500)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def main():
    global _file_path, _md_dir

    parser = argparse.ArgumentParser(description="Markdown Preview Server (remote access)")
    parser.add_argument("file", help="Path to the markdown file")
    parser.add_argument("--port", type=int, default=18888, help="Port to listen on (default: 18888)")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)")
    args = parser.parse_args()

    _file_path = os.path.abspath(args.file)
    _md_dir = os.path.dirname(_file_path)

    if not os.path.isfile(_file_path):
        print("Error: file not found: " + _file_path, file=sys.stderr)
        sys.exit(1)

    server = HTTPServer((args.host, args.port), PreviewHandler)
    print("Preview server running at http://" + args.host + ":" + str(args.port))
    print("Serving: " + _file_path)
    print("PID: " + str(os.getpid()))
    print("Connect from Windows: http://<SERVER_IP>:" + str(args.port))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
