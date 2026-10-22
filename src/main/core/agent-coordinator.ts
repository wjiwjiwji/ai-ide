import { randomUUID } from 'node:crypto'
import type {
  AgentProvider,
  AgentRunInfo,
  AgentRunMode,
  AgentStreamEvent
} from '../../shared/desktop'
import {
  runDeepSeekAgent,
  type DeepSeekAgentOptions,
  type DeepSeekApprovalRequest
} from './deepseek-agent'
import {
  CodexAgentProcess,
  type CodexAgentStartOptions
} from './codex-agent'
import type { WorkspaceFileService } from './workspace-files'

export interface AgentEventOwner {
  id: number
  isDestroyed: () => boolean
  send: (channel: string, payload: AgentStreamEvent) => void
}

interface AgentRunState {
  id: string
  provider: AgentProvider
  taskId: string
  owner: AgentEventOwner
  mode: AgentRunMode
  cancelled: boolean
  abortController?: AbortController
  codex?: CodexAgentProcess
  approvals: Map<string, (approved: boolean) => void>
}

export interface AgentCoordinatorDependencies {
  resolveCodexExecutable: () => Promise<string>
  createCheckpoint: (taskId: string, label: string) => Promise<void>
  searchCode: (query: string) => string
  deepSeekRunner?: typeof runDeepSeekAgent
  codexFactory?: (options: CodexAgentStartOptions) => CodexAgentProcess
}

export interface StartDeepSeekRunInput {
  owner: AgentEventOwner
  taskId: string
  prompt: string
  mode: AgentRunMode
  projectRoot: string
  workspace: WorkspaceFileService
  apiKey: string
  model: string
}

export interface StartCodexRunInput {
  owner: AgentEventOwner
  taskId: string
  prompt: string
  mode: AgentRunMode
  projectRoot: string
}

export class AgentCoordinator {
  private readonly runs = new Map<string, AgentRunState>()
  private readonly dependencies: AgentCoordinatorDependencies

  constructor(dependencies: AgentCoordinatorDependencies) {
    this.dependencies = dependencies
  }

  get size(): number {
    return this.runs.size
  }

  hasTaskRun(taskId: string): boolean {
    return [...this.runs.values()].some((run) => run.taskId === taskId)
  }

  private createRun(
    owner: AgentEventOwner,
    taskId: string,
    mode: AgentRunMode,
    provider: AgentProvider
  ): AgentRunState {
    this.killOwnerRuns(owner.id)
    const run: AgentRunState = {
      id: randomUUID(),
      provider,
      taskId,
      owner,
      mode,
      cancelled: false,
      approvals: new Map()
    }
    this.runs.set(run.id, run)
    return run
  }

  private send(
    run: AgentRunState,
    payload: Omit<AgentStreamEvent, 'runId'>
  ): void {
    if (!run.cancelled && !run.owner.isDestroyed()) {
      run.owner.send('agent:event', {
        runId: run.id,
        ...payload
      } satisfies AgentStreamEvent)
    }
  }

  private requestApproval(
    run: AgentRunState,
    request: DeepSeekApprovalRequest
  ): Promise<boolean> {
    if (run.cancelled) {
      return Promise.resolve(false)
    }
    const approvalId = randomUUID()
    this.send(run, {
      type: 'approval.required',
      approvalId,
      item: {
        id: request.toolCall.id,
        type:
          request.toolCall.function.name === 'run_command'
            ? 'command_execution'
            : 'file_change',
        text: request.detail,
        command: request.command,
        status: 'awaiting_approval',
        changes: request.changes
      }
    })

    return new Promise((resolveApproval) => {
      run.approvals.set(approvalId, (approved) => {
        run.approvals.delete(approvalId)
        resolveApproval(approved)
      })
    })
  }

