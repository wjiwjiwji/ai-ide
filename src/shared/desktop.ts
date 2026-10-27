export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
  electronVersion: string
}

export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface AppUpdateStatus {
  state: AppUpdateState
  currentVersion: string
  availableVersion: string | null
  progress: AppUpdateProgress | null
  message: string
  checkedAt: string | null
}

export interface MemoryProcessMetric {
  pid: number
  type: string
  memoryMB: number
  cpuPercent: number
}

export interface MemoryMetrics {
  processes: MemoryProcessMetric[]
  totalMemoryMB: number
  freeMemoryMB: number
  timestamp: string
}

export interface ProjectInfo {
  id: string
  name: string
  path: string
  lastOpenedAt: string
}

export interface ProjectAvailability {
  project: ProjectInfo | null
  available: boolean
}

export interface CreateProjectInput {
  parentPath: string
  name: string
  template: ProjectTemplateId
  initializeGit: boolean
}

export type ProjectTemplateId =
  | 'empty'
  | 'cpp-console'
  | 'python-app'
  | 'java-maven'
  | 'typescript-node'

export interface ProjectTemplateDefinition {
  id: ProjectTemplateId
  name: string
  badge: string
  description: string
  language: string
  runCommand: string
  diagnosticsCommand: string
}

export const PROJECT_TEMPLATES: ProjectTemplateDefinition[] = [
  {
    id: 'cpp-console',
    name: 'C++ 控制台',
    badge: 'C++',
    description: 'CMake、C++20，src/Headers 与 src/Sources 分离。',
    language: 'C++',
    runCommand: 'cmake -S . -B build && cmake --build build',
    diagnosticsCommand: 'cmake --build build'
  },
  {
    id: 'python-app',
    name: 'Python 应用',
    badge: 'PY',
    description: 'pyproject.toml、main.py 和 Python 包配置。',
    language: 'Python',
    runCommand: 'python main.py',
    diagnosticsCommand: 'python -m compileall -q .'
  },
  {
    id: 'java-maven',
    name: 'Java Maven',
    badge: 'JV',
    description: '标准 Maven 目录、App 类和 JUnit 5 测试。',
    language: 'Java',
    runCommand: 'mvn exec:java -Dexec.mainClass=com.example.app.App',
    diagnosticsCommand: 'mvn -q -DskipTests compile'
  },
  {
    id: 'typescript-node',
    name: 'TypeScript',
    badge: 'TS',
    description: 'Node.js、TypeScript、tsx 和类型检查脚本。',
    language: 'TypeScript',
    runCommand: 'npm run dev',
    diagnosticsCommand: 'npm run typecheck'
  },
  {
    id: 'empty',
    name: '空项目',
    badge: '∅',
    description: '只生成 README、.gitignore 和 EditorConfig。',
    language: '通用',
    runCommand: '',
    diagnosticsCommand: ''
  }
]

export type WorkspaceViewSlot = 1 | 2 | 3 | 4 | 5

export type AppMenuCommand =
  | 'app:settings'
  | 'project:new'
  | 'project:open'
  | 'file:save'
  | 'file:close-editor'
  | 'file:run-cpp'
  | 'file:run-python'
  | 'debug:start'
  | 'debug:continue'
  | 'debug:pause'
  | 'debug:step-over'
  | 'debug:step-in'
  | 'debug:step-out'
  | 'debug:toggle-breakpoint'
  | 'debug:stop'
  | 'agent:open'
  | 'workflow:open'
  | 'view:changes'
  | 'view:toggle-sidebar'
  | 'view:toggle-inspector'
  | 'view:dock-inspector-right'
  | 'view:dock-inspector-bottom'
  | `view:save-scheme-${WorkspaceViewSlot}`
  | `view:apply-scheme-${WorkspaceViewSlot}`
  | 'view:toggle-terminal'
  | 'view:toggle-bottom-panel'
  | 'view:toggle-activity-bar'
  | 'view:reset-layout'
  | 'view:explorer'
  | 'view:search'
  | 'view:run'
  | 'view:source-control'
  | 'view:problems'
  | 'view:error-list'
  | 'view:diagnostic-tools'
  | 'view:output'
  | 'view:debug-console'
  | 'view:call-stack'
  | 'view:memory'
  | 'view:toggle-word-wrap'
  | 'view:agent'
  | 'diagnostics:run'
  | 'command-palette:open'
  | 'command-palette:files'
  | 'editor:goto-line'
  | 'editor:next'
  | 'editor:previous'
  | 'terminal:open'
  | 'terminal:run'
  | 'updates:check'
  | 'help:about'

export type EditAction =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select-all'

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileEntry[]
}

