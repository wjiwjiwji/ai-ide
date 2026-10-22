import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentStreamEvent } from '../../shared/desktop'
import {
  runDeepSeekAgent,
  type DeepSeekCompletion,
  type DeepSeekResponse
} from './deepseek-agent'
import { WorkspaceFileService } from './workspace-files'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function createWorkspace(): Promise<{
  root: string
  workspace: WorkspaceFileService
}> {
  const root = await mkdtemp(join(tmpdir(), 'ai-ide-deepseek-'))
  temporaryDirectories.push(root)
  await writeFile(join(root, 'README.md'), '# Original\n')
  return {
    root,
    workspace: new WorkspaceFileService(root)
  }
}

function toolResponse(
  name: string,
  args: Record<string, unknown>
): DeepSeekResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call-${name}`,
              type: 'function',
              function: {
                name,
                arguments: JSON.stringify(args)
              }
            }
          ]
        }
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 3 }
  }
}

function finalResponse(text: string): DeepSeekResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: text
        }
      }
    ],
    usage: { prompt_tokens: 5, completion_tokens: 2 }
  }
}

function fakeCompletion(
  responses: DeepSeekResponse[]
): DeepSeekCompletion {
  return async () => {
    const response = responses.shift()
    if (!response) {
      throw new Error('No fake completion response remaining')
    }
    return response
  }
}

describe('DeepSeek agent runtime', () => {
  it('runs read-only tools and emits a completed turn', async () => {
    const { root, workspace } = await createWorkspace()
    const events: Array<Omit<AgentStreamEvent, 'runId'>> = []

    await runDeepSeekAgent({
      runId: 'run-1',
      taskId: 'task-1',
      prompt: 'Read the readme',
      apiKey: 'test-key',
      model: 'test-model',
      mode: 'read-only',
      projectRoot: root,
      workspace,
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      requestApproval: async () => false,
      createCheckpoint: async () => undefined,
      searchCode: () => '[]',
      complete: fakeCompletion([
        toolResponse('read_file', { path: 'README.md' }),
        finalResponse('Read complete')
      ])
    })

    expect(
      events.some(
        (event) =>
          event.type === 'item.completed' &&
          event.item?.text === 'read_file: README.md'
      )
    ).toBe(true)
    expect(
      events.some(
        (event) =>
          event.type === 'item.completed' &&
          event.item?.text === 'Read complete'
      )
    ).toBe(true)
    expect(events.at(-1)).toMatchObject({
      type: 'turn.completed',
      usage: { input_tokens: 15, output_tokens: 5 }
    })
  })

  it('requires approval and checkpoint before writing a file', async () => {
    const { root, workspace } = await createWorkspace()
    let approvalCount = 0
    let checkpointCount = 0

    await runDeepSeekAgent({
      runId: 'run-2',
      taskId: 'task-2',
      prompt: 'Update the readme',
      apiKey: 'test-key',
      model: 'test-model',
      mode: 'workspace-write',
      projectRoot: root,
      workspace,
      signal: new AbortController().signal,
      emit: () => undefined,
      requestApproval: async () => {
        approvalCount += 1
        return true
      },
      createCheckpoint: async () => {
        checkpointCount += 1
      },
      searchCode: () => '[]',
      complete: fakeCompletion([
        toolResponse('write_file', {
          path: 'README.md',
          content: '# Updated\n'
        }),
        finalResponse('Write complete')
      ])
    })

    expect(approvalCount).toBe(1)
    expect(checkpointCount).toBe(1)
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(
      '# Updated\n'
    )
  })

  it('does not write when approval is denied', async () => {
    const { root, workspace } = await createWorkspace()
    let checkpointCount = 0

    await runDeepSeekAgent({
      runId: 'run-3',
      taskId: 'task-3',
      prompt: 'Update the readme',
      apiKey: 'test-key',
      model: 'test-model',
      mode: 'workspace-write',
      projectRoot: root,
      workspace,
      signal: new AbortController().signal,
      emit: () => undefined,
      requestApproval: async () => false,
      createCheckpoint: async () => {
        checkpointCount += 1
      },
      searchCode: () => '[]',
      complete: fakeCompletion([
        toolResponse('write_file', {
          path: 'README.md',
          content: '# Denied\n'
        }),
        finalResponse('No changes applied')
      ])
    })

    expect(checkpointCount).toBe(0)
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(
      '# Original\n'
    )
  })

  it('rejects write tools in read-only mode', async () => {
    const { root, workspace } = await createWorkspace()
    const events: Array<Omit<AgentStreamEvent, 'runId'>> = []
    let approvalCount = 0

    await runDeepSeekAgent({
      runId: 'run-4',
      taskId: 'task-4',
      prompt: 'Try to write',
      apiKey: 'test-key',
      model: 'test-model',
      mode: 'read-only',
      projectRoot: root,
      workspace,
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      requestApproval: async () => {
        approvalCount += 1
        return true
      },
      createCheckpoint: async () => undefined,
      searchCode: () => '[]',
      complete: fakeCompletion([
        toolResponse('write_file', {
          path: 'README.md',
          content: '# Escape\n'
        }),
        finalResponse('Cannot write')
      ])
    })

    expect(approvalCount).toBe(0)
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(
      '# Original\n'
    )
    expect(
      events.some(
        (event) =>
          event.type === 'item.completed' &&
          event.item?.status === 'failed'
      )
    ).toBe(true)
  })
})
