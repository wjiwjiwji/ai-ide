# AI IDE

一个面向个人使用的 AI 原生项目工作台。

当前版本实现了 Electron + React + TypeScript 项目工作台，包括：

- 安全的 Electron 主进程与 Preload 桥接。
- AI 任务优先的三栏界面。
- 侧边栏和右侧检查器支持拖动调整宽度、隐藏和布局记忆。
- 设置窗口支持曜石黑、石墨灰、深海蓝和松林绿四套背景，编辑器字号、自动换行和布局重置会持久化。
- “查看”菜单可开关资源管理器、代码搜索、源码管理、Agent、问题、输出、调试控制台、调用堆栈、内存和终端。
- 工具标签可撕成多个浮动窗口，并拖回底部左/右拼接或合并为同一组标签；分栏宽度和布局会持久化。
- 新建项目支持 C++ CMake、Python、Java Maven、TypeScript 和空项目模板，自动生成源码、构建配置、README、Git 配置和默认运行/诊断命令。
- 本地项目选择器与最近项目记录。
- VS Code 风格原生菜单：文件、编辑、选择、查看、转到、运行、终端、帮助。
- 项目目录树和文件折叠浏览。
- 资源管理器支持项目和文件夹右键新建、重命名、移到回收站、在文件资源管理器中显示、复制路径和在集成终端中打开；文件节点支持打开、重命名、移到回收站和复制路径。
- 资源管理器选中项支持 `Delete` 移到回收站、`Shift+Delete` 永久删除和 `Enter` 打开。
- 资源管理器在代码界面保持单击打开；在 Agent 会话中单击只选中，双击文件才打开只读预览浮窗。
- Monaco Editor 代码编辑、标签页和文件保存。
- C/C++ 文件可按 `Ctrl+F5` 自动检测 MSVC/GCC/Clang、编译并在集成终端运行。
- C/C++ 调试器支持源码断点、继续、暂停、单步进入/跳过/退出、调用堆栈和局部变量。
- C/C++ 编辑过程中自动进行语法检查，并在 Monaco 中显示波浪线和问题列表。
- 关闭未保存标签时提示保存、不保存或取消。
- Git 分支、ahead/behind 和未提交文件状态。
- Monaco Diff 查看 HEAD 与工作区之间的代码变化。
- 单文件和批量暂存、取消暂存。
- 从应用内填写提交信息并创建 Git 提交。
- 集成 PowerShell / POSIX Shell 终端，支持输入、清空和重启。
- 每个项目可保存一条运行命令，并从终端直接执行。
- Codex CLI 与 DeepSeek API 两种 Agent Provider。
- DeepSeek 支持安全 Key 存储、工具调用和逐次写文件审批。
- Monaco 支持 Agent 内联代码补全；输入时自动请求，也可用 `Alt+\` 主动触发，并在编辑器内预览、接受或拒绝。
- C++ 函数右键菜单支持查看声明、查看定义；头文件声明没有实现时可一键生成带空实现体的源文件函数。
- 默认只读分析，显式切换后允许 Agent 在项目沙箱内修改文件。
- Agent 完成后自动刷新文件树、打开文件和 Git 状态。
- Agent 任务、对话、审批和检查点使用 SQLite 持久化。
- Agent 默认作用于整个当前项目，并自动获得活动文件、代码选区、未保存缓冲区、打开文件、Git 变更和诊断文件摘要；手动固定关注文件是可选项。
- 资源管理器右键可直接让 Agent 检查文件、以文件夹为范围创建任务，Agent 的上下文标签和修改文件路径也可跳回编辑器或资源管理器。
- Agent 会话中点击资源管理器文件会打开只读预览浮窗；Agent 每轮会汇总本轮修改、新增、删除和重命名的文件，并可从汇总直接预览。
- Monaco 编辑器右键可让 Agent 询问当前文件、解释代码选区或为选区设计修改方案，并自动携带文件、行号和选中代码。
- 写文件和命令执行前自动创建项目检查点，可从任务历史恢复。
- 检查点不包含 `.git`、`node_modules`、构建产物和缓存，单次快照上限为 20000 个文件或 100 MB。
- 本地增量代码索引，支持文件名、符号和全文搜索。
- Agent 输入区可搜索并附加相关文件，DeepSeek 可使用 `search_code` 工具。
- 项目问题面板支持 TypeScript 默认诊断和自定义诊断命令。
- 诊断结果可跳转到文件位置，或附加上下文交给 Agent 修复。
- `Ctrl+P` 快速打开文件，`Ctrl+Shift+P` 或 `F1` 打开命令面板，支持执行项目、Git、终端、诊断、索引与 Agent 操作。
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

Agent 内联补全会把当前光标附近的代码片段发送给已配置的 DeepSeek 模型，用于生成只插入到光标处的代码。可在状态栏关闭“AI 补全”，也可通过命令面板执行“触发 Agent 代码补全”。

Codex Provider 需要本机已安装 Codex CLI 并完成登录，也可以通过 `AI_IDE_CODEX_BIN` 指定路径。

快捷键：

- `F5`：启动调试；暂停时继续运行。
- `F9`：切换当前行断点。
- `F10`：单步跳过。
- `F11`：单步进入。
- `Shift+F11`：单步退出。
- `Shift+F5`：停止调试。
- `Ctrl+F5`：不调试直接运行当前 C/C++ 文件。
- `Ctrl+Shift+N`：新建项目。
- `Ctrl+,`：打开设置。
- `Ctrl+O`：打开或切换项目。
- `Ctrl+S`：保存当前文件。
- `Ctrl+W`：关闭当前编辑器；未保存时进入保存确认流程。
- `Ctrl+P`：按文件名或路径快速打开项目文件。
- `Ctrl+Shift+P`、`F1` 或 Visual Studio 风格的 `Ctrl+Q`：打开命令面板。
- `Ctrl+J`：显示或隐藏底部工具面板。
- `Ctrl+Shift+U`：显示输出面板。
- `F2`：在资源管理器焦点内重命名选中项。
- `Alt+\`：在编辑器光标处触发 Agent 代码补全。
- `Ctrl+Shift+A`：暂存全部变更。
- `Ctrl+Shift+Alt+U`：取消暂存全部变更。
- `Ctrl+Enter`：提交已暂存的文件。

## 检查与构建

```powershell
npm run typecheck
npm test
npm run build
```

也可以运行 `npm run check` 同时执行类型检查和测试。

首次使用 C/C++ 调试器时安装本地调试组件：

```powershell
npm run debugger:setup
```

该命令会下载微软官方 C/C++ Debug Adapter 和 GCC/GDB 工具链到被 Git 忽略的 `.debugger/` 目录。

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

更新检查默认直连 GitHub。需要代理时可设置 `AI_IDE_UPDATER_PROXY`，或设置 `AI_IDE_UPDATER_USE_SYSTEM_PROXY=1` 使用系统代理。

## 当前边界

多 Agent 并行、完整 LSP 诊断和远程同步尚未接入。下一阶段从团队策略同步、模板版本和批量项目管理开始。

完整设计见项目上级目录中的 `AI原生IDE设计方案.md`。

开发、测试、Windows 打包、GitHub 发布、自动更新排障和当前状态的完整记录见 [AI-IDE开发与发布全流程.md](./AI-IDE开发与发布全流程.md)。
