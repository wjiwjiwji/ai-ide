import { useState } from 'react'
import type { MemoryProcessMetric } from '../../../shared/desktop'

export interface DiagnosticMetricSample {
  timestamp: number
  cpuPercent: number
  memoryMB: number
}

export interface DiagnosticEvent {
  id: number
  time: string
  message: string
}

interface DiagnosticToolsPanelProps {
  samples: DiagnosticMetricSample[]
  processes: MemoryProcessMetric[]
  debuggerState: string
  debuggerMessage: string
  events: DiagnosticEvent[]
}

function chartPoints(
  samples: DiagnosticMetricSample[],
  key: 'cpuPercent' | 'memoryMB'
): string {
  if (samples.length === 0) {
    return ''
  }
  const values = samples.map((sample) => sample[key])
  const maximum = Math.max(...values, 1)
  return values
    .map((value, index) => {
      const x =
        values.length === 1 ? 50 : (index / (values.length - 1)) * 100
      const y = 34 - (value / maximum) * 28
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

function DiagnosticToolsPanel({
  samples,
  processes,
  debuggerState,
  debuggerMessage,
  events
}: DiagnosticToolsPanelProps): React.JSX.Element {
  const [view, setView] = useState<'events' | 'memory' | 'cpu'>('events')
  const latest = samples.at(-1)
  const memoryPoints = chartPoints(samples, 'memoryMB')
  const cpuPoints = chartPoints(samples, 'cpuPercent')

  return (
    <div className="diagnostic-tools-panel">
      <div className="diagnostic-tools-toolbar">
        <div>
          <span className={`diagnostic-state-dot ${debuggerState}`} />
          <strong>诊断工具</strong>
          <span>{debuggerMessage}</span>
        </div>
        <div className="diagnostic-current-values">
          <span>
            CPU <strong>{latest ? `${latest.cpuPercent.toFixed(1)}%` : '—'}</strong>
          </span>
          <span>
            内存{' '}
            <strong>{latest ? `${latest.memoryMB.toFixed(1)} MB` : '—'}</strong>
          </span>
        </div>
      </div>

      <div className="diagnostic-tools-tabs" role="tablist">
        <button
          className={view === 'events' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={view === 'events'}
          onClick={() => setView('events')}
        >
          事件
        </button>
        <button
          className={view === 'memory' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={view === 'memory'}
          onClick={() => setView('memory')}
        >
          内存使用率
        </button>
        <button
          className={view === 'cpu' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={view === 'cpu'}
          onClick={() => setView('cpu')}
        >
          CPU 使用率
        </button>
      </div>

      <div className="diagnostic-tools-body">
        {view === 'events' ? (
          <div className="diagnostic-event-list">
            {events.length ? (
              events.map((event) => (
                <div className="diagnostic-event-row" key={event.id}>
                  <time>{event.time}</time>
                  <span>{event.message}</span>
                </div>
              ))
            ) : (
              <div className="diagnostic-tools-empty">
                启动调试或执行诊断操作后，事件会显示在这里。
              </div>
            )}
          </div>
        ) : (
          <div className="diagnostic-metric-view">
            <div className="diagnostic-chart-card">
              <div>
                <span>{view === 'memory' ? '内存使用量' : 'CPU 使用率'}</span>
                <strong>
                  {latest
                    ? view === 'memory'
                      ? `${latest.memoryMB.toFixed(1)} MB`
                      : `${latest.cpuPercent.toFixed(1)}%`
                    : '等待采样'}
                </strong>
              </div>
              <svg
                viewBox="0 0 100 38"
                preserveAspectRatio="none"
                aria-label={
                  view === 'memory' ? '内存使用率曲线' : 'CPU 使用率曲线'
                }
              >
                <line x1="0" y1="34" x2="100" y2="34" />
                <polyline
                  className={view}
                  points={view === 'memory' ? memoryPoints : cpuPoints}
                />
              </svg>
            </div>
            <div className="diagnostic-process-table">
              <div className="diagnostic-process-head">
                <span>进程</span>
                <span>PID</span>
                <span>{view === 'memory' ? '内存' : 'CPU'}</span>
              </div>
              {processes.map((process) => (
                <div className="diagnostic-process-row" key={process.pid}>
                  <span>{process.type}</span>
                  <span>{process.pid}</span>
                  <strong>
                    {view === 'memory'
                      ? `${process.memoryMB} MB`
                      : `${process.cpuPercent}%`}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DiagnosticToolsPanel
