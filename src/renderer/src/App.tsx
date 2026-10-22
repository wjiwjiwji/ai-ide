import {
  DiffEditor,
  Editor,
  type BeforeMount,
  type OnMount
} from '@monaco-editor/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppInfo,
  AppUpdateStatus,
  FileEntry,
  GitFileChange,
  GitFileDiff,
  GitStatus,
  ProjectDiagnostic,
  ProjectInfo,
  WorkflowRunResult
} from '../../shared/desktop'
import AgentWorkspace from './components/AgentWorkspace'
import CommandPalette, { type CommandItem } from './components/CommandPalette'
import ProblemsPanel from './components/ProblemsPanel'
import TerminalPanel from './components/TerminalPanel'
import WorkflowModal from './components/WorkflowModal'

type WorkspaceTab = 'changes' | 'terminal' | 'diagnostics'

interface OpenFile {
  path: string
  name: string
  content: string
  savedContent: string
  dirty: boolean
}

const emptyGitStatus: GitStatus = {
  isRepository: false,
  branch: null,
  ahead: 0,
  behind: 0,
  changes: []
}

interface FileTreeNodeProps {
  node: FileEntry
  depth: number
  activePath: string | null
  collapsedPaths: Set<string>
  onToggleDirectory: (path: string) => void
  onOpenFile: (node: FileEntry) => void
}

const languageByExtension: Record<string, string> = {
  css: 'css',
  html: 'html',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  scss: 'scss',
  sh: 'shell',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml'
}

const fileBadges: Record<string, string> = {
  css: 'CS',
  html: 'HT',
  js: 'JS',
  jsx: 'JX',
  json: '{}',
  md: 'MD',
  py: 'PY',
  sql: 'DB',
  ts: 'TS',
  tsx: 'TX',
  xml: '<>',
  yaml: 'YM',
  yml: 'YM'
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

function extensionFromPath(path: string): string {
  const fileName = fileNameFromPath(path)
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : ''
}

function languageFromPath(path: string): string {
  return languageByExtension[extensionFromPath(path)] ?? 'plaintext'
}

function fileBadge(path: string): string {
  const extension = extensionFromPath(path)
  return fileBadges[extension] ?? (extension ? extension.slice(0, 2).toUpperCase() : '·')
}

function gitKindLabel(change: GitFileChange): string {
  switch (change.kind) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'untracked':
      return '?'
    case 'conflicted':
      return '!'
    case 'modified':
      return 'M'
    default:
      return '·'
  }
}

function readablePath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  if (segments.length <= 3) {
    return path
  }

  return `…\\${segments.slice(-3).join('\\')}`
}

function configureMonacoTheme(monaco: Parameters<BeforeMount>[0]): void {
  monaco.editor.defineTheme('ai-ide-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '68727A', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'D8F36B' },
      { token: 'string', foreground: 'B8D7A3' },
      { token: 'number', foreground: 'E9B872' },
      { token: 'type', foreground: '8EC9D8' }
    ],
    colors: {
      'editor.background': '#0D1114',
      'editor.foreground': '#D9DCD8',
      'editorLineNumber.foreground': '#465057',
      'editorLineNumber.activeForeground': '#9AA39F',
      'editorCursor.foreground': '#D8F36B',
      'editor.selectionBackground': '#34452A',
      'editor.inactiveSelectionBackground': '#24302A',
      'editor.lineHighlightBackground': '#13191D',
      'editorIndentGuide.background1': '#1E252B',
      'editorIndentGuide.activeBackground1': '#364047',
      'editorWidget.background': '#151A1F',
      'editorWidget.border': '#30383E',
      'scrollbarSlider.background': '#FFFFFF12',
      'scrollbarSlider.hoverBackground': '#FFFFFF20'
    }
  })
}

