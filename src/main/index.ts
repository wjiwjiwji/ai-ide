import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  shell,
  webContents as electronWebContents,
  type MenuItemConstructorOptions,
  type WebContents,
  type OpenDialogOptions
} from 'electron'
import {
  execFile,
  exec
} from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { freemem, totalmem } from 'node:os'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import {
  basename,
  dirname,
  join,
  relative,
  resolve
} from 'node:path'
import type {
  AgentCodeCompletionRequest,
  AgentCodeCompletionResult,
  AgentCheckpointInfo,
  AgentProvider,
  AgentProviderStatus,
  AgentRunInfo,
  AgentRunMode,
  AgentTaskRecord,
  AgentTaskSaveInput,
  AgentTaskSummary,
  AppInfo,
  AppMenuCommand,
  AppUpdateStatus,
  CodeIndexStatus,
  CodeSearchResult,
  CppRunPreparation,
  CppSyntaxCheckResult,
  CreateProjectInput,
  CreateWorkspaceEntryInput,
  DebugBreakpoint,
  DebuggerSnapshot,
  EditAction,
  CheckpointDiff,
  CheckpointFileChange,
  CheckpointFileDiff,
  DiagnosticsResult,
  FileContent,
  FileEntry,
  GitCommitResult,
  GitFileDiff,
  GitignoreRepairResult,
  GitStatus,
  MemoryMetrics,
  ProjectInfo,
  ProjectAvailability,
  ProjectWorkflow,
  PythonRunPreparation,
  RenameWorkspaceEntryInput,
  TerminalSessionInfo,
  WorkflowRunRecord,
  WorkflowRunResult,
  WorkflowRunSummary,
  WorkflowStepResult,
  WorkflowTemplate,
  WorkspaceViewSlot
} from '../shared/desktop'
import { PROJECT_TEMPLATES } from '../shared/desktop'
import { parseProjectDiagnostics } from './core/diagnostics'
import { isCheckpointIgnoredDirectory } from './core/checkpoint-policy'
import {
  createDeepSeekAgentCompletionRequest,
  generateAgentCodeCompletion
} from './core/agent-completion'
import {
  extractCodeSymbols,
  getFileLanguage,
  indexableExtensions
} from './core/code-symbols'
import { GitService } from './core/git-service'
import { ensureRecommendedGitignore } from './core/gitignore'
import {
  compileCppForDebug,
  prepareCppRun,
  syntaxCheckCppSource
} from './core/cpp-runner'
import { preparePythonRun } from './core/python-runner'
import { DebugSession } from './core/debug-session'
import { assertPathInside } from './core/path-security'
import { TerminalService } from './core/terminal-service'
import { AppDatabase } from './core/persistence'
import {
  createProjectDirectory,
  projectTemplateCommands,
  scaffoldProject
} from './core/project-service'
import { resolveCodexExecutable as findCodexExecutable } from './core/codex-agent'
import { AgentCoordinator } from './core/agent-coordinator'
import {
  configureUpdateNetwork,
  createElectronUpdateAdapter
} from './core/electron-update-adapter'
import { UpdateService } from './core/update-service'
import { truncateAgentOutput } from './core/text-utils'
import {
  evaluateWorkflowAcceptance,
  normalizeAcceptanceRules,
  normalizeWorkflowDefinition
} from './core/workflow'
import {
  DEFAULT_IGNORED_DIRECTORIES,
  MAX_TEXT_FILE_SIZE,
  WorkspaceFileService
} from './core/workspace-files'

const isDevelopment = !app.isPackaged
const maxFileSize = MAX_TEXT_FILE_SIZE
const ignoredDirectoryNames = DEFAULT_IGNORED_DIRECTORIES
configureUpdateNetwork()
nativeTheme.themeSource = 'dark'
const localCppToolchainRoot = join(
  app.isPackaged ? process.resourcesPath : app.getAppPath(),
  app.isPackaged
    ? join('debug-adapters', 'gdb')
    : join('.debugger', 'msys2', 'ucrt64')
)
if (!process.env.AI_IDE_LOCAL_CPP_COMPILER) {
  process.env.AI_IDE_LOCAL_CPP_COMPILER = join(
    localCppToolchainRoot,
    'bin',
    'g++.exe'
  )
}

let currentProject: ProjectInfo | null = null
let workspaceFileService: WorkspaceFileService | null = null
let gitService: GitService | null = null
let allowApplicationClose = false
let closeCleanupComplete = false
const unsavedFileCounts = new Map<number, number>()
const terminalService = new TerminalService({
  onData: (ownerId, event) => {
    const owner = electronWebContents.fromId(ownerId)
    if (owner && !owner.isDestroyed()) {
      owner.send('terminal:data', event)
    }
  },
  onExit: (ownerId, event) => {
    const owner = electronWebContents.fromId(ownerId)
    if (owner && !owner.isDestroyed()) {
      owner.send('terminal:exit', event)
    }
  }
})
const agentCoordinator = new AgentCoordinator({
  resolveCodexExecutable,
  createCheckpoint: async (taskId, label) => {
    await createAgentCheckpoint(taskId, label)
  },
  searchCode: (query) => JSON.stringify(searchCodeIndex(query))
})
const updateService = new UpdateService(
  app.isPackaged ? createElectronUpdateAdapter() : null,
  app.getVersion(),
  (status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('updates:status', status)
      }
    }
  }
)
let cachedCodexExecutable: string | null = null
let persistenceDatabase: AppDatabase | null = null
let debugSession: DebugSession | null = null
let debugStartAbortController: AbortController | null = null
const idleDebugSnapshot: DebuggerSnapshot = {
  state: 'idle',
  message: '未启动调试会话。',
  frames: [],
  variables: [],
  threads: [],
  programOutput: [],
  output: []
}
const codeIndexStates = new Map<string, CodeIndexStatus>()
let codeIndexGeneration = 0
const diagnosticsResults = new Map<string, DiagnosticsResult>()
let diagnosticsGeneration = 0
const agentCompletionControllers = new Map<number, AbortController>()
const agentCompletionCache = new Map<
  string,
  { expiresAt: number; completion: string }
>()

interface RecentProjectsStore {
  projects: ProjectInfo[]
}

interface ProjectSettingsStore {
  projects: Record<
    string,
    {
      runCommand?: string
      diagnosticsCommand?: string
      workflows?: ProjectWorkflow[]
    }
  >
}

function getRecentProjectsPath(): string {
  return join(app.getPath('userData'), 'recent-projects.json')
}

function getProjectSettingsPath(): string {
  return join(app.getPath('userData'), 'project-settings.json')
}

async function readProjectSettings(): Promise<ProjectSettingsStore> {
  try {
    const raw = await readFile(getProjectSettingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as ProjectSettingsStore

    if (!parsed || typeof parsed.projects !== 'object' || !parsed.projects) {
      return { projects: {} }
    }

    return { projects: parsed.projects }
  } catch {
    return { projects: {} }
  }
}

async function writeProjectSettings(settings: ProjectSettingsStore): Promise<void> {
  const projectEntries = Object.entries(settings.projects)
    .filter(
      ([, value]) =>
        typeof value?.runCommand === 'string' ||
        typeof value?.diagnosticsCommand === 'string' ||
        Array.isArray(value?.workflows)
    )
    .slice(-100)

  await writeFile(
    getProjectSettingsPath(),
    JSON.stringify({ projects: Object.fromEntries(projectEntries) }, null, 2),
    'utf8'
  )
}

function getDeepSeekKeyPath(): string {
  return join(app.getPath('userData'), 'deepseek-key.bin')
}

async function readStoredDeepSeekApiKey(): Promise<string | null> {
  try {
    const encryptedKey = await readFile(getDeepSeekKeyPath())
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      return null
    }
    const decrypted = await safeStorage.decryptStringAsync(encryptedKey)
    return decrypted.result
  } catch {
    return null
  }
}

async function getDeepSeekApiKey(): Promise<string | null> {
  const environmentKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (environmentKey) {
    return environmentKey
  }

  return readStoredDeepSeekApiKey()
}

async function getAgentProviderStatus(): Promise<AgentProviderStatus> {
  const environmentKey = process.env.DEEPSEEK_API_KEY?.trim()
  const storedKey = environmentKey
    ? null
    : await readStoredDeepSeekApiKey()
  let codexAvailable = true

  try {
    await resolveCodexExecutable()
  } catch {
    codexAvailable = false
  }

  return {
    deepseekConfigured: Boolean(environmentKey || storedKey),
    deepseekSource: environmentKey
      ? 'environment'
      : storedKey
        ? 'stored'
        : 'none',
    deepseekModel: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
    codexAvailable
  }
}

async function saveDeepSeekApiKey(
  apiKey: string
): Promise<AgentProviderStatus> {
  const normalizedKey = apiKey.trim()
  if (
    normalizedKey.length < 20 ||
    normalizedKey.length > 500 ||
    normalizedKey.includes('\0')
  ) {
    throw new Error('DeepSeek API Key 格式无效。')
  }

  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('当前系统无法使用 Electron 安全存储。')
  }

  await writeFile(
    getDeepSeekKeyPath(),
    await safeStorage.encryptStringAsync(normalizedKey)
  )
  return getAgentProviderStatus()
}

async function clearDeepSeekApiKey(): Promise<AgentProviderStatus> {
  try {
    await unlink(getDeepSeekKeyPath())
  } catch {
    // Nothing to clear.
  }
  return getAgentProviderStatus()
}

async function getAgentCodeCompletion(
  senderId: number,
  input: AgentCodeCompletionRequest
): Promise<AgentCodeCompletionResult> {
  if (
    !input ||
    typeof input.path !== 'string' ||
    typeof input.language !== 'string' ||
    typeof input.prefix !== 'string' ||
    typeof input.suffix !== 'string'
  ) {
    return {
      completion: '',
      cached: false,
      error: '代码补全请求格式无效。'
    }
  }

  const request: AgentCodeCompletionRequest = {
    path: input.path.slice(-500),
    language: input.language.slice(0, 80),
    prefix: input.prefix.slice(-24_000),
    suffix: input.suffix.slice(0, 12_000)
  }
  if (!request.prefix.trim()) {
    return { completion: '', cached: false }
  }

  const apiKey = await getDeepSeekApiKey()
  if (!apiKey) {
    return {
      completion: '',
      cached: false,
      error:
        'AI 补全需要 DeepSeek API Key，请先在 Agent 工作台完成配置。'
    }
  }

  const model = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat'
  const cacheKey = JSON.stringify([model, request])
  const cached = agentCompletionCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return { completion: cached.completion, cached: true }
  }

  agentCompletionControllers.get(senderId)?.abort()
  const controller = new AbortController()
  agentCompletionControllers.set(senderId, controller)
  try {
    const completion = await generateAgentCodeCompletion({
      request,
      signal: controller.signal,
      complete: createDeepSeekAgentCompletionRequest(apiKey, model)
    })
    if (!controller.signal.aborted && completion) {
      agentCompletionCache.set(cacheKey, {
        completion,
        expiresAt: Date.now() + 45_000
      })
      if (agentCompletionCache.size > 80) {
        const oldestKey = agentCompletionCache.keys().next().value
        if (oldestKey) {
          agentCompletionCache.delete(oldestKey)
        }
      }
    }
    return { completion, cached: false }
  } catch (error) {
    if (controller.signal.aborted) {
      return { completion: '', cached: false }
    }
    return {
      completion: '',
      cached: false,
      error:
        error instanceof Error ? error.message : '生成代码补全失败。'
    }
  } finally {
    if (agentCompletionControllers.get(senderId) === controller) {
      agentCompletionControllers.delete(senderId)
    }
  }
}

