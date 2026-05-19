# 使用 Claude Code 开发 Markdown Preview App 全流程回顾

> 历时 30 个版本迭代，从图像无法显示到功能完整发布

## 一、项目背景

一个基于 Tauri v2 + React + Rust 的 Windows 桌面 Markdown 预览应用。核心场景：在 Linux 服务器上编辑 `.md` 文件，Windows 桌面端实时预览，支持图像渲染、数学公式、主题切换等功能。

### 技术栈

- **前端**：React + TypeScript + Vite
- **后端**：Rust (Tauri v2)
- **服务**：Python HTTP 服务器（运行在 Linux）
- **客户端**：Windows (WebView2)
- **开发环境**：Linux 开发机 → SSH → Windows WSL2 → 编译部署

## 二、需求与演进

### 初始状态
- 已有基础 UI：连接服务器、渲染 Markdown、轮询刷新
- **核心问题**：图像无法显示

### 功能清单

| 功能 | 状态 | 备注 |
|------|------|------|
| Markdown 实时预览 | 已有 | 1s 轮询 + ETag 缓存 |
| 图像显示 | **修复** | 本次开发重点 |
| 图像图注 | **新增** | 取自 alt 文本 |
| 数学公式 (KaTeX) | 已有 | 内联 $ 和块级 $$ |
| 目录/书签侧栏 | 已有 | Ctrl+B 切换 |
| PDF 导出 | 已有 | Ctrl+P |
| 亮色/暗色主题 | 已有 | 工具栏切换 |
| 字体设置 | 已有 | 10 种字体 + 字号滑块 |
| 窗口大小持久化 | 已有 | Rust + localStorage |
| 置顶窗口 | 已有 | Pin 按钮 |
| 图片灯箱 | 已有 | 点击放大 |

## 三、开发流程时间线

### 第一阶段：图像问题排查（v1-v23）

**问题描述**：Markdown 中包含 `![test image](./media/image1.png)` 时，Windows 端图像不显示。

**尝试的方案**（均失败）：

1. **前端 useEffect 重写 img src** — 浏览器拒绝加载 `/file/...` 路径（跨域/CSP 限制）
2. **预渲染 HTML 字符串替换** — 同样的跨域问题
3. **注入 `<base>` 标签** — WebView2 不接受
4. **Rust 后端 `fetch_image` + base64** — 路径正确，数据正确，但图片仍不显示

**关键发现**：
- 30 个版本中，多次出现 `v20 v21 v22` 三个版本文件大小完全相同（12,651,008 bytes）
- 用户敏锐地怀疑 exe 没有更新 — 确实如此，App.tsx 没有 scp 到 Windows 就编译了
- 每次修改 JS 代码，Tauri 打包后的 exe 大小不变是正常的（JS 被压缩打包在 exe 资源中）

**根本原因（后来才定位）**：`<img>` 标签的 `error` 事件处理程序在 `fetch_image` 返回之前就触发了，先把图片隐藏并插入占位符，等 Rust 返回 base64 数据时，图片已被隐藏。

### 第二阶段：调试能力建设（v24-v27）

**用户明确要求**："你是否是应该加一些 log 或者调试看看"

**遇到的问题**：
1. F12 无法打开 DevTools
2. tauri.conf.json 中加了 `"devtools": true` 也没反应
3. Rust 需要 `devtools` feature 才能在 release 模式下启用
4. 编译通过但运行时按钮无反应 — `open_devtools` API 需要 `devtools` feature

**经验教训**：
- Tauri v2 的 DevTools 功能受 feature 控制，release 模式默认关闭
- 仅改 JSON 配置不够，Cargo.toml 也要加 `tauri = { version = "2", features = ["devtools"] }`

### 第三阶段：最终解决方案（v28-v29）

**v28** — 加入 UI 内嵌 Debug 面板（不依赖 DevTools）：
- 左侧 Debug 日志面板，直接显示 `[fetch]` 和 `[img]` 日志
- 所有 `console.log` 替换为 `addLog()` 调用
- 这是关键转折点 — **不再依赖 DevTools，日志直接可见**

**日志揭示真相**：
```
[img] found img src: /file/./media/image1.png
[img] pathMatch: ./media/image1.png
[img] invoking fetch_image
[img] fetch_image result: status=200 mime=image/png data_len=76320
[img] replaced with data URI
```
— 但右侧仍显示 `[Image not found: test image]`

**v29** — 修复竞态条件：
```
根本问题：img 加载 /file/... 失败 → 触发 error 事件
        → errorHandler 隐藏图片，插入占位符
        → fetch_image 返回 base64
        → 设置 img.src = data:...
        → 但图片已被隐藏！

修复方案：找到 /file/ 路径后，先 img.removeAttribute("src")
        阻止浏览器尝试加载失败 URL
        等 Rust 返回后再设置 img.src = data:...
```

### 第四阶段：功能增强（v30）

- 图片下方显示图注（取自 markdown `alt` 文本）
- 添加 `.img-caption` CSS 样式

### 第五阶段：定版与文档（Final）

- 清理所有调试代码（Debug 面板、addLog、eprintln）
- 移除 devtools feature
- 编写完整 README
- 源代码整理到 `~/mygithub/hgj-apps/md-preview/`
- git push 到 GitHub

## 四、遇到的问题及解决方案

### 问题 1：中文路径 URL 编码（400 Bad Request）

**现象**：`/switch?file=/path/含有中文/文件.md` 返回 400

**原因**：Neovim 插件中直接字符串拼接 URL，未对中文进行编码

