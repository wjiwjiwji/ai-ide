# AI IDE 开发、测试、打包与发布全流程

> 项目目录：`E:\Codex_Project\ai-ide`
>
> GitHub：https://github.com/wjiwjiwji/ai-ide
>
> 文档日期：2026-10-23
>
> 当前分支：`main`
> 已推送提交：`70c1a68 feat: add automatic updates and GitHub release support`

## 1. 当前状态

### 1.1 已完成

- Electron + React + TypeScript 桌面应用骨架。
- 新建项目、项目选择、最近项目、文件树和 Monaco 编辑器。
- VS Code 风格原生菜单：文件、编辑、选择、查看、转到、运行、终端、帮助。
- 资源管理器右键新建、重命名、移到回收站、定位文件、复制路径和在集成终端中打开。
- 资源管理器支持 `Delete`、`Shift+Delete` 和 `Enter` 键盘操作。
- C/C++ 当前文件自动编译运行，并在关闭未保存文件时确认。
- C/C++ 集成调试器：源码断点、单步、调用堆栈、局部变量和表达式求值。
- C/C++ 编辑时实时语法诊断、Monaco 波浪线和问题列表。
- 左右侧栏支持拖动调宽、显隐切换和布局记忆。
- 设置窗口支持背景主题、编辑器字号、自动换行和布局重置。
- “查看”菜单和底部面板支持显示/隐藏输出、调试控制台、调用堆栈和内存。
- 文件读取、编辑和保存。
- Git 状态、Diff、暂存、取消暂存和提交。
- PowerShell / POSIX Shell 集成终端。
- DeepSeek API Agent，以及可选的 Codex CLI Provider。
- Agent 工具调用审批、任务记录、检查点与恢复。
- SQLite 任务、检查点、代码索引、工作流模板和运行历史持久化。
- 文件名、代码符号和全文索引搜索。
- TypeScript/自定义命令诊断与 Agent 修复。
- 可保存的项目工作流、验收规则和运行报告。
- Windows NSIS 安装包与免安装目录。
- `node-pty` 原生模块 ASAR 解包。
- `electron-updater` 更新服务代码、IPC、界面和单元测试。
- GitHub 仓库、`main` 分支和 `v0.1.1` Release 资源。

### 1.2 已验证

- TypeScript 类型检查通过。
- 最新完整测试结果：13 个测试文件、49 个测试全部通过。
- Vite 生产构建通过。
- Windows 免安装目录曾成功生成。
- Windows NSIS 安装包曾成功生成。
- `node-pty` 文件已解包到 `app.asar.unpacked`。
- GitHub 账号 `wjiwjiwji` 已通过本机 Git 凭据验证。
- 代理开启后，GitHub Release API 可访问，HTTP 状态为 `200`。
- `v0.1.1` 安装包、`.blockmap` 和 `latest.yml` 已上传到 GitHub Release。

### 1.3 尚未验收

自动更新目前不能视为稳定可用。

- 打包版曾停在 `checking` 状态。
- 后续安装版冒烟测试中，窗口未正常渲染，调试端口也没有及时响应。
- 没有完成“安装旧版 → 发布新版 → 提示更新 → 下载 → 重启安装”的完整升级闭环。
- 当前 `v0.1.1` 只应视为测试发布，不要把它当作可靠自动更新源。
- 本地还有未提交的 `0.1.2` 代理修复代码，尚未发布。

## 2. 产品定位

本项目不是复刻整个 Visual Studio 或 VS Code，而是一个以 AI 任务为中心的个人项目工作台。

核心原则：

1. AI 优先：项目上下文、代码搜索、诊断、工作流和 Agent 任务集中在同一工作区。
2. 本地优先：代码、SQLite 数据库、检查点和工作流数据默认保存在本机。
3. Provider 可替换：默认支持 DeepSeek，也保留 Codex CLI。
4. 安全默认：Agent 默认只读；写入和命令执行需要明确审批。
5. 可恢复：写操作和命令操作前创建项目检查点。
6. 从实用功能开始：项目、编辑、Git、终端、Agent 和发布先形成完整闭环。

