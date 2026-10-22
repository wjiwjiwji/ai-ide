import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseCodexOutputLine,
  resolveCodexExecutable
} from './codex-agent'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('Codex provider helpers', () => {
  it('parses thread, message, command and usage events', () => {
    expect(
      parseCodexOutputLine(
        '{"type":"thread.started","thread_id":"thread-1"}'
      )
    ).toMatchObject({ type: 'thread.started', threadId: 'thread-1' })
    expect(
      parseCodexOutputLine(
        '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"done"}}'
      )
    ).toMatchObject({
      item: { id: 'i1', type: 'agent_message', text: 'done' }
    })
    expect(
      parseCodexOutputLine(
        '{"type":"item.completed","item":{"id":"i2","type":"command_execution","command":"npm test","exit_code":1,"aggregated_output":"failed"}}'
      )
    ).toMatchObject({
      item: {
        command: 'npm test',
        exitCode: 1,
        aggregatedOutput: 'failed'
      }
    })
    expect(
      parseCodexOutputLine(
        '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}'
      )
    ).toMatchObject({
      usage: { input_tokens: 12, output_tokens: 3 }
    })
  })

  it('keeps non-JSON log lines and ignores blank lines', () => {
    expect(parseCodexOutputLine('warning: test')).toEqual({
      type: 'log',
      message: 'warning: test'
    })
    expect(parseCodexOutputLine('   ')).toBeNull()
  })

  it('discovers the latest installed Codex executable', async () => {
    const localAppData = await mkdtemp(join(tmpdir(), 'ai-ide-codex-'))
    temporaryDirectories.push(localAppData)
    const binRoot = join(localAppData, 'OpenAI', 'Codex', 'bin')
    await mkdir(join(binRoot, '1.0.0'), { recursive: true })
    await mkdir(join(binRoot, '2.0.0'), { recursive: true })
    await writeFile(join(binRoot, '1.0.0', 'codex.exe'), '')
    const latest = join(binRoot, '2.0.0', 'codex.exe')
    await writeFile(latest, '')

    await expect(
      resolveCodexExecutable({
        environment: { LOCALAPPDATA: localAppData },
        platform: 'win32'
      })
    ).resolves.toBe(latest)
  })
})
