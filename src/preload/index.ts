import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentStreamEvent,
  DesktopApi,
  TerminalDataEvent,
  TerminalExitEvent
} from '../shared/desktop'

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  getUpdateStatus: () => ipcRenderer.invoke('updates:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: Parameters<typeof callback>[0]
    ): void => {
      callback(status)
    }
    ipcRenderer.on('updates:status', listener)
    return () => ipcRenderer.removeListener('updates:status', listener)
  },
  onAppMenuCommand: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command: Parameters<typeof callback>[0]
    ): void => {
      callback(command)
    }
    ipcRenderer.on('app-menu:command', listener)
    return () => ipcRenderer.removeListener('app-menu:command', listener)
  },
  onCloseRequested: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:close-requested', listener)
    return () => ipcRenderer.removeListener('app:close-requested', listener)
  },
  performEditAction: (action) => ipcRenderer.invoke('edit:perform', action),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggle-full-screen'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  confirmClose: () => ipcRenderer.invoke('app:confirm-close'),
  setUnsavedFileCount: (count) =>
    ipcRenderer.send('app:set-unsaved-file-count', count),
  chooseProjectParent: () => ipcRenderer.invoke('project:choose-parent'),
  createProject: (input) => ipcRenderer.invoke('project:create', input),
  openProject: () => ipcRenderer.invoke('project:open'),
  openRecentProject: (path) => ipcRenderer.invoke('project:open-path', path),
  listRecentProjects: () => ipcRenderer.invoke('project:list-recent'),
  getCurrentProject: () => ipcRenderer.invoke('project:get-current'),
  checkProjectAvailability: () =>
    ipcRenderer.invoke('project:check-availability'),
  closeCurrentProject: () => ipcRenderer.invoke('project:close-current'),
  getFileTree: () => ipcRenderer.invoke('files:get-tree'),
  readFile: (path) => ipcRenderer.invoke('files:read', path),
  saveFile: (path, content) => ipcRenderer.invoke('files:save', path, content),
  createWorkspaceEntry: (input) =>
    ipcRenderer.invoke('files:create-entry', input),
  renameWorkspaceEntry: (input) =>
    ipcRenderer.invoke('files:rename-entry', input),
  trashWorkspaceEntry: (path) =>
    ipcRenderer.invoke('files:trash-entry', path),
  deleteWorkspaceEntry: (path) =>
    ipcRenderer.invoke('files:delete-entry', path),
  revealWorkspaceEntry: (path) =>
    ipcRenderer.invoke('files:reveal-entry', path),
  getMemoryMetrics: () => ipcRenderer.invoke('app:get-memory-metrics'),
  prepareCppRun: (path) =>
    ipcRenderer.invoke('files:prepare-cpp-run', path),
  preparePythonRun: (path) =>
    ipcRenderer.invoke('files:prepare-python-run', path),
  checkCppSyntax: (path, content) =>
    ipcRenderer.invoke('files:check-cpp-syntax', path, content),
  startCppDebug: (path, breakpoints) =>
    ipcRenderer.invoke('debug:start', path, breakpoints),
  setDebugBreakpoints: (breakpoints) =>
    ipcRenderer.invoke('debug:set-breakpoints', breakpoints),
  debugControl: (action) => ipcRenderer.invoke('debug:control', action),
  evaluateDebugExpression: (expression) =>
    ipcRenderer.invoke('debug:evaluate', expression),
  getDebuggerSnapshot: () => ipcRenderer.invoke('debug:snapshot'),
  onDebuggerSnapshot: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      snapshot: Parameters<typeof callback>[0]
    ): void => {
      callback(snapshot)
    }
    ipcRenderer.on('debug:snapshot', listener)
    return () => ipcRenderer.removeListener('debug:snapshot', listener)
  },
  getGitStatus: () => ipcRenderer.invoke('git:get-status'),
  ensureRecommendedGitignore: () =>
    ipcRenderer.invoke('git:ensure-recommended-ignore'),
  getGitFileDiff: (path, originalPath) =>
    ipcRenderer.invoke('git:get-file-diff', path, originalPath),
  stageFiles: (paths) => ipcRenderer.invoke('git:stage-files', paths),
  unstageFiles: (paths) => ipcRenderer.invoke('git:unstage-files', paths),
  stageAll: () => ipcRenderer.invoke('git:stage-all'),
  unstageAll: () => ipcRenderer.invoke('git:unstage-all'),
  commitChanges: (message) => ipcRenderer.invoke('git:commit', message),
  getRunCommand: () => ipcRenderer.invoke('project:get-run-command'),
  saveRunCommand: (command) =>
    ipcRenderer.invoke('project:save-run-command', command),
  createTerminal: (cols, rows) =>
    ipcRenderer.invoke('terminal:create', cols, rows),
  writeTerminal: (sessionId, data) =>
    ipcRenderer.invoke('terminal:write', sessionId, data),
  resizeTerminal: (sessionId, cols, rows) =>
    ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  killTerminal: (sessionId) =>
    ipcRenderer.invoke('terminal:kill', sessionId),
  onTerminalData: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent): void => {
      callback(payload)
    }
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent): void => {
      callback(payload)
    }
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
  startAgent: (prompt, mode, provider, taskId) =>
    ipcRenderer.invoke('agent:start', prompt, mode, provider, taskId),
  cancelAgent: (runId) => ipcRenderer.invoke('agent:cancel', runId),
  onAgentEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AgentStreamEvent): void => {
      callback(payload)
    }
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  getAgentProviderStatus: () => ipcRenderer.invoke('agent:provider-status'),
  saveDeepSeekApiKey: (apiKey) =>
    ipcRenderer.invoke('agent:save-deepseek-key', apiKey),
  clearDeepSeekApiKey: () => ipcRenderer.invoke('agent:clear-deepseek-key'),
  getAgentCodeCompletion: (request) =>
    ipcRenderer.invoke('agent:code-completion', request),
  cancelAgentCodeCompletion: () =>
    ipcRenderer.invoke('agent:cancel-code-completion'),
  respondAgentApproval: (runId, approvalId, approved) =>
    ipcRenderer.invoke(
      'agent:approval-response',
      runId,
      approvalId,
      approved
    ),
  listAgentTasks: () => ipcRenderer.invoke('agent:tasks-list'),
  saveAgentTask: (task) => ipcRenderer.invoke('agent:task-save', task),
  getAgentTask: (taskId) => ipcRenderer.invoke('agent:task-get', taskId),
  listAgentCheckpoints: (taskId) =>
    ipcRenderer.invoke('agent:checkpoints-list', taskId),
  restoreAgentCheckpoint: (checkpointId) =>
    ipcRenderer.invoke('agent:checkpoint-restore', checkpointId),
  getAgentCheckpointDiff: (checkpointId) =>
    ipcRenderer.invoke('agent:checkpoint-diff', checkpointId),
  getAgentCheckpointFileDiff: (checkpointId, path) =>
    ipcRenderer.invoke('agent:checkpoint-file-diff', checkpointId, path),
  getCodeIndexStatus: () => ipcRenderer.invoke('code-index:status'),
  rebuildCodeIndex: () => ipcRenderer.invoke('code-index:rebuild'),
  searchCode: (query) => ipcRenderer.invoke('code-index:search', query),
  getDiagnosticsCommand: () => ipcRenderer.invoke('diagnostics:get-command'),
  saveDiagnosticsCommand: (command) =>
    ipcRenderer.invoke('diagnostics:save-command', command),
  runProjectDiagnostics: () => ipcRenderer.invoke('diagnostics:run'),
  getProjectWorkflows: () => ipcRenderer.invoke('workflow:list'),
  saveProjectWorkflows: (workflows) =>
    ipcRenderer.invoke('workflow:save', workflows),
  runProjectWorkflow: (workflowId) =>
    ipcRenderer.invoke('workflow:run', workflowId),
  listWorkflowTemplates: () => ipcRenderer.invoke('workflow:templates-list'),
  saveWorkflowTemplate: (template) =>
    ipcRenderer.invoke('workflow:template-save', template),
  deleteWorkflowTemplate: (templateId) =>
    ipcRenderer.invoke('workflow:template-delete', templateId),
  listWorkflowRuns: (workflowId) =>
    ipcRenderer.invoke('workflow:runs-list', workflowId),
  getWorkflowRun: (runId) => ipcRenderer.invoke('workflow:run-get', runId)
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