## 3. 技术栈

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| 桌面运行环境 | Electron 45 | 窗口、IPC、原生能力、自动更新 |
| UI | React 19 | 工作区、面板、状态管理 |
| 语言 | TypeScript 7 | 严格类型检查 |
| 构建 | electron-vite 6 / Vite 8 | 主进程、Preload、Renderer 构建 |
| 编辑器 | Monaco Editor 0.57 | 代码编辑和 Diff |
| 终端 | xterm.js + node-pty | 伪终端和 Shell 交互 |
| 本地存储 | Node.js `node:sqlite` | 任务、检查点、索引、工作流 |
| Agent | DeepSeek Chat Completions | 工具调用式代码 Agent |
| 可选 Agent | Codex CLI | 可替换 Provider |
| 测试 | Vitest 5 | 核心模块单元测试 |
| 打包 | electron-builder 26 | Windows NSIS 安装包 |
| 更新 | electron-updater 6 | GitHub Releases 更新检查与下载 |

本次文档生成时的环境：

```text
Node.js: v24.19.0
npm: 11.17.0
Git: 2.54.0.windows.1
OS: Windows
```

## 4. 总体架构

```text
Renderer / React / Monaco
          │
          │ window.desktop
          ▼
Preload / contextBridge
          │
          │ IPC
          ▼
Electron Main
  ├─ 项目与文件服务
  ├─ Git 服务
  ├─ PTY 终端服务
  ├─ Agent Coordinator
  ├─ SQLite 持久化
  ├─ 代码索引与诊断
  ├─ 工作流执行器
  └─ 自动更新服务
```

安全边界：

- Renderer 不直接获得 Node.js 文件系统权限。
- 所有文件路径都要经过项目根目录校验。
- Preload 只暴露 `DesktopApi` 中明确声明的方法。
- Agent 写文件和执行命令必须经过审批。
- 任务记录、检查点和工作流查询按项目隔离。
- API Key 不写入源码、Markdown、Git 提交或日志。

## 5. 目录结构

```text
ai-ide/
├─ electron-builder.yml
├─ electron.vite.config.ts
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ vitest.config.mts
├─ README.md
└─ src/
   ├─ shared/
   │  └─ desktop.ts
   ├─ preload/
   │  └─ index.ts
   ├─ main/
   │  ├─ index.ts
   │  └─ core/
   │     ├─ agent-coordinator.ts
   │     ├─ code-symbols.ts
   │     ├─ codex-agent.ts
   │     ├─ deepseek-agent.ts
   │     ├─ diagnostics.ts
   │     ├─ electron-update-adapter.ts
   │     ├─ git-service.ts
   │     ├─ git-status.ts
   │     ├─ path-security.ts
   │     ├─ persistence.ts
   │     ├─ terminal-service.ts
   │     ├─ text-utils.ts
   │     ├─ update-service.ts
   │     ├─ workflow.ts
   │     └─ workspace-files.ts
   └─ renderer/
      └─ src/
         ├─ App.tsx
         ├─ components/
         ├─ main.tsx
         ├─ monaco.ts
         └─ styles.css
```

## 6. 从零开始的开发步骤

### 6.1 创建 Electron + React + TypeScript 项目

主要配置：

- `electron.vite.config.ts`：构建 Main、Preload 和 Renderer。
- `src/main/index.ts`：Electron 主进程入口。
- `src/preload/index.ts`：安全桥接。
- `src/renderer/`：React 界面。
- `src/shared/desktop.ts`：主进程和渲染进程共享的类型与 API。

安装依赖：

```powershell
cd E:\Codex_Project\ai-ide
npm install
```

开发运行：

```powershell
npm run dev
```

### 6.2 实现项目与文件工作区

实现顺序：

1. 在“文件 → 新建项目”中输入项目名称。
2. 选择 C++ CMake、Python、Java Maven、TypeScript 或空项目模板。
3. 使用系统目录选择器选择父文件夹，并选择是否初始化 Git。
4. 校验名称长度、Windows 非法字符和保留名称。
5. 在父文件夹内创建同名目录并生成模板文件。
6. 为模板写入默认运行命令和诊断命令。
7. 立即打开新项目。
8. 使用系统目录选择器打开已有项目。
9. 保存最近项目列表。
10. 递归读取项目文件树。
11. 跳过 `.git`、`node_modules`、构建产物和缓存目录。
12. 使用 `realpath` 和 `path-security` 防止访问项目外路径。
13. 限制可读取文本文件大小。
14. 使用 Monaco 打开、编辑和保存文件。
15. 在资源管理器空白处或文件夹节点上右键创建文件、文件夹。
16. 新建文件后自动刷新资源管理器并打开文件。

