import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'

export interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  event?: string
  request_seq?: number
  success?: boolean
  message?: string
  body?: unknown
}

export class DapMessageParser {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): DapMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: DapMessage[] = []
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) {
        break
      }
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const contentLength = /content-length:\s*(\d+)/i.exec(header)?.[1]
      if (!contentLength) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number(contentLength)
      if (!Number.isFinite(length) || length < 0) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const messageEnd = headerEnd + 4 + length
      if (this.buffer.length < messageEnd) {
        break
      }
      const payload = this.buffer
        .subarray(headerEnd + 4, messageEnd)
        .toString('utf8')
      this.buffer = this.buffer.subarray(messageEnd)
      try {
        messages.push(JSON.parse(payload) as DapMessage)
      } catch {
        // Ignore malformed adapter messages and continue with the next packet.
      }
    }
    return messages
  }
}

interface PendingRequest {
  resolve: (response: DapMessage) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class DapClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null
  private parser = new DapMessageParser()
  private sequence = 1
  private pending = new Map<number, PendingRequest>()

  start(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
    if (this.process) {
      throw new Error('调试适配器已经在运行。')
    }
    const process = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.process = process
    process.stdout.on('data', (chunk: Buffer) => {
      for (const message of this.parser.push(chunk)) {
        this.dispatch(message)
      }
    })
    process.stderr.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString('utf8'))
    })
    process.on('error', (error) => {
      this.failAll(error)
      this.emit('error', error)
    })
    process.on('exit', (code, signal) => {
      this.failAll(
        new Error(`调试适配器已退出：${code ?? signal ?? 'unknown'}`)
      )
      this.process = null
      this.emit('exit', code, signal)
    })
  }

  request(
    command: string,
    args: unknown = {},
    timeoutMs = 15_000
  ): Promise<DapMessage> {
    const process = this.process
    if (!process?.stdin.writable) {
      return Promise.reject(new Error('调试适配器未运行。'))
    }
    const seq = this.sequence++
    const payload = JSON.stringify({
      seq,
      type: 'request',
      command,
      arguments: args
    })
    const body = Buffer.from(payload, 'utf8')
    process.stdin.write(
      `Content-Length: ${body.length}\r\n\r\n${payload}`
    )
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq)
        reject(new Error(`调试器请求超时：${command}`))
      }, timeoutMs)
      timer.unref()
      this.pending.set(seq, { resolve, reject, timer })
    })
  }

  stop(): void {
    const process = this.process
    this.process = null
    this.failAll(new Error('调试会话已关闭。'))
    if (process && !process.killed) {
      process.kill()
    }
  }

  private dispatch(message: DapMessage): void {
    if (message.type === 'response') {
      const requestSeq = message.request_seq
      if (typeof requestSeq !== 'number') {
        return
      }
      const pending = this.pending.get(requestSeq)
      if (!pending) {
        return
      }
      clearTimeout(pending.timer)
      this.pending.delete(requestSeq)
      if (message.success === false) {
        pending.reject(new Error(message.message || '调试请求失败。'))
      } else {
        pending.resolve(message)
      }
      return
    }
    if (message.type === 'event' && message.event) {
      this.emit(message.event, message.body)
      this.emit('event', message.event, message.body)
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