export interface FileContent {
  path: string
  content: string
  size: number
}

export interface CreateWorkspaceEntryInput {
  directoryPath: string
  type: 'file' | 'directory'
  name: string
  content?: string
  createParentDirectories?: boolean
}

export interface RenameWorkspaceEntryInput {
  path: string
  name: string
}

export interface CppRunPreparation {
  command: string
  compiler: string
  executablePath: string
}

export interface PythonRunPreparation {
  command: string
  interpreter: string
  sourcePath: string
}

export interface CppSyntaxCheckResult {
  output: string
  sourcePath: string
  temporarySource: string
}

export interface DebugBreakpoint {
  path: string
  line: number
}

export interface DebugStackFrame {
  id: number
  name: string
  source: string | null
  line: number
  column: number
}

export interface DebugVariable {
  name: string
  value: string
  type: string | null
  variablesReference: number
}

export interface DebugThread {
  id: number
  name: string
}

export interface DebuggerSnapshot {
  state: 'idle' | 'starting' | 'running' | 'paused' | 'exited' | 'error'
  message: string
  frames: DebugStackFrame[]
  variables: DebugVariable[]
  threads: DebugThread[]
  programOutput: string[]
  output: string[]
}

export type GitChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  | 'unknown'

export interface GitFileChange {
  path: string
  originalPath?: string
  indexStatus: string
  workTreeStatus: string
  kind: GitChangeKind
  staged: boolean
  unstaged: boolean
}

export interface GitStatus {
  isRepository: boolean
  branch: string | null
  ahead: number
  behind: number
  changes: GitFileChange[]
  error?: string
}

export interface GitignoreRepairResult {
  path: string
  changed: boolean
  addedPatterns: string[]
}

export interface GitFileDiff {
  path: string
  originalPath?: string
  originalContent: string
  modifiedContent: string
  isBinary: boolean
}

export interface GitCommitResult {
  status: GitStatus
  commitHash: string
  summary: string
}

export interface TerminalSessionInfo {
  id: string
  shell: string
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number
}

export type AgentRunMode = 'read-only' | 'workspace-write'
export type AgentProvider = 'codex' | 'deepseek'

export interface AgentProviderStatus {
  deepseekConfigured: boolean
  deepseekSource: 'environment' | 'stored' | 'none'
  deepseekModel: string
  codexAvailable: boolean
}

export interface AgentCodeCompletionRequest {
  path: string
  language: string
  prefix: string
  suffix: string
}

export interface AgentCodeCompletionResult {
  completion: string
  cached: boolean
  error?: string
}

export interface AgentRunInfo {
  runId: string
  mode: AgentRunMode
  provider: AgentProvider
}

export interface AgentStreamEvent {
  runId: string
  type: string
  threadId?: string
  item?: {
    id?: string
    type?: string
    text?: string
    command?: string
    status?: string
    exitCode?: number
    aggregatedOutput?: string
    changes?: Array<{ path: string; kind?: string }>
  }
  usage?: {
    input_tokens?: number
    cached_input_tokens?: number
    output_tokens?: number
    reasoning_output_tokens?: number
  }
  message?: string
  approvalId?: string
}

export type AgentTaskStatus =
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AgentTaskEntry {
  id: string
  kind: 'user' | 'assistant' | 'system' | 'error' | 'tool'
  text?: string
  toolType?: string
  title?: string
  detail?: string
  status?: string
  changes?: string[]
  approvalId?: string
  contextFiles?: string[]
  autoFocusFiles?: string[]
}

export interface AgentTaskSummary {
  id: string
  projectId: string
  title: string
  provider: AgentProvider
  mode: AgentRunMode
  status: AgentTaskStatus
  createdAt: string
  updatedAt: string
}

export interface AgentTaskRecord extends AgentTaskSummary {
  entries: AgentTaskEntry[]
  threadId: string | null
  usageText: string
}

export interface AgentTaskSaveInput {
  id: string
  title: string
  provider: AgentProvider
  mode: AgentRunMode
  status: AgentTaskStatus
  entries: AgentTaskEntry[]
  threadId: string | null
  usageText: string
}

export interface AgentCheckpointInfo {
  id: string
  taskId: string
  label: string
  createdAt: string
  restoredAt: string | null
}

export interface CheckpointFileChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
  addedLines: number
  deletedLines: number
  isBinary: boolean
}

export interface CheckpointDiff {
  checkpointId: string
  label: string
  createdAt: string
  files: CheckpointFileChange[]
  addedFiles: number
  modifiedFiles: number
  deletedFiles: number
  addedLines: number
  deletedLines: number
}