**解决**：使用 `curl --data-urlencode` 自动编码
```lua
-- 修复前
local url = string.format("http://localhost:%d/switch?file=%s", port, md_file)
local resp = vim.fn.system(string.format("curl -s '%s'", url))

-- 修复后
local escaped = vim.fn.shellescape(md_file)
local cmd = string.format("curl -s --get --data-urlencode 'file=%s' 'http://localhost:%d/switch'", escaped, port)
local resp = vim.fn.system(cmd)
```

### 问题 2：端口 6666 被浏览器阻止（ERR_UNSAFE_PORT）

**现象**：在浏览器中直接访问 `http://10.80.40.1:6666/` 显示 ERR_UNSAFE_PORT

**原因**：Chrome/Chromium 保留端口 6665-6669（IRC），WebView2 也是 Chromium 内核

**影响**：仅影响浏览器直接访问，不影响 Rust 后端的 `reqwest` HTTP 客户端

**结论**：无需修改端口，Rust 不受此限制

### 问题 3：图像加载竞态条件

**现象**：Rust 返回 200 + base64 数据，但图片仍不显示

**原因**：
```
时间线：
t=0  HTML 中 <img src="/file/./media/image1.png"> 被插入 DOM
t=1  浏览器尝试加载 /file/... — 失败（tauri://localhost origin 下无此资源）
t=2  error 事件触发 → errorHandler 隐藏图片，插入 "Image not found"
t=3  useEffect 找到 <img>，调用 invoke("fetch_image")
t=4  Rust 返回 base64 数据
t=5  设置 img.src = data:... — 但图片已被隐藏，看不到效果
```

**解决**：先移除 `src` 属性，阻止浏览器加载失败 URL，等 Rust 返回后再设置

### 问题 4：DevTools 无法打开

**原因**：
1. tauri.conf.json `"devtools": true` 需要同时配合 Cargo.toml 的 `devtools` feature
2. 前端调用 `getCurrentWindow().openDevTools()` 不存在 — Tauri v2 的 JS API 没有直接暴露此方法

**解决**：Rust 端添加 `open_devtools` 命令，但后续改为内嵌 Debug 面板，不再需要 DevTools

### 问题 5：代码同步遗漏

**现象**：用户发现 v20/v21/v22 文件大小相同，怀疑 exe 未更新

**原因**：修改了 App.tsx 但没有 scp 到 Windows 的构建目录就执行了编译

**解决**：建立固定流程 — 每次编译前必须先 scp 源文件

## 五、关键经验教训

### 1. 调试策略

- **优先使用内嵌日志面板，不要依赖 DevTools**
  - DevTools 在 Tauri 中需要额外 feature，且用户不熟悉
  - 内嵌 Debug 面板零依赖，所见即所得
  - 这是整个调试流程的转折点

- **在怀疑代码没生效时，首先检查部署**
  - 文件是否同步？
  - 是否两个编译步骤都执行了（npm build + cargo tauri build）？
  - exe 文件大小相同不代表代码没更新（JS 被打包在资源中）

### 2. 架构设计

- **图像通过 Rust 后端代理是正确选择**
  - WebView2 CSP 限制无法绕过
  - reqwest 无浏览器端口限制
  - base64 data URI 方案简洁有效

- **先移除失败 URL，再设置 data URI**
  - 防止 error handler 抢在 fetch 完成前触发

### 3. 与 AI 协作

- **用户直觉很准** — "v20 v21 v22 大小一样"的质疑直接指出同步问题
- **显式要求加 log 是关键转折** — "你是否应该加一些调试看看"改变了排查方向
- **多轮迭代需要版本管理** — v1 到 v30 的演进需要清晰的版本标识
- **定版前必须清理** — 移除所有调试代码，保持代码干净

### 4. 构建流程

```
固定步骤（缺一不可）：
1. scp App.tsx → Windows 源目录
2. scp main.rs → Windows 源目录
3. 验证文件时间戳已更新
4. npm run build（Vite 编译前端）
5. cargo tauri build（打包 exe）
6. cp exe → 部署目录
```

## 六、最终成果

### 项目结构

```
hgj-apps/md-preview/
├── src/App.tsx              # React 主组件（~570 行）
├── src/index.css            # 主题 CSS 变量
├── src-tauri/src/main.rs    # Rust 后端（~180 行）
├── src-tauri/Cargo.toml     # Rust 依赖
├── src-tauri/tauri.conf.json
├── neovim-plugin/md_preview.lua
├── server/md_preview_server.py
└── README.md
```

### 代码量统计

| 文件 | 行数 | 语言 |
|------|------|------|
| App.tsx | ~570 | TypeScript/React |
| main.rs | ~180 | Rust |
| md_preview.lua | ~120 | Lua |
| md_preview_server.py | ~310 | Python |
| **总计** | **~1,180** | |

### 迭代数据

- **总版本数**：30 个版本
- **开发轮次**：5 个阶段
- **核心问题**：图像不显示 → 竞态条件 → 先移除 src 再设置 data URI
- **最终 exe 大小**：13 MB
- **GitHub 仓库**：github.com/GuangjiHuang/hgj-apps

## 七、使用 AI 辅助开发的建议

1. **不要跳过部署验证** — AI 写的代码改了，必须确认确实部署到了运行环境
2. **加 log 比猜原因快** — 遇到不确定的问题，第一反应应该是加日志而不是分析假设
3. **内嵌调试优于外部工具** — 自建的日志面板比 DevTools 更易用
4. **版本编号很重要** — 每改必建版本号，方便追踪和回滚
5. **用户的直觉通常是对的** — "大小一样是不是没更新" — 这是关键洞察
6. **最终一定要清理** — 调试代码、日志、临时命令，定版前全部移除
