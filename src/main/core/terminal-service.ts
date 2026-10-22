import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionInfo
} from '../../shared/desktop'

interface TerminalSession {
  id: string
  ownerId: number
  process: IPty
  shell: string
}

export interface TerminalServiceCallbacks {
  onData: (ownerId: number, event: TerminalDataEvent) => void
  onExit: (ownerId: number, event: TerminalExitEvent) => void
}

export interface TerminalServiceOptions {
  useConpty?: boolean
}

export function resolveDefaultShell(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): { shell: string; args: string[] } {
  if (platform === 'win32') {
    return {
      shell: environment.AI_IDE_SHELL ?? 'powershell.exe',
      args: ['-NoLogo']
    }
  }
  return {
    shell: environment.SHELL ?? '/bin/bash',
    args: ['-l']
  }
}

export function clampTerminalDimensions(
  cols: number,
  rows: number
): { cols: number; rows: number } {
  return {
    cols: Number.isFinite(cols)
      ? Math.min(500, Math.max(20, Math.round(cols)))
      : 100,
    rows: Number.isFinite(rows)
      ? Math.min(200, Math.max(5, Math.round(rows)))
      : 30
  }
}

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly callbacks: TerminalServiceCallbacks
  private readonly options: TerminalServiceOptions

  constructor(
    callbacks: TerminalServiceCallbacks,
    options: TerminalServiceOptions = {}
  ) {
    this.callbacks = callbacks
    this.options = options
  }

  get size(): number {
    return this.sessions.size
  }

  createSession(
    ownerId: number,
    cwd: string,
    cols: number,
    rows: number
  ): TerminalSessionInfo {
    this.killOwnerSessions(ownerId)
    const dimensions = clampTerminalDimensions(cols, rows)
    const { shell, args } = resolveDefaultShell(
      process.platform,
      process.env
    )
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
    const terminalProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: dimensions.cols,
      rows: dimensions.rows,
      cwd,
      useConpty: this.options.useConpty,
      env: {
        ...environment,
        TERM: 'xterm-256color',
        TERM_PROGRAM: 'AI IDE'
      }
    })
    const sessionId = randomUUID()
    const session: TerminalSession = {
      id: sessionId,
      ownerId,
      process: terminalProcess,
      shell: basename(shell)
    }
    this.sessions.set(sessionId, session)

    terminalProcess.onData((data) => {
      this.callbacks.onData(ownerId, { sessionId, data })
    })
    terminalProcess.onExit(({ exitCode }) => {
      this.sessions.delete(sessionId)
      this.callbacks.onExit(ownerId, { sessionId, exitCode })
    })

    return {
      id: sessionId,
      shell: session.shell
    }
  }

  private getOwnedSession(
    sessionId: string,
    ownerId: number
  ): TerminalSession {
    const session = this.sessions.get(sessionId)
    if (!session || session.ownerId !== ownerId) {
      throw new Error('终端会话不存在或已失效。')
    }
    return session
  }

  write(ownerId: number, sessionId: string, data: string): void {
    if (typeof data !== 'string' || data.length > 64 * 1024) {
      throw new Error('终端输入无效。')
    }
    this.getOwnedSession(sessionId, ownerId).process.write(data)
  }

  resize(ownerId: number, sessionId: string, cols: number, rows: number): void {
    const dimensions = clampTerminalDimensions(cols, rows)
    this.getOwnedSession(sessionId, ownerId).process.resize(
      dimensions.cols,
      dimensions.rows
    )
  }

  kill(ownerId: number, sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    if (session.ownerId !== ownerId) {
      throw new Error('无权关闭其他窗口的终端。')
    }
    this.killSession(sessionId)
  }

  private killOwnerSessions(ownerId: number): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.ownerId === ownerId) {
        this.killSession(sessionId)
      }
    }
  }

  private killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }
    this.sessions.delete(sessionId)
    try {
      session.process.kill()
    } catch {
      // The shell may already have exited.
    }
  }

  killAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.killSession(sessionId)
    }
  }
}