核心模块：

- `workspace-files.ts`
- `path-security.ts`
- `project-service.ts`

新建项目 API：

```text
project:choose-parent
project:create
```

### 6.3 实现 VS Code 风格菜单

应用使用 Electron 原生应用菜单，不再在 React 页面中保留旧版 54px 自定义顶栏。

顶部菜单包括：

- 文件：新建项目、打开项目、保存、退出。
- 编辑：撤销、重做、剪切、复制、粘贴、删除。
- 选择：全选、命令面板。
- 查看：源码管理、问题、命令面板、全屏。
- 转到：转到文件、转到行、上一个/下一个编辑器。
- 运行：运行项目、诊断、工作流、Agent。
- 终端：显示终端、运行已保存命令。
- 帮助：使用指南、GitHub 仓库、检查更新、关于。

菜单通过 `app-menu:command` IPC 将操作发送给 React 渲染进程。普通编辑操作使用 Electron 原生菜单角色。

### 6.4 实现 Git 工作区

实现内容：

- 解析 `git status --porcelain`。
- 显示当前分支、ahead/behind 和变更文件。
- 单个或批量执行暂存、取消暂存。
- 查看 HEAD 与工作区文件的 Monaco Diff。
- 在应用内输入提交信息并创建提交。

核心模块：

- `git-status.ts`
- `git-service.ts`

### 6.5 实现集成终端

实现内容：

- Windows 使用 PowerShell。
- POSIX 系统使用环境中的 Shell。
- xterm.js 负责显示。
- node-pty 负责真实 PTY。
- 支持输入、尺寸变化、清空、重启和退出事件。

核心模块：

- Electron 主进程：`terminal-service.ts`
- React 界面：`TerminalPanel.tsx`

### 6.6 实现 DeepSeek Agent

默认推荐 DeepSeek，因为不要求 Codex 登录或代理。

配置方式一，环境变量：

```powershell
$env:DEEPSEEK_API_KEY = "..."
$env:DEEPSEEK_MODEL = "deepseek-chat"
npm run dev
```

配置方式二，在应用内填写 API Key。应用使用 Electron `safeStorage` 加密后保存。

Agent 工作流：

1. 创建 Agent 任务。
2. 将用户提示词和历史消息发送给 DeepSeek。
3. 解析 Function Calling 返回的工具请求。
4. 自动执行只读工具，例如列目录、读文件和搜索代码。
5. 写文件或执行命令前创建检查点并请求用户审批。
6. 将工具结果返回模型，继续下一轮。
7. 完成后保存任务、消息、Provider 和状态。

核心模块：

- `deepseek-agent.ts`
- `agent-coordinator.ts`
- `codex-agent.ts`

### 6.7 实现任务、审批与检查点

一次写入或命令执行前的安全步骤：

1. 确认任务属于当前项目。
2. 确认该任务没有正在运行。
3. 创建项目快照。
4. 快照跳过 `.git`、`node_modules`、构建产物和缓存。
5. 限制单次快照的文件数和总大小。
6. 执行 Agent 操作。
7. 保存检查点元数据。
8. 用户可查看文件级 Diff 或恢复完整检查点。

### 6.8 实现代码索引

索引流程：

1. 扫描项目中的可索引文件。
2. 跳过二进制文件和超大文件。
3. 使用文件修改时间和大小判断增量变化。
4. 将文件内容写入 `code_files`。
5. 将全文内容写入 FTS5 表 `code_fts`。
6. 提取函数、类、接口、变量等轻量符号，写入 `code_symbols`。
7. 支持文件名、符号和全文搜索。
8. 提供 `search_code` Agent 工具。

限制：

- 当前是轻量文本和正则索引，不是完整语义索引。
- 它不是 LSP，不提供完整定义跳转和类型推导。

### 6.9 实现诊断与 Agent 修复

诊断来源：

- 没有配置诊断命令时，可使用 TypeScript 默认诊断。
- 项目可保存自定义诊断命令。

诊断步骤：

