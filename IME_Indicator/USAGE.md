# IME Indicator - 中文输入法状态指示器

一个轻量级的 Windows 输入法状态指示工具，可在文本光标处实时显示当前中英文输入状态。

---

## 编译

### 环境要求

- **Rust** (stable, 1.70+)
- **cargo-xwin**（用于从 Linux 交叉编译 Windows exe）
- **xwin 缓存**（首次编译会自动下载 MSVC CRT 和 Windows SDK，约 200MB）

### 编译步骤

1. 安装 Rust：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

2. 添加 Windows MSVC 目标：

```bash
rustup target add x86_64-pc-windows-msvc
```

3. 安装 cargo-xwin：

```bash
cargo install cargo-xwin
```

4. 克隆仓库并编译：

```bash
git clone https://github.com/RickAsli/IME_Indicator.git
cd IME_Indicator/rust_indicator
cargo xwin build --target x86_64-pc-windows-msvc --release
```

5. 编译完成后，exe 位于：

```
target/x86_64-pc-windows-msvc/release/IME-Indicator.exe
```

---

## 使用

### 启动

双击 `IME-Indicator.exe` 即可运行。程序启动后会在系统托盘中显示图标。

### 功能

程序运行后，在任意可输入文本的位置（记事本、浏览器、IDE 等），当光标闪烁时：

- **中文模式**：光标处显示彩色圆点（默认橙色）
- **英文模式**：光标处显示彩色圆点（默认蓝绿色）

圆点会跟随文本光标位置移动。

### 配置文件

程序首次运行时会在 **exe 同目录** 下自动生成 `config.toml`。你可以随时编辑此文件来自定义行为。

```toml
[poll]
state_interval_ms = 100   # 状态检测间隔 (ms)
track_interval_ms = 10    # 位置追踪间隔 (ms)

[tray]
enable = true             # 是否显示托盘图标

[caret]
enable = true             # 是否启用光标提示
color_cn = "#FF7800A0"    # 中文状态颜色 (#RRGGBBAA)
color_en = "#0078FF30"    # 英文状态颜色
size = 8                  # 提示球大小
offset_x = 0              # X 方向偏移
offset_y = 0              # Y 方向偏移
show_en = true            # 英文状态下是否显示

[mouse]
enable = true             # 是否启用鼠标提示
color_cn = "#FF7800A0"    # 中文状态颜色
color_en = "#0078FF30"    # 英文状态颜色
size = 8                  # 提示球大小
offset_x = 2
offset_y = 18
show_en = true
target_cursors = [32513, 32512]  # I-Beam, Normal
```

修改配置后需要**重启程序**才能生效。

### 托盘菜单

右键点击托盘图标，可以选择：

- **编辑配置 (Config)**：打开 config.toml
- **重启程序 (Restart)**：重新启动程序
- **关于 (About)**：查看版本信息
- **退出 (Exit)**：关闭程序

### 系统要求

- Windows 10 或更高版本
- 至少 2GB 内存

---

## 项目结构

```
IME_Indicator/
├── rust_indicator/
│   ├── Cargo.toml          # Rust 项目配置
│   ├── build.rs            # 构建脚本
│   ├── assets/             # 图标等资源
│   └── src/
│       ├── main.rs              # 入口，检测循环
│       ├── caret_detector.rs    # 文本光标位置检测
│       ├── cursor_detector.rs   # 鼠标光标检测
│       ├── ime_detector.rs      # 中英文输入模式检测
│       ├── overlay.rs           # GDI+ 悬浮窗渲染
│       ├── config.rs            # 配置文件解析
│       └── tray.rs              # 系统托盘管理
├── python_indicator/       # Python 版本（可选）
├── config.toml             # 用户配置文件（运行时自动生成）
└── README.md
```
