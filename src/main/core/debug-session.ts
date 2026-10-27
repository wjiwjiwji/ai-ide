import { EventEmitter } from 'node:events'
import type {
  DebugBreakpoint,
  DebugStackFrame,
  DebugThread,
  DebugVariable,
  DebuggerSnapshot
} from '../../shared/desktop'
import { DapClient, type DapMessage } from './dap-client'

interface DebugStartInput {
  adapterPath: string
  adapterCwd: string
  gdbPath: string
  program: string
  cwd: string
  breakpoints: DebugBreakpoint[]
  buildOutput?: string
}

const initialSnapshot: DebuggerSnapshot = {
  state: 'idle',
  message: '未启动调试会话。',
  frames: [],
  variables: [],
  threads: [],
  programOutput: [],
  output: []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

export function debugOutputTarget(
  category: unknown
): 'program' | 'diagnostics' {
  return category === 'stdout' || category === 'stderr'
    ? 'program'
    : 'diagnostics'
}

function isGdbConsoleLine(line: string): boolean {
  const value = line.trim()
  return (
    /^=thread-group-/.test(value) ||
    /^=cmd-param-changed,/.test(value) ||
    /^=breakpoint-/.test(value) ||
    /^~"/.test(value) ||
    /^GNU gdb \(GDB\)/.test(value) ||
    /^Copyright \(C\).*Free Software Foundation/.test(value) ||
    /^License GPLv3\+:/.test(value) ||
    /^This is free software;/.test(value) ||
    /^There is NO WARRANTY/.test(value) ||
    /^Type "show /.test(value) ||
    /^This GDB was configured as/.test(value) ||
    /^For bug reporting instructions/.test(value) ||
    /^Find the GDB manual online/.test(value) ||
    /^For help, type /.test(value) ||
    /^Type "apropos /.test(value) ||
    /^Warning: Debuggee TargetArchitecture/.test(value) ||
    /^\[New Thread /.test(value) ||
    /^\[Thread .* exited with code /.test(value) ||
    /^\[Inferior .* exited /.test(value) ||
    /^Thread \d+ hit Breakpoint /.test(value) ||
    /^#\d+\s+/.test(value) ||
    /^\+-+\+$/.test(value) ||
    /^\|.*\|$/.test(value)
  )
}

function localizeDebugLine(line: string): string | null {
  const value = line.trim()
  if (
    /^GNU gdb \(GDB\)/.test(value) ||
    /^Copyright \(C\).*Free Software Foundation/.test(value) ||
    /^License GPLv3\+:/.test(value) ||
    /^This is free software;/.test(value) ||
    /^There is NO WARRANTY/.test(value) ||
    /^Type "show/.test(value) ||
    /^Type "apropos/.test(value) ||
    /^This GDB was configured as/.test(value) ||
    /^For bug reporting instructions/.test(value) ||
    /^<https?:\/\/www\.gnu\.org\/software\/gdb/.test(value) ||
    /^Find the GDB manual online/.test(value) ||
    /^For help, type/.test(value) ||
    /^set auto-load safe-path\b/.test(value) ||
    /^line to your configuration file/.test(value)
  ) {
    return null
  }

  let match = /^Loaded '([^']+)'\. Symbols loaded\.$/.exec(value)
  if (match) {
    return `已加载“${match[1]}”，符号已加载。`
  }
  match = /^Loaded '([^']+)'\.$/.exec(value)
  if (match) {
    return `已加载“${match[1]}”。`
  }
  match = /^\[New Thread ([^\] ]+)(?: \(id (\d+)\))?\]$/.exec(value)
  if (match) {
    return match[2]
      ? `[新线程 ${match[1]}（ID ${match[2]}）]`
      : `[新线程 ${match[1]}]`
  }
  match =
    /^\[Thread ([^\] ]+)(?: \(id (\d+)\))? exited with code ([-\d]+)\]$/.exec(
      value
    )
  if (match) {
    return match[2]
      ? `[线程 ${match[1]}（ID ${match[2]}）已退出，退出代码 ${match[3]}]`
      : `[线程 ${match[1]} 已退出，退出代码 ${match[3]}]`
  }
  match =
    /^\[Inferior (\d+)(?: \(process (\d+)\))? exited normally\]$/.exec(value)
  if (match) {
    return match[2]
      ? `[调试目标 ${match[1]}（进程 ${match[2]}）已正常退出]`
      : `[调试目标 ${match[1]} 已正常退出]`
  }
  match =
    /^The program '([^']+)' has exited with code ([-\d]+) \(0x[0-9a-f]+\)\.$/i.exec(
      value
    )
  if (match) {
    return `程序“${match[1]}”已退出，退出代码 ${match[2]}。`
  }
  match =
    /^Thread (\d+) hit Breakpoint (\d+), (.*?) at (.+)$/.exec(value)
  if (match) {
    return `线程 ${match[1]} 命中断点 ${match[2]}，${match[3]} 位于 ${match[4]}`
  }
  if (value === 'VS/Diagnostics/Debugger/DebugCompleted') {
    return '调试完成。'
  }
  if (value === 'VS/Diagnostics/Debugger/DebugStarted') {
    return '调试已启动。'
  }
  if (/^Warning: Debuggee TargetArchitecture not detected/.test(value)) {
    return '警告：未检测到调试目标的 CPU 架构，已按 x86_64 处理。'
  }
  return line
}