1. 在项目根目录运行诊断命令。
2. 合并 stdout 和 stderr。
3. 解析 `file(line,column): severity message` 等常见格式。
4. 在问题面板中显示。
5. 点击问题跳转到文件位置。
6. 将问题和上下文附加到 Agent 修复任务。

### 6.10 实现工作流

支持的步骤：

- 命令。
- 诊断。
- Agent。

执行流程：

1. 保存项目工作流。
2. 执行前创建 Agent 任务和检查点。
3. 按顺序执行步骤。
4. 记录每个步骤的状态、退出码和输出。
5. 生成变更统计和验收报告。
6. 按规则判定：
   - `accepted`
   - `needs_review`
   - `blocked`
7. 保存运行历史。

### 6.11 SQLite 持久化重构

持久化最初集中在主进程 `index.ts`，后来拆分为仓储：

- `TaskRepository`
- `CheckpointRepository`
- `CodeIndexRepository`
- `WorkflowRepository`
- `AppDatabase`

数据库文件：

```text
%APPDATA%\ai-ide\ai-ide-tasks.sqlite
```

主要表：

- `agent_tasks`
- `agent_checkpoints`
- `code_files`
- `code_fts`
- `code_symbols`
- `workflow_templates`
- `workflow_runs`

重构结果：

- 主进程不再直接拼接业务 SQL。
- 代码索引和工作流查询集中到 `persistence.ts`。
- 数据库关闭逻辑统一在应用退出时执行。
- 项目和任务的跨项目隔离有测试覆盖。

## 7. 本地使用流程

### 7.1 第一次启动

```powershell
cd E:\Codex_Project\ai-ide
npm run dev
```

打开项目后可以：

- 浏览文件树。
- 编辑并保存代码。
- 查看 Git 变更。
- 打开终端。
- 配置 DeepSeek。
- 运行 Agent 任务。
- 重建代码索引。
- 运行诊断。
- 创建和执行工作流。

### 7.2 DeepSeek 使用

必须在环境中或应用设置中提供 `DEEPSEEK_API_KEY`。

不要执行：

```powershell
git add .env
git commit
```

不要在 Markdown、截图、提交信息、Issue 或 Release 中粘贴 API Key。

### 7.3 Agent 权限

- 默认模式：只读。
- 写入模式：必须显式切换。
- 写文件和运行命令：逐次审批。
- 恢复检查点：Agent 运行期间禁止。

## 8. 测试

完整检查：

```powershell
npm run check
```

它等价于：

```powershell
npm run typecheck
npm test
```

当前测试覆盖：

- 路径安全。
- 工作区文件读取。
- Git 状态解析。
- Git 服务。
- 代码符号提取。
- 诊断解析。
- 工作流规则。
- 终端服务。
- DeepSeek 工具循环与审批。
- Codex 事件解析。
- Agent 协调、取消和所有权。
- SQLite 任务、检查点、索引和工作流仓储。
- 自动更新状态机。

当前基线：

```text
Test Files: 13 passed
Tests:      49 passed
TypeScript: passed
```

注意：单元测试通过不代表安装版 UI、GitHub 下载和覆盖升级已经通过。

## 9. Windows 打包

### 9.1 生成免安装目录

```powershell
npm run pack:win
```

输出：

```text
release\win-unpacked\
```

### 9.2 生成安装包

```powershell
npm run dist:win
```

输出示例：

```text
release\AI-IDE-0.1.1-x64-Setup.exe
release\AI-IDE-0.1.1-x64-Setup.exe.blockmap
release\latest.yml
```

### 9.3 打包配置说明

`electron-builder.yml` 中的关键配置：

- `appId: com.local.ai-ide`：应用身份，升级时保持稳定。
- `productName: AI IDE`：安装后的产品名称。
- `asar: true`：应用文件打入 ASAR。
- `asarUnpack: node_modules/node-pty/**/*`：原生模块和可执行文件必须解包。
- `npmRebuild: false`：node-pty 使用 Node-API 预编译文件，不做无意义的 Electron ABI 重建。
- `perMachine: false`：默认安装到当前用户。
- `deleteAppDataOnUninstall: false`：卸载时保留项目记录、任务和设置。

### 9.4 检查原生终端模块

打包后必须确认：

```text
release\win-unpacked\resources\app.asar.unpacked\node_modules\node-pty\
```

其中应包含当前平台和架构的 `.node`、`conpty.dll`、`OpenConsole.exe` 等文件。

