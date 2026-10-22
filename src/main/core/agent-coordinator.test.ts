import { describe, expect, it } from 'vitest'
import type { AgentStreamEvent } from '../../shared/desktop'
import {
  AgentCoordinator,
  type AgentEventOwner,
  type AgentCoordinatorDependencies
} from './agent-coordinator'
import type { DeepSeekAgentOptions } from './deepseek-agent'
import { WorkspaceFileService } from './workspace-files'

function createOwner(id: number): {
  owner: AgentEventOwner
  events: AgentStreamEvent[]
} {
  const events: AgentStreamEvent[] = []
  return {
    events,
    owner: {
      id,
      isDestroyed: () => false,
      send: (channel, payload) => {
        if (channel === 'agent:event') {
          events.push(payload)
        }
      }
    }
  }
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2000
): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for Agent state')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function createCoordinator(
  runner: (options: DeepSeekAgentOptions) => Promise<void>,
  overrides: Partial<AgentCoordinatorDependencies> = {}
): AgentCoordinator {
  return new AgentCoordinator({
    resolveCodexExecutable: async () => 'codex.exe',
    createCheckpoint: async () => undefined,
    searchCode: () => '[]',
    deepSeekRunner: runner,
    ...overrides
  })
}

describe('agent coordinator', () => {
  it('routes approval requests and owner responses back to the provider', async () => {
    const { owner, events } = createOwner(1)
    let approvedResult: boolean | null = null
    const coordinator = createCoordinator(async (options) => {
      approvedResult = await options.requestApproval({
        toolCall: {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: '{}'
          }
        },
        detail: 'Write README.md',
        changes: [{ path: 'README.md', kind: 'modified' }]
      })
      options.emit({ type: 'turn.completed' })
    })

    const run = coordinator.startDeepSeek({
      owner,
      taskId: 'task-1',
      prompt: 'test',
      mode: 'workspace-write',
      projectRoot: process.cwd(),
      workspace: new WorkspaceFileService(process.cwd()),
      apiKey: 'test',
      model: 'test'
    })

    await waitUntil(() =>
      events.some((event) => event.type === 'approval.required')
    )
    expect(coordinator.hasTaskRun('task-1')).toBe(true)
    const approval = events.find(
      (event) => event.type === 'approval.required'
    )
    coordinator.respondApproval(1, run.runId, approval?.approvalId ?? '', true)
    await waitUntil(() => coordinator.size === 0)

    expect(approvedResult).toBe(true)
    expect(
      events.some((event) => event.type === 'turn.completed')
    ).toBe(true)
  })

  it('cancels pending approval and aborts the provider signal', async () => {
    const { owner, events } = createOwner(1)
    let approvalResult: boolean | null = null
    let signalAborted = false
    const coordinator = createCoordinator(async (options) => {
      approvalResult = await options.requestApproval({
        toolCall: {
          id: 'call-2',
          type: 'function',
          function: {
            name: 'run_command',
            arguments: '{}'
          }
        },
        detail: 'npm test',
        command: 'npm test',
        changes: []
      })
      signalAborted = options.signal.aborted
    })
    const run = coordinator.startDeepSeek({
      owner,
      taskId: 'task-2',
      prompt: 'test',
      mode: 'workspace-write',
      projectRoot: process.cwd(),
      workspace: new WorkspaceFileService(process.cwd()),
      apiKey: 'test',
      model: 'test'
    })

    await waitUntil(() =>
      events.some((event) => event.type === 'approval.required')
    )
    coordinator.cancel(1, run.runId)
    await waitUntil(() => approvalResult !== null)

    expect(approvalResult).toBe(false)
    expect(signalAborted).toBe(true)
    expect(coordinator.size).toBe(0)
  })

  it('rejects approval responses from another owner', async () => {
    const { owner, events } = createOwner(1)
    const coordinator = createCoordinator(async (options) => {
      await options.requestApproval({
        toolCall: {
          id: 'call-3',
          type: 'function',
          function: {
            name: 'run_command',
            arguments: '{}'
          }
        },
        detail: 'echo test',
        command: 'echo test',
        changes: []
      })
    })
    const run = coordinator.startDeepSeek({
      owner,
      taskId: 'task-3',
      prompt: 'test',
      mode: 'workspace-write',
      projectRoot: process.cwd(),
      workspace: new WorkspaceFileService(process.cwd()),
      apiKey: 'test',
      model: 'test'
    })
    await waitUntil(() =>
      events.some((event) => event.type === 'approval.required')
    )
    const approval = events.find(
      (event) => event.type === 'approval.required'
    )

    expect(() =>
      coordinator.respondApproval(
        2,
        run.runId,
        approval?.approvalId ?? '',
        true
      )
    ).toThrow('Agent 审批请求已失效。')
    coordinator.killAll()
  })

  it('creates a Codex checkpoint before launching a writable run', async () => {
    const { owner } = createOwner(1)
    const checkpoints: string[] = []
    const coordinator = createCoordinator(
      async () => undefined,
      {
        createCheckpoint: async (taskId, label) => {
          checkpoints.push(`${taskId}:${label}`)
        },
        codexFactory: () =>
          ({
            cancel: () => undefined
          }) as never
      }
    )

    const run = await coordinator.startCodex({
      owner,
      taskId: 'task-4',
      prompt: 'test',
      mode: 'workspace-write',
      projectRoot: process.cwd()
    })

    expect(run.provider).toBe('codex')
    expect(checkpoints).toEqual(['task-4:Codex 修改前'])
    coordinator.killAll()
  })
})
