import type {
  DebuggerSnapshot,
  DebugStackFrame,
  MemoryMetrics,
  ProjectDiagnostic
} from '../../../shared/desktop'
import DiagnosticToolsPanel, {
  type DiagnosticEvent,
  type DiagnosticMetricSample
} from './DiagnosticToolsPanel'
import ErrorListPanel from './ErrorListPanel'

export type BottomToolTab =
  | 'output'
  | 'console'
  | 'stack'
  | 'memory'
  | 'errors'
  | 'diagnostics'

interface OutputEntry {
  id: number
  time: string
  message: string
}

interface BottomPanelContentProps {
  tab: BottomToolTab
  outputEntries: OutputEntry[]
  consoleEntries: string[]
  debugCommand: string
  projectName: string
  activeFilePath: string | null
  errorListItems: ProjectDiagnostic[]
  projectDiagnosticsRunning: boolean
  projectDiagnosticsError: string
  diagnosticSamples: DiagnosticMetricSample[]
  diagnosticEvents: DiagnosticEvent[]
  memoryMetrics: MemoryMetrics | null
  debuggerSnapshot: DebuggerSnapshot
  onClearOutput: () => void
  onClearConsole: () => void
  onDebugCommandChange: (value: string) => void
  onRunDebugConsoleCommand: () => void
  onRunDiagnostics: () => void
  onOpenDiagnostic: (diagnostic: ProjectDiagnostic) => void
  onAskAgent: (diagnostics: ProjectDiagnostic[]) => void
  onControlDebugger: (
    action:
      | 'continue'
      | 'pause'
      | 'step-over'
      | 'step-in'
      | 'step-out'
      | 'stop'
  ) => void
  onStartDebug: () => void
  onOpenDebugFrame: (frame: DebugStackFrame) => void
}