export function localizeDebugDiagnostics(text: string): string {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const localized = lines.flatMap((line) => {
    const newline = line.endsWith('\n') ? '\n' : ''
    const value = localizeDebugLine(line.slice(0, line.length - newline.length))
    return value ? [`${value}${newline}`] : []
  })
  return localized.join('').replace(/\n{3,}/g, '\n\n')
}

export function routeDebugOutput(
  category: unknown,
  text: string
): {
  programOutput: string
  diagnosticsOutput: string
} {
  if (debugOutputTarget(category) === 'diagnostics') {
    return {
      programOutput: '',
      diagnosticsOutput: localizeDebugDiagnostics(text)
    }
  }
  if (
    /To enable execution of this file add/.test(text) ||
    /To completely disable this security protection/.test(text) ||
    /add-auto-load-safe-path/.test(text) ||
    /Auto-loading safe path/.test(text)
  ) {
    return {
      programOutput: '',
      diagnosticsOutput: localizeDebugDiagnostics(text)
    }
  }
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [text]
  let programOutput = ''
  let diagnosticsOutput = ''
  let followsBreakpointLocation = false
  let previousLineWasGdb = false
  for (const line of lines) {
    const value = line.trim()
    if (!value && previousLineWasGdb) {
      diagnosticsOutput += line
      continue
    }
    if (/^Thread \d+ hit Breakpoint /.test(value)) {
      followsBreakpointLocation = true
      diagnosticsOutput += line
      previousLineWasGdb = true
    } else if (
      followsBreakpointLocation &&
      /^\d+\s+/.test(value)
    ) {
      followsBreakpointLocation = false
      diagnosticsOutput += line
      previousLineWasGdb = true
    } else if (isGdbConsoleLine(line)) {
      diagnosticsOutput += line
      previousLineWasGdb = true
    } else {
      programOutput += line
      previousLineWasGdb = false
    }
  }
  return {
    programOutput,
    diagnosticsOutput: localizeDebugDiagnostics(diagnosticsOutput)
  }
}

export class DebugSession extends EventEmitter {
  private client = new DapClient()
  private snapshot: DebuggerSnapshot = { ...initialSnapshot }
  private frameId: number | null = null
  private breakpoints: DebugBreakpoint[] = []
  private disposed = false

  getSnapshot(): DebuggerSnapshot {
    return {
      ...this.snapshot,
      frames: this.snapshot.frames.map((frame) => ({ ...frame })),
      variables: this.snapshot.variables.map((variable) => ({
        ...variable
      })),
      threads: this.snapshot.threads.map((thread) => ({ ...thread })),
      programOutput: [...this.snapshot.programOutput],
      output: [...this.snapshot.output]
    }
  }

