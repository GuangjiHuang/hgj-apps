import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useState, useEffect, useRef, useCallback } from "react";
import html2pdf from "html2pdf.js";
import katex from "katex";
import "katex/dist/katex.min.css";

const MARKDOWN_CSS = `
.markdown-body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  font-size: var(--md-font-size, 16px);
  line-height: 1.6;
  word-wrap: break-word;
  color: var(--fg-primary);
}
.markdown-body .octicon { display: inline-block; fill: currentColor; vertical-align: text-bottom; min-width: 16px; }
.markdown-body h1, .markdown-body h2, .markdown-body h3,
.markdown-body h4, .markdown-body h5, .markdown-body h6 {
  margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25;
}
.markdown-body h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid var(--border-color); }
.markdown-body h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid var(--border-color); }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body p { margin-top: 0; margin-bottom: 16px; }
.markdown-body a { color: var(--link-color); text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }
.markdown-body img { max-width: 100%; box-sizing: content-box; cursor: zoom-in; border-radius: 4px; }
.markdown-body .img-caption { text-align: center; color: var(--fg-muted); font-size: 0.85em; margin: 8px 0 16px; }
.markdown-body code {
  padding: .2em .4em; margin: 0; font-size: 85%; white-space: break-spaces;
  background-color: var(--code-bg); border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.markdown-body pre {
  padding: 16px; overflow: auto; font-size: 85%; line-height: 1.45;
  background-color: var(--pre-bg); border-radius: 6px; margin-bottom: 16px;
}
.markdown-body pre code {
  padding: 0; margin: 0; font-size: 100%; word-break: normal; white-space: pre;
  background: transparent; border: 0; display: block;
}
.markdown-body blockquote {
  padding: 0 1em; color: var(--blockquote-fg); border-left: .25em solid var(--border-color); margin: 0 0 16px 0;
}
.markdown-body table {
  display: block; width: 100%; overflow: auto; margin-bottom: 16px;
  border-spacing: 0; border-collapse: collapse;
}
.markdown-body table th, .markdown-body table td {
  padding: 6px 13px; border: 1px solid var(--border-color);
}
.markdown-body table th { font-weight: 600; background-color: var(--table-header-bg); }
.markdown-body table tr { background-color: var(--table-row-bg); border-top: 1px solid var(--border-color); }
.markdown-body table tr:nth-child(2n) { background-color: var(--table-row-alt-bg); }
.markdown-body ul, .markdown-body ol { padding-left: 2em; margin-top: 0; margin-bottom: 16px; }
.markdown-body li { list-style-type: disc; }
.markdown-body li + li { margin-top: .25em; }
.markdown-body hr { height: .25em; padding: 0; margin: 24px 0;
  background-color: var(--border-color); border: 0; }
.markdown-body input[type=checkbox] { margin-right: .5em; vertical-align: middle; }
.markdown-body kbd {
  display: inline-block; padding: 3px 5px; font-size: 11px; line-height: 10px;
  color: var(--fg-primary); vertical-align: middle; background-color: var(--pre-bg);
  border: solid 1px var(--border-color); border-radius: 6px; box-shadow: inset 0 -1px 0 var(--border-color);
}
`;

const FONT_FAMILIES = [
  "System Default", "Segoe UI", "Inter", "Noto Sans SC", "Source Han Sans SC",
  "Microsoft YaHei", "PingFang SC", "Consolas", "JetBrains Mono", "SF Pro Text",
];

function resolveFontFamily(name: string): string {
  if (name === "System Default")
    return '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';
  return `"${name}", sans-serif`;
}

function readSavedConfig(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem("md_preview_config") || "{}"); } catch { return {}; }
}

type TocItem = { id: string; text: string; level: number };