export interface CheckpointFileDiff {
  checkpointId: string
  path: string
  status: 'added' | 'modified' | 'deleted'
  originalContent: string
  modifiedContent: string
  isBinary: boolean
}

export type CodeIndexState = 'idle' | 'indexing' | 'ready' | 'error'

export interface CodeIndexStatus {
  state: CodeIndexState
  indexedFiles: number
  indexedSymbols: number
  updatedAt: string | null
  error?: string
}

export interface CodeSearchResult {
  path: string
  line: number
  kind: 'file' | 'symbol' | 'text'
  label: string
  snippet: string
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface ProjectDiagnostic {
  file: string
  line: number
  column: number
  severity: DiagnosticSeverity
  message: string
  code?: string
}

export interface DiagnosticsResult {
  command: string
  state: 'idle' | 'running' | 'ready' | 'error'
  items: ProjectDiagnostic[]
  error?: string
  updatedAt: string | null
}

export type WorkflowStepKind = 'command' | 'diagnostics' | 'agent'

export interface WorkflowStep {
  id: string
  kind: WorkflowStepKind
  label: string
  command?: string
  prompt?: string
  continueOnError: boolean
}

export interface WorkflowAcceptanceRules {
  requireAllStepsSuccess: boolean
  requireDiagnosticsPass: boolean
  maxChangedFiles: number
  maxChangedLines: number
}

export interface WorkflowAcceptanceResult {
  decision: 'accepted' | 'needs_review' | 'blocked'
  reasons: string[]
  rules: WorkflowAcceptanceRules
}

export interface ProjectWorkflow {
  id: string
  name: string
  steps: WorkflowStep[]
  acceptance: WorkflowAcceptanceRules
  updatedAt: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  steps: WorkflowStep[]
  acceptance: WorkflowAcceptanceRules
  createdAt: string
  updatedAt: string
}

export interface WorkflowRunSummary {
  id: string
  taskId: string
  projectId: string
  workflowId: string
  workflowName: string
  status: WorkflowRunResult['status']
  acceptance: WorkflowAcceptanceResult['decision']
  createdAt: string
}

export interface WorkflowRunRecord extends WorkflowRunSummary {
  result: WorkflowRunResult
}

export interface WorkflowStepResult {
  stepId: string
  label: string
  kind: WorkflowStepKind
  status: 'success' | 'failed' | 'skipped'
  exitCode?: number
  output: string
}

export interface WorkflowRunResult {
  runId: string
  taskId: string
  checkpointId: string | null
  workflowId: string
  workflowName: string
  status: 'completed' | 'failed' | 'needs_review'
  steps: WorkflowStepResult[]
  agentPrompt: string | null
  changes: CheckpointDiff | null
  report: string
  acceptance: WorkflowAcceptanceResult
  updatedAt: string
}

export interface DesktopApi {
  getAppInfo: () => Promise<AppInfo>
  getUpdateStatus: () => Promise<AppUpdateStatus>
  checkForUpdates: () => Promise<AppUpdateStatus>
  downloadUpdate: () => Promise<AppUpdateStatus>
  installUpdate: () => Promise<void>
  onUpdateStatus: (callback: (status: AppUpdateStatus) => void) => () => void
  onAppMenuCommand: (callback: (command: AppMenuCommand) => void) => () => void
  onCloseRequested: (callback: () => void) => () => void
  performEditAction: (action: EditAction) => Promise<void>
  toggleFullScreen: () => Promise<void>
  quitApp: () => Promise<void>
  confirmClose: () => Promise<void>
  setUnsavedFileCount: (count: number) => void
  chooseProjectParent: () => Promise<string | null>
  createProject: (input: CreateProjectInput) => Promise<ProjectInfo>
  openProject: () => Promise<ProjectInfo | null>
  openRecentProject: (path: string) => Promise<ProjectInfo>
  listRecentProjects: () => Promise<ProjectInfo[]>
  getCurrentProject: () => Promise<ProjectInfo | null>
  checkProjectAvailability: () => Promise<ProjectAvailability>
  closeCurrentProject: () => Promise<void>
  getFileTree: () => Promise<FileEntry[]>
  readFile: (path: string) => Promise<FileContent>
  saveFile: (path: string, content: string) => Promise<void>
  createWorkspaceEntry: (
    input: CreateWorkspaceEntryInput
  ) => Promise<FileEntry>
  renameWorkspaceEntry: (
    input: RenameWorkspaceEntryInput
  ) => Promise<FileEntry>
  trashWorkspaceEntry: (path: string) => Promise<void>
  deleteWorkspaceEntry: (path: string) => Promise<void>
  revealWorkspaceEntry: (path: string) => Promise<void>
  getMemoryMetrics: () => Promise<MemoryMetrics>
  prepareCppRun: (path: string) => Promise<CppRunPreparation>
  preparePythonRun: (path: string) => Promise<PythonRunPreparation>
  checkCppSyntax: (
    path: string,
    content: string
  ) => Promise<CppSyntaxCheckResult>
  startCppDebug: (
    path: string,
    breakpoints: DebugBreakpoint[]
  ) => Promise<DebuggerSnapshot>
  setDebugBreakpoints: (breakpoints: DebugBreakpoint[]) => Promise<void>
  debugControl: (
    action: 'continue' | 'pause' | 'step-over' | 'step-in' | 'step-out' | 'stop'
  ) => Promise<void>
  evaluateDebugExpression: (expression: string) => Promise<string>
  getDebuggerSnapshot: () => Promise<DebuggerSnapshot>
  onDebuggerSnapshot: (
    callback: (snapshot: DebuggerSnapshot) => void
  ) => () => void
  getGitStatus: () => Promise<GitStatus>
  ensureRecommendedGitignore: () => Promise<GitignoreRepairResult>
  getGitFileDiff: (path: string, originalPath?: string) => Promise<GitFileDiff>
  stageFiles: (paths: string[]) => Promise<GitStatus>
  unstageFiles: (paths: string[]) => Promise<GitStatus>
  stageAll: () => Promise<GitStatus>
  unstageAll: () => Promise<GitStatus>
  commitChanges: (message: string) => Promise<GitCommitResult>
  getRunCommand: () => Promise<string>
  saveRunCommand: (command: string) => Promise<void>
  createTerminal: (cols: number, rows: number) => Promise<TerminalSessionInfo>
  writeTerminal: (sessionId: string, data: string) => Promise<void>
  resizeTerminal: (
    sessionId: string,
    cols: number,
    rows: number
  ) => Promise<void>
  killTerminal: (sessionId: string) => Promise<void>
  onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void
  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void
  startAgent: (
    prompt: string,
    mode: AgentRunMode,
    provider: AgentProvider,
    taskId: string
  ) => Promise<AgentRunInfo>
  cancelAgent: (runId: string) => Promise<void>
  onAgentEvent: (callback: (event: AgentStreamEvent) => void) => () => void
  getAgentProviderStatus: () => Promise<AgentProviderStatus>
  saveDeepSeekApiKey: (apiKey: string) => Promise<AgentProviderStatus>
  clearDeepSeekApiKey: () => Promise<AgentProviderStatus>
  getAgentCodeCompletion: (
    request: AgentCodeCompletionRequest
  ) => Promise<AgentCodeCompletionResult>
  cancelAgentCodeCompletion: () => Promise<void>
  respondAgentApproval: (
    runId: string,
    approvalId: string,
    approved: boolean
  ) => Promise<void>
  listAgentTasks: () => Promise<AgentTaskSummary[]>
  saveAgentTask: (task: AgentTaskSaveInput) => Promise<AgentTaskSummary>
  getAgentTask: (taskId: string) => Promise<AgentTaskRecord | null>
  listAgentCheckpoints: (taskId: string) => Promise<AgentCheckpointInfo[]>
  restoreAgentCheckpoint: (checkpointId: string) => Promise<void>
  getAgentCheckpointDiff: (checkpointId: string) => Promise<CheckpointDiff>
  getAgentCheckpointFileDiff: (
    checkpointId: string,
    path: string
  ) => Promise<CheckpointFileDiff>
  getCodeIndexStatus: () => Promise<CodeIndexStatus>
  rebuildCodeIndex: () => Promise<CodeIndexStatus>
  searchCode: (query: string) => Promise<CodeSearchResult[]>
  getDiagnosticsCommand: () => Promise<string>
  saveDiagnosticsCommand: (command: string) => Promise<void>
  runProjectDiagnostics: () => Promise<DiagnosticsResult>
  getProjectWorkflows: () => Promise<ProjectWorkflow[]>
  saveProjectWorkflows: (workflows: ProjectWorkflow[]) => Promise<ProjectWorkflow[]>
  runProjectWorkflow: (workflowId: string) => Promise<WorkflowRunResult>
  listWorkflowTemplates: () => Promise<WorkflowTemplate[]>
  saveWorkflowTemplate: (
    template: WorkflowTemplate
  ) => Promise<WorkflowTemplate[]>
  deleteWorkflowTemplate: (templateId: string) => Promise<WorkflowTemplate[]>
  listWorkflowRuns: (workflowId?: string) => Promise<WorkflowRunSummary[]>
  getWorkflowRun: (runId: string) => Promise<WorkflowRunRecord | null>
}