  async start(input: DebugStartInput): Promise<DebuggerSnapshot> {
    this.breakpoints = input.breakpoints.map((breakpoint) => ({
      ...breakpoint
    }))
    this.update({
      state: 'starting',
      message: '正在启动调试器…',
      programOutput: [],
      output: [
        ...(input.buildOutput ? [input.buildOutput] : []),
        '正在启动调试器…'
      ]
    })
    this.attachEvents()
    this.client.start(
      input.adapterPath,
      [],
      input.adapterCwd,
      {
        ...process.env,
        PATH: [
          input.adapterCwd,
          input.gdbPath.replace(/[\\/][^\\/]+$/, ''),
          process.env.PATH ?? ''
        ].join(';')
      }
    )

    await this.client.request('initialize', {
      clientID: 'ai-ide',
      clientName: 'AI IDE',
      adapterID: 'cppdbg',
      locale: 'zh-CN',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: false
    })

    const initializedEvent = this.waitForEvent('initialized', 15_000)
    const launchResponse = this.client.request(
      'launch',
      {
        type: 'cppdbg',
        request: 'launch',
        name: 'AI IDE Debug',
        program: input.program,
        args: [],
        cwd: input.cwd,
        environment: [],
        externalConsole: false,
        MIMode: 'gdb',
        miDebuggerPath: input.gdbPath,
        stopAtEntry: false,
        setupCommands: [
          {
            text: '-enable-pretty-printing',
            description: 'Enable GDB pretty printing',
            ignoreFailures: true
          }
        ],
        logging: {
          engineLogging: false,
          programOutput: true,
          exceptions: true
        }
      },
      60_000
    )
    await initializedEvent
    await this.sendBreakpoints(this.breakpoints)
    await this.client.request('configurationDone')
    await launchResponse
    return this.getSnapshot()
  }

  async setBreakpoints(breakpoints: DebugBreakpoint[]): Promise<void> {
    this.breakpoints = breakpoints.map((breakpoint) => ({ ...breakpoint }))
    if (this.snapshot.state !== 'idle' && this.snapshot.state !== 'exited') {
      await this.sendBreakpoints(this.breakpoints)
    }
  }

  async control(
    action:
      | 'continue'
      | 'pause'
      | 'step-over'
      | 'step-in'
      | 'step-out'
      | 'stop'
  ): Promise<void> {
    if (action === 'stop') {
      await this.client
        .request('disconnect', { terminateDebuggee: true })
        .catch(() => undefined)
      this.client.stop()
      this.update({
        state: 'exited',
        message: '调试会话已停止。',
        frames: [],
        variables: []
      })
      return
    }
    if (this.snapshot.state === 'idle' || this.snapshot.state === 'exited') {
      throw new Error('没有活动调试会话。')
    }
    const threadId = this.snapshot.threads[0]?.id ?? 1
    const command =
      action === 'continue'
        ? 'continue'
        : action === 'pause'
          ? 'pause'
          : action === 'step-over'
            ? 'next'
            : action === 'step-in'
              ? 'stepIn'
              : 'stepOut'
    await this.client.request(command, { threadId })
    if (command === 'continue' || command.startsWith('step')) {
      this.update({
        state: 'running',
        message: command === 'continue' ? '程序正在运行。' : '正在单步执行。',
        frames: [],
        variables: []
      })
    }
  }

  async evaluate(expression: string): Promise<string> {
    const response = await this.client.request('evaluate', {
      expression,
      frameId: this.frameId ?? undefined,
      context: 'repl'
    })
    const body = asRecord(response.body)
    return typeof body.result === 'string' ? body.result : ''
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.client.stop()
  }

  private attachEvents(): void {
    this.client.on('event', (event: string, body: unknown) => {
      if (event === 'output') {
        const output = asRecord(body)
        const text = typeof output.output === 'string' ? output.output : ''
        if (text) {
          const routed = routeDebugOutput(output.category, text)
          if (routed.programOutput) {
            this.update({
              programOutput: [
                ...this.snapshot.programOutput.slice(-999),
                routed.programOutput
              ]
            })
          }
          if (routed.diagnosticsOutput) {
            this.update({
              output: [
                ...this.snapshot.output.slice(-499),
                routed.diagnosticsOutput
              ]
            })
          }
        }
        return
      }
      if (event === 'continued') {
        this.update({
          state: 'running',
          message: '程序继续运行。',
          frames: [],
          variables: []
        })
        return
      }
      if (event === 'stopped') {
        const stopped = asRecord(body)
        const reason =
          typeof stopped.reason === 'string' ? stopped.reason : 'breakpoint'
        void this.captureStoppedState(
          typeof stopped.threadId === 'number' ? stopped.threadId : 1,
          reason
        )
        return
      }
      if (event === 'terminated' || event === 'exited') {
        this.update({
          state: 'exited',
          message: '调试目标已退出。',
          frames: [],
          variables: []
        })
      }
    })
    this.client.on('stderr', (text: string) => {
      if (text.trim()) {
        this.update({
          output: [
            ...this.snapshot.output.slice(-499),
            localizeDebugDiagnostics(text)
          ].filter(Boolean)
        })
      }
    })
    this.client.on('exit', () => {
      if (!this.disposed && this.snapshot.state !== 'exited') {
        this.update({
          state: 'exited',
          message: '调试适配器已退出。',
          frames: [],
          variables: []
        })
      }
    })
    this.client.on('error', (error: Error) => {
      this.update({
        state: 'error',
        message: `调试器错误：${error.message}`
      })
    })
  }