function getPersistenceDatabase(): AppDatabase {
  if (!persistenceDatabase) {
    persistenceDatabase = new AppDatabase(
      join(app.getPath('userData'), 'ai-ide-tasks.sqlite')
    )
  }
  return persistenceDatabase
}

function ensureCurrentProject(): ProjectInfo {
  if (!currentProject) {
    throw new Error('请先打开一个项目。')
  }
  return currentProject
}

function saveAgentTask(input: AgentTaskSaveInput): AgentTaskSummary {
  const project = ensureCurrentProject()
  return getPersistenceDatabase().tasks.save(project, input)
}

function listAgentTasks(): AgentTaskSummary[] {
  const project = ensureCurrentProject()
  return getPersistenceDatabase().tasks.list(project.id)
}

function getAgentTask(taskId: string): AgentTaskRecord | null {
  const project = ensureCurrentProject()
  if (typeof taskId !== 'string' || !taskId) {
    throw new Error('任务 ID 无效。')
  }

  return getPersistenceDatabase().tasks.get(taskId, project.id)
}

interface SnapshotBudget {
  files: number
  bytes: number
}

async function copyProjectSnapshot(
  sourcePath: string,
  destinationPath: string,
  budget: SnapshotBudget
): Promise<void> {
  await mkdir(destinationPath, { recursive: true })
  const entries = await readdir(sourcePath, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue
    }
    if (
      entry.isDirectory() &&
      isCheckpointIgnoredDirectory(entry.name)
    ) {
      continue
    }

    const sourceEntry = join(sourcePath, entry.name)
    const destinationEntry = join(destinationPath, entry.name)

    if (entry.isDirectory()) {
      await copyProjectSnapshot(sourceEntry, destinationEntry, budget)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const fileStats = await lstat(sourceEntry)
    budget.files += 1
    budget.bytes += fileStats.size
    if (budget.files > 20_000 || budget.bytes > 100 * 1024 * 1024) {
      throw new Error(
        '项目超过检查点限制（20000 个文件或 100 MB），已取消操作。'
      )
    }
    await copyFile(sourceEntry, destinationEntry)
  }
}

function getCheckpointRoot(): string {
  return join(app.getPath('userData'), 'agent-checkpoints')
}

async function createAgentCheckpoint(
  taskId: string,
  label: string
): Promise<AgentCheckpointInfo> {
  const project = ensureCurrentProject()
  if (!getAgentTask(taskId)) {
    throw new Error('保存检查点前需要先创建 Agent 任务。')
  }

  const checkpointId = randomUUID()
  const snapshotDir = join(getCheckpointRoot(), checkpointId, 'snapshot')
  const projectRoot = await realpath(project.path)
  const createdAt = new Date().toISOString()
  const normalizedLabel = label.trim().slice(0, 200) || 'Agent 操作前'

  try {
    await copyProjectSnapshot(projectRoot, snapshotDir, {
      files: 0,
      bytes: 0
    })
  } catch (error) {
    await rm(join(getCheckpointRoot(), checkpointId), {
      recursive: true,
      force: true
    })
    throw error
  }

  return getPersistenceDatabase().checkpoints.insert({
    id: checkpointId,
    taskId,
    projectPath: project.path,
    label: normalizedLabel,
    snapshotDir,
    createdAt
  })
}

function listAgentCheckpoints(taskId: string): AgentCheckpointInfo[] {
  const project = ensureCurrentProject()
  return getPersistenceDatabase().checkpoints.list(taskId, project.path)
}

async function collectProjectTypes(
  rootPath: string,
  currentPath = rootPath,
  result = new Map<string, 'file' | 'directory' | 'other'>()
): Promise<Map<string, 'file' | 'directory' | 'other'>> {
  const entries = await readdir(currentPath, { withFileTypes: true })
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      isCheckpointIgnoredDirectory(entry.name)
    ) {
      continue
    }
    const absolutePath = join(currentPath, entry.name)
    const relativePath = relative(rootPath, absolutePath)
    if (entry.isSymbolicLink()) {
      result.set(relativePath, 'other')
    } else if (entry.isDirectory()) {
      result.set(relativePath, 'directory')
      await collectProjectTypes(rootPath, absolutePath, result)
    } else if (entry.isFile()) {
      result.set(relativePath, 'file')
    }
  }
  return result
}

async function cleanTargetToSnapshot(
  targetPath: string,
  targetRoot: string,
  sourceTypes: Map<string, 'file' | 'directory' | 'other'>
): Promise<void> {
  const entries = await readdir(targetPath, { withFileTypes: true })
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      isCheckpointIgnoredDirectory(entry.name)
    ) {
      continue
    }
    const absolutePath = join(targetPath, entry.name)
    const relativePath = relative(targetRoot, absolutePath)
    const sourceType = sourceTypes.get(relativePath)

    if (!sourceType) {
      await rm(absolutePath, {
        recursive: entry.isDirectory() && !entry.isSymbolicLink(),
        force: true
      })
      continue
    }

    if (entry.isSymbolicLink()) {
      await rm(absolutePath, { force: true })
      continue
    }

    if (entry.isDirectory() && sourceType !== 'directory') {
      await rm(absolutePath, { recursive: true, force: true })
      continue
    }

    if (entry.isFile() && sourceType !== 'file') {
      await rm(absolutePath, { force: true })
      continue
    }

    if (entry.isDirectory() && sourceType === 'directory') {
      await cleanTargetToSnapshot(absolutePath, targetRoot, sourceTypes)
    }
  }
}

async function copySnapshotOver(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  await mkdir(targetPath, { recursive: true })
  const entries = await readdir(sourcePath, { withFileTypes: true })
  for (const entry of entries) {
    const sourceEntry = join(sourcePath, entry.name)
    const targetEntry = join(targetPath, entry.name)
    if (entry.isDirectory()) {
      await copySnapshotOver(sourceEntry, targetEntry)
    } else if (entry.isFile()) {
      await copyFile(sourceEntry, targetEntry)
    }
  }
}

async function restoreAgentCheckpoint(checkpointId: string): Promise<void> {
  const project = ensureCurrentProject()
  const checkpoint = getPersistenceDatabase().checkpoints.get(checkpointId)
  if (!checkpoint) {
    throw new Error('检查点不存在。')
  }
  if (checkpoint.projectPath !== project.path) {
    throw new Error('检查点不属于当前项目。')
  }
  if (agentCoordinator.hasTaskRun(checkpoint.taskId)) {
    throw new Error('Agent 正在运行，不能恢复检查点。')
  }

  const snapshotRoot = await realpath(checkpoint.snapshotDir)
  const projectRoot = await realpath(project.path)
  const [sourceTypes, targetTypes] = await Promise.all([
    collectProjectTypes(snapshotRoot),
    collectProjectTypes(projectRoot)
  ])
  await cleanTargetToSnapshot(projectRoot, projectRoot, sourceTypes)
  await copySnapshotOver(snapshotRoot, projectRoot)

  const sourceFiles = [...sourceTypes.entries()].filter(
    ([, type]) => type === 'file'
  )
  const targetFiles = [...targetTypes.entries()].filter(
    ([, type]) => type === 'file'
  )
  if (sourceFiles.length === 0 && targetFiles.length > 0) {
    throw new Error('检查点内容异常，已停止恢复。')
  }

  getPersistenceDatabase().checkpoints.markRestored(checkpointId)
}

function countBufferLines(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0
  }
  let lines = 0
  for (const byte of buffer) {
    if (byte === 10) {
      lines += 1
    }
  }
  return buffer[buffer.length - 1] === 10 ? lines : lines + 1
}

function getDiffLineCounts(
  originalPath: string,
  modifiedPath: string
): Promise<{ added: number; deleted: number }> {
  return new Promise((resolveStats) => {
    execFile(
      'git',
      ['diff', '--no-index', '--numstat', '--', originalPath, modifiedPath],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        windowsHide: true
      },
      (_error, stdout) => {
        const [addedText, deletedText] = stdout.trim().split(/\s+/, 3)
        const added = Number(addedText)
        const deleted = Number(deletedText)
        if (Number.isFinite(added) && Number.isFinite(deleted)) {
          resolveStats({ added, deleted })
        } else {
          resolveStats({ added: 0, deleted: 0 })
        }
      }
    )
  })
}

async function readCheckpointFileBuffer(
  filePath: string
): Promise<Buffer | null> {
  try {
    const fileStats = await lstat(filePath)
    if (!fileStats.isFile()) {
      return null
    }
    if (fileStats.size > 4 * 1024 * 1024) {
      return null
    }
    return readFile(filePath)
  } catch {
    return null
  }
}

async function getCheckpointRow(checkpointId: string): Promise<{
  taskId: string
  projectPath: string
  label: string
  snapshotDir: string
  createdAt: string
}> {
  const project = ensureCurrentProject()
  const checkpoint = getPersistenceDatabase().checkpoints.get(checkpointId)
  if (!checkpoint || checkpoint.projectPath !== project.path) {
    throw new Error('检查点不存在或不属于当前项目。')
  }
  return {
    taskId: checkpoint.taskId,
    projectPath: checkpoint.projectPath,
    label: checkpoint.label,
    snapshotDir: checkpoint.snapshotDir,
    createdAt: checkpoint.createdAt
  }
}