function BottomPanelContent({
  tab,
  outputEntries,
  consoleEntries,
  debugCommand,
  projectName,
  activeFilePath,
  errorListItems,
  projectDiagnosticsRunning,
  projectDiagnosticsError,
  diagnosticSamples,
  diagnosticEvents,
  memoryMetrics,
  debuggerSnapshot,
  onClearOutput,
  onClearConsole,
  onDebugCommandChange,
  onRunDebugConsoleCommand,
  onRunDiagnostics,
  onOpenDiagnostic,
  onAskAgent,
  onControlDebugger,
  onStartDebug,
  onOpenDebugFrame
}: BottomPanelContentProps): React.JSX.Element | null {
  if (tab === 'output') {
    return (
      <div className="bottom-panel-content output-log">
        <div className="bottom-panel-toolbar">
          <span>AI IDE 输出</span>
          <button type="button" onClick={onClearOutput}>
            清空
          </button>
        </div>
        {outputEntries.length ? (
          outputEntries.map((entry) => (
            <div className="output-row" key={entry.id}>
              <span>{entry.time}</span>
              <p>{entry.message}</p>
            </div>
          ))
        ) : (
          <div className="bottom-panel-empty">
            构建、运行和操作信息会显示在这里。
          </div>
        )}
      </div>
    )
  }

  if (tab === 'console') {
    return (
      <div className="bottom-panel-content debug-console">
        <div className="bottom-panel-toolbar">
          <span>程序输出</span>
          <button type="button" onClick={onClearConsole}>
            清空
          </button>
        </div>
        <div className="debug-console-log">
          {consoleEntries.length ? (
            consoleEntries.map((entry, index) => (
              <div key={`${entry}-${index}`}>{entry}</div>
            ))
          ) : (
            <div className="debug-console-empty">等待程序输出…</div>
          )}
        </div>
        <form
          className="debug-console-input"
          onSubmit={(event) => {
            event.preventDefault()
            onRunDebugConsoleCommand()
          }}
        >
          <span>›</span>
          <input
            value={debugCommand}
            placeholder='输入调试表达式或 help 查看可用命令'
            spellCheck={false}
            onChange={(event) => onDebugCommandChange(event.target.value)}
          />
        </form>
      </div>
    )
  }

  if (tab === 'errors') {
    return (
      <ErrorListPanel
        items={errorListItems}
        projectName={projectName}
        activeFilePath={activeFilePath}
        running={projectDiagnosticsRunning}
        error={projectDiagnosticsError}
        onRunDiagnostics={onRunDiagnostics}
        onOpenDiagnostic={onOpenDiagnostic}
        onAskAgent={onAskAgent}
      />
    )
  }

  if (tab === 'diagnostics') {
    return (
      <DiagnosticToolsPanel
        samples={diagnosticSamples}
        processes={memoryMetrics?.processes ?? []}
        debuggerState={debuggerSnapshot.state}
        debuggerMessage={debuggerSnapshot.message}
        events={diagnosticEvents}
      />
    )
  }

  if (tab === 'stack') {
    return (
      <div className="bottom-panel-content debug-stack-panel">
        <div className="bottom-panel-toolbar">
          <span>{debuggerSnapshot.message}</span>
          <div className="debug-controls">
            <button
              type="button"
              disabled={
                debuggerSnapshot.state === 'starting' ||
                debuggerSnapshot.state === 'running'
              }
              onClick={() => {
                if (debuggerSnapshot.state === 'paused') {
                  onControlDebugger('continue')
                } else {
                  onStartDebug()
                }
              }}
            >
              {debuggerSnapshot.state === 'paused' ? '继续' : '调试'}
            </button>
            <button
              type="button"
              disabled={debuggerSnapshot.state !== 'running'}
              onClick={() => onControlDebugger('pause')}
            >
              暂停
            </button>
            <button
              type="button"
              disabled={debuggerSnapshot.state !== 'paused'}
              onClick={() => onControlDebugger('step-over')}
            >
              跳过
            </button>
            <button
              type="button"
              disabled={debuggerSnapshot.state !== 'paused'}
              onClick={() => onControlDebugger('step-in')}
            >
              进入
            </button>
            <button
              type="button"
              disabled={debuggerSnapshot.state !== 'paused'}
              onClick={() => onControlDebugger('step-out')}
            >
              退出
            </button>
            <button
              type="button"
              disabled={
                debuggerSnapshot.state === 'idle' ||
                debuggerSnapshot.state === 'exited'
              }
              onClick={() => onControlDebugger('stop')}
            >
              {debuggerSnapshot.state === 'starting' ? '取消' : '停止'}
            </button>
          </div>
        </div>
        <div className="debug-details">
          <section className="debug-frames">
            <h3>调用堆栈</h3>
            {debuggerSnapshot.frames.length ? (
              debuggerSnapshot.frames.map((frame, index) => (
                <button
                  className={index === 0 ? 'active' : ''}
                  type="button"
                  key={frame.id}
                  onClick={() => onOpenDebugFrame(frame)}
                >
                  <strong>{frame.name}</strong>
                  <span>
                    {frame.source
                      ? `${frame.source.split(/[\\/]/).pop()}:${frame.line}`
                      : '<unknown>'}
                  </span>
                </button>
              ))
            ) : (
              <div className="bottom-panel-empty">
                <strong>
                  {debuggerSnapshot.state === 'idle'
                    ? '当前没有活动调试会话'
                    : debuggerSnapshot.state === 'paused'
                      ? '当前线程没有可用堆栈帧'
                      : '程序运行中'}
                </strong>
                <p>按 F5 调试当前 C/C++ 文件，在行号左侧点击红点设置断点。</p>
              </div>
            )}
          </section>
          <section className="debug-variables">
            <h3>
              局部变量
              {debuggerSnapshot.threads.length
                ? ` · ${debuggerSnapshot.threads.length} 个线程`
                : ''}
            </h3>
            {debuggerSnapshot.variables.length ? (
              debuggerSnapshot.variables.map((variable) => (
                <div
                  className="debug-variable-row"
                  key={`${variable.name}:${variable.variablesReference}`}
                >
                  <span>{variable.name}</span>
                  <strong>{variable.value}</strong>
                  {variable.type ? <small>{variable.type}</small> : null}
                </div>
              ))
            ) : (
              <div className="bottom-panel-empty">
                <p>暂停后显示当前栈帧的局部变量。</p>
              </div>
            )}
          </section>
        </div>
      </div>
    )
  }

  if (tab === 'memory') {
    return (
      <div className="bottom-panel-content memory-panel">
        <div className="memory-summary">
          <div>
            <span>系统可用</span>
            <strong>
              {memoryMetrics
                ? `${memoryMetrics.freeMemoryMB} MB / ${memoryMetrics.totalMemoryMB} MB`
                : '读取中…'}
            </strong>
          </div>
          <div>
            <span>AI IDE 进程</span>
            <strong>
              {memoryMetrics
                ? `${memoryMetrics.processes
                    .reduce(
                      (total, process) => total + process.memoryMB,
                      0
                    )
                    .toFixed(1)} MB`
                : '—'}
            </strong>
          </div>
        </div>
        <div className="memory-process-list">
          {memoryMetrics?.processes.map((process) => (
            <div className="memory-process-row" key={process.pid}>
              <span>{process.type}</span>
              <span>PID {process.pid}</span>
              <strong>{process.memoryMB} MB</strong>
              <span>CPU {process.cpuPercent}%</span>
            </div>
          )) ?? (
            <div className="bottom-panel-empty">内存数据读取中…</div>
          )}
        </div>
      </div>
    )
  }

  return null
}

export default BottomPanelContent
