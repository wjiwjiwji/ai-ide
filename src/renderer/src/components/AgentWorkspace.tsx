import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentCheckpointInfo,
  AgentProvider,
  AgentProviderStatus,
  AgentRunMode,
  AgentStreamEvent,
  AgentTaskEntry,
  AgentTaskStatus,
  AgentTaskSummary,
  CodeIndexStatus,
  CodeSearchResult,
  GitFileChange,
  ProjectInfo
} from '../../../shared/desktop'
import CheckpointDiffModal from './CheckpointDiffModal'
import FloatingDetailWindow from './FloatingDetailWindow'
import MarkdownContent from './MarkdownContent'
import {
  buildAgentPrompt,
  type AgentEditorFocus
} from '../agent-focus'

interface AgentWorkspaceProps {
  project: ProjectInfo
  visible: boolean
  editorTheme: string
  hasUnsavedFiles: boolean
  workspaceFocus: AgentEditorFocus | null
  openFilePaths: string[]
  changedFilePaths: string[]
  diagnosticFilePaths: string[]
  gitChanges: GitFileChange[]
  onRunFinished: () => Promise<void>
  onOpenFile: (path: string) => void
  externalPrompt: {
    id: string
    text: string
    contextFiles: string[]
    taskId?: string
  } | null
}

type AgentStatus = 'idle' | 'starting' | 'running' | 'cancelling'

type ChatEntry =
  | {
      id: string
      kind: 'user' | 'assistant' | 'system' | 'error'
      text: string
      contextFiles?: string[]
      autoFocusFiles?: string[]
    }
  | {
      id: string
      kind: 'tool'
      toolType: string
      title: string
      detail: string
      status: string
      changes: string[]
      approvalId?: string
    }

interface ToolEntry {
  toolType: string
  title: string
  detail: string
  status: string
  changes: string[]
  approvalId?: string
}

function toStoredEntry(entry: ChatEntry): AgentTaskEntry {
  if (entry.kind === 'tool') {
    return {
      id: entry.id,
      kind: 'tool',
      toolType: entry.toolType,
      title: entry.title,
      detail: entry.detail,
      status: entry.status,
      changes: entry.changes,
      approvalId: entry.approvalId
    }
  }

  return {
    id: entry.id,
    kind: entry.kind,
    text: entry.text,
    contextFiles: entry.contextFiles,
    autoFocusFiles: entry.autoFocusFiles
  }
}

function fromStoredEntry(entry: AgentTaskEntry): ChatEntry {
  if (entry.kind === 'tool') {
    return {
      id: entry.id,
      kind: 'tool',
      toolType: entry.toolType ?? 'tool',
      title: entry.title ?? 'Agent 操作',
      detail: entry.detail ?? '',
      status: entry.status ?? 'completed',
      changes: entry.changes ?? [],
      approvalId: entry.approvalId
    }
  }

  return {
    id: entry.id,
    kind: entry.kind,
    text: entry.text ?? '',
    contextFiles: entry.contextFiles,
    autoFocusFiles: entry.autoFocusFiles
  }
}

function toolTitle(type: string | undefined): string {
  switch (type) {
    case 'command_execution':
      return '运行命令'
    case 'file_change':
      return '修改文件'
    case 'mcp_tool_call':
      return '调用工具'
    case 'web_search':
      return '搜索资料'
    case 'todo_list':
      return '更新计划'
    default:
      return type ? type.replaceAll('_', ' ') : 'Agent 操作'
  }
}

function toolStatusLabel(status: string): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'approved':
      return '已允许'
    case 'rejected':
      return '已拒绝'
    case 'pending':
      return '等待确认'
    default:
      return status
  }
}

function fileChangeLabel(kind: GitFileChange['kind']): string {
  switch (kind) {
    case 'added':
    case 'untracked':
      return '新增'
    case 'deleted':
      return '删除'
    case 'renamed':
      return '重命名'
    case 'conflicted':
      return '冲突'
    default:
      return '修改'
  }
}