async function getAgentCheckpointDiff(
  checkpointId: string
): Promise<CheckpointDiff> {
  const checkpoint = await getCheckpointRow(checkpointId)
  const snapshotRoot = await realpath(checkpoint.snapshotDir)
  const projectRoot = await realpath(checkpoint.projectPath)
  const [sourceTypes, targetTypes] = await Promise.all([
    collectProjectTypes(snapshotRoot),
    collectProjectTypes(projectRoot)
  ])
  const allPaths = new Set([
    ...[...sourceTypes.entries()]
      .filter(([, type]) => type === 'file')
      .map(([path]) => path),
    ...[...targetTypes.entries()]
      .filter(([, type]) => type === 'file')
      .map(([path]) => path)
  ])
  const files: CheckpointFileChange[] = []

  for (const relativePath of [...allPaths].sort()) {
    const sourcePath = join(snapshotRoot, relativePath)
    const targetPath = join(projectRoot, relativePath)
    const sourceExists = sourceTypes.get(relativePath) === 'file'
    const targetExists = targetTypes.get(relativePath) === 'file'

    if (sourceExists && targetExists) {
      const [sourceBuffer, targetBuffer] = await Promise.all([
        readCheckpointFileBuffer(sourcePath),
        readCheckpointFileBuffer(targetPath)
      ])
      if (sourceBuffer && targetBuffer && sourceBuffer.equals(targetBuffer)) {
        continue
      }
      const isBinary = Boolean(
        !sourceBuffer ||
          !targetBuffer ||
          sourceBuffer.includes(0) ||
          targetBuffer.includes(0)
      )
      const counts =
        sourceBuffer && targetBuffer && !isBinary
          ? await getDiffLineCounts(sourcePath, targetPath)
          : { added: 0, deleted: 0 }
      files.push({
        path: relativePath,
        status: 'modified',
        addedLines: counts.added,
        deletedLines: counts.deleted,
        isBinary
      })
      continue
    }

    if (targetExists) {
      const buffer = await readCheckpointFileBuffer(targetPath)
      files.push({
        path: relativePath,
        status: 'added',
        addedLines: buffer && !buffer.includes(0) ? countBufferLines(buffer) : 0,
        deletedLines: 0,
        isBinary: Boolean(!buffer || buffer.includes(0))
      })
    } else if (sourceExists) {
      const buffer = await readCheckpointFileBuffer(sourcePath)
      files.push({
        path: relativePath,
        status: 'deleted',
        addedLines: 0,
        deletedLines:
          buffer && !buffer.includes(0) ? countBufferLines(buffer) : 0,
        isBinary: Boolean(!buffer || buffer.includes(0))
      })
    }
  }

  return {
    checkpointId,
    label: checkpoint.label,
    createdAt: checkpoint.createdAt,
    files,
    addedFiles: files.filter((file) => file.status === 'added').length,
    modifiedFiles: files.filter((file) => file.status === 'modified').length,
    deletedFiles: files.filter((file) => file.status === 'deleted').length,
    addedLines: files.reduce((total, file) => total + file.addedLines, 0),
    deletedLines: files.reduce((total, file) => total + file.deletedLines, 0)
  }
}

async function getAgentCheckpointFileDiff(
  checkpointId: string,
  relativePath: string
): Promise<CheckpointFileDiff> {
  if (
    typeof relativePath !== 'string' ||
    !relativePath ||
    relativePath.includes('\0')
  ) {
    throw new Error('文件路径无效。')
  }

  const checkpoint = await getCheckpointRow(checkpointId)
  const snapshotRoot = await realpath(checkpoint.snapshotDir)
  const projectRoot = await realpath(checkpoint.projectPath)
  const sourcePath = resolve(snapshotRoot, relativePath)
  const targetPath = resolve(projectRoot, relativePath)
  assertPathInside(snapshotRoot, sourcePath)
  assertPathInside(projectRoot, targetPath)

  const sourceBuffer = await readCheckpointFileBuffer(sourcePath)
  const targetBuffer = await readCheckpointFileBuffer(targetPath)
  const isBinary = Boolean(
    (sourceBuffer && sourceBuffer.includes(0)) ||
      (targetBuffer && targetBuffer.includes(0)) ||
      (!sourceBuffer && !targetBuffer)
  )
  const status: CheckpointFileDiff['status'] =
    !sourceBuffer && targetBuffer
      ? 'added'
      : sourceBuffer && !targetBuffer
        ? 'deleted'
        : 'modified'

  return {
    checkpointId,
    path: relativePath,
    status,
    originalContent:
      sourceBuffer && !isBinary ? sourceBuffer.toString('utf8') : '',
    modifiedContent:
      targetBuffer && !isBinary ? targetBuffer.toString('utf8') : '',
    isBinary
  }
}

interface IndexedFileInput {
  path: string
  absolutePath: string
  mtimeMs: number
  size: number
  language: string
}

async function collectIndexFiles(
  rootPath: string,
  directoryPath = rootPath,
  files: IndexedFileInput[] = [],
  budget = { totalBytes: 0 }
): Promise<IndexedFileInput[]> {
  if (files.length >= 5000 || budget.totalBytes >= 50 * 1024 * 1024) {
    return files
  }

  const entries = await readdir(directoryPath, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  for (const entry of entries) {
    if (files.length >= 5000 || budget.totalBytes >= 50 * 1024 * 1024) {
      break
    }
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        await collectIndexFiles(
          rootPath,
          join(directoryPath, entry.name),
          files,
          budget
        )
      }
      continue
    }
    if (!entry.isFile()) {
      continue
    }

    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    if (
      !indexableExtensions.has(extension) ||
      entry.name === 'package-lock.json' ||
      entry.name === 'yarn.lock'
    ) {
      continue
    }

    const absolutePath = join(directoryPath, entry.name)
    const fileStats = await lstat(absolutePath)
    if (fileStats.size > maxFileSize) {
      continue
    }

    budget.totalBytes += fileStats.size
    files.push({
      path: relative(rootPath, absolutePath),
      absolutePath,
      mtimeMs: fileStats.mtimeMs,
      size: fileStats.size,
      language: getFileLanguage(entry.name)
    })
  }
  return files
}

function getCodeIndexStatusForProject(project: ProjectInfo): CodeIndexStatus {
  return (
    codeIndexStates.get(project.id) ?? {
      state: 'idle',
      indexedFiles: 0,
      indexedSymbols: 0,
      updatedAt: null
    }
  )
}

async function rebuildProjectCodeIndex(
  project: ProjectInfo
): Promise<CodeIndexStatus> {
  const generation = ++codeIndexGeneration
  const previousStatus = getCodeIndexStatusForProject(project)
  codeIndexStates.set(project.id, {
    ...previousStatus,
    state: 'indexing',
    error: undefined
  })

  try {
    const projectRoot = await realpath(project.path)
    const files = await collectIndexFiles(projectRoot)
    const codeIndex = getPersistenceDatabase().codeIndex
    const existing = new Map(
      codeIndex.getFiles(project.id).map((file) => [
        file.path,
        {
          mtimeMs: file.mtimeMs,
          size: file.size
        }
      ])
    )
    const currentPaths = new Set(files.map((file) => file.path))

    const updates: Array<{
      file: IndexedFileInput
      content: string
      symbols: Array<{ name: string; kind: string; line: number }>
    }> = []
    for (const file of files) {
      const previous = existing.get(file.path)
      if (
        previous &&
        Math.abs(previous.mtimeMs - file.mtimeMs) < 1 &&
        previous.size === file.size
      ) {
        continue
      }

      try {
        const buffer = await readFile(file.absolutePath)
        if (buffer.includes(0)) {
          continue
        }
        const content = buffer.toString('utf8')
        updates.push({
          file,
          content,
          symbols: extractCodeSymbols(content, file.language)
        })
      } catch {
        // Missing or unreadable files are removed from the index below.
      }
    }

    const { fileCount, symbolCount } = codeIndex.replace(
      project.id,
      currentPaths,
      updates.map(({ file, content, symbols }) => ({
        path: file.path,
        mtimeMs: file.mtimeMs,
        size: file.size,
        language: file.language,
        content,
        symbols
      }))
    )
    const status: CodeIndexStatus = {
      state: 'ready',
      indexedFiles: fileCount,
      indexedSymbols: symbolCount,
      updatedAt: new Date().toISOString()
    }
    if (generation === codeIndexGeneration) {
      codeIndexStates.set(project.id, status)
    }
    return status
  } catch (error) {
    const status: CodeIndexStatus = {
      state: 'error',
      indexedFiles: previousStatus.indexedFiles,
      indexedSymbols: previousStatus.indexedSymbols,
      updatedAt: previousStatus.updatedAt,
      error: error instanceof Error ? error.message : '代码索引失败。'
    }
    if (generation === codeIndexGeneration) {
      codeIndexStates.set(project.id, status)
    }
    return status
  }
}

function getCodeIndexStatus(): CodeIndexStatus {
  return getCodeIndexStatusForProject(ensureCurrentProject())
}

async function rebuildCodeIndex(): Promise<CodeIndexStatus> {
  return rebuildProjectCodeIndex(ensureCurrentProject())
}

function searchCodeIndex(query: string): CodeSearchResult[] {
  const project = ensureCurrentProject()
  const normalizedQuery = query.trim().slice(0, 200)
  if (!normalizedQuery) {
    return []
  }
  return getPersistenceDatabase().codeIndex.search(
    project.id,
    normalizedQuery
  )
}

async function runProjectDiagnostics(): Promise<DiagnosticsResult> {
  const project = ensureCurrentProject()
  const generation = ++diagnosticsGeneration
  const command = await getDiagnosticsCommand()
  if (!command) {
    const result: DiagnosticsResult = {
      command: '',
      state: 'error',
      items: [],
      error: '没有可用的诊断命令。请先配置项目诊断命令。',
      updatedAt: new Date().toISOString()
    }
    diagnosticsResults.set(project.id, result)
    return result
  }

  diagnosticsResults.set(project.id, {
    command,
    state: 'running',
    items: [],
    updatedAt: null
  })
  const projectRoot = await realpath(project.path)
  const result = await new Promise<DiagnosticsResult>((resolveDiagnostics) => {
    exec(
      command,
      {
        cwd: projectRoot,
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.trim()
        const items = parseProjectDiagnostics(output, projectRoot)
        const updatedAt = new Date().toISOString()
        if (items.length > 0) {
          resolveDiagnostics({
            command,
            state: 'ready',
            items,
            updatedAt
          })
          return
        }
        if (error) {
          resolveDiagnostics({
            command,
            state: 'error',
            items: [],
            error:
              stderr.trim() ||
              stdout.trim() ||
              error.message,
            updatedAt
          })
          return
        }
        resolveDiagnostics({
          command,
          state: 'ready',
          items: [],
          updatedAt
        })
      }
    )
  })

  if (
    generation === diagnosticsGeneration &&
    currentProject?.id === project.id
  ) {
    diagnosticsResults.set(project.id, result)
  }
  return result
}

