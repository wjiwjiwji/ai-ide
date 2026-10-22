import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import type { ProjectInfo } from '../../../shared/desktop'

interface TerminalPanelProps {
  project: ProjectInfo
  visible: boolean
  runCommand: string
  runRequest: number
  onRunCommandChange: (command: string) => void
  onSaveRunCommand: (command: string) => Promise<void>
}

type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'

function TerminalPanel({
  project,
  visible,
  runCommand,
  runRequest,
  onRunCommandChange,
  onSaveRunCommand
}: TerminalPanelProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [status, setStatus] = useState<TerminalStatus>('starting')
  const [shellName, setShellName] = useState('shell')
  const [restartToken, setRestartToken] = useState(0)
  const [error, setError] = useState('')
  const lastRunRequestRef = useRef(0)
  const pendingRunRequestRef = useRef(false)

  useEffect(() => {
    if (!window.desktop || !hostRef.current) {
      return
    }

    const host = hostRef.current
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"Cascadia Code", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 6000,
      theme: {
        background: '#0a0d10',
        foreground: '#c8ceca',
        cursor: '#d8f36b',
        cursorAccent: '#0a0d10',
        selectionBackground: '#35452d',
        black: '#11161a',
        red: '#ff8d7e',
        green: '#b6d26e',
        yellow: '#e9c46a',
        blue: '#7db8d2',
        magenta: '#c59ad9',
        cyan: '#83cabf',
        white: '#d8ddda',
        brightBlack: '#59636a',
        brightRed: '#ffaa9f',
        brightGreen: '#d8f36b',
        brightYellow: '#f4d78b',
        brightBlue: '#9ed4e8',
        brightMagenta: '#d7b1e8',
        brightCyan: '#a2e5dc',
        brightWhite: '#f3f3ed'
      }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    setStatus('starting')
    setError('')

    const resizeObserver = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        fitAddon.fit()
      }
    })
    resizeObserver.observe(host)

    const removeDataListener = window.desktop.onTerminalData((event) => {
      if (event.sessionId === sessionIdRef.current) {
        terminal.write(event.data)
      }
    })
    const removeExitListener = window.desktop.onTerminalExit((event) => {
      if (event.sessionId === sessionIdRef.current) {
        setStatus('exited')
        terminal.writeln(
          `\r\n\x1b[38;2;125;135;141m[shell exited with code ${event.exitCode}]\x1b[0m`
        )
      }
    })
    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current
      if (sessionId) {
        void window.desktop.writeTerminal(sessionId, data).catch(() => {
          setStatus('error')
        })
      }
    })
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const sessionId = sessionIdRef.current
      if (sessionId) {
        void window.desktop.resizeTerminal(sessionId, cols, rows)
      }
    })

    let disposed = false
    void (async () => {
      try {
        fitAddon.fit()
        const session = await window.desktop.createTerminal(
          terminal.cols,
          terminal.rows
        )

        if (disposed) {
          await window.desktop.killTerminal(session.id)
          return
        }

        sessionIdRef.current = session.id
        setShellName(session.shell)
        setStatus('running')
        terminal.write(
          `\x1b[38;2;104;115;122mAI IDE terminal · ${project.name}\x1b[0m\r\n`
        )
        await window.desktop.writeTerminal(session.id, '\r')
      } catch (terminalError) {
        if (!disposed) {
          setStatus('error')
          setError(
            terminalError instanceof Error
              ? terminalError.message
              : '终端启动失败。'
          )
        }
      }
    })()

    return () => {
      disposed = true
      resizeObserver.disconnect()
      removeDataListener()
      removeExitListener()
      inputDisposable.dispose()
      resizeDisposable.dispose()

      const sessionId = sessionIdRef.current
      sessionIdRef.current = null
      if (sessionId) {
        void window.desktop.killTerminal(sessionId)
      }

      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      host.replaceChildren()
    }
  }, [project.name, project.path, restartToken])

  useEffect(() => {
    if (!visible) {
      return
    }

    const frame = requestAnimationFrame(() => {
      fitAddonRef.current?.fit()
      terminalRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [visible])

  const clearTerminal = (): void => {
    terminalRef.current?.clear()
  }

  const runCurrentCommand = async (): Promise<void> => {
    const command = runCommand.trim()
    const sessionId = sessionIdRef.current
    if (!command || !sessionId) {
      return
    }

    try {
      await onSaveRunCommand(command)
      await window.desktop.writeTerminal(sessionId, `${command}\r`)
      terminalRef.current?.focus()
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : '无法保存运行命令。'
      )
    }
  }

  useEffect(() => {
    if (runRequest > lastRunRequestRef.current) {
      lastRunRequestRef.current = runRequest
      pendingRunRequestRef.current = true
    }
    if (
      pendingRunRequestRef.current &&
      visible &&
      status === 'running'
    ) {
      pendingRunRequestRef.current = false
      void runCurrentCommand()
    }
  }, [runCommand, runRequest, status, visible])

  return (
    <div className="terminal-panel">
      <div className="terminal-panel-bar">
        <div className="terminal-name">
          <span className={`terminal-state-dot ${status}`} />
          <strong>{shellName}</strong>
        </div>
        <div className="terminal-actions">
          <button type="button" onClick={clearTerminal}>
            清空
          </button>
          <button
            type="button"
            onClick={() => setRestartToken((current) => current + 1)}
          >
            重启
          </button>
        </div>
      </div>

      <div className="run-command-row">
        <input
          value={runCommand}
          placeholder="运行命令，例如 npm run dev"
          spellCheck={false}
          onChange={(event) => onRunCommandChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void runCurrentCommand()
            }
          }}
        />
        <button
          className="run-command-button"
          type="button"
          disabled={!runCommand.trim() || status !== 'running'}
          onClick={() => void runCurrentCommand()}
        >
          运行
        </button>
      </div>

      {error ? <div className="terminal-error">{error}</div> : null}
      <div ref={hostRef} className="terminal-host" />
    </div>
  )
}

export default TerminalPanel
