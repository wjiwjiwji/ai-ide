# AI IDE

一个面向个人使用的 AI 原生项目工作台。

当前版本实现了 Electron + React + TypeScript 项目工作台，包括：

- 安全的 Electron 主进程与 Preload 桥接。
- AI 任务优先的三栏界面。
- 本地项目选择器与最近项目记录。
- 项目目录树和文件折叠浏览。
- Monaco Editor 代码编辑、标签页和文件保存。
- Git 分支、ahead/behind 和未提交文件状态。
- Monaco Diff 查看 HEAD 与工作区之间的代码变化。
- 单文件和批量暂存、取消暂存。
- 从应用内填写提交信息并创建 Git 提交。
- 集成 PowerShell / POSIX Shell 终端，支持输入、清空和重启。
- 每个项目可保存一条运行命令，并从终端直接执行。
- Codex CLI 与 DeepSeek API 两种 Agent Provider。
- DeepSeek 支持安全 Key 存储、工具调用和逐次写文件审批。
- 默认只读分析，显式切换后允许 Agent 在项目沙箱内修改文件。
- Agent 完成后自动刷新文件树、打开文件和 Git 状态。
- Agent 任务、对话、审批和检查点使用 SQLite 持久化。
- 写文件和命令执行前自动创建项目检查点，可从任务历史恢复。
- 检查点不包含 `.git`、`node_modules`、构建产物和缓存，单次快照上限为 20000 个文件或 100 MB。
- 本地增量代码索引，支持文件名、符号和全文搜索。
- Agent 输入区可搜索并附加相关文件，DeepSeek 可使用 `search_code` 工具。
- 项目问题面板支持 TypeScript 默认诊断和自定义诊断命令。
- 诊断结果可跳转到文件位置，或附加上下文交给 Agent 修复。
- `Ctrl+K` 命令面板支持搜索和执行项目、Git、终端、诊断、索引与 Agent 操作。
- Agent 预设任务可审查文件、审查变更或修复项目诊断。
- 可保存项目工作流，并按顺序执行命令、诊断和 Agent 修复步骤。
- 工作流执行前自动创建检查点，执行结果会保存为 Agent 任务记录。
- 工作流结束时生成自动验收报告，包含步骤状态和文件增删行数。
- 检查点支持文件级 Monaco Diff 预览和完整项目恢复。
- 工作流支持验收规则，自动判定 `accepted`、`needs_review` 或 `blocked`。
- 内置 Node/TypeScript、Python 和通用项目工作流模板。
- 支持保存和复用跨项目全局工作流模板。
- 保存工作流运行历史，可按项目回看步骤结果、验收结论和变更报告。
- 安装版启动后自动检查 GitHub Releases，并支持下载、进度显示和重启安装。
- 路径安全、诊断解析和工作流规则已拆分为可测试核心模块。
- 使用 Vitest 提供自动化单元测试。
- 项目外路径访问防护与 2 MB 文本文件限制。
- 项目、任务、变更和终端区域的基础布局。
- 应用运行环境信息展示。

## 开发

```powershell
npm install
npm run dev
```

### Agent

DeepSeek 可以直接在 Agent 面板中配置 API Key，Key 使用 Electron 安全存储加密。也可以设置环境变量：

```powershell
$env:DEEPSEEK_API_KEY = "..."
$env:DEEPSEEK_MODEL = "deepseek-chat"
```

DeepSeek 适配器使用官方 [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) 和 [Function Calling](https://api-docs.deepseek.com/guides/function_calling)。读取、列目录和搜索自动执行；写文件和运行命令必须逐次审批。

Codex Provider 需要本机已安装 Codex CLI 并完成登录，也可以通过 `AI_IDE_CODEX_BIN` 指定路径。

快捷键：

- `Ctrl+O`：打开或切换项目。
- `Ctrl+S`：保存当前文件。
- `Ctrl+Shift+A`：暂存全部变更。
- `Ctrl+Shift+U`：取消暂存全部变更。
- `Ctrl+Enter`：提交已暂存的文件。

## 检查与构建

```powershell
npm run typecheck
npm test
npm run build
```

也可以运行 `npm run check` 同时执行类型检查和测试。

### Windows 安装包

生成免安装目录：

```powershell
npm run pack:win
```

生成 NSIS 安装包：

```powershell
npm run dist:win
```

产物写入 `release/`。`node-pty` 的 Node-API 原生模块会从 ASAR 中解包，确保集成终端在安装版中可用。

自动更新从 [GitHub Releases](https://github.com/wjiwjiwji/ai-ide/releases) 获取版本。发布新版本前先更新 `package.json` 中的版本号，然后使用带 `GH_TOKEN` 的环境运行：

```powershell
$env:GH_TOKEN = "..."
npm run release:win
```

## 当前边界

多 Agent 并行、完整 LSP 诊断和远程同步尚未接入。下一阶段从团队策略同步、模板版本和批量项目管理开始。

完整设计见项目上级目录中的 `AI原生IDE设计方案.md`。