async function getProjectWorkflows(): Promise<ProjectWorkflow[]> {
  const project = ensureCurrentProject()
  const settings = await readProjectSettings()
  return (settings.projects[project.path]?.workflows ?? []).map(
    (workflow) => ({
      ...workflow,
      acceptance: normalizeAcceptanceRules(workflow.acceptance)
    })
  )
}

async function saveProjectWorkflows(
  workflows: ProjectWorkflow[]
): Promise<ProjectWorkflow[]> {
  const project = ensureCurrentProject()
  if (!Array.isArray(workflows) || workflows.length > 30) {
    throw new Error('工作流数量无效。')
  }

  const normalizedWorkflows = workflows.map((workflow) =>
    normalizeWorkflowDefinition(workflow)
  )
  const settings = await readProjectSettings()
  settings.projects[project.path] = {
    ...(settings.projects[project.path] ?? {}),
    workflows: normalizedWorkflows
  }
  await writeProjectSettings(settings)
  return normalizedWorkflows
}

function normalizeWorkflowTemplate(
  template: WorkflowTemplate
): WorkflowTemplate {
  const normalized = normalizeWorkflowDefinition({
    id: template.id,
    name: template.name,
    steps: template.steps,
    acceptance: template.acceptance,
    updatedAt: template.updatedAt
  })
  const now = new Date().toISOString()
  return {
    id: normalized.id,
    name: normalized.name,
    steps: normalized.steps,
    acceptance: normalized.acceptance,
    createdAt:
      typeof template.createdAt === 'string' ? template.createdAt : now,
    updatedAt: now
  }
}

function listWorkflowTemplates(): WorkflowTemplate[] {
  return getPersistenceDatabase().workflows
    .listTemplates()
    .map((template) => ({
      ...template,
      acceptance: normalizeAcceptanceRules(template.acceptance)
    }))
}

function saveWorkflowTemplate(
  template: WorkflowTemplate
): WorkflowTemplate[] {
  const normalized = normalizeWorkflowTemplate(template)
  return getPersistenceDatabase().workflows
    .saveTemplate(normalized)
    .map((saved) => ({
      ...saved,
      acceptance: normalizeAcceptanceRules(saved.acceptance)
    }))
}

function deleteWorkflowTemplate(templateId: string): WorkflowTemplate[] {
  return getPersistenceDatabase().workflows.deleteTemplate(templateId)
}

function saveWorkflowRun(result: WorkflowRunResult): void {
  const resultJson = JSON.stringify(result)
  if (Buffer.byteLength(resultJson, 'utf8') > 8 * 1024 * 1024) {
    throw new Error('工作流运行结果超过 8 MB，无法保存。')
  }
  getPersistenceDatabase().workflows.saveRun(
    ensureCurrentProject().id,
    result
  )
}

function listWorkflowRuns(workflowId?: string): WorkflowRunSummary[] {
  const project = ensureCurrentProject()
  return getPersistenceDatabase().workflows.listRuns(project.id, workflowId)
}

function getWorkflowRun(runId: string): WorkflowRunRecord | null {
  const project = ensureCurrentProject()
  return getPersistenceDatabase().workflows.getRun(project.id, runId)
}

function runWorkflowCommand(
  projectRoot: string,
  command: string
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolveCommand) => {
    exec(
      command,
      {
        cwd: projectRoot,
        timeout: 5 * 60_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const errorCode = (error as (Error & { code?: number | string }) | null)
          ?.code
        const exitCode =
          typeof errorCode === 'number' ? errorCode : error ? 1 : 0
        resolveCommand({
          exitCode,
          output: truncateAgentOutput(
            `${stdout}${stderr ? `\n${stderr}` : ''}`.trim(),
            100_000
          )
        })
      }
    )
  })
}

async function runProjectWorkflow(
  workflowId: string
): Promise<WorkflowRunResult> {
  const project = ensureCurrentProject()
  const workflows = await getProjectWorkflows()
  const workflow = workflows.find((item) => item.id === workflowId)
  if (!workflow) {
    throw new Error('工作流不存在。')
  }

  const taskId = randomUUID()
  const runId = randomUUID()
  const workflowTitle = `工作流：${workflow.name}`
  const createdAt = new Date().toISOString()
  saveAgentTask({
    id: taskId,
    title: workflowTitle,
    provider: 'deepseek',
    mode: 'workspace-write',
    status: 'active',
    entries: [
      {
        id: `workflow-${workflow.id}`,
        kind: 'system',
        text: `开始执行项目工作流：${workflow.name}`
      }
    ],
    threadId: null,
    usageText: ''
  })

  const hasCommandStep = workflow.steps.some(
    (step) => step.kind === 'command'
  )
  let checkpoint: AgentCheckpointInfo | null = null
  if (hasCommandStep) {
    checkpoint = await createAgentCheckpoint(
      taskId,
      `工作流执行前：${workflow.name}`
    )
  }

  const projectRoot = await realpath(project.path)
  const stepResults: WorkflowStepResult[] = []
  let agentPrompt: string | null = null
  let failed = false

  for (const step of workflow.steps) {
    if (step.kind === 'agent') {
      const priorResults = stepResults
        .map(
          (result) =>
            `- [${result.status}] ${result.label}${
              result.output ? `\n${result.output.slice(0, 4000)}` : ''
            }`
        )
        .join('\n')
      agentPrompt =
        step.prompt?.trim() ||
        [
          `Continue from project workflow "${workflow.name}".`,
          'Review the workflow output below, fix any failed steps, and verify the result.',
          '',
          priorResults || 'No previous step output.'
        ].join('\n')
      stepResults.push({
        stepId: step.id,
        label: step.label,
        kind: 'agent',
        status: 'success',
        output: 'Agent 修复任务已准备好，等待你在 Agent 面板中确认发送。'
      })
      break
    }

    if (step.kind === 'command') {
      const commandResult = await runWorkflowCommand(
        projectRoot,
        step.command ?? ''
      )
      const success = commandResult.exitCode === 0
      failed ||= !success
      stepResults.push({
        stepId: step.id,
        label: step.label,
        kind: 'command',
        status: success ? 'success' : 'failed',
        exitCode: commandResult.exitCode,
        output: commandResult.output
      })
      if (!success && !step.continueOnError) {
        break
      }
      continue
    }

    const diagnostics = await runProjectDiagnostics()
    const errorCount = diagnostics.items.filter(
      (item) => item.severity === 'error'
    ).length
    const success = diagnostics.state === 'ready' && errorCount === 0
    failed ||= !success
    stepResults.push({
      stepId: step.id,
      label: step.label,
      kind: 'diagnostics',
      status: success ? 'success' : 'failed',
      output:
        diagnostics.state === 'error'
          ? diagnostics.error ?? '诊断命令失败。'
          : `${errorCount} 个错误，${diagnostics.items.length - errorCount} 个警告。\n${diagnostics.items
              .slice(0, 20)
              .map(
                (item) =>
                  `${item.file}:${item.line}:${item.column} ${item.message}`
              )
              .join('\n')}`,
      exitCode: success ? 0 : 1
    })
    if (!success && !step.continueOnError) {
      break
    }
  }

  const status: WorkflowRunResult['status'] = failed
    ? 'failed'
    : agentPrompt
      ? 'needs_review'
      : 'completed'
  const summary = stepResults
    .map(
      (result) =>
        `[${result.status}] ${result.label}\n${result.output.slice(0, 2000)}`
    )
    .join('\n\n')
  const changes = checkpoint
    ? await getAgentCheckpointDiff(checkpoint.id)
    : null
  const acceptance = evaluateWorkflowAcceptance({
    rules: workflow.acceptance,
    configuredSteps: workflow.steps,
    stepResults,
    changes,
    hasAgentPrompt: Boolean(agentPrompt)
  })
  const report = [
    `工作流：${workflow.name}`,
    `状态：${status}`,
    `验收：${acceptance.decision}`,
    `步骤：${stepResults.filter((step) => step.status === 'success').length} 成功，${stepResults.filter((step) => step.status === 'failed').length} 失败`,
    changes
      ? `文件：${changes.addedFiles} 新增，${changes.modifiedFiles} 修改，${changes.deletedFiles} 删除`
      : '文件：无命令步骤，未创建检查点',
    changes
      ? `代码行：+${changes.addedLines} / -${changes.deletedLines}`
      : '',
    agentPrompt ? 'Agent 修复任务：已准备' : '',
    ...(acceptance.reasons.length
      ? ['验收原因：', ...acceptance.reasons.map((reason) => `- ${reason}`)]
      : [])
  ]
    .filter(Boolean)
    .join('\n')
  const finalAgentPrompt = agentPrompt
    ? `${agentPrompt}\n\nAcceptance report:\n${report}`
    : null
  saveAgentTask({
    id: taskId,
    title: workflowTitle,
    provider: 'deepseek',
    mode: 'workspace-write',
    status: failed ? 'failed' : 'completed',
    entries: [
      {
        id: `workflow-${workflow.id}`,
        kind: 'system',
        text: `项目工作流“${workflow.name}”执行结果`
      },
      {
        id: `workflow-summary-${taskId}`,
        kind: failed ? 'error' : 'assistant',
        text: `${report}\n\n${summary}`
      }
    ],
    threadId: null,
    usageText: ''
  })

  const result: WorkflowRunResult = {
    runId,
    taskId,
    checkpointId: checkpoint?.id ?? null,
    workflowId: workflow.id,
    workflowName: workflow.name,
    status,
    steps: stepResults,
    agentPrompt: finalAgentPrompt,
    changes,
    report,
    acceptance,
    updatedAt: new Date().toISOString()
  }
  saveWorkflowRun(result)
  return result
}

async function getProjectRunCommand(): Promise<string> {
  if (!currentProject) {
    return ''
  }

  const settings = await readProjectSettings()
  return settings.projects[currentProject.path]?.runCommand ?? ''
}

async function saveProjectRunCommand(command: string): Promise<void> {
  if (!currentProject) {
    throw new Error('请先打开一个项目。')
  }

  if (typeof command !== 'string' || command.includes('\0')) {
    throw new Error('运行命令无效。')
  }

  if (command.length > 2000) {
    throw new Error('运行命令不能超过 2000 个字符。')
  }

  const settings = await readProjectSettings()
  const runCommand = command.trim()
  const currentSettings = settings.projects[currentProject.path] ?? {}
  if (runCommand) {
    settings.projects[currentProject.path] = {
      ...currentSettings,
      runCommand
    }
  } else {
    delete currentSettings.runCommand
    if (Object.keys(currentSettings).length === 0) {
      delete settings.projects[currentProject.path]
    } else {
      settings.projects[currentProject.path] = currentSettings
    }
  }

  await writeProjectSettings(settings)
}