function App() {
  const cfg = readSavedConfig();
  const [host, setHost] = useState(cfg.host as string || "192.168.1.100");
  const [port, setPort] = useState(cfg.port as string || "6666");
  const [connected, setConnected] = useState(false);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [pinned, setPinned] = useState(true);
  const [status, setStatus] = useState("Not connected");
  const savedTheme = localStorage.getItem("md_preview_theme");
  const [theme, setTheme] = useState<"light" | "dark">(savedTheme === "dark" ? "dark" : "light");
  const [tocOpen, setTocOpen] = useState(false);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontFamily, setFontFamily] = useState(cfg.fontFamily as string || "System Default");
  const [fontSize, setFontSize] = useState(cfg.fontSize as number || 16);
  const [winWidth, setWinWidth] = useState(cfg.winWidth as number || 800);
  const [winHeight, setWinHeight] = useState(cfg.winHeight as number || 600);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const etagRef = useRef("");
  const contentRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);

  const applyWindowSize = async (w: number, h: number) => {
    try {
      await invoke("set_window_size", { width: w, height: h });
      await invoke("save_window_size", { width: w, height: h });
    } catch (e) { console.error("setSize failed:", e); }
  };

  useEffect(() => {
    const saved = localStorage.getItem("md_preview_theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);

  const saveConfig = useCallback(() => {
    localStorage.setItem("md_preview_config", JSON.stringify({ host, port, fontFamily, fontSize, winWidth, winHeight }));
  }, [host, port, fontFamily, fontSize, winWidth, winHeight]);

  useEffect(() => {
    if (!html) { setTocItems([]); return; }
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const headings = doc.querySelectorAll("h1, h2, h3, h4, h5, h6");
    const items: TocItem[] = [];
    headings.forEach((h, i) => {
      let id = h.id || `heading-${i}`;
      if (!h.id) h.id = id;
      items.push({ id, text: h.textContent || "", level: parseInt(h.tagName[1]) });
    });
    setTocItems(items);
  }, [html]);

  const scrollToHeading = useCallback((id: string) => {
    const el = contentRef.current?.querySelector(`#${CSS.escape(id)}`) as HTMLElement;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const container = contentRef.current?.querySelector(".markdown-body");
    if (!container || !html) return;

    container.querySelectorAll("div.math-display").forEach((el) => {
      const latex = (el as HTMLElement).dataset.latex || "";
      if (!latex) return;
      try {
        const rendered = katex.renderToString(latex, { displayMode: true, throwOnError: false });
        const wrapper = document.createElement("div");
        wrapper.innerHTML = rendered;
        wrapper.style.textAlign = "center";
        wrapper.style.margin = "16px 0";
        wrapper.style.overflowX = "auto";
        el.replaceWith(wrapper);
      } catch (e) { console.error("KaTeX block render error:", e); }
    });

    container.querySelectorAll("span.math-inline").forEach((el) => {
      const latex = (el as HTMLElement).dataset.latex || "";
      if (!latex) return;
      try {
        const rendered = katex.renderToString(latex, { displayMode: false, throwOnError: false });
        const span = document.createElement("span");
        span.innerHTML = rendered;
        el.replaceWith(span);
      } catch (e) { console.error("KaTeX inline render error:", e); }
    });

    container.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (!src) return;
      const pathMatch = src.match(/\/file\/(.+)/);
      if (!pathMatch) return;
      const relPath = pathMatch[1];
      img.removeAttribute("src");
      img.style.display = "inline";
      invoke("fetch_image", { host, port, path: relPath }).then((result: unknown) => {
        const r = result as { status: number; mime_type: string; data: string };
        if (r.status === 200 && r.data) {
          img.src = `data:${r.mime_type};base64,${r.data}`;
          const caption = img.alt;
          if (caption && caption !== "image" && caption !== "图片" && caption !== "") {
            const capEl = document.createElement("div");
            capEl.className = "img-caption";
            capEl.textContent = caption;
            img.parentNode?.insertBefore(capEl, img.nextSibling);
          }
        } else {
          const ph = document.createElement("span");
          ph.textContent = `[Image load failed: ${img.alt || src}]`;
          ph.style.cssText = "color:#999;font-style:italic;font-size:0.9em;padding:8px;border:1px dashed #ddd;border-radius:4px;display:inline-block;";
          img.parentNode?.insertBefore(ph, img);
          img.remove();
        }
      }).catch(() => {
        const ph = document.createElement("span");
        ph.textContent = `[Image load failed: ${img.alt || src}]`;
        ph.style.cssText = "color:#999;font-style:italic;font-size:0.9em;padding:8px;border:1px dashed #ddd;border-radius:4px;display:inline-block;";
        img.parentNode?.insertBefore(ph, img);
        img.remove();
      });
    });
  }, [html, host, port]);

  // Image lightbox via event delegation + broken image fallback
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const clickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG") {
        e.preventDefault();
        setPreviewImage(target.getAttribute("src"));
      }
    };

    const errorHandler = (e: Event) => {
      const img = e.target as HTMLImageElement;
      if (img.src?.startsWith("data:")) return;
      if (img.dataset.mdImgHandled === "1") return;
      img.dataset.mdImgHandled = "1";
      img.style.display = "none";
      const placeholder = document.createElement("span");
      placeholder.className = "broken-image-placeholder";
      placeholder.textContent = `[Image not found: ${img.alt || img.src}]`;
      placeholder.style.cssText = "color: var(--fg-muted, #999); font-style: italic; font-size: 0.9em; padding: 8px; border: 1px dashed var(--border-color, #ddd); border-radius: 4px; display: inline-block;";
      img.parentNode?.insertBefore(placeholder, img.nextSibling);
    };

    container.addEventListener("click", clickHandler);
    container.addEventListener("error", errorHandler, true);
    return () => {
      container.removeEventListener("click", clickHandler);
      container.removeEventListener("error", errorHandler, true);
    };
  }, [html]);

  const fetchContent = useCallback(async () => {
    try {
      const result = await invoke("fetch_markdown", { host, port, etag: etagRef.current });
      const resp = result as { status: number; body: string; etag: string };
      if (resp.status === 304) return;
      if (resp.status >= 400) throw new Error(`HTTP ${resp.status}`);
      if (resp.etag) etagRef.current = resp.etag;
      if (!resp.body) return;
      if (resp.body.startsWith("<!DOCTYPE") || resp.body.startsWith("<html>")) {
        throw new Error("Server returned unexpected HTML response");
      }
      setHtml(resp.body);
      setConnected(true);
      setError("");
      setStatus("Connected");
    } catch (e: any) {
      setError(`Connection failed: ${e.message || String(e)}`);
      setConnected(false);
      setHtml("");
      setStatus("Disconnected");
    }
  }, [host, port]);

  const connect = useCallback(() => {
    saveConfig();
    etagRef.current = "";
    setHtml("");
    fetchContent();
    intervalRef.current = setInterval(fetchContent, 1000);
  }, [fetchContent, saveConfig]);

  const disconnect = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    etagRef.current = "";
    setPinned(false);
    setConnected(false);
    setHtml("");
    setStatus("Not connected");
    setError("");
  }, []);

  const togglePin = useCallback(async () => {
    const next = !pinned;
    setPinned(next);
    try { await getCurrentWindow().setAlwaysOnTop(next); }
    catch (e) { console.warn("Pin failed:", e); }
  }, [pinned]);

  const toggleTheme = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("md_preview_theme", next);
  }, [theme]);

  const exportPdf = useCallback(async () => {
    const element = contentRef.current?.querySelector(".markdown-body") as HTMLElement;
    if (!element) return;
    setStatus("Generating PDF...");
    try {
      const pdfBlob = await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        } as any)
        .from(element)
        .outputPdf("blob");
      if ((window as any).showSaveFilePicker) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: "markdown-preview.pdf",
          types: [{ description: "PDF Files", accept: { "application/pdf": [".pdf"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(pdfBlob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "markdown-preview.pdf";
        a.click();
        URL.revokeObjectURL(url);
      }
      setStatus("Connected");
    } catch (e: any) {
      if (e.name !== "AbortError") console.error("PDF export failed:", e);
      setStatus("Connected");
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "b") { e.preventDefault(); setTocOpen(prev => !prev); }
      if (e.ctrlKey && e.key === "p") { e.preventDefault(); if (html) exportPdf(); }
    };
    const wheelHandler = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setFontSize(prev => Math.min(32, Math.max(8, prev + (e.deltaY < 0 ? 1 : -1))));
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("wheel", wheelHandler, { passive: false });
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("wheel", wheelHandler);
    };
  }, [html, exportPdf]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      const panel = settingsPanelRef.current;
      const gearBtn = document.getElementById("settings-btn");
      if (panel && (panel.contains(e.target as Node) || gearBtn?.contains(e.target as Node))) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const fontStyle = `.markdown-body { font-family: ${resolveFontFamily(fontFamily)}; font-size: ${fontSize}px; }`;

  return (
    <div style={styles.app}>
      <style>{MARKDOWN_CSS}</style>
      <style>{fontStyle}</style>

      <div className="no-print" style={styles.toolbar}>
        <div style={styles.logo}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span style={styles.logoText}>Markdown Preview</span>
        </div>

        <div style={styles.controls}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Server</label>
            <input style={styles.input} value={host} onChange={(e) => setHost(e.target.value)}
              placeholder="Server IP" disabled={connected} />
          </div>
          <div style={{ ...styles.inputGroup, width: 80 }}>
            <label style={styles.label}>Port</label>
            <input style={{ ...styles.input, width: 60 }} value={port} onChange={(e) => setPort(e.target.value)}
              placeholder="Port" disabled={connected} />
          </div>
          <button style={connected ? styles.btnDisconnect : styles.btnConnect}
            onClick={connected ? disconnect : connect}>
            {connected ? "Disconnect" : "Connect"}
          </button>
          <div style={styles.divider} />

          <button style={{ ...styles.btnIcon, ...(tocOpen ? styles.btnIconActive : {}) }}
            onClick={() => setTocOpen(!tocOpen)} title="Bookmarks (Ctrl+B)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              <line x1="9" y1="7" x2="16" y2="7"/>
              <line x1="9" y1="11" x2="14" y2="11"/>
              <line x1="9" y1="15" x2="12" y2="15"/>
            </svg>
          </button>

          <button style={styles.btnIcon} onClick={exportPdf} title="Export PDF (Ctrl+P)" disabled={!html}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>

          <button style={styles.btnIcon} onClick={toggleTheme}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
            {theme === "light" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            )}
          </button>

          <button id="settings-btn" style={{ ...styles.btnIcon, ...(settingsOpen ? styles.btnIconActive : {}) }}
            onClick={() => setSettingsOpen(!settingsOpen)} title="Settings"
            onMouseDown={(e) => e.stopPropagation()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          <div style={styles.divider} />

          <button style={{ ...styles.btnPin, ...(pinned ? styles.btnPinActive : {}) }}
            onClick={togglePin} title={pinned ? "Unpin" : "Pin"}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M5 5c0 5.5 7 9 7 16l2-7h4l2 7V5l-5-2z"/>
            </svg>
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div id="settings-panel" ref={settingsPanelRef} style={styles.settingsPanel}
          onMouseDown={(e) => e.stopPropagation()}>
          <div style={styles.settingsGroup}>
            <label style={styles.settingsLabel}>Font Family</label>
            <select style={styles.settingsSelect} value={fontFamily}
              onChange={(e) => { setFontFamily(e.target.value); saveConfig(); }}>
              {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={styles.settingsGroup}>
            <label style={styles.settingsLabel}>Font Size: {fontSize}px</label>
            <input type="range" min={8} max={32} value={fontSize}
              onChange={(e) => { setFontSize(parseInt(e.target.value)); saveConfig(); }}
              style={{ width: "100%" }} />
            <div style={styles.rangeLabels}>
              <span>8px</span><span>20px</span><span>32px</span>
            </div>
          </div>
          <div style={styles.settingsGroup}>
            <label style={styles.settingsLabel}>Window Size: {winWidth} × {winHeight}</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input type="number" min={400} max={2560} value={winWidth}
                onChange={(e) => { setWinWidth(parseInt(e.target.value) || 400); }}
                style={{ ...styles.settingsInput, flex: 1 }} />
              <span style={{ lineHeight: "32px", color: "var(--fg-muted)" }}>×</span>
              <input type="number" min={300} max={1600} value={winHeight}
                onChange={(e) => { setWinHeight(parseInt(e.target.value) || 300); }}
                style={{ ...styles.settingsInput, flex: 1 }} />
            </div>
            <button id="apply-btn" style={styles.applyBtn}
              onClick={() => { applyWindowSize(winWidth, winHeight); saveConfig(); }}>
              Apply
            </button>
          </div>
        </div>
      )}

      <div className="no-print" style={{
        ...styles.statusBar,
        backgroundColor: connected ? "var(--success-bg)" : error ? "var(--error-bg)" : "var(--bg-secondary)",
        color: connected ? "var(--success-fg)" : error ? "var(--error-fg)" : "var(--fg-secondary)",
      }}>
        <span style={{ marginRight: 8 }}>●</span>
        {error ? `Error: ${error}` : status}
        {connected && (
          <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>
            Polling every 1s • {host}:{port}
          </span>
        )}
      </div>

      <div style={styles.mainArea}>
        {tocOpen && (
          <div style={styles.tocSidebar}>
            <div style={styles.tocHeader}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Bookmarks</span>
              <button style={styles.tocCloseBtn} onClick={() => setTocOpen(false)} title="Close (Ctrl+B)">✕</button>
            </div>
            <div style={styles.tocList}>
              {tocItems.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--fg-secondary)" }}>No headings found</div>
              ) : (
                tocItems.map((item, i) => (
                  <div key={i} style={{
                    ...styles.tocItem,
                    paddingLeft: 8 + (item.level - 1) * 16,
                  }} onClick={() => scrollToHeading(item.id)} title={item.text}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "var(--fg-muted)", marginRight: 6, minWidth: 18 }}>
                      H{item.level}
                    </span>
                    <span style={{
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}>{item.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div ref={contentRef} style={styles.content}>
          {html ? (
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
          ) : connected ? (
            <div style={styles.placeholder}>
              <div style={styles.placeholderIcon}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--border-color)" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <p style={{ color: "var(--fg-secondary)", fontSize: 14 }}>Waiting for Markdown content...</p>
              <p style={{ color: "var(--fg-muted)", fontSize: 12 }}>Save a .md file on the server to see preview</p>
            </div>
          ) : (
            <div style={styles.placeholder}>
              <div style={styles.placeholderIcon}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--border-color)" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
              </div>
              <p style={{ color: "var(--fg-secondary)", fontSize: 14 }}>Enter server IP and port, then click Connect</p>
            </div>
          )}
        </div>
      </div>

      {previewImage && (
        <div style={styles.lightboxOverlay} onClick={() => setPreviewImage(null)}>
          <img src={previewImage} style={styles.lightboxImage} alt="Preview" />
          <span style={styles.lightboxClose}>✕</span>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: { display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-primary)", overflow: "hidden" },
  toolbar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "6px 12px", borderBottom: "1px solid var(--border-color)",
    background: "linear-gradient(180deg, var(--toolbar-gradient-start) 0%, var(--toolbar-gradient-end) 100%)",
    minHeight: 44,
  },
  logo: { display: "flex", alignItems: "center", gap: 8 },
  logoText: { fontWeight: 600, fontSize: 14, color: "var(--fg-primary)" },
  controls: { display: "flex", alignItems: "center", gap: 8 },
  inputGroup: { display: "flex", flexDirection: "column", gap: 2 },
  label: { fontSize: 10, fontWeight: 600, color: "var(--fg-secondary)", textTransform: "uppercase" as const, letterSpacing: "0.05em" },
  input: {
    border: "1px solid var(--border-color)", borderRadius: 6, padding: "4px 8px",
    fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    outline: "none", width: 140, transition: "border-color 0.15s",
    background: "var(--bg-primary)", color: "var(--fg-primary)",
  },
  btnConnect: {
    background: "#2da44e", color: "#fff", border: "none", borderRadius: 6,
    padding: "5px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 14,
  },
  btnDisconnect: {
    background: "var(--bg-secondary)", color: "var(--error-fg)", border: "1px solid var(--error-fg)",
    borderRadius: 6, padding: "5px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 14,
  },
  btnIcon: {
    background: "none", border: "1px solid transparent", borderRadius: 6, padding: 4,
    cursor: "pointer", color: "var(--fg-secondary)", display: "flex",
    alignItems: "center", justifyContent: "center", marginTop: 14, transition: "all 0.15s",
  },
  btnIconActive: { background: "var(--accent-bg)", borderColor: "var(--accent)", color: "var(--accent)" },
  btnPin: {
    background: "none", border: "1px solid var(--border-color)", borderRadius: 6, padding: 4,
    cursor: "pointer", color: "var(--fg-secondary)", display: "flex",
    alignItems: "center", justifyContent: "center", marginTop: 14, transition: "all 0.15s",
  },
  btnPinActive: { background: "var(--btn-pin-active)", borderColor: "var(--accent)", color: "var(--accent)" },
  divider: { width: 1, height: 28, background: "var(--border-color)", marginTop: 14 },
  statusBar: { display: "flex", alignItems: "center", padding: "4px 12px", fontSize: 12, fontWeight: 500, borderBottom: "1px solid var(--border-color)" },
  mainArea: { display: "flex", flex: 1, overflow: "hidden" },
  tocSidebar: {
    width: 240, minWidth: 240, borderRight: "1px solid var(--border-color)",
    background: "var(--sidebar-bg)", display: "flex", flexDirection: "column", overflow: "hidden",
  },
  tocHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border-color)" },
  tocCloseBtn: { background: "none", border: "none", cursor: "pointer", color: "var(--fg-secondary)", fontSize: 12, padding: "2px 6px", borderRadius: 4 },
  tocList: { flex: 1, overflow: "auto", padding: "4px 0" },
  tocItem: {
    padding: "4px 8px", cursor: "pointer", display: "flex", alignItems: "center",
    borderRadius: 4, margin: "1px 4px", transition: "background 0.1s",
  },
  content: { flex: 1, overflow: "auto", padding: "24px 32px" },
  placeholder: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 },
  placeholderIcon: { marginBottom: 8 },
  settingsPanel: {
    position: "absolute", top: 48, right: 12, width: 260,
    background: "var(--settings-bg)", border: "1px solid var(--border-color)",
    borderRadius: 8, boxShadow: "var(--settings-shadow)", padding: 16, zIndex: 1000,
  },
  settingsGroup: { marginBottom: 16 },
  settingsLabel: {
    display: "block", fontSize: 11, fontWeight: 600, color: "var(--fg-secondary)",
    textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 6,
  },
  settingsSelect: {
    width: "100%", padding: "6px 8px", border: "1px solid var(--border-color)",
    borderRadius: 6, fontSize: 13, background: "var(--bg-secondary)", color: "var(--fg-primary)", outline: "none",
  },
  settingsInput: {
    padding: "5px 8px", border: "1px solid var(--border-color)",
    borderRadius: 6, fontSize: 13, background: "var(--bg-secondary)", color: "var(--fg-primary)", outline: "none", width: 80,
  },
  applyBtn: {
    width: "100%", padding: "5px 0", background: "var(--accent)", color: "#fff",
    border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
  rangeLabels: { display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--fg-muted)", marginTop: 2 },
  lightboxOverlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 9999, cursor: "zoom-out",
  },
  lightboxImage: { maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 4 },
  lightboxClose: {
    position: "absolute", top: 16, right: 20, color: "#fff", fontSize: 28, cursor: "pointer",
    width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(255,255,255,0.15)", borderRadius: "50%",
  },
};

export default App;
