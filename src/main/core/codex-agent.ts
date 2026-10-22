import {
  spawn,
  type ChildProcessWithoutNullStreams
} from 'node:child_process'
import {
  lstat,
  readdir
} from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AgentRunMode,
  AgentStreamEvent
} from '../../shared/desktop'

export interface CodexExecutableOptions {
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export async function resolveCodexExecutable(
  options: CodexExecutableOptions = {}
): Promise<string> {
  const environment = options.environment ?? process.env
  const platform = options.platform ?? process.platform
  const configuredPath = environment.AI_IDE_CODEX_BIN

  if (configuredPath) {
    const configuredStats = await lstat(configuredPath)
    if (!configuredStats.isFile()) {
      throw new Error('AI_IDE_CODEX_BIN 未指向可执行文件。')
    }
    return configuredPath
  }

  if (platform !== 'win32') {
    return 'codex'
  }

  const codexBinRoot = join(
    environment.LOCALAPPDATA ?? '',
    'OpenAI',
    'Codex',
    'bin'
  )
  try {
    const versionDirectories = await readdir(codexBinRoot, {
      withFileTypes: true
    })
    versionDirectories.sort((left, right) =>
      right.name.localeCompare(left.name, 'en')
    )
    for (const directory of versionDirectories) {
      if (!directory.isDirectory()) {
        continue
      }
      const candidate = join(codexBinRoot, directory.name, 'codex.exe')
      try {
        const candidateStats = await lstat(candidate)
        if (candidateStats.isFile()) {
          return candidate
        }
      } catch {
        // Continue searching installed Codex versions.
      }
    }
  } catch {
    // Report a clear configuration error below.
  }

  throw new Error(
    '未找到 Codex CLI。请安装 Codex，或设置 AI_IDE_CODEX_BIN 指向 codex.exe。'
  )
}

export function parseCodexOutputLine(
  line: string
): Omit<AgentStreamEvent, 'runId'> | null {
  const trimmedLine = line.trim()
  if (!trimmedLine) {
    return null
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(trimmedLine) as Record<string, unknown>
  } catch {
    return {
      type: 'log',
      message: trimmedLine
    }
  }

  const eventType =
    typeof parsed.type === 'string' ? parsed.type : 'unknown'
  const rawItem =
    parsed.item && typeof parsed.item === 'object'
      ? (parsed.item as Record<string, unknown>)
      : undefined
  const rawChanges =
    rawItem && Array.isArray(rawItem.changes)
      ? rawItem.changes
          .filter(
            (change): change is Record<string, unknown> =>
              Boolean(change) && typeof change === 'object'
          )
          .map((change) => ({
            path: typeof change.path === 'string' ? change.path : '',
            kind: typeof change.kind === 'string' ? change.kind : undefined
          }))
          .filter((change) => change.path)
      : undefined
  const rawUsage =
    parsed.usage && typeof parsed.usage === 'object'
      ? (parsed.usage as Record<string, unknown>)
      : undefined

  return {
    type: eventType,
    threadId:
      typeof parsed.thread_id === 'string' ? parsed.thread_id : undefined,
    message: typeof parsed.message === 'string' ? parsed.message : undefined,
    item: rawItem
      ? {
          id: typeof rawItem.id === 'string' ? rawItem.id : undefined,
          type: typeof rawItem.type === 'string' ? rawItem.type : undefined,
          text: typeof rawItem.text === 'string' ? rawItem.text : undefined,
          command:
            typeof rawItem.command === 'string'
              ? rawItem.command
              : undefined,
          status:
            typeof rawItem.status === 'string' ? rawItem.status : undefined,
          exitCode:
            typeof rawItem.exit_code === 'number'
              ? rawItem.exit_code
              : undefined,
          aggregatedOutput:
            typeof rawItem.aggregated_output === 'string'
              ? rawItem.aggregated_output
              : undefined,
          changes: rawChanges
        }
      : undefined,
    usage: rawUsage
      ? {
          input_tokens:
            typeof rawUsage.input_tokens === 'number'
              ? rawUsage.input_tokens
              : undefined,
          cached_input_tokens:
            typeof rawUsage.cached_input_tokens === 'number'
              ? rawUsage.cached_input_tokens
              : undefined,
          output_tokens:
            typeof rawUsage.output_tokens === 'number'
              ? rawUsage.output_tokens
              : undefined,
          reasoning_output_tokens:
            typeof rawUsage.reasoning_output_tokens === 'number'
              ? rawUsage.reasoning_output_tokens
              : undefined
        }
      : undefined
  }
}

export interface CodexAgentStartOptions {
  executable: string
  projectRoot: string
  prompt: string
  mode: AgentRunMode
  onEvent: (event: Omit<AgentStreamEvent, 'runId'>) => void
  onSpawnError: (error: Error) => void
  onClose: (info: {
    exitCode: number | null
    completed: boolean
    cancelled: boolean
    stderr: string
  }) => void
}

export class CodexAgentProcess {
  readonly child: ChildProcessWithoutNullStreams
  private stdoutBuffer = ''
  private stderrTail = ''
  private completed = false
  private cancelled = false

  constructor(options: CodexAgentStartOptions) {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
    delete environment.ELECTRON_RUN_AS_NODE
    environment.NO_COLOR = '1'

    this.child = spawn(
      options.executable,
      [
        'exec',
        '--json',
        '--sandbox',
        options.mode,
        '--skip-git-repo-check',
        '--color',
        'never',
        '--cd',
        options.projectRoot,
        '-'
      ],
      {
        cwd: options.projectRoot,
        env: environment,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8')
      let newlineIndex = this.stdoutBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = this.stdoutBuffer.slice(0, newlineIndex)
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
        this.handleLine(line, options.onEvent)
        newlineIndex = this.stdoutBuffer.indexOf('\n')
      }
    })
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(
        -8000
      )
    })
    this.child.on('error', options.onSpawnError)
    this.child.on('close', (exitCode) => {
      if (this.stdoutBuffer.trim()) {
        this.handleLine(this.stdoutBuffer, options.onEvent)
        this.stdoutBuffer = ''
      }
      options.onClose({
        exitCode,
        completed: this.completed,
        cancelled: this.cancelled,
        stderr: this.stderrTail
      })
    })
    this.child.stdin.end(options.prompt)
  }

  private handleLine(
    line: string,
    onEvent: CodexAgentStartOptions['onEvent']
  ): void {
    const event = parseCodexOutputLine(line)
    if (!event) {
      return
    }
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      this.completed = true
    }
    onEvent(event)
  }

  cancel(): void {
    this.cancelled = true
    try {
      this.child.kill()
    } catch {
      // The process may already have exited.
    }
  }
}