async function getDiagnosticsCommand(): Promise<string> {
  const project = ensureCurrentProject()
  const settings = await readProjectSettings()
  const configured = settings.projects[project.path]?.diagnosticsCommand?.trim()
  if (configured) {
    return configured
  }

  try {
    const tsconfigStats = await lstat(join(project.path, 'tsconfig.json'))
    if (tsconfigStats.isFile()) {
      return 'npx --no-install tsc --noEmit --pretty false'
    }
  } catch {
    // No TypeScript project detected.
  }

  return ''
}

async function saveDiagnosticsCommand(command: string): Promise<void> {
  const project = ensureCurrentProject()
  if (typeof command !== 'string' || command.includes('\0')) {
    throw new Error('诊断命令无效。')
  }
  if (command.length > 2000) {
    throw new Error('诊断命令不能超过 2000 个字符。')
  }

  const settings = await readProjectSettings()
  const currentSettings = settings.projects[project.path] ?? {}
  const diagnosticsCommand = command.trim()
  if (diagnosticsCommand) {
    settings.projects[project.path] = {
      ...currentSettings,
      diagnosticsCommand
    }
  } else {
    delete currentSettings.diagnosticsCommand
    if (Object.keys(currentSettings).length === 0) {
      delete settings.projects[project.path]
    } else {
      settings.projects[project.path] = currentSettings
    }
  }
  await writeProjectSettings(settings)
}

function createProjectInfo(projectPath: string): ProjectInfo {
  return {
    id: createHash('sha1').update(projectPath).digest('hex').slice(0, 12),
    name: basename(projectPath),
    path: projectPath,
    lastOpenedAt: new Date().toISOString()
  }
}

async function readRecentProjects(): Promise<ProjectInfo[]> {
  try {
    const raw = await readFile(getRecentProjectsPath(), 'utf8')
    const parsed = JSON.parse(raw) as RecentProjectsStore

    if (!Array.isArray(parsed.projects)) {
      return []
    }

    return parsed.projects.filter((project) => {
      return (
        typeof project?.id === 'string' &&
        typeof project?.name === 'string' &&
        typeof project?.path === 'string' &&
        typeof project?.lastOpenedAt === 'string'
      )
    })
  } catch {
    return []
  }
}

async function writeRecentProjects(projects: ProjectInfo[]): Promise<void> {
  const store: RecentProjectsStore = {
    projects: projects.slice(0, 12)
  }

  await writeFile(
    getRecentProjectsPath(),
    JSON.stringify(store, null, 2),
    'utf8'
  )
}

async function rememberProject(project: ProjectInfo): Promise<void> {
  const recentProjects = await readRecentProjects()
  const nextProjects = [
    project,
    ...recentProjects.filter((item) => item.path !== project.path)
  ]

  await writeRecentProjects(nextProjects)
}

function getWorkspaceFileService(): WorkspaceFileService {
  if (!currentProject) {
    throw new Error('请先打开一个项目。')
  }
  if (
    !workspaceFileService ||
    workspaceFileService.projectPath !== currentProject.path
  ) {
    workspaceFileService = new WorkspaceFileService(currentProject.path)
  }
  return workspaceFileService
}

function getGitService(): GitService {
  if (!currentProject) {
    throw new Error('请先打开一个项目。')
  }
  if (!gitService || gitService.projectPath !== currentProject.path) {
    gitService = new GitService(currentProject.path)
  }
  return gitService
}

async function resolveProjectPath(path: string): Promise<string> {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error('项目路径无效。')
  }

  const absolutePath = resolve(path)
  const projectStats = await stat(absolutePath)
  if (!projectStats.isDirectory()) {
    throw new Error('所选路径不是文件夹。')
  }

  return realpath(absolutePath)
}

async function activateProject(path: string): Promise<ProjectInfo> {
  const projectPath = await resolveProjectPath(path)
  const project = createProjectInfo(projectPath)
  stopActiveProjectServices()
  currentProject = project
  workspaceFileService = new WorkspaceFileService(project.path)
  gitService = new GitService(project.path)
  void rebuildProjectCodeIndex(project)
  await rememberProject(project)
  return project
}

function stopActiveProjectServices(): void {
  terminalService.killAll()
  agentCoordinator.killAll()
  debugStartAbortController?.abort()
  debugStartAbortController = null
  debugSession?.dispose()
  debugSession = null
  broadcastDebuggerSnapshot(idleDebugSnapshot)
  diagnosticsGeneration += 1
}

async function closeCurrentProject(): Promise<void> {
  const projectPath = currentProject?.path
  stopActiveProjectServices()
  currentProject = null
  workspaceFileService = null
  gitService = null
  if (projectPath) {
    const recentProjects = await readRecentProjects()
    await writeRecentProjects(
      recentProjects.filter((project) => project.path !== projectPath)
    )
  }
}

async function resolveWorkspacePath(relativePath: string): Promise<{
  projectRoot: string
  targetPath: string
}> {
  return getWorkspaceFileService().resolvePath(relativePath)
}

async function getWorkspaceFileTree(): Promise<FileEntry[]> {
  return getWorkspaceFileService().getFileTree()
}

async function readWorkspaceFile(relativePath: string): Promise<FileContent> {
  return getWorkspaceFileService().readText(relativePath)
}

async function saveWorkspaceFile(
  relativePath: string,
  content: string
): Promise<void> {
  return getWorkspaceFileService().saveText(relativePath, content)
}

async function createWorkspaceEntry(
  input: CreateWorkspaceEntryInput
): Promise<FileEntry> {
  if (!input || typeof input !== 'object') {
    throw new Error('创建参数无效。')
  }
  return getWorkspaceFileService().createEntry(
    typeof input.directoryPath === 'string' ? input.directoryPath : '',
    input.type,
    input.name,
    typeof input.content === 'string' ? input.content : '',
    input.createParentDirectories === true
  )
}

async function renameWorkspaceEntry(
  input: RenameWorkspaceEntryInput
): Promise<FileEntry> {
  if (!input || typeof input !== 'object') {
    throw new Error('重命名参数无效。')
  }
  return getWorkspaceFileService().renameEntry(input.path, input.name)
}

async function resolveExistingWorkspaceEntry(
  relativePath: string,
  allowRoot = false
): Promise<string> {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('不能操作项目根目录。')
  }
  const { projectRoot, targetPath } = await resolveWorkspacePath(relativePath)
  const realTargetPath = await realpath(targetPath)
  assertPathInside(projectRoot, realTargetPath)
  if (!allowRoot && realTargetPath === projectRoot) {
    throw new Error('不能操作项目根目录。')
  }
  return realTargetPath
}

async function trashWorkspaceEntry(relativePath: string): Promise<void> {
  await shell.trashItem(await resolveExistingWorkspaceEntry(relativePath))
}

async function deleteWorkspaceEntry(relativePath: string): Promise<void> {
  await getWorkspaceFileService().deleteEntry(relativePath)
}

async function revealWorkspaceEntry(relativePath: string): Promise<void> {
  shell.showItemInFolder(
    await resolveExistingWorkspaceEntry(relativePath, true)
  )
}

async function prepareWorkspaceCppRun(
  relativePath: string
): Promise<CppRunPreparation> {
  const project = ensureCurrentProject()
  const { targetPath } = await resolveWorkspacePath(relativePath)
  return prepareCppRun({
    projectRoot: project.path,
    sourcePath: targetPath,
    relativeSourcePath: relativePath,
    outputRoot: join(app.getPath('temp'), 'ai-ide-cpp-runs')
  })
}

async function prepareWorkspacePythonRun(
  relativePath: string
): Promise<PythonRunPreparation> {
  const project = ensureCurrentProject()
  const { targetPath } = await resolveWorkspacePath(relativePath)
  return preparePythonRun({
    projectRoot: project.path,
    sourcePath: targetPath,
    relativeSourcePath: relativePath
  })
}

async function checkWorkspaceCppSyntax(
  relativePath: string,
  content: string
): Promise<CppSyntaxCheckResult> {
  const project = ensureCurrentProject()
  const { targetPath } = await resolveWorkspacePath(relativePath)
  return syntaxCheckCppSource({
    projectRoot: project.path,
    sourcePath: targetPath,
    content
  })
}

function broadcastDebuggerSnapshot(snapshot: DebuggerSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('debug:snapshot', snapshot)
    }
  }
}

async function startWorkspaceCppDebug(
  relativePath: string,
  breakpoints: DebugBreakpoint[]
): Promise<DebuggerSnapshot> {
  debugStartAbortController?.abort()
  const abortController = new AbortController()
  debugStartAbortController = abortController
  const project = ensureCurrentProject()
  try {
    const { targetPath } = await resolveWorkspacePath(relativePath)
    const debugRoot = app.isPackaged
      ? join(process.resourcesPath, 'debug-adapters')
      : join(app.getAppPath(), '.debugger')
    const adapterPath = app.isPackaged
      ? join(debugRoot, 'cpptools', 'bin', 'OpenDebugAD7.exe')
      : join(
          debugRoot,
          'cpptools-win',
          'extension',
          'debugAdapters',
          'bin',
          'OpenDebugAD7.exe'
        )
    const gdbPath = join(
      debugRoot,
      app.isPackaged ? 'gdb' : 'msys2',
      app.isPackaged ? 'bin' : 'ucrt64\\bin',
      'gdb.exe'
    )
    for (const requiredPath of [adapterPath, gdbPath]) {
      if (!(await lstat(requiredPath).catch(() => null))) {
        throw new Error(`调试组件不存在：${requiredPath}`)
      }
    }

    const build = await compileCppForDebug({
      projectRoot: project.path,
      sourcePath: targetPath,
      relativeSourcePath: relativePath,
      outputRoot: join(app.getPath('temp'), 'ai-ide-cpp-runs'),
      signal: abortController.signal
    })
    if (abortController.signal.aborted) {
      throw new Error('调试已取消。')
    }
    debugSession?.dispose()
    const session = new DebugSession()
    debugSession = session
    session.on('snapshot', broadcastDebuggerSnapshot)
    try {
      return await session.start({
        adapterPath,
        adapterCwd: dirname(adapterPath),
        gdbPath,
        program: build.executablePath,
        cwd: project.path,
        buildOutput: `${build.output}\nDebugger: ${build.compiler} + GDB`,
        breakpoints: Array.isArray(breakpoints)
          ? breakpoints
              .filter(
                (breakpoint) =>
                  breakpoint &&
                  typeof breakpoint.path === 'string' &&
                  Number.isInteger(breakpoint.line)
              )
              .slice(0, 200)
              .map((breakpoint) => ({
                path: resolve(project.path, breakpoint.path),
                line: Math.max(1, breakpoint.line)
              }))
          : []
      })
    } catch (error) {
      session.dispose()
      if (debugSession === session) {
        debugSession = null
      }
      throw error
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error('调试已取消。')
    }
    throw error
  } finally {
    if (debugStartAbortController === abortController) {
      debugStartAbortController = null
    }
  }
}