## 10. GitHub 仓库步骤

### 10.1 创建仓库

已创建：

```text
https://github.com/wjiwjiwji/ai-ide
```

仓库为 Public，原因：

- GitHub Releases 自动更新不需要在客户端内置私有仓库令牌。
- 测试阶段可以直接从公开 Release 读取 `latest.yml` 和安装包。

### 10.2 初始化本地仓库

```powershell
cd E:\Codex_Project\ai-ide
git init -b main
git remote add origin https://github.com/wjiwjiwji/ai-ide.git
git add .
git commit -m "feat: add automatic updates and GitHub release support"
git push -u origin main
```

实际首次提交：

```text
70c1a68 feat: add automatic updates and GitHub release support
```

### 10.3 `.gitignore`

以下内容不应提交：

```text
node_modules/
out/
dist/
release/
*.log
```

安装包、构建结果和日志可以从源码重新生成。

## 11. GitHub Release 发布

### 11.1 版本号规则

每次发布前必须增加 `package.json` 和 `package-lock.json` 的版本。

示例：

```text
0.1.1 → 0.1.2
```

自动更新只接受比当前版本更高的版本号。

### 11.2 发布资产

一个可用的 Windows GitHub Release 至少包含：

```text
AI-IDE-<version>-x64-Setup.exe
AI-IDE-<version>-x64-Setup.exe.blockmap
latest.yml
```

三个文件必须来自同一次构建。

### 11.3 自动发布命令

GitHub Token 需要具备 Release 和仓库内容写入权限。

```powershell
$env:GH_TOKEN = "..."
npm run release:win
```

不要把 Token 写入脚本、`.env` 并提交到 Git。

### 11.4 手动发布步骤

1. 运行 `npm run dist:win`。
2. 打开 GitHub 仓库的 Releases。
3. 新建标签，例如 `v0.1.2`。
4. 标题填写 `AI IDE 0.1.2`。
5. 上传 `.exe`、`.blockmap` 和 `latest.yml`。
6. 不要勾选 Draft。
7. 不要勾选 Pre-release，除非应用主动允许预发布版本。
8. 发布后确认 `latest.yml` 可以直接访问。

已发布的测试 Release：

```text
https://github.com/wjiwjiwji/ai-ide/releases/tag/v0.1.1
```

### 11.5 Release 校验

检查：

- Release 不是 Draft。
- Release 不是 Pre-release。
- 标签版本与 `latest.yml` 的 `version` 一致。
- `latest.yml` 中的文件名与安装包完全一致。
- SHA-512、文件大小和上传文件一致。
- GitHub Release API 返回的是最新版本。

## 12. 自动更新实现步骤

### 12.1 安装依赖

```powershell
npm install electron-updater
```

### 12.2 主进程

自动更新服务拆为：

- `update-service.ts`：可测试的状态机。
- `electron-update-adapter.ts`：electron-updater 与 Electron 适配。

状态：

- `idle`
- `checking`
- `available`
- `not-available`
- `downloading`
- `downloaded`
- `error`
- `disabled`

### 12.3 自动检查

打包版创建窗口后延迟约 4 秒检查更新。

开发模式：

- 显示 `disabled`。
- 不访问 GitHub。
- 必须使用打包版测试更新。

### 12.4 用户操作

发现新版本后：

1. 状态栏版本按钮变为“可更新版本号”。
2. 右上角显示更新横幅。
3. 用户点击“下载更新”。
4. 下载时显示百分比。
5. 下载完成后提示“重启并安装”。
6. `autoUpdater.quitAndInstall()` 执行覆盖升级。

当前设置为手动下载，不是后台静默下载。

### 12.5 IPC 接口

```text
updates:get-status
updates:check
updates:download
updates:install
updates:status
```

Preload 暴露：

```text
getUpdateStatus()
checkForUpdates()
downloadUpdate()
installUpdate()
onUpdateStatus(callback)
```

### 12.6 发布源

`electron-builder.yml`：

```yaml
publish:
  provider: github
  owner: wjiwjiwji
  repo: ai-ide
  releaseType: release
```

打包后生成：

```text
release\win-unpacked\resources\app-update.yml
```

内容应包含：

```yaml
owner: wjiwjiwji
repo: ai-ide
provider: github
releaseType: release
```