function AgentWorkspace({
  project,
  visible,
  editorTheme,
  hasUnsavedFiles,
  workspaceFocus,
  openFilePaths,
  changedFilePaths,
  diagnosticFilePaths,
  gitChanges,
  onRunFinished,
  onOpenFile,
  externalPrompt
}: AgentWorkspaceProps): React.JSX.Element {
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<AgentRunMode>('read-only')
  const [provider, setProvider] = useState<AgentProvider>('deepseek')
  const [providerStatus, setProviderStatus] =
    useState<AgentProviderStatus | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [showKeyForm, setShowKeyForm] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskTitle, setTaskTitle] = useState('新任务')
  const [taskStatus, setTaskStatus] = useState<AgentTaskStatus>('active')
  const [taskList, setTaskList] = useState<AgentTaskSummary[]>([])
  const [checkpoints, setCheckpoints] = useState<AgentCheckpointInfo[]>([])
  const [showCheckpoints, setShowCheckpoints] = useState(false)
  const [showChanges, setShowChanges] = useState(false)
  const [diffCheckpointId, setDiffCheckpointId] = useState<string | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)
  const [contextFiles, setContextFiles] = useState<string[]>([])
  const [showContextPicker, setShowContextPicker] = useState(false)
  const [contextQuery, setContextQuery] = useState('')
  const [contextResults, setContextResults] = useState<CodeSearchResult[]>([])
  const [indexStatus, setIndexStatus] = useState<CodeIndexStatus | null>(null)
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [usage, setUsage] = useState<string>('')
  const activeRunIdRef = useRef<string | null>(null)
  const taskIdRef = useRef<string | null>(null)
  const skipPersistRef = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const providerReady =
    provider === 'deepseek'
      ? providerStatus?.deepseekConfigured === true
      : providerStatus?.codexAvailable !== false
  const autoFocusFiles = useMemo(
    () => [
      ...new Set(
        [
          workspaceFocus?.path,
          ...openFilePaths,
          ...changedFilePaths,
          ...diagnosticFilePaths
        ].filter((path): path is string => Boolean(path))
      )
    ].slice(0, 30),
    [
      changedFilePaths,
      diagnosticFilePaths,
      openFilePaths,
      workspaceFocus?.path
    ]
  )
  const agentChangedFiles = useMemo(() => {
    const paths = [
      ...new Set(
        entries.flatMap((entry) =>
          entry.kind === 'tool' ? entry.changes : []
        )
      )
    ]
    return paths.map((path) => {
      const normalized = path.replaceAll('\\', '/').toLowerCase()
      const gitChange = gitChanges.find((change) => {
        const candidate = (change.path || change.originalPath || '')
          .replaceAll('\\', '/')
          .toLowerCase()
        return candidate === normalized
      })
      return {
        path,
        kind: gitChange?.kind ?? 'modified'
      }
    })
  }, [entries, gitChanges])

  useEffect(() => {
    if (!agentChangedFiles.length) {
      setShowChanges(false)
    }
  }, [agentChangedFiles.length])

  useEffect(() => {
    if (!window.desktop) {
      return
    }

    void window.desktop.getAgentProviderStatus().then((nextStatus) => {
      setProviderStatus(nextStatus)
      if (nextStatus.deepseekConfigured) {
        setProvider('deepseek')
      } else if (nextStatus.codexAvailable) {
        setProvider('codex')
      }
    })
  }, [])

  const appendEntry = (entry: ChatEntry): void => {
    setEntries((currentEntries) => [...currentEntries, entry])
  }

  const upsertToolEntry = (
    entryId: string,
    tool: ToolEntry
  ): void => {
    setEntries((currentEntries) => {
      const existingIndex = currentEntries.findIndex(
        (entry) => entry.id === entryId
      )
      const nextEntry: ChatEntry = {
        id: entryId,
        kind: 'tool',
        ...tool
      }

      if (existingIndex < 0) {
        return [...currentEntries, nextEntry]
      }

      const nextEntries = [...currentEntries]
      nextEntries[existingIndex] = nextEntry
      return nextEntries
    })
  }

  const refreshTaskList = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    setTaskList(await window.desktop.listAgentTasks())
  }, [])

  const refreshCheckpoints = useCallback(
    async (selectedTaskId: string): Promise<void> => {
      if (!window.desktop) {
        return
      }
      setCheckpoints(
        await window.desktop.listAgentCheckpoints(selectedTaskId)
      )
    },
    []
  )

  useEffect(() => {
    void refreshTaskList()
  }, [refreshTaskList])

  const refreshIndexStatus = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    setIndexStatus(await window.desktop.getCodeIndexStatus())
  }, [])

  useEffect(() => {
    void refreshIndexStatus()
  }, [refreshIndexStatus])

  useEffect(() => {
    if (indexStatus?.state !== 'indexing') {
      return
    }
    const timeout = window.setTimeout(() => {
      void refreshIndexStatus()
    }, 800)
    return () => window.clearTimeout(timeout)
  }, [indexStatus?.state, refreshIndexStatus])

  useEffect(() => {
    if (!showContextPicker || !contextQuery.trim() || !window.desktop) {
      setContextResults([])
      return
    }

    const timeout = window.setTimeout(() => {
      void window.desktop
        .searchCode(contextQuery)
        .then(setContextResults)
        .catch(() => setContextResults([]))
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [contextQuery, showContextPicker])

  useEffect(() => {
    taskIdRef.current = taskId
  }, [taskId])

  useEffect(() => {
    if (!taskId || skipPersistRef.current || !window.desktop) {
      return
    }

    const timeout = window.setTimeout(() => {
      void window.desktop
        .saveAgentTask({
          id: taskId,
          title: taskTitle,
          provider,
          mode,
          status: taskStatus,
          entries: entries.map(toStoredEntry),
          threadId,
          usageText: usage
        })
        .then(() => refreshTaskList())
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [
    entries,
    mode,
    provider,
    refreshTaskList,
    taskId,
    taskStatus,
    taskTitle,
    threadId,
    usage
  ])

  useEffect(() => {
    if (taskId) {
      void refreshCheckpoints(taskId)
    } else {
      setCheckpoints([])
    }
  }, [refreshCheckpoints, taskId, taskStatus])

  useEffect(() => {
    if (!window.desktop) {
      return
    }

    const removeListener = window.desktop.onAgentEvent((event) => {
      if (activeRunIdRef.current && event.runId !== activeRunIdRef.current) {
        return
      }

      if (event.threadId) {
        setThreadId(event.threadId)
      }

      if (event.type === 'thread.started') {
        setStatus('running')
        return
      }

      if (event.type === 'turn.started') {
        setStatus('running')
        return
      }

      if (event.type === 'turn.completed') {
        setStatus('idle')
        setTaskStatus('completed')
        activeRunIdRef.current = null
        setActiveRunId(null)
        if (event.usage?.input_tokens || event.usage?.output_tokens) {
          setUsage(
            `${event.usage.input_tokens ?? 0} 输入 / ${event.usage.output_tokens ?? 0} 输出 tokens`
          )
        }
        void onRunFinished()
        return
      }

      if (event.type === 'turn.failed' || event.type === 'error') {
        setStatus('idle')
        setTaskStatus('failed')
        activeRunIdRef.current = null
        setActiveRunId(null)
        appendEntry({
          id: crypto.randomUUID(),
          kind: 'error',
          text: event.message ?? 'Agent 任务失败。'
        })
        return
      }

      const item = event.item
      if (!item) {
        return
      }

      const itemId = item.id ?? crypto.randomUUID()
      if (event.type === 'approval.required' && event.approvalId) {
        upsertToolEntry(`tool-${event.runId}-${itemId}`, {
          toolType: item.type ?? 'tool',
          title: toolTitle(item.type),
          detail: item.command ?? item.text ?? '等待审批',
          status: 'awaiting_approval',
          changes: item.changes?.map((change) => change.path) ?? [],
          approvalId: event.approvalId
        })
        return
      }

      if (item.type === 'agent_message') {
        if (item.text?.trim()) {
          setEntries((currentEntries) => {
            const existingIndex = currentEntries.findIndex(
              (entry) => entry.id === `assistant-${event.runId}-${itemId}`
            )
            const nextEntry: ChatEntry = {
              id: `assistant-${event.runId}-${itemId}`,
              kind: 'assistant',
              text: item.text ?? ''
            }
            if (existingIndex < 0) {
              return [...currentEntries, nextEntry]
            }
            const nextEntries = [...currentEntries]
            nextEntries[existingIndex] = nextEntry
            return nextEntries
          })
        }
        return
      }

      if (item.type === 'error') {
        if (item.text?.trim()) {
          appendEntry({
            id: `error-${event.runId}-${itemId}`,
            kind: 'error',
            text: item.text
          })
        }
        return
      }

      if (item.type === 'reasoning') {
        return
      }

      upsertToolEntry(`tool-${event.runId}-${itemId}`, {
        toolType: item.type ?? 'tool',
        title: toolTitle(item.type),
        detail:
          item.command ??
          item.text ??
          item.aggregatedOutput ??
          (item.changes?.length
            ? `${item.changes.length} 个文件发生变化`
            : '正在处理项目'),
        status: item.status ?? (event.type === 'item.completed' ? 'completed' : 'running'),
        changes: item.changes?.map((change) => change.path) ?? []
      })
    })

    return removeListener
  }, [onRunFinished])

  useEffect(() => {
    activeRunIdRef.current = activeRunId
  }, [activeRunId])

  useEffect(() => {
    if (!visible) {
      return
    }

    const frame = requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ block: 'end' })
      textareaRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [visible])

  useEffect(() => {
    if (!externalPrompt) {
      return
    }

    const applyPrompt = (): void => {
      setDraft(externalPrompt.text)
      setContextFiles([...new Set(externalPrompt.contextFiles)])
      setShowContextPicker(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }

    if (externalPrompt.taskId && window.desktop) {
      skipPersistRef.current = true
      void window.desktop
        .getAgentTask(externalPrompt.taskId)
        .then((task) => {
          if (!task) {
            applyPrompt()
            return
          }
          setTaskId(task.id)
          taskIdRef.current = task.id
          setTaskTitle(task.title)
          setProvider(task.provider)
          setMode(task.mode)
          setTaskStatus(task.status)
          setEntries(task.entries.map(fromStoredEntry))
          setThreadId(task.threadId)
          setUsage(task.usageText)
          applyPrompt()
        })
        .catch((error) => {
          appendEntry({
            id: crypto.randomUUID(),
            kind: 'error',
            text:
              error instanceof Error
                ? error.message
                : '无法载入工作流任务。'
          })
          applyPrompt()
        })
        .finally(() => {
          window.setTimeout(() => {
            skipPersistRef.current = false
          }, 50)
        })
      return
    }

    applyPrompt()
  }, [externalPrompt])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [entries])

  useEffect(() => {
    return () => {
      const runId = activeRunIdRef.current
      if (runId) {
        void window.desktop.cancelAgent(runId)
      }
    }
  }, [])

  const attachContextFile = (path: string): void => {
    setContextFiles((current) =>
      current.includes(path) ? current : [...current, path]
    )
  }

  const removeContextFile = (path: string): void => {
    setContextFiles((current) => current.filter((item) => item !== path))
  }

  const rebuildContextIndex = async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    setIndexStatus({
      state: 'indexing',
      indexedFiles: indexStatus?.indexedFiles ?? 0,
      indexedSymbols: indexStatus?.indexedSymbols ?? 0,
      updatedAt: indexStatus?.updatedAt ?? null
    })
    setIndexStatus(await window.desktop.rebuildCodeIndex())
  }

  const loadTask = async (selectedTaskId: string): Promise<void> => {
    if (!window.desktop || status !== 'idle') {
      return
    }

    setTaskLoading(true)
    skipPersistRef.current = true
    try {
      const task = await window.desktop.getAgentTask(selectedTaskId)
      if (!task) {
        await refreshTaskList()
        return
      }

      setTaskId(task.id)
      taskIdRef.current = task.id
      setTaskTitle(task.title)
      setProvider(task.provider)
      setMode(task.mode)
      setTaskStatus(task.status)
      setEntries(task.entries.map(fromStoredEntry))
      const latestUserEntry = [...task.entries]
        .reverse()
        .find((entry) => entry.kind === 'user')
      setContextFiles(latestUserEntry?.contextFiles ?? [])
      setThreadId(task.threadId)
      setUsage(task.usageText)
      setStatus('idle')
      setShowCheckpoints(false)
      await refreshCheckpoints(task.id)
    } catch (error) {
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'error',
        text: error instanceof Error ? error.message : '无法读取任务记录。'
      })
    } finally {
      window.setTimeout(() => {
        skipPersistRef.current = false
      }, 0)
      setTaskLoading(false)
    }
  }

  const saveDeepSeekKey = async (): Promise<void> => {
    if (!window.desktop || !apiKeyDraft.trim()) {
      return
    }

    setKeySaving(true)
    try {
      const nextStatus = await window.desktop.saveDeepSeekApiKey(apiKeyDraft)
      setProviderStatus(nextStatus)
      setApiKeyDraft('')
      setShowKeyForm(false)
      setProvider('deepseek')
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'system',
        text: 'DeepSeek API Key 已安全保存。'
      })
    } catch (error) {
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : '无法保存 DeepSeek API Key。'
      })
    } finally {
      setKeySaving(false)
    }
  }

  const respondToApproval = async (
    entryId: string,
    approvalId: string,
    approved: boolean
  ): Promise<void> => {
    const runId = activeRunIdRef.current
    if (!runId || !window.desktop) {
      return
    }

    setEntries((currentEntries) =>
      currentEntries.map((entry) =>
        entry.id === entryId && entry.kind === 'tool'
          ? {
              ...entry,
              status: approved ? 'approved' : 'rejected',
              approvalId: undefined
            }
          : entry
      )
    )

    try {
      await window.desktop.respondAgentApproval(runId, approvalId, approved)
    } catch (error) {
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'error',
        text:
          error instanceof Error ? error.message : '无法提交 Agent 审批结果。'
      })
    }
  }

  const startRun = async (): Promise<void> => {
    const request = draft.trim()
    if (!request || status !== 'idle' || !window.desktop) {
      return
    }

    if (mode === 'workspace-write' && hasUnsavedFiles) {
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'error',
        text: '请先保存所有打开的文件，再允许 Agent 修改项目。'
      })
      return
    }

    if (provider === 'deepseek' && !providerStatus?.deepseekConfigured) {
      setShowKeyForm(true)
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'error',
        text: '请先配置 DeepSeek API Key。'
      })
      return
    }

    if (provider === 'codex' && providerStatus && !providerStatus.codexAvailable) {
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'error',
        text: '未找到可用的 Codex CLI。'
      })
      return
    }

    const userEntry: ChatEntry = {
      id: crypto.randomUUID(),
      kind: 'user',
      text: request,
      contextFiles: [...contextFiles],
      autoFocusFiles: [...autoFocusFiles]
    }
    const nextTaskId = taskId ?? crypto.randomUUID()
    const nextTaskTitle =
      taskId && taskTitle !== '新任务'
        ? taskTitle
        : request.split(/\r?\n/, 1)[0].slice(0, 80) || '未命名任务'
    const nextEntries = [...entries, userEntry]

    setStatus('starting')

    try {
      await window.desktop.saveAgentTask({
        id: nextTaskId,
        title: nextTaskTitle,
        provider,
        mode,
        status: 'active',
        entries: nextEntries.map(toStoredEntry),
        threadId: null,
        usageText: ''
      })
      setTaskId(nextTaskId)
      taskIdRef.current = nextTaskId
      setTaskTitle(nextTaskTitle)
      setTaskStatus('active')
      setEntries(nextEntries)
      setDraft('')
      setUsage('')
      setThreadId(null)
      await refreshTaskList()

      const history = entries
        .flatMap((entry) => {
          if (entry.kind !== 'user' && entry.kind !== 'assistant') {
            return []
          }
          const role = entry.kind === 'user' ? 'User' : 'Assistant'
          return [`${role}: ${entry.text.slice(0, 3000)}`]
        })
        .slice(-8)
      const run = await window.desktop.startAgent(
        buildAgentPrompt({
          request,
          history,
          contextFiles,
          workspaceFocus,
          openFilePaths,
          changedFilePaths,
          diagnosticFilePaths
        }),
        mode,
        provider,
        nextTaskId
      )
      setActiveRunId(run.runId)
      activeRunIdRef.current = run.runId
      setStatus('running')
    } catch (error) {
      setStatus('idle')
      setTaskStatus('failed')
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'error',
        text: error instanceof Error ? error.message : '无法启动 Agent。'
      })
    }
  }

  const cancelRun = async (): Promise<void> => {
    const runId = activeRunIdRef.current
    if (!runId || !window.desktop) {
      return
    }

    setStatus('cancelling')
    try {
      await window.desktop.cancelAgent(runId)
      setStatus('idle')
      setTaskStatus('cancelled')
      activeRunIdRef.current = null
      setActiveRunId(null)
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'system',
        text: 'Agent 任务已停止。'
      })
    } catch (error) {
      setStatus('running')
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'error',
        text: error instanceof Error ? error.message : '无法停止 Agent。'
      })
    }
  }

  const clearConversation = (): void => {
    if (status !== 'idle') {
      return
    }
    setTaskId(null)
    taskIdRef.current = null
    setTaskTitle('新任务')
    setTaskStatus('active')
    setEntries([])
    setContextFiles([])
    setContextQuery('')
    setContextResults([])
    setShowContextPicker(false)
    setCheckpoints([])
    setShowCheckpoints(false)
    setThreadId(null)
    setUsage('')
    setDraft('')
    textareaRef.current?.focus()
  }

  const restoreCheckpoint = async (
    checkpoint: AgentCheckpointInfo
  ): Promise<void> => {
    if (
      !window.desktop ||
      status !== 'idle' ||
      !window.confirm(
        `恢复到检查点“${checkpoint.label}”？\n\n当前项目中的相关文件会被替换，该操作无法自动撤销。`
      )
    ) {
      return
    }

    setTaskLoading(true)
    try {
      await window.desktop.restoreAgentCheckpoint(checkpoint.id)
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'system',
        text: `项目已恢复到检查点：${checkpoint.label}`
      })
      await refreshCheckpoints(checkpoint.taskId)
      await onRunFinished()
    } catch (error) {
      appendEntry({
        id: crypto.randomUUID(),
        kind: 'error',
        text: error instanceof Error ? error.message : '恢复检查点失败。'
      })
    } finally {
      setTaskLoading(false)
    }
  }

  return (
    <section className="agent-workspace">
      <header className="agent-header">
        <div>
          <span className="eyebrow">Agent 会话</span>
          <strong>{taskTitle === '新任务' ? project.name : taskTitle}</strong>
        </div>
        <div className="agent-header-actions">
          <div className="agent-provider-switch" aria-label="Agent Provider">
            <button
              className={provider === 'deepseek' ? 'active' : ''}
              type="button"
              disabled={status !== 'idle'}
              onClick={() => setProvider('deepseek')}
            >
              DeepSeek
            </button>
            <button
              className={provider === 'codex' ? 'active' : ''}
              type="button"
              disabled={status !== 'idle' || providerStatus?.codexAvailable === false}
              onClick={() => setProvider('codex')}
            >
              Codex
            </button>
          </div>
          {threadId ? (
            <span className="agent-thread" title={threadId}>
              {threadId.slice(0, 8)}
            </span>
          ) : null}
          <button
            type="button"
            disabled={status !== 'idle' || entries.length === 0}
            onClick={clearConversation}
          >
            新任务
          </button>
        </div>
      </header>

      <div className="agent-task-bar">
        <div className="agent-task-selector">
          <span>任务</span>
          <select
            value={taskId ?? ''}
            disabled={status !== 'idle' || taskLoading}
            onChange={(event) => {
              if (!event.target.value) {
                clearConversation()
                return
              }
              void loadTask(event.target.value)
            }}
          >
            <option value="">新任务</option>
            {taskList.map((task) => (
              <option value={task.id} key={task.id}>
                {task.title} · {new Date(task.updatedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
        <button
          className={showChanges ? 'active' : ''}
          type="button"
          disabled={!agentChangedFiles.length}
          onClick={() => setShowChanges((current) => !current)}
        >
          本轮变更 {agentChangedFiles.length}
        </button>
        <button
          className={showCheckpoints ? 'active' : ''}
          type="button"
          disabled={!taskId}
          onClick={() => setShowCheckpoints((current) => !current)}
        >
          检查点 {checkpoints.length}
        </button>
      </div>

      {showCheckpoints ? (
        <div className="agent-checkpoint-drawer">
          <div className="agent-checkpoint-heading">
            <strong>任务检查点</strong>
            <button type="button" onClick={() => setShowCheckpoints(false)}>
              ×
            </button>
          </div>
          {checkpoints.length ? (
            checkpoints.map((checkpoint) => (
              <div className="agent-checkpoint-row" key={checkpoint.id}>
                <div>
                  <strong>{checkpoint.label}</strong>
                  <small>
                    {new Date(checkpoint.createdAt).toLocaleString()}
                    {checkpoint.restoredAt ? ' · 已恢复' : ''}
                  </small>
                </div>
                <div className="agent-checkpoint-actions">
                  <button
                    type="button"
                    onClick={() => setDiffCheckpointId(checkpoint.id)}
                  >
                    Diff
                  </button>
                  <button
                    type="button"
                    disabled={status !== 'idle' || taskLoading}
                    onClick={() => void restoreCheckpoint(checkpoint)}
                  >
                    恢复
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p>批准的写文件或命令执行前会自动创建检查点。</p>
          )}
        </div>
      ) : null}

      <div className="agent-messages">
        {entries.length === 0 ? (
          <div className="agent-empty">
            <div className="agent-orbit">
              <span>A</span>
            </div>
            <span className="welcome-kicker">
              <span className="kicker-line" />
              准备就绪
            </span>
            <h1>把目标交给 Agent。</h1>
            <p>
              默认以只读模式分析项目。需要修改代码时，再明确切换到可写模式。
            </p>
            <div className="agent-suggestions">
              <button
                type="button"
                onClick={() => setDraft('分析这个项目的结构，并说明主要模块的职责。')}
              >
                分析项目结构
              </button>
              <button
                type="button"
                onClick={() => setDraft('检查当前工作区的问题，并给出按优先级排序的修复建议。')}
              >
                检查工作区问题
              </button>
              <button
                type="button"
                onClick={() => setDraft('阅读 README 和核心入口，告诉我下一步最值得实现的功能。')}
              >
                规划下一步
              </button>
            </div>
          </div>
        ) : (
          <div className="agent-entry-list">
            {entries.map((entry) => {
              if (entry.kind === 'tool') {
                return (
                  <article className={`agent-tool-card ${entry.status}`} key={entry.id}>
                    <div className="agent-tool-heading">
                      <span>{entry.title}</span>
                      <small>{toolStatusLabel(entry.status)}</small>
                    </div>
                    <pre>{entry.detail}</pre>
                    {entry.changes.length ? (
                      <div className="agent-tool-changes">
                        {entry.changes.map((path) => (
                          <button
                            type="button"
                            key={path}
                            title={`打开 ${path}`}
                            onClick={() => onOpenFile(path)}
                          >
                            {path}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {entry.approvalId ? (
                      <div className="agent-approval-actions">
                        <span>需要你的确认</span>
                        <button
                          className="approve"
                          type="button"
                          onClick={() =>
                            void respondToApproval(
                              entry.id,
                              entry.approvalId as string,
                              true
                            )
                          }
                        >
                          允许
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void respondToApproval(
                              entry.id,
                              entry.approvalId as string,
                              false
                            )
                          }
                        >
                          拒绝
                        </button>
                      </div>
                    ) : null}
                  </article>
                )
              }

              return (
                <article className={`agent-entry ${entry.kind}`} key={entry.id}>
                  <div className="agent-entry-role">
                    {entry.kind === 'user'
                      ? '你'
                      : entry.kind === 'assistant'
                        ? 'Agent'
                        : entry.kind === 'error'
                          ? '错误'
                          : '系统'}
                  </div>
                  <div className="agent-entry-copy">
                    {entry.kind === 'assistant' ? (
                      <MarkdownContent text={entry.text} />
                    ) : (
                      entry.text
                    )}
                    {entry.kind === 'user' &&
                    (entry.contextFiles?.length || entry.autoFocusFiles?.length) ? (
                      <div className="agent-context-tags">
                        {entry.autoFocusFiles?.slice(0, 8).map((path) => (
                          <button
                            className="automatic"
                            type="button"
                            key={`focus-${path}`}
                            title={`自动焦点：${path}`}
                            onClick={() => onOpenFile(path)}
                          >
                            {path}
                          </button>
                        ))}
                        {entry.contextFiles
                          ?.filter(
                            (path) => !entry.autoFocusFiles?.includes(path)
                          )
                          .map((path) => (
                          <button
                            type="button"
                            key={`pinned-${path}`}
                            title={`固定关注：${path}`}
                            onClick={() => onOpenFile(path)}
                          >
                            {path}
                          </button>
                          ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
            {status === 'running' ||
            status === 'starting' ||
            status === 'cancelling' ? (
              <div className="agent-thinking">
                <span />
                <span />
                <span />
                {status === 'starting' ? '正在启动 Agent' : '正在处理项目'}
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="agent-composer">
        <div className="agent-workspace-focus">
          <span>
            <strong>项目范围</strong>
            整个项目
          </span>
          {workspaceFocus ? (
            <button
              type="button"
              title={
                workspaceFocus.selectedText
                  ? '当前编辑器和代码选区已自动加入工作焦点'
                  : '当前编辑器已自动加入工作焦点'
              }
              onClick={() => onOpenFile(workspaceFocus.path)}
            >
              <strong>当前焦点</strong>
              {workspaceFocus.path}:{workspaceFocus.startLine}
              {workspaceFocus.selectedText ? ' · 有选区' : ''}
            </button>
          ) : (
            <span>当前没有打开的文件</span>
          )}
        </div>
        <div className="agent-mode-row">
          <div className="agent-mode-switch" role="radiogroup" aria-label="Agent 权限">
            <button
              className={mode === 'read-only' ? 'active' : ''}
              type="button"
              role="radio"
              aria-checked={mode === 'read-only'}
              disabled={status !== 'idle'}
              onClick={() => setMode('read-only')}
            >
              只读分析
            </button>
            <button
              className={mode === 'workspace-write' ? 'active write-mode' : ''}
              type="button"
              role="radio"
              aria-checked={mode === 'workspace-write'}
              disabled={status !== 'idle' || hasUnsavedFiles}
              title={hasUnsavedFiles ? '请先保存所有文件' : '允许 Agent 修改项目文件'}
              onClick={() => setMode('workspace-write')}
            >
              允许修改
            </button>
          </div>
          <span className="agent-sandbox-label">
            {provider === 'deepseek'
              ? providerStatus?.deepseekModel ?? 'deepseek-chat'
              : mode === 'read-only'
                ? 'codex: read-only'
                : 'codex: workspace-write'}
          </span>
        </div>

        {provider === 'deepseek' &&
        (!providerStatus?.deepseekConfigured || showKeyForm) ? (
          <div className="agent-key-panel">
            <input
              type="password"
              value={apiKeyDraft}
              placeholder="DeepSeek API Key（加密保存在本机）"
              autoComplete="off"
              disabled={keySaving || status !== 'idle'}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void saveDeepSeekKey()
                }
              }}
            />
            <button
              type="button"
              disabled={!apiKeyDraft.trim() || keySaving}
              onClick={() => void saveDeepSeekKey()}
            >
              {keySaving ? '保存中' : '保存 Key'}
            </button>
            {showKeyForm && providerStatus?.deepseekConfigured ? (
              <button
                className="agent-key-cancel"
                type="button"
                onClick={() => {
                  setShowKeyForm(false)
                  setApiKeyDraft('')
                }}
              >
                取消
              </button>
            ) : null}
          </div>
        ) : provider === 'deepseek' ? (
          <div className="agent-provider-note">
            <span>
              DeepSeek 已配置 ·{' '}
              {providerStatus?.deepseekSource === 'environment'
                ? '环境变量'
                : '安全存储'}
            </span>
            <button type="button" onClick={() => setShowKeyForm(true)}>
              更换 Key
            </button>
          </div>
        ) : null}

        {mode === 'workspace-write' ? (
          <div className="agent-write-warning">
            Agent 可以修改当前项目并执行项目内命令。修改完成后请检查 Git Diff。
          </div>
        ) : null}

        {contextFiles.length ? (
          <div className="agent-selected-context">
            {contextFiles.map((path) => (
              <span key={path}>
                <button
                  className="context-open"
                  type="button"
                  onClick={() => onOpenFile(path)}
                >
                  {path}
                </button>
                <button
                  className="context-remove"
                  type="button"
                  aria-label={`移除 ${path}`}
                  onClick={() => removeContextFile(path)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {showContextPicker ? (
          <div className="agent-context-picker">
            <div className="agent-context-heading">
              <strong>固定关注文件（可选）</strong>
              <span>
                {indexStatus?.state === 'indexing'
                  ? '正在建立索引'
                  : indexStatus?.state === 'ready'
                    ? `${indexStatus.indexedFiles} 文件 · ${indexStatus.indexedSymbols} 符号`
                    : indexStatus?.state === 'error'
                      ? '索引失败'
                      : '索引未建立'}
              </span>
              <button
                type="button"
                title="重建代码索引"
                disabled={indexStatus?.state === 'indexing'}
                onClick={() => void rebuildContextIndex()}
              >
                ↻
              </button>
            </div>
            <input
              value={contextQuery}
              placeholder="搜索文件名、符号或代码内容"
              spellCheck={false}
              onChange={(event) => setContextQuery(event.target.value)}
            />
            <div className="agent-context-results">
              {contextQuery.trim() ? (
                contextResults.length ? (
                  contextResults.map((result) => (
                    <button
                      className={
                        contextFiles.includes(result.path) ? 'selected' : ''
                      }
                      type="button"
                      key={`${result.kind}-${result.path}-${result.line}-${result.label}`}
                      onClick={() => attachContextFile(result.path)}
                    >
                      <span className="context-result-copy">
                        <strong>{result.label}</strong>
                        <small>
                          {result.path}:{result.line}
                        </small>
                        <em>{result.snippet}</em>
                      </span>
                      <span className="context-result-kind">{result.kind}</span>
                    </button>
                  ))
                ) : (
                  <p>没有找到匹配结果。</p>
                )
              ) : (
                <p>
                  Agent 默认可以搜索和读取整个项目；这里只用于固定额外关注的文件或符号。
                </p>
              )}
            </div>
          </div>
        ) : null}

        <div className="agent-input-shell">
          <textarea
            ref={textareaRef}
            value={draft}
            rows={3}
            placeholder="描述要完成的工作、限制条件和验收标准……"
            disabled={status !== 'idle'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void startRun()
              }
            }}
          />
          <div className="agent-composer-footer">
            <div className="agent-composer-left">
              <span>
                {usage ||
                  (hasUnsavedFiles
                    ? '有未保存文件，当前只能只读分析'
                    : 'Enter 发送 · Shift+Enter 换行')}
              </span>
              <button
                className={showContextPicker ? 'active' : ''}
                type="button"
                disabled={status !== 'idle'}
                onClick={() => setShowContextPicker((current) => !current)}
              >
                @ 固定关注文件
              </button>
            </div>
            {status === 'running' ||
            status === 'starting' ||
            status === 'cancelling' ? (
              <button
                className="agent-cancel-button"
                type="button"
                disabled={status === 'cancelling'}
                onClick={() => void cancelRun()}
              >
                停止
              </button>
            ) : (
              <button
                className="agent-send-button"
                type="button"
                disabled={!draft.trim() || status !== 'idle' || !providerReady}
                onClick={() => void startRun()}
              >
                {mode === 'workspace-write' ? '允许并运行' : '发送'}
                <span>↗</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {showChanges ? (
        <FloatingDetailWindow
          title="本轮变更"
          subtitle={`${agentChangedFiles.length} 个文件`}
          onClose={() => setShowChanges(false)}
        >
          <div className="agent-change-window-list">
            {agentChangedFiles.map((file) => (
              <button
                className={`change-${file.kind}`}
                type="button"
                key={file.path}
                disabled={file.kind === 'deleted'}
                title={
                  file.kind === 'deleted'
                    ? `已删除：${file.path}`
                    : `预览 ${file.path}`
                }
                onClick={() => onOpenFile(file.path)}
              >
                <small>{fileChangeLabel(file.kind)}</small>
                <span>{file.path}</span>
              </button>
            ))}
          </div>
        </FloatingDetailWindow>
      ) : null}

      {diffCheckpointId ? (
        <CheckpointDiffModal
          checkpointId={diffCheckpointId}
          theme={editorTheme}
          onClose={() => setDiffCheckpointId(null)}
        />
      ) : null}
    </section>
  )
}

export default AgentWorkspace