  startDeepSeek(input: StartDeepSeekRunInput): AgentRunInfo {
    const run = this.createRun(
      input.owner,
      input.taskId,
      input.mode,
      'deepseek'
    )
    run.abortController = new AbortController()
    const runner = this.dependencies.deepSeekRunner ?? runDeepSeekAgent
    const options: DeepSeekAgentOptions = {
      runId: run.id,
      taskId: run.taskId,
      prompt: input.prompt,
      mode: input.mode,
      projectRoot: input.projectRoot,
      workspace: input.workspace,
      apiKey: input.apiKey,
      model: input.model,
      signal: run.abortController.signal,
      emit: (event) => this.send(run, event),
      requestApproval: (request) => this.requestApproval(run, request),
      createCheckpoint: async (label) => {
        await this.dependencies.createCheckpoint(run.taskId, label)
      },
      searchCode: this.dependencies.searchCode
    }

    void runner(options)
      .catch((error) => {
        if (!run.cancelled) {
          this.send(run, {
            type: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'DeepSeek Agent 运行失败。'
          })
        }
      })
      .finally(() => {
        this.cleanupRun(run)
      })

    return { runId: run.id, mode: input.mode, provider: 'deepseek' }
  }

  async startCodex(input: StartCodexRunInput): Promise<AgentRunInfo> {
    if (input.mode === 'workspace-write') {
      await this.dependencies.createCheckpoint(
        input.taskId,
        'Codex 修改前'
      )
    }
    const executable = await this.dependencies.resolveCodexExecutable()
    const run = this.createRun(
      input.owner,
      input.taskId,
      input.mode,
      'codex'
    )
    const factory =
      this.dependencies.codexFactory ??
      ((options: CodexAgentStartOptions) =>
        new CodexAgentProcess(options))
    try {
      run.codex = factory({
        executable,
        projectRoot: input.projectRoot,
        prompt: input.prompt,
        mode: input.mode,
        onEvent: (event) => this.send(run, event),
        onSpawnError: (error) => {
          this.runs.delete(run.id)
          this.send(run, {
            type: 'error',
            message: error.message
          })
        },
        onClose: ({ exitCode, completed, cancelled, stderr }) => {
          this.runs.delete(run.id)
          if (!cancelled && !completed) {
            this.send(run, {
              type: 'error',
              message:
                stderr.trim() ||
                `Codex 进程异常退出，退出码 ${exitCode ?? 'unknown'}。`
            })
          }
        }
      })
    } catch (error) {
      this.runs.delete(run.id)
      this.send(run, {
        type: 'error',
        message:
          error instanceof Error ? error.message : '无法启动 Codex。'
      })
    }
    return { runId: run.id, mode: input.mode, provider: 'codex' }
  }

  respondApproval(
    ownerId: number,
    runId: string,
    approvalId: string,
    approved: boolean
  ): void {
    const run = this.runs.get(runId)
    if (!run || run.owner.id !== ownerId) {
      throw new Error('Agent 审批请求已失效。')
    }
    const resolveApproval = run.approvals.get(approvalId)
    if (!resolveApproval) {
      throw new Error('审批请求已处理或已过期。')
    }
    run.approvals.delete(approvalId)
    resolveApproval(Boolean(approved))
  }

  cancel(ownerId: number, runId: string): void {
    const run = this.runs.get(runId)
    if (!run) {
      return
    }
    if (run.owner.id !== ownerId) {
      throw new Error('无权停止其他窗口的 Agent 任务。')
    }
    this.killRun(run)
  }

  private cleanupRun(run: AgentRunState): void {
    this.runs.delete(run.id)
    for (const resolveApproval of run.approvals.values()) {
      resolveApproval(false)
    }
    run.approvals.clear()
  }

  private killRun(run: AgentRunState): void {
    run.cancelled = true
    this.runs.delete(run.id)
    run.abortController?.abort()
    for (const resolveApproval of run.approvals.values()) {
      resolveApproval(false)
    }
    run.approvals.clear()
    run.codex?.cancel()
  }

  private killOwnerRuns(ownerId: number): void {
    for (const run of [...this.runs.values()]) {
      if (run.owner.id === ownerId) {
        this.killRun(run)
      }
    }
  }

  killAll(): void {
    for (const run of [...this.runs.values()]) {
      this.killRun(run)
    }
  }
}
