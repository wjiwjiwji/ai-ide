import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TerminalService,
  clampTerminalDimensions,
  resolveDefaultShell
} from './terminal-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('terminal service', () => {
  it('clamps terminal dimensions', () => {
    expect(clampTerminalDimensions(1, 1)).toEqual({ cols: 20, rows: 5 })
    expect(clampTerminalDimensions(9999, 9999)).toEqual({
      cols: 500,
      rows: 200
    })
    expect(clampTerminalDimensions(Number.NaN, Number.NaN)).toEqual({
      cols: 100,
      rows: 30
    })
  })

  it('selects platform shells', () => {
    expect(
      resolveDefaultShell('win32', { AI_IDE_SHELL: 'pwsh.exe' })
    ).toEqual({
      shell: 'pwsh.exe',
      args: ['-NoLogo']
    })
    expect(resolveDefaultShell('linux', { SHELL: '/bin/zsh' })).toEqual({
      shell: '/bin/zsh',
      args: ['-l']
    })
  })

  it.skipIf(process.platform !== 'win32')(
    'runs a PowerShell command through a real PTY',
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'ai-ide-terminal-'))
      temporaryDirectories.push(cwd)
      let output = ''
      let service: TerminalService
      let resolveExited: (() => void) | undefined
      const exited = new Promise<void>((resolve) => {
        resolveExited = resolve
      })
      const marker = 'TERMINAL_SERVICE_OK'

      const received = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`PTY output timeout: ${output}`)),
          5000
        )
        service = new TerminalService(
          {
            onData: (_ownerId, event) => {
              output += event.data
              if (output.includes(marker)) {
                clearTimeout(timeout)
                service.kill(1, event.sessionId)
                resolve()
              }
            },
            onExit: () => {
              resolveExited?.()
            }
          },
          { useConpty: false }
        )
      })

      const session = service!.createSession(1, cwd, 80, 24)
      service!.write(1, session.id, `Write-Output ${marker}\r`)
      await received
      await Promise.race([
        exited,
        new Promise<void>((_, reject) => {
          setTimeout(
            () => reject(new Error('PTY exit event timeout')),
            5000
          )
        })
      ])
      expect(output).toContain(marker)
    },
    10_000
  )
})