async function setWorkspaceDebugBreakpoints(
  breakpoints: DebugBreakpoint[]
): Promise<void> {
  if (!debugSession) {
    return
  }
  const project = ensureCurrentProject()
  await debugSession.setBreakpoints(
    breakpoints
      .filter(
        (breakpoint) =>
          breakpoint &&
          typeof breakpoint.path === 'string' &&
          Number.isInteger(breakpoint.line)
      )
      .slice(0, 200)
      .map((breakpoint) => ({
        path: resolve(project.path, breakpoint.path),
        line: Math.max(1, breakpoint.line)
      }))
  )
}

async function getGitStatus(): Promise<GitStatus> {
  if (!currentProject) {
    return {
      isRepository: false,
      branch: null,
      ahead: 0,
      behind: 0,
      changes: [],
      error: '请先打开一个项目。'
    }
  }
  return getGitService().getStatus()
}

async function getGitFileDiff(
  relativePath: string,
  originalPath?: string
): Promise<GitFileDiff> {
  return getGitService().getFileDiff(relativePath, originalPath)
}

async function stageGitFiles(paths: string[]): Promise<GitStatus> {
  return getGitService().stageFiles(paths)
}

async function unstageGitFiles(paths: string[]): Promise<GitStatus> {
  return getGitService().unstageFiles(paths)
}

async function stageAllGitFiles(): Promise<GitStatus> {
  return getGitService().stageAll()
}

async function unstageAllGitFiles(): Promise<GitStatus> {
  return getGitService().unstageAll()
}

async function commitGitChanges(message: string): Promise<GitCommitResult> {
  return getGitService().commitChanges(message)
}

async function resolveCodexExecutable(): Promise<string> {
  if (cachedCodexExecutable) {
    return cachedCodexExecutable
  }
  cachedCodexExecutable = await findCodexExecutable()
  return cachedCodexExecutable
}

async function startCodexRun(
  webContents: WebContents,
  prompt: string,
  mode: AgentRunMode,
  taskId: string
): Promise<AgentRunInfo> {
  if (!currentProject) {
    throw new Error('请先打开一个项目。')
  }
  if (!prompt.trim() || prompt.length > 100_000) {
    throw new Error('Agent 任务不能为空。')
  }
  if (mode !== 'read-only' && mode !== 'workspace-write') {
    throw new Error('Agent 运行模式无效。')
  }
  const projectRoot = await realpath(currentProject.path)
  if (!getAgentTask(taskId)) {
    throw new Error('启动 Agent 前需要先创建任务。')
  }
  return agentCoordinator.startCodex({
    owner: webContents,
    taskId,
    prompt,
    mode,
    projectRoot,
  })
}

async function startDeepSeekRun(
  webContents: WebContents,
  prompt: string,
  mode: AgentRunMode,
  taskId: string
): Promise<AgentRunInfo> {
  if (!currentProject) {
    throw new Error('请先打开一个项目。')
  }
  if (!prompt.trim() || prompt.length > 100_000) {
    throw new Error('Agent 任务无效。')
  }
  if (mode !== 'read-only' && mode !== 'workspace-write') {
    throw new Error('Agent 运行模式无效。')
  }
  const apiKey = await getDeepSeekApiKey()
  if (!apiKey) {
    throw new Error('请先配置 DeepSeek API Key。')
  }
  if (!getAgentTask(taskId)) {
    throw new Error('启动 Agent 前需要先创建任务。')
  }
  const model = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat'
  const projectRoot = await realpath(currentProject.path)
  return agentCoordinator.startDeepSeek({
    owner: webContents,
    taskId,
    prompt,
    apiKey,
    model,
    mode,
    projectRoot,
    workspace: getWorkspaceFileService()
  })
}

async function startAgentRun(
  webContents: WebContents,
  prompt: string,
  mode: AgentRunMode,
  provider: AgentProvider,
  taskId: string
): Promise<AgentRunInfo> {
  if (provider === 'deepseek') {
    return startDeepSeekRun(webContents, prompt, mode, taskId)
  }
  if (provider === 'codex') {
    return startCodexRun(webContents, prompt, mode, taskId)
  }
  throw new Error('不支持的 Agent Provider。')
}

function sendCloseRequest(window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    window.webContents.send('app:close-requested')
  }
}

