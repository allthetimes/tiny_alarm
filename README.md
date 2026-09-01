# 小小闹钟 (Tiny Alarm)

一款基于 Electron + Vite + TypeScript 的 Windows 桌面闹钟应用。窄高竖条形手机风格界面，简洁美观，支持自定义本地音乐铃声、多闹钟管理、法定工作日重复规则，并内置音乐下载窗口。

![tech](https://img.shields.io/badge/Electron-37-blue) ![tech](https://img.shields.io/badge/Vite-6-purple) ![tech](https://img.shields.io/badge/TypeScript-5-blue)

## 功能特性

### ⏰ 闹钟管理
- 创建多个闹钟，支持编辑、删除、启用/停用
- 闹钟卡片显示下一次响铃时间（今天 / 明天 / 具体日期）
- 系统通知提醒

### 🔁 重复规则
- 仅一次 / 每天 / 工作日 / 周末
- **法定工作日**：读取 `legal-days.json` 配置（可标记调休补班日、法定假日），精准匹配中国节假日作息
- 自定义星期几

### 🔔 响铃控制
- 可配置**响铃时长**（10 秒 / 30 秒 / 1 分钟 / 5 分钟）
- 可配置**再响间隔**（5 / 10 / 15 分钟）和**最多再响次数**
- 响铃时弹出全屏提醒窗口
- **长按空格键 5 秒**关闭本次闹钟（带进度条显示）

### 🎵 铃声管理（我的铃声）
- 从本地导入 mp3 / wav / ogg / m4a / flac 音频
- 自动复制到应用铃声目录，统一命名为 `alarm-原名称`
- 铃声库支持：选择、试听（10 秒自动停止）、**重命名**（固定 `alarm-` 前缀和后缀）、删除
- 音量滑块支持拖动和**滚轮调节**（步进 5）

### 🌐 内嵌音乐下载
- 铃声库内一键打开内嵌音乐网站窗口（https://flac.music.hi.cn/）
- 在内嵌窗口下载的音频文件**自动导入铃声库**，并弹出重命名窗口
- 网站弹窗自动抑制（所有链接在窗口内打开），下载流程不受影响

## 技术栈

| 模块 | 技术 |
|------|------|
| 桌面框架 | Electron |
| 构建工具 | Vite 6 |
| 语言 | TypeScript（原生 DOM，无框架） |
| 样式 | 原生 CSS |
| 持久化 | 本地 JSON 文件（`alarms.json`） |
| 音频服务 | 自定义协议 `alarm-sound://` |

## 快速开始

### 环境要求
- Node.js ≥ 18（推荐 22，可用 nvm 切换）
- npm

### 安装依赖
```bash
npm install
```

> 国内网络如果 Electron 下载超时，先设置镜像：
> ```bash
> # bash
> export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> npm install
> ```
> ```cmd
> # Windows CMD
> set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> npm install
> ```

### 开发运行
```bash
npm run dev
```

### 构建产物
```bash
npm run build
```

### 打包 Windows exe
```bash
npm run pack
```

- 产物输出在 `release/`：`小小闹钟 Setup x.x.x.exe`（NSIS 安装包）与 `win-unpacked/`（免安装绿色版）。
- Vite 输出目录是 `dist/`，electron-builder 输出目录是 `release/`，两者分离，避免安装包递归膨胀。
- 渲染层构建固定使用 `--base=./`（file:// 加载必须用相对资源路径，否则打包后白屏），由 `scripts/vite-build.cjs` 启动，它同时为 Node 16 补齐 `crypto.getRandomValues`。
- 打包后铃声目录位于用户数据目录，首次启动自动从安装目录复制默认铃声。

## 项目结构

```
tiny_alarm/
├── src/
│   ├── main/          # Electron 主进程：窗口、IPC、铃声文件管理、内嵌下载窗口
│   ├── preload/       # contextBridge 安全桥接（contextIsolation: true）
│   └── renderer/      # 前端页面：闹钟列表、弹窗表单、响铃遮罩、样式
├── sounds/            # 开发环境铃声目录（导入的音频存放于此）
├── index.html         # Vite 入口
├── scripts/           # 构建辅助脚本（vite-build.cjs：Node 16 兼容 + 相对路径 base）
├── package.json       # 脚本与 electron-builder 配置
├── tsconfig.json      # renderer 编译配置
└── tsconfig.electron.json  # 主进程/preload 编译配置
```

## 数据与文件位置

| 内容 | 开发环境 | 打包后 |
|------|---------|--------|
| 闹钟数据 | `%APPDATA%/tiny_alarm/alarms.json` | 同左 |
| 法定工作日配置 | `%APPDATA%/tiny_alarm/legal-days.json` | 同左 |
| 铃声目录 | `项目根目录/sounds/` | `%APPDATA%/tiny_alarm/sounds/` |

### 法定工作日配置示例（legal-days.json）
```json
{
  "holidays": ["2026-10-01", "2026-10-02", "2026-10-03"],
  "workdays": ["2026-09-27"]
}
```
- `holidays`：法定假日（周末也标记为休）
- `workdays`：调休补班日（周末也标记为班）

## 安全设计

- 渲染进程开启 `contextIsolation`，禁用 `nodeIntegration`
- preload 只暴露最小 API（读写闹钟、选导入音频、铃声列表/重命名/删除、打开音乐窗口等）
- 铃声文件操作限制在应用铃声目录内（路径校验防目录穿越）
- 音频通过自定义 `alarm-sound://` 协议提供，避免 `file://` 跨域限制

## License

MIT