### 12.7 网络代理

当前本地 `0.1.2` 未提交修复采用的原则：

- 默认让更新检查直连 GitHub。
- `AI_IDE_UPDATER_PROXY` 可指定代理。
- `AI_IDE_UPDATER_USE_SYSTEM_PROXY=1` 可要求使用系统代理。

示例：

```powershell
$env:AI_IDE_UPDATER_PROXY = "http://127.0.0.1:7890"
```

或：

```powershell
$env:AI_IDE_UPDATER_USE_SYSTEM_PROXY = "1"
```

注意：该修复尚未完成打包验收，也没有提交或发布。

## 13. 更新问题排查记录

### 13.1 第一次问题

表现：

- 打包应用启动成功。
- 更新状态一直停在 `checking`。
- GitHub 网页和外部 `curl` 可以访问。
- Electron 的更新请求没有正常完成。

怀疑原因：

- Windows 系统里残留 `127.0.0.1` 代理配置。
- Chromium/Electron 网络层可能继续使用已关闭或失效的代理。

### 13.2 第一次修复尝试

代码曾尝试：

```text
session.fromPartition("electron-updater").setProxy(...)
```

结果：

- 在应用启动阶段添加 `await setProxy()` 后，应用窗口与调试端口异常。
- 该方案被放弃。

### 13.3 第二次修复尝试

改为在应用 ready 前使用 Chromium 启动参数：

```text
--no-proxy-server
```

同时保留代理环境变量作为显式覆盖。

结果：

- 类型检查和 49 个测试通过。
- `0.1.2` 打包过程在 `packaging platform` 阶段长时间无输出。
- 为遵守“如果不行先不弄”，打包被中止。

### 13.4 安装版冒烟测试

测试对象：

```text
AI-IDE-0.1.1-x64-Setup.exe
```

测试步骤：

1. 将安装包静默安装到 `release\update-smoke-install`。
2. 使用本地 Chromium 调试端口启动。
3. 等待更新检查。
4. 截图检查窗口状态。

结果：

- 安装器返回 `0`。
- 应用进程存在。
- 窗口没有正常显示 IDE 内容。
- 调试端口可以监听，但 HTTP 请求超时。
- 自动更新无法完成验收。

清理：

- 关闭测试进程。
- 使用安装器自带卸载程序卸载。
- 确认测试安装目录已删除。
- 删除临时日志和截图。

### 13.5 GitHub 网络验证

代理开启后：

```powershell
curl.exe -sS -m 12 -o NUL -w "%{http_code} %{time_total}" `
  https://api.github.com/repos/wjiwjiwji/ai-ide/releases/latest