  private async sendBreakpoints(
    breakpoints: DebugBreakpoint[]
  ): Promise<void> {
    const byFile = new Map<string, DebugBreakpoint[]>()
    for (const breakpoint of breakpoints) {
      const entries = byFile.get(breakpoint.path) ?? []
      entries.push(breakpoint)
      byFile.set(breakpoint.path, entries)
    }
    for (const [path, entries] of byFile) {
      await this.client.request('setBreakpoints', {
        source: { path },
        breakpoints: entries.map((entry) => ({ line: entry.line }))
      })
    }
  }

  private async captureStoppedState(
    threadId: number,
    reason: string
  ): Promise<void> {
    try {
      const threadsResponse = await this.client.request('threads')
      const threadsBody = asRecord(threadsResponse.body)
      const threads = (
        Array.isArray(threadsBody.threads) ? threadsBody.threads : []
      ).map((thread) => {
        const item = asRecord(thread)
        return {
          id: Number(item.id ?? 0),
          name: String(item.name ?? 'Thread')
        } satisfies DebugThread
      })
      const stackResponse = await this.client.request('stackTrace', {
        threadId,
        startFrame: 0,
        levels: 30
      })
      const stackBody = asRecord(stackResponse.body)
      const frames = (
        Array.isArray(stackBody.stackFrames)
          ? stackBody.stackFrames
          : []
      ).map((frame) => {
        const item = asRecord(frame)
        const source = asRecord(item.source)
        return {
          id: Number(item.id ?? 0),
          name: String(item.name ?? '<unknown>'),
          source: typeof source.path === 'string' ? source.path : null,
          line: Number(item.line ?? 1),
          column: Number(item.column ?? 1)
        } satisfies DebugStackFrame
      })
      this.frameId = frames[0]?.id ?? null
      let variables: DebugVariable[] = []
      if (this.frameId !== null) {
        const scopesResponse = await this.client.request('scopes', {
          frameId: this.frameId
        })
        const scopesBody = asRecord(scopesResponse.body)
        const scopes = Array.isArray(scopesBody.scopes)
          ? scopesBody.scopes
          : []
        const localScope =
          scopes.find((scope) => {
            const name = String(asRecord(scope).name ?? '')
            return /local/i.test(name)
          }) ?? scopes[0]
        const variablesReference = Number(
          asRecord(localScope).variablesReference ?? 0
        )
        if (variablesReference > 0) {
          const variablesResponse = await this.client.request('variables', {
            variablesReference
          })
          const variablesBody = asRecord(variablesResponse.body)
          variables = (
            Array.isArray(variablesBody.variables)
              ? variablesBody.variables
              : []
          ).map((variable) => {
            const item = asRecord(variable)
            return {
              name: String(item.name ?? ''),
              value: String(item.value ?? ''),
              type:
                typeof item.type === 'string' ? item.type : null,
              variablesReference: Number(item.variablesReference ?? 0)
            }
          })
        }
      }
      this.update({
        state: 'paused',
        message: `已暂停：${reason}`,
        threads,
        frames,
        variables
      })
    } catch (error) {
      this.update({
        state: 'paused',
        message:
          error instanceof Error
            ? `已暂停，但读取调试状态失败：${error.message}`
            : '已暂停。'
      })
    }
  }

  private waitForEvent(event: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.client.removeListener(event, handleEvent)
        reject(new Error(`调试事件超时：${event}`))
      }, timeoutMs)
      const handleEvent = (body: unknown): void => {
        clearTimeout(timer)
        resolve(body)
      }
      this.client.once(event, handleEvent)
    })
  }

  private update(patch: Partial<DebuggerSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch
    }
    this.emit('snapshot', this.getSnapshot())
  }
}