function requestCloseWithUnsavedCheck(): void {
  if (allowApplicationClose) {
    app.quit()
    return
  }
  const windowsWithUnsavedFiles = BrowserWindow.getAllWindows().filter(
    (window) =>
      !window.isDestroyed() &&
      (unsavedFileCounts.get(window.webContents.id) ?? 0) > 0
  )
  if (windowsWithUnsavedFiles.length > 0) {
    for (const window of windowsWithUnsavedFiles) {
      sendCloseRequest(window)
    }
    return
  }
  allowApplicationClose = true
  app.quit()
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d1013',
      symbolColor: '#d8ddd5',
      height: 32
    },
    backgroundColor: '#0d1013',
    title: 'AI IDE',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })
  const windowWebContentsId = mainWindow.webContents.id

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (url !== currentUrl) {
      event.preventDefault()
    }
  })

  mainWindow.on('close', (event) => {
    if (allowApplicationClose) {
      return
    }
    if ((unsavedFileCounts.get(windowWebContentsId) ?? 0) > 0) {
      event.preventDefault()
      sendCloseRequest(mainWindow)
    }
  })

  mainWindow.on('closed', () => {
    unsavedFileCounts.delete(windowWebContentsId)
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (isDevelopment && rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function sendAppMenuCommand(command: AppMenuCommand): void {
  const window =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(0)
  if (window && !window.isDestroyed()) {
    window.webContents.send('app-menu:command', command)
  }
}

function createApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '设置…',
          accelerator: 'Ctrl+,',
          click: () => sendAppMenuCommand('app:settings')
        },
        { type: 'separator' },
        {
          label: '新建项目…',
          accelerator: 'Ctrl+Shift+N',
          click: () => sendAppMenuCommand('project:new')
        },
        {
          label: '打开项目…',
          accelerator: 'Ctrl+O',
          click: () => sendAppMenuCommand('project:open')
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: 'Ctrl+S',
          click: () => sendAppMenuCommand('file:save')
        },
        {
          label: '关闭编辑器',
          accelerator: 'Ctrl+W',
          click: () => sendAppMenuCommand('file:close-editor')
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '删除', role: 'delete' }
      ]
    },
    {
      label: '选择',
      submenu: [
        { label: '全选', role: 'selectAll' },
        { type: 'separator' },
        {
          label: '打开命令面板',
          click: () => sendAppMenuCommand('command-palette:open')
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '命令面板…',
          accelerator: 'Ctrl+Shift+P',
          click: () => sendAppMenuCommand('command-palette:open')
        },
        { type: 'separator' },
        {
          label: '资源管理器',
          accelerator: 'Ctrl+Shift+E',
          click: () => sendAppMenuCommand('view:explorer')
        },
        {
          label: '搜索代码',
          accelerator: 'Ctrl+Shift+F',
          click: () => sendAppMenuCommand('view:search')
        },
        {
          label: '源码管理',
          accelerator: 'Ctrl+Shift+G',
          click: () => sendAppMenuCommand('view:source-control')
        },
        {
          label: '运行',
          accelerator: 'Ctrl+Shift+D',
          click: () => sendAppMenuCommand('view:run')
        },
        {
          label: 'Agent',
          accelerator: 'Ctrl+Alt+I',
          click: () => sendAppMenuCommand('view:agent')
        },
        { type: 'separator' },
        {
          label: '问题',
          accelerator: 'Ctrl+Shift+M',
          click: () => sendAppMenuCommand('view:problems')
        },
        {
          label: '错误列表',
          click: () => sendAppMenuCommand('view:error-list')
        },
        {
          label: '诊断工具',
          click: () => sendAppMenuCommand('view:diagnostic-tools')
        },
        {
          label: '输出',
          accelerator: 'Ctrl+Shift+U',
          click: () => sendAppMenuCommand('view:output')
        },
        {
          label: '调试控制台',
          accelerator: 'Ctrl+Shift+Y',
          click: () => sendAppMenuCommand('view:debug-console')
        },
        {
          label: '调用堆栈',
          click: () => sendAppMenuCommand('view:call-stack')
        },
        {
          label: '内存',
          click: () => sendAppMenuCommand('view:memory')
        },
        {
          label: '终端',
          accelerator: 'Ctrl+`',
          click: () => sendAppMenuCommand('view:toggle-terminal')
        },
        {
          label: '显示或隐藏底部面板',
          accelerator: 'Ctrl+J',
          click: () => sendAppMenuCommand('view:toggle-bottom-panel')
        },
        { type: 'separator' },
        {
          label: '显示或隐藏活动栏',
          click: () => sendAppMenuCommand('view:toggle-activity-bar')
        },
        {
          label: '显示或隐藏侧边栏',
          accelerator: 'Ctrl+B',
          click: () => sendAppMenuCommand('view:toggle-sidebar')
        },
        {
          label: '显示或隐藏右侧栏',
          accelerator: 'Ctrl+Alt+B',
          click: () => sendAppMenuCommand('view:toggle-inspector')
        },
        {
          label: '将右侧栏停靠到右侧',
          click: () => sendAppMenuCommand('view:dock-inspector-right')
        },
        {
          label: '将右侧栏停靠到底部',
          click: () => sendAppMenuCommand('view:dock-inspector-bottom')
        },
        { type: 'separator' },
        {
          label: '保存视图',
          submenu: ([1, 2, 3, 4, 5] as WorkspaceViewSlot[]).map((slot) => ({
            label: `保存到方案 ${slot}`,
            click: () =>
              sendAppMenuCommand(`view:save-scheme-${slot}`)
          }))
        },
        {
          label: '应用视图',
          submenu: ([1, 2, 3, 4, 5] as WorkspaceViewSlot[]).map((slot) => ({
            label: `应用方案 ${slot}`,
            click: () =>
              sendAppMenuCommand(`view:apply-scheme-${slot}`)
          }))
        },
        {
          label: '自动换行',
          accelerator: 'Alt+Z',
          click: () => sendAppMenuCommand('view:toggle-word-wrap')
        },
        {
          label: '重置窗口布局',
          click: () => sendAppMenuCommand('view:reset-layout')
        },
        { type: 'separator' },
        { label: '切换全屏', role: 'togglefullscreen' }
      ]
    },
    {
      label: '转到',
      submenu: [
        {
          label: '转到文件…',
          accelerator: 'Ctrl+P',
          click: () => sendAppMenuCommand('command-palette:files')
        },
        {
          label: '转到行…',
          accelerator: 'Ctrl+G',
          click: () => sendAppMenuCommand('editor:goto-line')
        },
        { type: 'separator' },
        {
          label: '下一个编辑器',
          accelerator: 'Ctrl+Tab',
          click: () => sendAppMenuCommand('editor:next')
        },
        {
          label: '上一个编辑器',
          accelerator: 'Ctrl+Shift+Tab',
          click: () => sendAppMenuCommand('editor:previous')
        }
      ]
    },
    {
      label: '运行',
      submenu: [
        {
          label: '启动调试',
          accelerator: 'F5',
          click: () => sendAppMenuCommand('debug:start')
        },
        {
          label: '继续',
          click: () => sendAppMenuCommand('debug:continue')
        },
        {
          label: '暂停',
          click: () => sendAppMenuCommand('debug:pause')
        },
        {
          label: '单步跳过',
          accelerator: 'F10',
          click: () => sendAppMenuCommand('debug:step-over')
        },
        {
          label: '单步进入',
          accelerator: 'F11',
          click: () => sendAppMenuCommand('debug:step-in')
        },
        {
          label: '单步退出',
          accelerator: 'Shift+F11',
          click: () => sendAppMenuCommand('debug:step-out')
        },
        {
          label: '切换断点',
          accelerator: 'F9',
          click: () => sendAppMenuCommand('debug:toggle-breakpoint')
        },
        {
          label: '停止调试',
          accelerator: 'Shift+F5',
          click: () => sendAppMenuCommand('debug:stop')
        },
        { type: 'separator' },
        {
          label: '运行当前 C/C++ 文件',
          accelerator: 'Ctrl+F5',
          click: () => sendAppMenuCommand('file:run-cpp')
        },
        {
          label: '运行当前 Python 文件',
          accelerator: 'Shift+F10',
          click: () => sendAppMenuCommand('file:run-python')
        },
        { type: 'separator' },
        {
          label: '运行项目',
          click: () => sendAppMenuCommand('terminal:run')
        },
        {
          label: '运行诊断',
          click: () => sendAppMenuCommand('diagnostics:run')
        },
        {
          label: '运行工作流…',
          click: () => sendAppMenuCommand('workflow:open')
        },
        {
          label: '打开 Agent',
          click: () => sendAppMenuCommand('agent:open')
        }
      ]
    },
    {
      label: '终端',
      submenu: [
        {
          label: '显示终端',
          accelerator: 'Ctrl+`',
          click: () => sendAppMenuCommand('terminal:open')
        },
        {
          label: '运行已保存命令',
          click: () => sendAppMenuCommand('terminal:run')
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '使用指南',
          click: () => {
            void shell.openExternal(
              'https://github.com/wjiwjiwji/ai-ide#readme'
            )
          }
        },
        {
          label: 'GitHub 仓库',
          click: () => {
            void shell.openExternal('https://github.com/wjiwjiwji/ai-ide')
          }
        },
        {
          label: '检查更新',
          click: () => sendAppMenuCommand('updates:check')
        },
        { type: 'separator' },
        {
          label: '关于 AI IDE',
          click: () => sendAppMenuCommand('help:about')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:get-info', (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron
    }
  })

  ipcMain.handle('updates:get-status', (): AppUpdateStatus => {
    return updateService.getStatus()
  })

  ipcMain.handle('updates:check', async (): Promise<AppUpdateStatus> => {
    return updateService.checkForUpdates()
  })

  ipcMain.handle('updates:download', async (): Promise<AppUpdateStatus> => {
    return updateService.downloadUpdate()
  })

  ipcMain.handle('updates:install', (): void => {
    updateService.installUpdate()
  })

  ipcMain.handle('edit:perform', (event, action: EditAction): void => {
    switch (action) {
      case 'undo':
        event.sender.undo()
        break
      case 'redo':
        event.sender.redo()
        break
      case 'cut':
        event.sender.cut()
        break
      case 'copy':
        event.sender.copy()
        break
      case 'paste':
        event.sender.paste()
        break
      case 'select-all':
        event.sender.selectAll()
        break
      default:
        throw new Error('不支持的编辑操作。')
    }
  })

  ipcMain.handle('window:toggle-full-screen', (event): void => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.setFullScreen(!window.isFullScreen())
  })

  ipcMain.handle('app:quit', (): void => {
    requestCloseWithUnsavedCheck()
  })

  ipcMain.on(
    'app:set-unsaved-file-count',
    (event, count: number): void => {
      unsavedFileCounts.set(
        event.sender.id,
        Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
      )
    }
  )

  ipcMain.handle('app:confirm-close', (): void => {
    allowApplicationClose = true
    app.quit()
  })

  ipcMain.handle('app:get-memory-metrics', (): MemoryMetrics => {
    return {
      processes: app.getAppMetrics().map((metric) => ({
        pid: metric.pid,
        type: metric.type,
        memoryMB: Math.round((metric.memory.workingSetSize / 1024) * 10) / 10,
        cpuPercent: Math.round(metric.cpu.percentCPUUsage * 10) / 10
      })),
      totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(freemem() / 1024 / 1024),
      timestamp: new Date().toISOString()
    }
  })

  ipcMain.handle('project:choose-parent', async (): Promise<string | null> => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = {
      title: '选择新项目保存位置',
      buttonLabel: '选择文件夹',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle(
    'project:create',
    async (_event, input: CreateProjectInput): Promise<ProjectInfo> => {
      if (!input || typeof input !== 'object') {
        throw new Error('项目创建参数无效。')
      }
      const template = PROJECT_TEMPLATES.find(
        (item) => item.id === input.template
      )
      if (!template) {
        throw new Error('所选项目模板无效。')
      }
      const created = await createProjectDirectory(input.parentPath, input.name)
      await scaffoldProject(created.path, created.name, template.id)
      if (input.initializeGit) {
        await new Promise<void>((resolve) => {
          execFile(
            'git',
            ['init', '-b', 'main'],
            {
              cwd: created.path,
              windowsHide: true
            },
            (error) => {
              if (error) {
                console.warn('Unable to initialize Git repository:', error)
              }
              resolve()
            }
          )
        })
      }

      const settings = await readProjectSettings()
      const projectSettings: NonNullable<
        ProjectSettingsStore['projects'][string]
      > = {}
      const templateCommands = projectTemplateCommands(
        created.name,
        template.id
      )
      if (templateCommands.runCommand) {
        projectSettings.runCommand = templateCommands.runCommand
      }
      if (templateCommands.diagnosticsCommand) {
        projectSettings.diagnosticsCommand =
          templateCommands.diagnosticsCommand
      }
      if (Object.keys(projectSettings).length > 0) {
        settings.projects[created.path] = projectSettings
        await writeProjectSettings(settings)
      }
      return activateProject(created.path)
    }
  )

  ipcMain.handle('project:list-recent', async (): Promise<ProjectInfo[]> => {
    return readRecentProjects()
  })

  ipcMain.handle('project:get-current', (): ProjectInfo | null => {
    return currentProject
  })

  ipcMain.handle(
    'project:check-availability',
    async (): Promise<ProjectAvailability> => {
      if (!currentProject) {
        return { project: null, available: false }
      }
      try {
        const projectStats = await stat(currentProject.path)
        return {
          project: currentProject,
          available: projectStats.isDirectory()
        }
      } catch {
        return { project: currentProject, available: false }
      }
    }
  )

  ipcMain.handle('project:close-current', async (): Promise<void> => {
    await closeCurrentProject()
  })

  ipcMain.handle('project:open', async (): Promise<ProjectInfo | null> => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = {
      title: '打开项目文件夹',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return activateProject(result.filePaths[0])
  })

  ipcMain.handle(
    'project:open-path',
    async (_event, path: string): Promise<ProjectInfo> => {
      try {
        return await activateProject(path)
      } catch (error) {
        const recentProjects = await readRecentProjects()
        await writeRecentProjects(
          recentProjects.filter((project) => project.path !== path)
        )
        const errorCode = (error as NodeJS.ErrnoException).code
        if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') {
          throw new Error('项目已经删除。')
        }
        throw error
      }
    }
  )

  ipcMain.handle('files:get-tree', async (): Promise<FileEntry[]> => {
    return getWorkspaceFileTree()
  })

  ipcMain.handle(
    'files:read',
    async (_event, path: string): Promise<FileContent> => {
      return readWorkspaceFile(path)
    }
  )

  ipcMain.handle(
    'files:save',
    async (_event, path: string, content: string): Promise<void> => {
      await saveWorkspaceFile(path, content)
    }
  )

  ipcMain.handle(
    'files:create-entry',
    async (_event, input: CreateWorkspaceEntryInput): Promise<FileEntry> => {
      return createWorkspaceEntry(input)
    }
  )

  ipcMain.handle(
    'files:rename-entry',
    async (_event, input: RenameWorkspaceEntryInput): Promise<FileEntry> => {
      return renameWorkspaceEntry(input)
    }
  )

  ipcMain.handle(
    'files:trash-entry',
    async (_event, path: string): Promise<void> => {
      await trashWorkspaceEntry(path)
    }
  )

  ipcMain.handle(
    'files:delete-entry',
    async (_event, path: string): Promise<void> => {
      await deleteWorkspaceEntry(path)
    }
  )

  ipcMain.handle(
    'files:reveal-entry',
    async (_event, path: string): Promise<void> => {
      await revealWorkspaceEntry(path)
    }
  )

  ipcMain.handle(
    'files:prepare-cpp-run',
    async (_event, path: string): Promise<CppRunPreparation> => {
      return prepareWorkspaceCppRun(path)
    }
  )

  ipcMain.handle(
    'files:prepare-python-run',
    async (_event, path: string): Promise<PythonRunPreparation> => {
      return prepareWorkspacePythonRun(path)
    }
  )

  ipcMain.handle(
    'files:check-cpp-syntax',
    async (
      _event,
      path: string,
      content: string
    ): Promise<CppSyntaxCheckResult> => {
      return checkWorkspaceCppSyntax(path, content)
    }
  )

  ipcMain.handle(
    'debug:start',
    async (
      _event,
      path: string,
      breakpoints: DebugBreakpoint[]
    ): Promise<DebuggerSnapshot> => {
      return startWorkspaceCppDebug(path, breakpoints)
    }
  )

  ipcMain.handle(
    'debug:set-breakpoints',
    async (_event, breakpoints: DebugBreakpoint[]): Promise<void> => {
      await setWorkspaceDebugBreakpoints(breakpoints)
    }
  )

  ipcMain.handle(
    'debug:control',
    async (
      _event,
      action:
        | 'continue'
        | 'pause'
        | 'step-over'
        | 'step-in'
        | 'step-out'
        | 'stop'
    ): Promise<void> => {
      if (action === 'stop') {
        debugStartAbortController?.abort()
        debugStartAbortController = null
        debugSession?.dispose()
        debugSession = null
        broadcastDebuggerSnapshot({
          ...idleDebugSnapshot,
          message: '调试已取消。'
        })
        return
      }
      if (!debugSession) {
        throw new Error('没有活动调试会话。')
      }
      await debugSession.control(action)
    }
  )

  ipcMain.handle(
    'debug:evaluate',
    async (_event, expression: string): Promise<string> => {
      if (!debugSession) {
        throw new Error('没有活动调试会话。')
      }
      if (typeof expression !== 'string' || expression.length > 4000) {
        throw new Error('调试表达式无效。')
      }
      return debugSession.evaluate(expression)
    }
  )

  ipcMain.handle('debug:snapshot', (): DebuggerSnapshot => {
    return debugSession?.getSnapshot() ?? idleDebugSnapshot
  })

  ipcMain.handle('git:get-status', async (): Promise<GitStatus> => {
    return getGitStatus()
  })

  ipcMain.handle(
    'git:ensure-recommended-ignore',
    async (): Promise<GitignoreRepairResult> => {
      return ensureRecommendedGitignore(ensureCurrentProject().path)
    }
  )

  ipcMain.handle(
    'git:get-file-diff',
    async (
      _event,
      path: string,
      originalPath?: string
    ): Promise<GitFileDiff> => {
      return getGitFileDiff(path, originalPath)
    }
  )

  ipcMain.handle(
    'git:stage-files',
    async (_event, paths: string[]): Promise<GitStatus> => {
      return stageGitFiles(paths)
    }
  )

  ipcMain.handle(
    'git:unstage-files',
    async (_event, paths: string[]): Promise<GitStatus> => {
      return unstageGitFiles(paths)
    }
  )

  ipcMain.handle('git:stage-all', async (): Promise<GitStatus> => {
    return stageAllGitFiles()
  })

  ipcMain.handle('git:unstage-all', async (): Promise<GitStatus> => {
    return unstageAllGitFiles()
  })

  ipcMain.handle(
    'git:commit',
    async (_event, message: string): Promise<GitCommitResult> => {
      return commitGitChanges(message)
    }
  )

  ipcMain.handle('project:get-run-command', async (): Promise<string> => {
    return getProjectRunCommand()
  })

  ipcMain.handle(
    'project:save-run-command',
    async (_event, command: string): Promise<void> => {
      await saveProjectRunCommand(command)
    }
  )

  ipcMain.handle(
    'terminal:create',
    async (
      event,
      cols: number,
      rows: number
    ): Promise<TerminalSessionInfo> => {
      if (!currentProject) {
        throw new Error('请先打开一个项目。')
      }
      const projectRoot = await realpath(currentProject.path)
      return terminalService.createSession(
        event.sender.id,
        projectRoot,
        cols,
        rows
      )
    }
  )

  ipcMain.handle(
    'terminal:write',
    async (event, sessionId: string, data: string): Promise<void> => {
      terminalService.write(event.sender.id, sessionId, data)
    }
  )

  ipcMain.handle(
    'terminal:resize',
    async (
      event,
      sessionId: string,
      cols: number,
      rows: number
    ): Promise<void> => {
      terminalService.resize(event.sender.id, sessionId, cols, rows)
    }
  )

  ipcMain.handle(
    'terminal:kill',
    async (event, sessionId: string): Promise<void> => {
      terminalService.kill(event.sender.id, sessionId)
    }
  )

  ipcMain.handle(
    'agent:start',
    async (
      event,
      prompt: string,
      mode: AgentRunMode,
      provider: AgentProvider,
      taskId: string
    ): Promise<AgentRunInfo> => {
      return startAgentRun(event.sender, prompt, mode, provider, taskId)
    }
  )

  ipcMain.handle(
    'agent:cancel',
    async (event, runId: string): Promise<void> => {
      agentCoordinator.cancel(event.sender.id, runId)
    }
  )

  ipcMain.handle(
    'agent:provider-status',
    async (): Promise<AgentProviderStatus> => {
      return getAgentProviderStatus()
    }
  )

  ipcMain.handle(
    'agent:code-completion',
    async (
      event,
      request: AgentCodeCompletionRequest
    ): Promise<AgentCodeCompletionResult> => {
      return getAgentCodeCompletion(event.sender.id, request)
    }
  )

  ipcMain.handle(
    'agent:cancel-code-completion',
    async (event): Promise<void> => {
      agentCompletionControllers.get(event.sender.id)?.abort()
      agentCompletionControllers.delete(event.sender.id)
    }
  )

  ipcMain.handle(
    'agent:save-deepseek-key',
    async (_event, apiKey: string): Promise<AgentProviderStatus> => {
      return saveDeepSeekApiKey(apiKey)
    }
  )

  ipcMain.handle(
    'agent:clear-deepseek-key',
    async (): Promise<AgentProviderStatus> => {
      return clearDeepSeekApiKey()
    }
  )

  ipcMain.handle(
    'agent:approval-response',
    async (
      event,
      runId: string,
      approvalId: string,
      approved: boolean
    ): Promise<void> => {
      agentCoordinator.respondApproval(
        event.sender.id,
        runId,
        approvalId,
        approved
      )
    }
  )

  ipcMain.handle('agent:tasks-list', (): AgentTaskSummary[] => {
    return listAgentTasks()
  })

  ipcMain.handle(
    'agent:task-save',
    (_event, task: AgentTaskSaveInput): AgentTaskSummary => {
      return saveAgentTask(task)
    }
  )

  ipcMain.handle(
    'agent:task-get',
    (_event, taskId: string): AgentTaskRecord | null => {
      return getAgentTask(taskId)
    }
  )

  ipcMain.handle(
    'agent:checkpoints-list',
    (_event, taskId: string): AgentCheckpointInfo[] => {
      return listAgentCheckpoints(taskId)
    }
  )

  ipcMain.handle(
    'agent:checkpoint-restore',
    async (_event, checkpointId: string): Promise<void> => {
      await restoreAgentCheckpoint(checkpointId)
    }
  )

  ipcMain.handle(
    'agent:checkpoint-diff',
    async (_event, checkpointId: string): Promise<CheckpointDiff> => {
      return getAgentCheckpointDiff(checkpointId)
    }
  )

  ipcMain.handle(
    'agent:checkpoint-file-diff',
    async (
      _event,
      checkpointId: string,
      path: string
    ): Promise<CheckpointFileDiff> => {
      return getAgentCheckpointFileDiff(checkpointId, path)
    }
  )

  ipcMain.handle('code-index:status', (): CodeIndexStatus => {
    return getCodeIndexStatus()
  })

  ipcMain.handle('code-index:rebuild', async (): Promise<CodeIndexStatus> => {
    return rebuildCodeIndex()
  })

  ipcMain.handle(
    'code-index:search',
    (_event, query: string): CodeSearchResult[] => {
      return searchCodeIndex(query)
    }
  )

  ipcMain.handle('diagnostics:get-command', async (): Promise<string> => {
    return getDiagnosticsCommand()
  })

  ipcMain.handle(
    'diagnostics:save-command',
    async (_event, command: string): Promise<void> => {
      await saveDiagnosticsCommand(command)
    }
  )

  ipcMain.handle(
    'diagnostics:run',
    async (): Promise<DiagnosticsResult> => {
      return runProjectDiagnostics()
    }
  )

  ipcMain.handle('workflow:list', async (): Promise<ProjectWorkflow[]> => {
    return getProjectWorkflows()
  })

  ipcMain.handle(
    'workflow:save',
    async (_event, workflows: ProjectWorkflow[]): Promise<ProjectWorkflow[]> => {
      return saveProjectWorkflows(workflows)
    }
  )

  ipcMain.handle(
    'workflow:run',
    async (_event, workflowId: string): Promise<WorkflowRunResult> => {
      return runProjectWorkflow(workflowId)
    }
  )

  ipcMain.handle(
    'workflow:templates-list',
    (): WorkflowTemplate[] => {
      return listWorkflowTemplates()
    }
  )

  ipcMain.handle(
    'workflow:template-save',
    (_event, template: WorkflowTemplate): WorkflowTemplate[] => {
      return saveWorkflowTemplate(template)
    }
  )

  ipcMain.handle(
    'workflow:template-delete',
    (_event, templateId: string): WorkflowTemplate[] => {
      return deleteWorkflowTemplate(templateId)
    }
  )

  ipcMain.handle(
    'workflow:runs-list',
    (_event, workflowId?: string): WorkflowRunSummary[] => {
      return listWorkflowRuns(workflowId)
    }
  )

  ipcMain.handle(
    'workflow:run-get',
    (_event, runId: string): WorkflowRunRecord | null => {
      return getWorkflowRun(runId)
    }
  )
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.local.ai-ide')
  registerIpcHandlers()
  createApplicationMenu()

  const startupProjectPath = process.env.AI_IDE_PROJECT
  if (startupProjectPath) {
    try {
      await activateProject(startupProjectPath)
    } catch (error) {
      console.error('Unable to open the startup project:', error)
    }
  }

  createWindow()
  const updateCheckTimer = setTimeout(() => {
    void updateService.checkForUpdates()
  }, 4000)
  updateCheckTimer.unref()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  terminalService.killAll()
  agentCoordinator.killAll()
  for (const controller of agentCompletionControllers.values()) {
    controller.abort()
  }
  agentCompletionControllers.clear()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (
    !allowApplicationClose &&
    [...unsavedFileCounts.values()].some((count) => count > 0)
  ) {
    event.preventDefault()
    for (const window of BrowserWindow.getAllWindows()) {
      if (
        !window.isDestroyed() &&
        (unsavedFileCounts.get(window.webContents.id) ?? 0) > 0
      ) {
        sendCloseRequest(window)
      }
    }
    return
  }
  if (closeCleanupComplete) {
    return
  }
  closeCleanupComplete = true
  terminalService.killAll()
  agentCoordinator.killAll()
  debugStartAbortController?.abort()
  debugStartAbortController = null
  debugSession?.dispose()
  debugSession = null
  persistenceDatabase?.close()
  persistenceDatabase = null
})