```

结果：

```text
200 0.667313
```

说明代理本身可以访问 GitHub，但不等于 Electron 应用内更新检查已经通过。

## 14. 当前 Git 状态

已推送：

```text
70c1a68 feat: add automatic updates and GitHub release support
```

当前未提交修改：

```text
README.md
package.json
package-lock.json
src/main/index.ts
src/main/core/electron-update-adapter.ts
```

这些修改主要是：

- 版本提升到 `0.1.2`。
- 更新网络代理策略调整。
- README 中的代理说明。

在更新服务验收前，不要继续发布这些改动。

## 15. 恢复自动更新开发的建议顺序

### 15.1 先恢复稳定启动

目标：先确认安装版 IDE 能正常显示，不携带任何更新网络实验。

1. 暂时禁用自动更新自动检查。
2. 使用 `npm run pack:win` 生成全新免安装目录。
3. 启动并确认文件树、编辑器、终端均可用。
4. 再手动点击“检查更新”。

### 15.2 抓主进程日志

```powershell
$env:ELECTRON_ENABLE_LOGGING = "1"
.\release\win-unpacked\"AI IDE.exe" --enable-logging --v=1
```

需要检查：

- Renderer 是否加载 `out/renderer/index.html`。
- 是否出现 CSP、模块加载或 Preload 错误。
- `electron-updater` 是否产生 error 事件。
- 请求是卡在 DNS、代理、TLS，还是文件校验。

### 15.3 缩短失败反馈

更新检查应增加超时：

- 检查更新超时：建议 30 至 60 秒。
- 下载更新超时：单独设置更长时间。
- 超时后显示明确错误，而不是永久停在 `checking`。

### 15.4 完整升级测试

必须使用两个版本：

1. 安装 `0.1.2`。
2. 发布 `0.1.3`。
3. 启动 `0.1.2`。
4. 确认出现 `0.1.3` 下载提示。
5. 下载并确认进度。
6. 重启安装。
7. 检查应用版本、用户数据和项目记录是否保留。

## 16. 常见问题

### 16.1 `spawn EPERM`

现象：

```text
Error: spawn EPERM
```

原因：

- 受限环境中 Vite 或 Electron Builder 无法创建子进程。

处理：

- 在正常的本地终端运行。
- 如果使用受限制的执行环境，需要允许在沙箱外调用 npm/Electron Builder。

### 16.2 Git 推送连接 `127.0.0.1`

现象：

```text
Failed to connect to github.com port 443 via 127.0.0.1
```

处理：

1. 检查系统代理是否开启。
2. 检查代理端口是否正确。
3. 确认 Git 和浏览器使用同一网络路径。
4. 必要时重新推送：

```powershell
git push -u origin main
```

### 16.3 `node-pty` 在安装版中不可用

检查：

- `asarUnpack` 是否包含 `node_modules/node-pty/**/*`。
- 当前平台预编译目录是否存在。
- `OpenConsole.exe`、`conpty.dll` 是否被安全软件隔离。
- 是否错误地把所有原生文件封装在 ASAR 内。

### 16.4 GitHub Release 有文件但不提示更新

检查：

1. `package.json` 版本是否已经提高。
2. Release 是否发布而不是 Draft。
3. Release 是否被标记为 Pre-release。
4. `latest.yml` 是否上传。
5. `latest.yml` 版本是否与安装包一致。
6. `app-update.yml` 的 owner/repo 是否正确。
7. 安装包和 `latest.yml` 是否来自同一次构建。
8. 当前安装版是否能访问 GitHub。

### 16.5 更新一直显示“检查中”

可能原因：

- 网络请求没有超时。
- 代理无法访问 GitHub。
- TLS 或证书错误。
- 应用资源和 `app-update.yml` 缺失。
- 主进程事件循环被其他同步任务阻塞。

当前版本就存在这个问题，尚未修复完成。

## 17. 安全注意事项

- 不要把 DeepSeek API Key 上传到 GitHub。
- 不要把 GitHub Token 写入 `package.json`、脚本或 Release。
- 不要将用户项目数据、SQLite 数据库和检查点提交到仓库。
- 安装包目前没有代码签名，Windows 可能显示“未知发布者”。
- 测试更新源为公开仓库；项目代码和 Release 都可被公开访问。
- Agent 只读模式仍然是推荐的默认模式。

## 18. 当前未完成的产品能力

- 完整 LSP：定义跳转、引用查找、代码补全、重命名。
- 断点调试器。
- 文件系统 watcher 和外部文件变化实时同步。
- 多项目同时打开。
- 搜索和替换。
- 设置中心和可配置主题。
- 自动更新完整验收。
- 应用图标。
- 代码签名。
- 自动更新失败重试与超时。
- 长期稳定性和大项目性能测试。

## 19. 命令速查

```powershell
# 安装依赖
npm install

# 开发
npm run dev

# 类型检查
npm run typecheck

# 单元测试
npm test

# 类型检查 + 单元测试
npm run check

# 生产构建
npm run build

# Windows 免安装目录
npm run pack:win

# Windows 安装包
npm run dist:win

# 构建并发布到 GitHub Release
$env:GH_TOKEN = "..."
npm run release:win

# 查看 Git 状态
git status --short

# 提交
git add .
git commit -m "说明本次修改"

# 推送
git push
```

## 20. 交付结论

AI IDE 的主体功能已经形成个人可用的 MVP，源码和 Windows 安装包已经进入 GitHub。

自动更新功能完成了依赖、配置、状态机、IPC 和界面，但安装版运行验收没有通过。当前应暂停更新服务发布，先恢复安装版稳定启动，再用两个连续版本完成真实升级测试。

在完成上述验收前：

- 可以使用 IDE 的主工作区功能。
- 不要把 `v0.1.1` 视为可靠自动更新版本。
- 不要发布本地未提交的 `0.1.2` 改动。
- 不要删除现有 GitHub 仓库和 Release，先保留用于问题定位。