function FileTreeNode({
  node,
  depth,
  activePath,
  collapsedPaths,
  onToggleDirectory,
  onOpenFile
}: FileTreeNodeProps): React.JSX.Element {
  const isDirectory = node.type === 'directory'
  const isCollapsed = collapsedPaths.has(node.path)
  const isActive = activePath === node.path

  return (
    <div className="tree-node">
      <button
        className={`tree-row ${isDirectory ? 'directory-row' : ''} ${isActive ? 'active' : ''}`}
        type="button"
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        title={node.path}
        onClick={() => {
          if (isDirectory) {
            onToggleDirectory(node.path)
          } else {
            onOpenFile(node)
          }
        }}
      >
        <span className={`tree-chevron ${isDirectory ? '' : 'file-spacer'}`}>
          {isDirectory ? (isCollapsed ? '›' : '⌄') : ''}
        </span>
        <span className={`tree-icon ${isDirectory ? 'folder' : 'file'}`}>
          {isDirectory ? '▰' : fileBadge(node.path)}
        </span>
        <span className="tree-name">{node.name}</span>
      </button>

      {isDirectory && !isCollapsed && node.children?.length ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              collapsedPaths={collapsedPaths}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [recentProjects, setRecentProjects] = useState<ProjectInfo[]>([])
  const [fileTree, setFileTree] = useState<FileEntry[]>([])
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('changes')
  const [gitStatus, setGitStatus] = useState<GitStatus>(emptyGitStatus)
  const [gitDiff, setGitDiff] = useState<GitFileDiff | null>(null)
  const [gitBusy, setGitBusy] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [runCommand, setRunCommand] = useState('')
  const [terminalOpened, setTerminalOpened] = useState(false)
  const [diagnosticsOpened, setDiagnosticsOpened] = useState(false)
  const [diagnosticsCount, setDiagnosticsCount] = useState(0)
  const [diagnosticsRefreshToken, setDiagnosticsRefreshToken] = useState(0)
  const [terminalRunRequest, setTerminalRunRequest] = useState(0)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [workflowModalOpen, setWorkflowModalOpen] = useState(false)
  const [workspaceView, setWorkspaceView] = useState<'code' | 'agent'>('code')
  const [agentOpened, setAgentOpened] = useState(false)
  const [agentPromptRequest, setAgentPromptRequest] = useState<{
    id: string
    text: string
    contextFiles: string[]
    taskId?: string
  } | null>(null)
  const [editorPosition, setEditorPosition] = useState<{
    path: string
    line: number
    column: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('桌面骨架已就绪，选择一个本地项目开始。')
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  const activeFile = openFiles.find((file) => file.path === activePath) ?? null
  const stagedCount = gitStatus.changes.filter((change) => change.staged).length
  const allChangesStaged =
    gitStatus.changes.length > 0 &&
    gitStatus.changes.every((change) => change.staged)
  const hasUnsavedFiles = openFiles.some((file) => file.dirty)

  const refreshRecentProjects = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }

    const projects = await window.desktop.listRecentProjects()
    setRecentProjects(projects)
  }, [])

  const refreshGitStatus = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }

    setGitBusy(true)
    try {
      const status = await window.desktop.getGitStatus()
      setGitStatus(status)
      setGitDiff((currentDiff) => {
        if (
          currentDiff &&
          !status.changes.some((change) => change.path === currentDiff.path)
        ) {
          return null
        }
        return currentDiff
      })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法读取 Git 状态。')
    } finally {
      setGitBusy(false)
    }
  }, [])

  const loadProject = useCallback(async (projectInfo: ProjectInfo): Promise<void> => {
    if (!window.desktop) {
      return
    }

    setBusy(true)
    try {
      const [tree, status, savedRunCommand] = await Promise.all([
        window.desktop.getFileTree(),
        window.desktop.getGitStatus(),
        window.desktop.getRunCommand()
      ])
      setProject(projectInfo)
      setFileTree(tree)
      setOpenFiles([])
      setActivePath(null)
      setGitDiff(null)
      setGitStatus(status)
      setRunCommand(savedRunCommand)
      setTerminalOpened(false)
      setDiagnosticsOpened(false)
      setDiagnosticsCount(0)
      setDiagnosticsRefreshToken((token) => token + 1)
      setActiveTab('changes')
      setWorkspaceView('code')
      setAgentOpened(false)
      setAgentPromptRequest(null)
      setEditorPosition(null)
      setCollapsedPaths(new Set())
      setNotice(`已打开项目：${projectInfo.name}`)
      await refreshRecentProjects()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '读取项目失败。')
    } finally {
      setBusy(false)
    }
  }, [refreshRecentProjects])

  useEffect(() => {
    if (!window.desktop) {
      setNotice('浏览器预览模式：桌面桥接仅在 Electron 中可用。')
      return
    }

    void Promise.all([
      window.desktop
        .getAppInfo()
        .then(setAppInfo)
        .catch(() => setNotice('无法读取 Electron 运行环境。')),
      refreshRecentProjects()
    ])

    void window.desktop.getCurrentProject().then((currentProject) => {
      if (currentProject) {
        void loadProject(currentProject)
      }
    })
  }, [loadProject, refreshRecentProjects])

  useEffect(() => {
    if (!window.desktop) {
      return
    }
    void window.desktop.getUpdateStatus().then(setUpdateStatus)
    return window.desktop.onUpdateStatus(setUpdateStatus)
  }, [])

  const handleCheckForUpdates = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    try {
      const status = await window.desktop.checkForUpdates()
      setUpdateStatus(status)
      setNotice(status.message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '检查更新失败。')
    }
  }, [])

  const handleDownloadUpdate = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    try {
      const status = await window.desktop.downloadUpdate()
      setUpdateStatus(status)
      setNotice(status.message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '下载更新失败。')
    }
  }, [])

  const handleInstallUpdate = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    try {
      await window.desktop.installUpdate()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '安装更新失败。')
    }
  }, [])

  const handleOpenProject = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      setNotice('请在 Electron 桌面应用中使用项目选择器。')
      return
    }

    setBusy(true)
    try {
      const selectedProject = await window.desktop.openProject()
      if (selectedProject) {
        await loadProject(selectedProject)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '打开项目失败。')
    } finally {
      setBusy(false)
    }
  }, [loadProject])

  const handleOpenRecentProject = useCallback(
    async (path: string): Promise<void> => {
      if (!window.desktop) {
        return
      }

      setBusy(true)
      try {
        const selectedProject = await window.desktop.openRecentProject(path)
        await loadProject(selectedProject)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '无法打开最近项目。')
      } finally {
        setBusy(false)
      }
    },
    [loadProject]
  )

  const openFile = useCallback(
    async (node: FileEntry): Promise<void> => {
      if (!window.desktop) {
        return
      }

      const existingFile = openFiles.find((file) => file.path === node.path)
      if (existingFile) {
        setActivePath(node.path)
        setGitDiff(null)
        setEditorPosition(null)
        return
      }

      setBusy(true)
      try {
        const file = await window.desktop.readFile(node.path)
        setOpenFiles((currentFiles) => [
          ...currentFiles,
          {
            path: node.path,
            name: node.name,
            content: file.content,
            savedContent: file.content,
            dirty: false
          }
        ])
        setActivePath(node.path)
        setGitDiff(null)
        setEditorPosition(null)
        setNotice(`已打开 ${node.name}`)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '无法读取文件。')
      } finally {
        setBusy(false)
      }
    },
    [openFiles]
  )

  const openGitDiff = useCallback(async (change: GitFileChange): Promise<void> => {
    if (!window.desktop) {
      return
    }

    setGitBusy(true)
    try {
      const diff = await window.desktop.getGitFileDiff(
        change.path,
        change.originalPath
      )
      setGitDiff(diff)
      setNotice(`正在查看 ${change.path} 的 Git 变更。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法读取文件差异。')
    } finally {
      setGitBusy(false)
    }
  }, [])

  const openDiagnostic = useCallback(
    async (diagnostic: ProjectDiagnostic): Promise<void> => {
      if (!window.desktop) {
        return
      }

      const existingFile = openFiles.find(
        (file) => file.path === diagnostic.file
      )
      if (!existingFile) {
        setBusy(true)
        try {
          const file = await window.desktop.readFile(diagnostic.file)
          setOpenFiles((currentFiles) => [
            ...currentFiles,
            {
              path: diagnostic.file,
              name: fileNameFromPath(diagnostic.file),
              content: file.content,
              savedContent: file.content,
              dirty: false
            }
          ])
        } catch (error) {
          setNotice(
            error instanceof Error ? error.message : '无法打开诊断文件。'
          )
          return
        } finally {
          setBusy(false)
        }
      }

      setActivePath(diagnostic.file)
      setGitDiff(null)
      setWorkspaceView('code')
      setEditorPosition({
        path: diagnostic.file,
        line: diagnostic.line,
        column: diagnostic.column
      })
    },
    [openFiles]
  )

  const openAgentWithPrompt = useCallback(
    (
      text: string,
      contextFiles: string[] = [],
      taskId?: string
    ): void => {
      if (!project) {
        setNotice('请先打开项目，再启动 Agent 任务。')
        return
      }
      setAgentPromptRequest({
        id: crypto.randomUUID(),
        text,
        contextFiles: [...new Set(contextFiles)],
        taskId
      })
      setAgentOpened(true)
      setWorkspaceView('agent')
    },
    [project]
  )

  const askAgentToFixDiagnostics = useCallback(
    (diagnostics: ProjectDiagnostic[]): void => {
      const selectedDiagnostics = diagnostics.slice(0, 50)
      if (!selectedDiagnostics.length) {
        return
      }

      const prompt = [
        'Fix the following project diagnostics.',
        'Inspect the relevant code first, make the smallest correct change, and verify it with the project diagnostics command.',
        '',
        ...selectedDiagnostics.map(
          (diagnostic) =>
            `- ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.severity}${diagnostic.code ? ` ${diagnostic.code}` : ''}] ${diagnostic.message}`
        )
      ].join('\n')

      openAgentWithPrompt(
        prompt,
        selectedDiagnostics.map((diagnostic) => diagnostic.file)
      )
    },
    [openAgentWithPrompt]
  )

  const setChangeStaged = useCallback(
    async (change: GitFileChange, shouldStage: boolean): Promise<void> => {
      if (!window.desktop) {
        return
      }

      const paths = [change.path, change.originalPath].filter(
        (path): path is string => Boolean(path)
      )

      setGitBusy(true)
      try {
        const status = shouldStage
          ? await window.desktop.stageFiles(paths)
          : await window.desktop.unstageFiles(paths)
        setGitStatus(status)
        setNotice(
          shouldStage
            ? `已暂存 ${change.path}`
            : `已取消暂存 ${change.path}`
        )
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '无法更新暂存区。')
      } finally {
        setGitBusy(false)
      }
    },
    []
  )

  const setAllChangesStaged = useCallback(async (shouldStage: boolean): Promise<void> => {
    if (!window.desktop) {
      return
    }

    setGitBusy(true)
    try {
      const status = shouldStage
        ? await window.desktop.stageAll()
        : await window.desktop.unstageAll()
      setGitStatus(status)
      setNotice(shouldStage ? '已暂存全部变更。' : '已取消暂存全部变更。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法更新暂存区。')
    } finally {
      setGitBusy(false)
    }
  }, [])

  const createCommit = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }

    const summary = commitMessage.trim()
    if (!summary || stagedCount === 0) {
      return
    }

    setGitBusy(true)
    try {
      const result = await window.desktop.commitChanges(summary)
      setGitStatus(result.status)
      setCommitMessage('')
      setGitDiff(null)
      setNotice(`已创建提交 ${result.commitHash}：${result.summary}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '创建提交失败。')
    } finally {
      setGitBusy(false)
    }
  }, [commitMessage, stagedCount])

  const saveProjectRunCommand = useCallback(
    async (command: string): Promise<void> => {
      if (!window.desktop) {
        return
      }

      await window.desktop.saveRunCommand(command)
      setRunCommand(command.trim())
      setNotice(command.trim() ? '项目运行命令已保存。' : '项目运行命令已清除。')
    },
    []
  )

  const handleAgentRunFinished = useCallback(async (
    announce = true
  ): Promise<void> => {
    if (!window.desktop) {
      return
    }

    try {
      const tree = await window.desktop.getFileTree()
      setFileTree(tree)

      const refreshedFiles = await Promise.all(
        openFiles.map(async (file) => {
          try {
            const content = await window.desktop.readFile(file.path)
            return {
              ...file,
              content: content.content,
              savedContent: content.content,
              dirty: false
            }
          } catch {
            return file
          }
        })
      )
      setOpenFiles(refreshedFiles)
      await refreshGitStatus()
      await window.desktop.rebuildCodeIndex()
      setDiagnosticsRefreshToken((token) => token + 1)
      if (announce) {
        setNotice('Agent 任务已结束，项目状态已刷新。')
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '刷新 Agent 结果失败。'
      )
    }
  }, [openFiles, refreshGitStatus])

  const handleWorkflowCompleted = useCallback(
    (result: WorkflowRunResult): void => {
      if (result.agentPrompt) {
        setWorkflowModalOpen(false)
      }
      void handleAgentRunFinished(false)
      setNotice(
        result.status === 'completed'
          ? `工作流“${result.workflowName}”执行完成。`
          : result.status === 'failed'
            ? `工作流“${result.workflowName}”存在失败步骤。`
            : `工作流“${result.workflowName}”已准备 Agent 修复任务。`
      )
      if (result.agentPrompt) {
        openAgentWithPrompt(result.agentPrompt, [], result.taskId)
      }
    },
    [handleAgentRunFinished, openAgentWithPrompt]
  )

  const saveActiveFile = useCallback(async (): Promise<void> => {
    if (!window.desktop || !activeFile || !activeFile.dirty) {
      return
    }

    setBusy(true)
    try {
      await window.desktop.saveFile(activeFile.path, activeFile.content)
      setOpenFiles((currentFiles) =>
        currentFiles.map((file) =>
          file.path === activeFile.path
            ? { ...file, savedContent: file.content, dirty: false }
            : file
        )
      )
      setNotice(`已保存 ${activeFile.name}`)
      setGitDiff(null)
      await refreshGitStatus()
      void window.desktop.rebuildCodeIndex()
      setDiagnosticsRefreshToken((token) => token + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存文件失败。')
    } finally {
      setBusy(false)
    }
  }, [activeFile, refreshGitStatus])

  useEffect(() => {
    const handleWorkspaceShortcut = (event: KeyboardEvent): void => {
      const isCommandOrControl = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (isCommandOrControl && key === 's') {
        event.preventDefault()
        void saveActiveFile()
      }

      if (isCommandOrControl && key === 'o') {
        event.preventDefault()
        void handleOpenProject()
      }

      if (isCommandOrControl && key === 'k') {
        event.preventDefault()
        setCommandPaletteOpen(true)
      }
    }

    window.addEventListener('keydown', handleWorkspaceShortcut)
    return () => window.removeEventListener('keydown', handleWorkspaceShortcut)
  }, [handleOpenProject, saveActiveFile])

  useEffect(() => {
    const handleCommitShortcut = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        void setAllChangesStaged(true)
        return
      }

      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'u') {
        event.preventDefault()
        void setAllChangesStaged(false)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void createCommit()
      }
    }

    window.addEventListener('keydown', handleCommitShortcut)
    return () => window.removeEventListener('keydown', handleCommitShortcut)
  }, [createCommit, setAllChangesStaged])

  useEffect(() => {
    if (
      !editorPosition ||
      editorPosition.path !== activePath ||
      !editorRef.current
    ) {
      return
    }

    const frame = requestAnimationFrame(() => {
      editorRef.current?.revealPositionInCenter({
        lineNumber: editorPosition.line,
        column: editorPosition.column
      })
      editorRef.current?.setPosition({
        lineNumber: editorPosition.line,
        column: editorPosition.column
      })
      editorRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [activePath, editorPosition])

  const toggleDirectory = useCallback((path: string): void => {
    setCollapsedPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths)
      if (nextPaths.has(path)) {
        nextPaths.delete(path)
      } else {
        nextPaths.add(path)
      }
      return nextPaths
    })
  }, [])

  const closeFile = (
    path: string,
    event: { stopPropagation: () => void }
  ): void => {
    event.stopPropagation()
    const file = openFiles.find((item) => item.path === path)
    if (file?.dirty) {
      setNotice(`请先保存 ${file.name}，再关闭标签页。`)
      return
    }

    const fileIndex = openFiles.findIndex((item) => item.path === path)
    const nextFiles = openFiles.filter((item) => item.path !== path)
    setOpenFiles(nextFiles)

    if (activePath === path) {
      const nextActiveFile = nextFiles[Math.max(0, fileIndex - 1)] ?? null
      setActivePath(nextActiveFile?.path ?? null)
    }
  }

  const handleEditorChange = (value: string | undefined): void => {
    if (!activeFile) {
      return
    }

    const nextContent = value ?? ''
    setOpenFiles((currentFiles) =>
      currentFiles.map((file) =>
        file.path === activeFile.path
          ? {
              ...file,
              content: nextContent,
              dirty: nextContent !== file.savedContent
            }
          : file
      )
    )
  }

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: 'project.open',
        title: '打开或切换项目',
        subtitle: '选择本地项目文件夹',
        group: '项目',
        shortcut: 'Ctrl+O',
        keywords: ['open', 'folder', 'workspace'],
        run: handleOpenProject
      },
      {
        id: 'agent.open',
        title: '打开 Agent 工作台',
        subtitle: '开始或继续一个 AI 开发任务',
        group: 'Agent',
        shortcut: 'T',
        keywords: ['ai', 'deepseek', 'task'],
        run: () => {
          if (!project) {
            setNotice('请先打开项目，再启动 Agent。')
            return
          }
          setAgentOpened(true)
          setWorkspaceView('agent')
        }
      },
      {
        id: 'workflow.open',
        title: '打开项目工作流',
        subtitle: '编辑并运行可复用自动化步骤',
        group: '工作流',
        keywords: ['workflow', 'automation', 'format', 'test'],
        run: () => {
          if (!project) {
            setNotice('请先打开项目，再配置工作流。')
            return
          }
          setWorkflowModalOpen(true)
        }
      },
      {
        id: 'changes.open',
        title: '查看 Git 变更',
        subtitle: '打开源码管理面板',
        group: 'Git',
        keywords: ['diff', 'source', 'control'],
        run: () => setActiveTab('changes')
      },
      {
        id: 'diagnostics.run',
        title: '运行项目诊断',
        subtitle: '执行 TypeScript 或自定义诊断命令',
        group: '诊断',
        keywords: ['problems', 'errors', 'typescript', 'tsc'],
        run: () => {
          if (!project) {
            setNotice('请先打开项目。')
            return
          }
          setDiagnosticsOpened(true)
          setActiveTab('diagnostics')
          setDiagnosticsRefreshToken((token) => token + 1)
        }
      },
      {
        id: 'index.rebuild',
        title: '重建项目代码索引',
        subtitle: '刷新文件名、符号和全文搜索',
        group: '索引',
        keywords: ['index', 'search', 'symbol'],
        run: async () => {
          if (!window.desktop || !project) {
            return
          }
          const status = await window.desktop.rebuildCodeIndex()
          setNotice(
            status.state === 'ready'
              ? `索引完成：${status.indexedFiles} 个文件，${status.indexedSymbols} 个符号。`
              : status.error ?? '代码索引失败。'
          )
        }
      },
      {
        id: 'terminal.open',
        title: '打开项目终端',
        subtitle: 'PowerShell 或系统默认 Shell',
        group: '终端',
        keywords: ['shell', 'powershell', 'command'],
        run: () => {
          if (!project) {
            setNotice('请先打开项目。')
            return
          }
          setTerminalOpened(true)
          setActiveTab('terminal')
        }
      },
      {
        id: 'terminal.run',
        title: '运行项目命令',
        subtitle: runCommand || '在终端中执行已保存的项目命令',
        group: '终端',
        keywords: ['run', 'start', 'dev', 'build'],
        run: () => {
          if (!project) {
            setNotice('请先打开项目。')
            return
          }
          if (!runCommand.trim()) {
            setTerminalOpened(true)
            setActiveTab('terminal')
            setNotice('请先在终端中配置项目运行命令。')
            return
          }
          setTerminalOpened(true)
          setActiveTab('terminal')
          setTerminalRunRequest((request) => request + 1)
        }
      }
    ]

    if (activeFile) {
      items.push(
        {
          id: 'file.save',
          title: '保存当前文件',
          subtitle: activeFile.path,
          group: '文件',
          shortcut: 'Ctrl+S',
          keywords: ['save', 'write'],
          run: saveActiveFile
        },
        {
          id: 'agent.review.file',
          title: 'Agent：审查当前文件',
          subtitle: activeFile.path,
          group: 'Agent 预设',
          keywords: ['review', 'file', 'quality'],
          run: () =>
            openAgentWithPrompt(
              `Review ${activeFile.path} for bugs, maintainability issues, and missing tests. Do not modify files unless I ask you to.`,
              [activeFile.path]
            )
        },
        {
          id: 'agent.explain.file',
          title: 'Agent：解释当前文件',
          subtitle: activeFile.path,
          group: 'Agent 预设',
          keywords: ['explain', 'architecture', 'file'],
          run: () =>
            openAgentWithPrompt(
              `Explain the structure and responsibilities of ${activeFile.path}. Focus on the main flow and important edge cases.`,
              [activeFile.path]
            )
        }
      )
    }

    if (project) {
      items.push(
        {
          id: 'git.stage.all',
          title: 'Git：暂存全部变更',
          subtitle: '将全部修改加入暂存区',
          group: 'Git',
          shortcut: 'Ctrl+Shift+A',
          keywords: ['stage', 'add'],
          run: () => setAllChangesStaged(true)
        },
        {
          id: 'git.unstage.all',
          title: 'Git：取消暂存全部变更',
          subtitle: '清空当前暂存区',
          group: 'Git',
          shortcut: 'Ctrl+Shift+U',
          keywords: ['unstage', 'reset'],
          run: () => setAllChangesStaged(false)
        },
        {
          id: 'agent.review.changes',
          title: 'Agent：审查 Git 变更',
          subtitle: '检查未提交修改和行为风险',
          group: 'Agent 预设',
          keywords: ['review', 'diff', 'changes'],
          run: () =>
            openAgentWithPrompt(
              'Review the current uncommitted Git changes. Identify bugs, regressions, missing tests, and risky behavior. Do not modify files unless I ask you to.'
            )
        },
        {
          id: 'agent.fix.diagnostics',
          title: 'Agent：修复项目问题',
          subtitle: '运行诊断并修复发现的问题',
          group: 'Agent 预设',
          keywords: ['fix', 'diagnostics', 'errors'],
          run: () =>
            openAgentWithPrompt(
              'Run the project diagnostics command, inspect the failing code, fix the reported problems, and rerun diagnostics to verify the result.'
            )
        }
      )
    }

    return items
  }, [
    activeFile,
    handleOpenProject,
    openAgentWithPrompt,
    project,
    runCommand,
    saveActiveFile,
    setAllChangesStaged
  ])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">AI IDE</span>
          <span className="brand-tag">个人工作台</span>
        </div>

        <div className="project-context">
          <span className="context-label">当前工作区</span>
          <span className="context-value">{project?.name ?? '尚未打开项目'}</span>
          <span className="branch-pill">
            <span className="branch-dot" />
            {project
              ? gitStatus.isRepository
                ? gitStatus.branch ?? 'detached'
                : 'no git'
              : 'no branch'}
            {gitStatus.ahead ? ` ↑${gitStatus.ahead}` : ''}
            {gitStatus.behind ? ` ↓${gitStatus.behind}` : ''}
          </span>
        </div>

        <div className="topbar-actions">
          <button
            className={`update-button ${updateStatus?.state ?? ''}`}
            type="button"
            title={updateStatus?.message ?? '检查更新'}
            disabled={
              updateStatus?.state === 'checking' ||
              updateStatus?.state === 'downloading' ||
              updateStatus?.state === 'disabled'
            }
            onClick={() => {
              if (updateStatus?.state === 'available') {
                void handleDownloadUpdate()
              } else if (updateStatus?.state === 'downloaded') {
                void handleInstallUpdate()
              } else {
                void handleCheckForUpdates()
              }
            }}
          >
            {updateStatus?.state === 'available'
              ? `下载 ${updateStatus.availableVersion}`
              : updateStatus?.state === 'downloading'
                ? `更新 ${Math.round(updateStatus.progress?.percent ?? 0)}%`
                : updateStatus?.state === 'downloaded'
                  ? '重启安装'
                  : updateStatus?.state === 'checking'
                    ? '检查中'
                    : `v${appInfo?.version ?? '...'}`}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              if (!project) {
                setNotice('请先打开项目，再配置工作流。')
                return
              }
              setWorkflowModalOpen(true)
            }}
          >
            工作流
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
          >
            命令
            <kbd>Ctrl K</kbd>
          </button>
          <button className="primary-button" type="button" onClick={handleOpenProject}>
            {project ? '切换项目' : '打开项目'}
          </button>
        </div>
      </header>

      {updateStatus &&
      ['available', 'downloading', 'downloaded'].includes(
        updateStatus.state
      ) ? (
        <section className="update-banner" aria-live="polite">
          <div>
            <strong>
              {updateStatus.state === 'downloaded'
                ? '更新已准备完成'
                : `发现 AI IDE ${updateStatus.availableVersion}`}
            </strong>
            <span>{updateStatus.message}</span>
          </div>
          {updateStatus.state === 'available' ? (
            <button type="button" onClick={() => void handleDownloadUpdate()}>
              下载更新
            </button>
          ) : null}
          {updateStatus.state === 'downloaded' ? (
            <button type="button" onClick={() => void handleInstallUpdate()}>
              重启并安装
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="workspace">
        <nav className="activity-bar" aria-label="主要视图">
          <button
            className={`activity-button ${workspaceView === 'code' ? 'active' : ''}`}
            type="button"
            aria-label="项目和代码"
            onClick={() => setWorkspaceView('code')}
          >
            P
          </button>
          <button
            className={`activity-button ${workspaceView === 'agent' ? 'active' : ''}`}
            type="button"
            aria-label="Agent 任务"
            onClick={() => {
              if (!project) {
                setNotice('请先打开项目，再启动 Agent。')
                return
              }
              setAgentOpened(true)
              setWorkspaceView('agent')
            }}
          >
            T
          </button>
          <button
            className="activity-button"
            type="button"
            aria-label="搜索"
            onClick={() => setNotice('项目搜索将在下一轮迭代中加入。')}
          >
            S
          </button>
          <div className="activity-spacer" />
          <button
            className="activity-button"
            type="button"
            aria-label="设置"
            onClick={() => setNotice('设置页面尚未接入。')}
          >
            ⚙
          </button>
        </nav>

        <aside className="sidebar">
          <div className="sidebar-heading">
            <div>
              <span className="eyebrow">Workspace</span>
              <h2>{project?.name ?? '项目与任务'}</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="打开项目"
              onClick={handleOpenProject}
            >
              +
            </button>
          </div>

          {project ? (
            <>
              <div className="project-summary">
                <span className="project-status-dot" />
                <span title={project.path}>{readablePath(project.path)}</span>
              </div>
              <section className="sidebar-section file-section">
                <div className="section-label">
                  <span>资源管理器</span>
                  <button
                    className="text-icon-button"
                    type="button"
                    title="刷新文件树"
                    onClick={() => void loadProject(project)}
                  >
                    ↻
                  </button>
                </div>
                <div className="file-tree">
                  {fileTree.length ? (
                    fileTree.map((node) => (
                      <FileTreeNode
                        key={node.path}
                        node={node}
                        depth={0}
                        activePath={activePath}
                        collapsedPaths={collapsedPaths}
                        onToggleDirectory={toggleDirectory}
                        onOpenFile={(file) => void openFile(file)}
                      />
                    ))
                  ) : (
                    <div className="tree-empty">这个项目中没有可显示的文件。</div>
                  )}
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="sidebar-section">
                <div className="section-label">
                  <span>进行中的任务</span>
                  <span className="count">0</span>
                </div>
                <div className="empty-task">
                  <div className="empty-task-icon">↳</div>
                  <p>还没有任务</p>
                  <span>打开项目后，从一个明确目标开始。</span>
                </div>
              </section>

              <section className="sidebar-section recent-section">
                <div className="section-label">
                  <span>最近项目</span>
                  <span className="count">{recentProjects.length}</span>
                </div>
                <div className="project-list">
                  {recentProjects.length ? (
                    recentProjects.map((recentProject) => (
                      <button
                        className="project-item"
                        type="button"
                        key={recentProject.path}
                        title={recentProject.path}
                        onClick={() => void handleOpenRecentProject(recentProject.path)}
                      >
                        <span className="project-avatar">
                          {recentProject.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="project-copy">
                          <strong>{recentProject.name}</strong>
                          <small>local</small>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="recent-empty">打开过的项目会显示在这里。</div>
                  )}
                </div>
              </section>
            </>
          )}
        </aside>

        <main className={project ? 'main-stage editor-mode' : 'main-stage'}>
          {project ? (
            <>
              <div className="code-workspace-view" hidden={workspaceView !== 'code'}>
                {gitDiff ? (
              <section className="editor-workspace diff-workspace">
                <div className="diff-toolbar">
                  <div className="diff-title">
                    <button
                      className="diff-close"
                      type="button"
                      aria-label="关闭差异视图"
                      onClick={() => setGitDiff(null)}
                    >
                      ×
                    </button>
                    <span className="diff-badge">DIFF</span>
                    <span className="diff-path" title={gitDiff.path}>
                      {gitDiff.path}
                    </span>
                    {gitDiff.originalPath ? (
                      <span className="diff-renamed-from">← {gitDiff.originalPath}</span>
                    ) : null}
                  </div>
                  <span className="diff-source">HEAD ↔ 工作区</span>
                </div>
                <div className="editor-breadcrumb">
                  <span>{project.name}</span>
                  {gitDiff.path.split(/[\\/]/).map((part, index, segments) => (
                    <span
                      className={index === segments.length - 1 ? 'current' : ''}
                      key={`${part}-${index}`}
                    >
                      <span className="crumb-separator">›</span>
                      {part}
                    </span>
                  ))}
                </div>
                <div className="monaco-shell">
                  {gitDiff.isBinary ? (
                    <div className="binary-diff">
                      <strong>二进制文件发生变化</strong>
                      <p>当前版本暂不支持预览二进制文件的差异。</p>
                    </div>
                  ) : (
                    <DiffEditor
                      original={gitDiff.originalContent}
                      modified={gitDiff.modifiedContent}
                      language={languageFromPath(gitDiff.path)}
                      theme="ai-ide-dark"
                      beforeMount={configureMonacoTheme}
                      loading={<div className="editor-loading">正在加载差异…</div>}
                      options={{
                        automaticLayout: true,
                        readOnly: true,
                        originalEditable: false,
                        renderSideBySide: true,
                        fontFamily: '"Cascadia Code", Consolas, monospace',
                        fontSize: 13,
                        lineHeight: 22,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        renderOverviewRuler: false,
                        ignoreTrimWhitespace: false,
                        diffWordWrap: 'on'
                      }}
                    />
                  )}
                </div>
              </section>
            ) : activeFile ? (
              <section className="editor-workspace">
                <div className="editor-toolbar">
                  <div className="editor-tabs" role="tablist" aria-label="打开的文件">
                    {openFiles.map((file) => (
                      <button
                        className={`editor-tab ${file.path === activePath ? 'active' : ''}`}
                        key={file.path}
                        type="button"
                        role="tab"
                        aria-selected={file.path === activePath}
                        title={file.path}
                        onClick={() => setActivePath(file.path)}
                      >
                        <span className="tab-file-badge">{fileBadge(file.path)}</span>
                        <span className="tab-file-name">{file.name}</span>
                        {file.dirty ? <span className="dirty-dot" /> : null}
                        <span
                          className="tab-close"
                          role="button"
                          tabIndex={0}
                          aria-label={`关闭 ${file.name}`}
                          onClick={(event) => closeFile(file.path, event)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              closeFile(file.path, event)
                            }
                          }}
                        >
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="save-button"
                    type="button"
                    disabled={!activeFile.dirty || busy}
                    onClick={() => void saveActiveFile()}
                  >
                    保存
                    <kbd>Ctrl S</kbd>
                  </button>
                </div>
                <div className="editor-breadcrumb">
                  <span>{project.name}</span>
                  {activeFile.path.split(/[\\/]/).map((part, index, segments) => (
                    <span className={index === segments.length - 1 ? 'current' : ''} key={`${part}-${index}`}>
                      <span className="crumb-separator">›</span>
                      {part}
                    </span>
                  ))}
                </div>
                <div className="monaco-shell">
                  <Editor
                    path={activeFile.path}
                    language={languageFromPath(activeFile.path)}
                    value={activeFile.content}
                    theme="ai-ide-dark"
                    beforeMount={configureMonacoTheme}
                    onChange={handleEditorChange}
                    onMount={(editor) => {
                      editorRef.current = editor
                      if (editorPosition?.path === activeFile.path) {
                        editor.revealPositionInCenter({
                          lineNumber: editorPosition.line,
                          column: editorPosition.column
                        })
                        editor.setPosition({
                          lineNumber: editorPosition.line,
                          column: editorPosition.column
                        })
                        editor.focus()
                      }
                    }}
                    loading={<div className="editor-loading">正在加载编辑器…</div>}
                    options={{
                      automaticLayout: true,
                      fontFamily: '"Cascadia Code", Consolas, monospace',
                      fontSize: 13,
                      lineHeight: 22,
                      minimap: { enabled: true, scale: 0.75 },
                      padding: { top: 14 },
                      scrollBeyondLastLine: false,
                      smoothScrolling: true,
                      renderLineHighlight: 'all',
                      overviewRulerBorder: false,
                      cursorBlinking: 'smooth',
                      cursorSmoothCaretAnimation: 'on',
                      bracketPairColorization: { enabled: true },
                      guides: { bracketPairs: true, indentation: true }
                    }}
                  />
                </div>
              </section>
            ) : (
              <section className="project-empty-editor">
                <div className="project-emblem">{project.name.slice(0, 1).toUpperCase()}</div>
                <span className="welcome-kicker">
                  <span className="kicker-line" />
                  PROJECT READY
                </span>
                <h1>{project.name}</h1>
                <p>{project.path}</p>
                <div className="project-facts">
                  <div>
                    <span>文件树</span>
                    <strong>{fileTree.length} 个根节点</strong>
                  </div>
                  <div>
                    <span>编辑模式</span>
                    <strong>本地文本</strong>
                  </div>
                  <div>
                    <span>工作流</span>
                    <strong>等待任务</strong>
                  </div>
                </div>
                <div className="project-empty-hint">
                  从左侧资源管理器选择一个文件，或打开命令面板开始工作。
                </div>
              </section>
                )}
              </div>

              {agentOpened ? (
                <div className="agent-workspace-view" hidden={workspaceView !== 'agent'}>
                  <AgentWorkspace
                    key={project.path}
                    project={project}
                    visible={workspaceView === 'agent'}
                    hasUnsavedFiles={hasUnsavedFiles}
                    onRunFinished={handleAgentRunFinished}
                    externalPrompt={agentPromptRequest}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <section className="welcome">
              <div className="welcome-kicker">
                <span className="kicker-line" />
                AI-NATIVE WORKSPACE
              </div>
              <h1>
                从一个项目开始，
                <br />
                让 Agent 完成剩下的工作。
              </h1>
              <p className="welcome-description">
                把需求、代码变更、命令和验证结果放在同一条工作流里。你负责目标和判断，
                Agent 负责检索、修改与执行。
              </p>

              <div className="quick-actions">
                <button className="quick-action" type="button" onClick={handleOpenProject}>
                  <span className="action-index">01</span>
                  <span className="action-title">打开项目</span>
                  <span className="action-description">连接本地目录，建立项目上下文</span>
                  <span className="action-arrow">↗</span>
                </button>
                <button
                  className="quick-action"
                  type="button"
                  onClick={() => setNotice('请先打开项目，再创建 Agent 任务。')}
                >
                  <span className="action-index">02</span>
                  <span className="action-title">创建任务</span>
                  <span className="action-description">从需求、缺陷或重构开始</span>
                  <span className="action-arrow">↗</span>
                </button>
                <button
                  className="quick-action"
                  type="button"
                  onClick={() => setNotice('请先打开项目，再启动 Agent。')}
                >
                  <span className="action-index">03</span>
                  <span className="action-title">调用 Agent</span>
                  <span className="action-description">读取项目、修改代码并运行验证</span>
                  <span className="action-arrow">↗</span>
                </button>
              </div>

              <div className="prompt-panel">
                <div className="prompt-heading">
                  <span>描述你想完成的工作</span>
                  <span className="agent-offline">
                    <span className="offline-dot" />
                    Agent 未连接
                  </span>
                </div>
                <div className="prompt-placeholder">
                  例如：分析这个项目的结构，并告诉我应该从哪一部分开始……
                </div>
                <div className="prompt-footer">
                  <div className="prompt-context">
                    <span className="context-chip">@ 添加上下文</span>
                    <span className="context-chip">/ 选择任务</span>
                  </div>
                  <button
                    className="send-button"
                    type="button"
                    onClick={() => setNotice('请先打开项目并接入 Agent 运行时。')}
                  >
                    发送
                    <span>↗</span>
                  </button>
                </div>
              </div>
            </section>
          )}
        </main>

        <aside className="inspector">
          <div className="inspector-tabs" role="tablist" aria-label="工作区输出">
            <button
              className={activeTab === 'changes' ? 'inspector-tab active' : 'inspector-tab'}
              type="button"
              role="tab"
              aria-selected={activeTab === 'changes'}
              onClick={() => setActiveTab('changes')}
            >
              变更
              <span>{gitStatus.changes.length}</span>
            </button>
            <button
              className={
                activeTab === 'diagnostics'
                  ? 'inspector-tab active'
                  : 'inspector-tab'
              }
              type="button"
              role="tab"
              aria-selected={activeTab === 'diagnostics'}
              disabled={!project}
              onClick={() => {
                setActiveTab('diagnostics')
                if (project) {
                  setDiagnosticsOpened(true)
                }
              }}
            >
              问题
              <span>{diagnosticsCount}</span>
            </button>
            <button
              className={activeTab === 'terminal' ? 'inspector-tab active' : 'inspector-tab'}
              type="button"
              role="tab"
              aria-selected={activeTab === 'terminal'}
              onClick={() => {
                setActiveTab('terminal')
                if (project) {
                  setTerminalOpened(true)
                }
              }}
            >
              终端
            </button>
          </div>

          <div className="inspector-content" hidden={activeTab !== 'changes'}>
              <div className="git-summary">
                <div className="git-summary-copy">
                  <span className="eyebrow">Source control</span>
                  <strong>
                    {gitStatus.isRepository
                      ? gitStatus.branch ?? 'detached HEAD'
                      : '本地项目'}
                  </strong>
                </div>
                <button
                  className={`git-refresh ${gitBusy ? 'spinning' : ''}`}
                  type="button"
                  title="刷新 Git 状态"
                  disabled={!project || gitBusy}
                  onClick={() => void refreshGitStatus()}
                >
                  ↻
                </button>
              </div>

              {!project ? (
                <div className="inspector-empty compact">
                  <strong>尚未打开项目</strong>
                  <p>打开项目后会在这里显示 Git 分支和文件变化。</p>
                </div>
              ) : !gitStatus.isRepository ? (
                <div className="inspector-empty compact">
                  <div className="git-empty-icon">GIT</div>
                  <strong>当前目录没有 Git 仓库</strong>
                  <p>{gitStatus.error ?? '初始化仓库后即可查看文件变化。'}</p>
                </div>
              ) : gitStatus.changes.length === 0 ? (
                <div className="inspector-empty compact">
                  <div className="inspector-glyph">
                    <span>+0</span>
                    <span>−0</span>
                  </div>
                  <strong>工作区是干净的</strong>
                  <p>修改文件并保存后，变化会自动显示在这里。</p>
                </div>
              ) : (
                <div className="git-changes">
                  <div className="section-label git-changes-heading">
                    <span>未提交的变更</span>
                    <span className="count">{gitStatus.changes.length}</span>
                  </div>
                  {gitStatus.changes.map((change) => (
                    <div
                      className={`git-change-row ${
                        gitDiff?.path === change.path ? 'active' : ''
                      }`}
                      key={`${change.originalPath ?? ''}-${change.path}`}
                      title={change.path}
                    >
                      <button
                        className="git-change-main"
                        type="button"
                        onClick={() => void openGitDiff(change)}
                      >
                        <span className={`git-kind ${change.kind}`}>
                          {gitKindLabel(change)}
                        </span>
                        <span className="git-change-copy">
                          <strong>{fileNameFromPath(change.path)}</strong>
                          <small>{change.path}</small>
                        </span>
                        <span className="git-state">
                          {change.staged ? 'S' : ''}
                          {change.unstaged ? 'W' : ''}
                        </span>
                      </button>
                      <button
                        className="git-stage-button"
                        type="button"
                        title={
                          change.staged && !change.unstaged
                            ? '取消暂存'
                            : '暂存变更'
                        }
                        disabled={gitBusy}
                        onClick={() =>
                          void setChangeStaged(
                            change,
                            !(change.staged && !change.unstaged)
                          )
                        }
                      >
                        {change.staged && !change.unstaged ? '−' : '+'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {gitStatus.isRepository ? (
                <div className="commit-panel">
                  <div className="bulk-actions">
                    <button
                      type="button"
                      disabled={gitBusy || allChangesStaged || gitStatus.changes.length === 0}
                      onClick={() => void setAllChangesStaged(true)}
                    >
                      全部暂存
                    </button>
                    <button
                      type="button"
                      disabled={gitBusy || stagedCount === 0}
                      onClick={() => void setAllChangesStaged(false)}
                    >
                      取消暂存
                    </button>
                  </div>
                  <textarea
                    className="commit-message-input"
                    value={commitMessage}
                    placeholder="提交信息（必填）"
                    rows={3}
                    spellCheck={false}
                    onChange={(event) => setCommitMessage(event.target.value)}
                  />
                  <div className="commit-footer">
                    <span>
                      {stagedCount
                        ? `${stagedCount} 个文件已暂存`
                        : '请先暂存要提交的变更'}
                    </span>
                    <button
                      className="commit-button"
                      type="button"
                      disabled={gitBusy || stagedCount === 0 || !commitMessage.trim()}
                      onClick={() => void createCommit()}
                    >
                      提交
                      <kbd>Ctrl ↵</kbd>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="git-footer-block">
                  <div className="block-heading">
                    <span>Git 工作区</span>
                    <span>—</span>
                  </div>
                  <p>初始化仓库后，可以在这里暂存并提交文件。</p>
                </div>
              )}
          </div>

          {project && terminalOpened ? (
            <div className="terminal-container" hidden={activeTab !== 'terminal'}>
              <TerminalPanel
                key={project.path}
                project={project}
                visible={activeTab === 'terminal'}
                runCommand={runCommand}
                runRequest={terminalRunRequest}
                onRunCommandChange={setRunCommand}
                onSaveRunCommand={saveProjectRunCommand}
              />
            </div>
          ) : activeTab === 'terminal' ? (
            <div className="terminal-preview">
              <div className="terminal-bar">
                <span>Terminal</span>
                <span className="terminal-status">等待项目</span>
              </div>
              <div className="terminal-body">
                <span className="terminal-prompt">PS</span>
                <span className="terminal-cursor">▌</span>
              </div>
              <p className="terminal-hint">打开项目后即可启动项目终端。</p>
            </div>
          ) : null}

          {project && diagnosticsOpened ? (
            <div
              className="problems-container"
              hidden={activeTab !== 'diagnostics'}
            >
              <ProblemsPanel
                key={project.path}
                visible={activeTab === 'diagnostics'}
                refreshToken={diagnosticsRefreshToken}
                onCountChange={setDiagnosticsCount}
                onOpenDiagnostic={(diagnostic) =>
                  void openDiagnostic(diagnostic)
                }
                onAskAgent={askAgentToFixDiagnostics}
              />
            </div>
          ) : null}
        </aside>
      </div>

      <footer className="statusbar">
        <div className="status-left">
          <span className="status-item status-ready">
            <span className="status-dot" />
            {busy ? '处理中' : '就绪'}
          </span>
          <span className="status-separator" />
          <span className="status-note">{notice}</span>
        </div>
        <div className="status-right">
          {gitStatus.isRepository ? (
            <span>{gitStatus.branch ?? 'detached'}</span>
          ) : null}
          {activeFile ? (
            <>
              <span>{languageFromPath(activeFile.path)}</span>
              <span>{activeFile.dirty ? '未保存' : '已保存'}</span>
            </>
          ) : null}
          {updateStatus ? (
            <span className={`update-status update-${updateStatus.state}`}>
              {updateStatus.state === 'not-available'
                ? `v${updateStatus.currentVersion} 已是最新`
                : updateStatus.state === 'error'
                  ? '更新检查失败'
                  : updateStatus.state === 'disabled'
                    ? '开发版'
                    : null}
            </span>
          ) : null}
          <span>{appInfo ? `Electron ${appInfo.electronVersion}` : '桌面环境'}</span>
          <span>UTF-8</span>
          <span>{appInfo?.platform ?? 'desktop'}</span>
        </div>
      </footer>

      {commandPaletteOpen ? (
        <CommandPalette
          commands={commands}
          onClose={() => setCommandPaletteOpen(false)}
        />
      ) : null}

      {workflowModalOpen && project ? (
        <WorkflowModal
          onClose={() => setWorkflowModalOpen(false)}
          onRunCompleted={handleWorkflowCompleted}
        />
      ) : null}
    </div>
  )
}

export default App
