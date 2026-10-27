import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DiagnosticsResult,
  ProjectDiagnostic
} from '../../../shared/desktop'

interface ProblemsPanelProps {
  visible: boolean
  refreshToken: number
  externalDiagnostics?: ProjectDiagnostic[]
  onCountChange: (count: number) => void
  onOpenDiagnostic: (diagnostic: ProjectDiagnostic) => void
  onAskAgent: (diagnostics: ProjectDiagnostic[]) => void
}

function ProblemsPanel({
  visible,
  refreshToken,
  externalDiagnostics = [],
  onCountChange,
  onOpenDiagnostic,
  onAskAgent
}: ProblemsPanelProps): React.JSX.Element {
  const [result, setResult] = useState<DiagnosticsResult | null>(null)
  const [command, setCommand] = useState('')
  const [draftCommand, setDraftCommand] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [savingCommand, setSavingCommand] = useState(false)
  const lastRefreshToken = useRef(-1)

  useEffect(() => {
    if (!window.desktop) {
      return
    }
    void window.desktop.getDiagnosticsCommand().then((nextCommand) => {
      setCommand(nextCommand)
      setDraftCommand(nextCommand)
    })
  }, [])

  const runDiagnostics = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    setResult({
      command,
      state: 'running',
      items: [],
      updatedAt: null
    })
    const nextResult = await window.desktop.runProjectDiagnostics()
    setResult(nextResult)
    setCommand(nextResult.command)
    setDraftCommand(nextResult.command)
  }, [command])

  useEffect(() => {
    if (!visible || lastRefreshToken.current === refreshToken) {
      return
    }
    lastRefreshToken.current = refreshToken
    void runDiagnostics()
  }, [refreshToken, runDiagnostics, visible])

  useEffect(() => {
    onCountChange((result?.items.length ?? 0) + externalDiagnostics.length)
  }, [externalDiagnostics.length, onCountChange, result?.items.length])

  const saveCommand = async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    setSavingCommand(true)
    try {
      await window.desktop.saveDiagnosticsCommand(draftCommand)
      const nextCommand = await window.desktop.getDiagnosticsCommand()
      setCommand(nextCommand)
      setDraftCommand(nextCommand)
      setShowSettings(false)
      await runDiagnostics()
    } finally {
      setSavingCommand(false)
    }
  }

  const allItems = [
    ...externalDiagnostics,
    ...(result?.items ?? [])
  ]
  const errors = allItems.filter((item) => item.severity === 'error').length
  const warnings = allItems.filter(
    (item) => item.severity === 'warning'
  ).length

  return (
    <div className="problems-panel">
      <div className="problems-summary">
        <div>
          <span className="eyebrow">诊断</span>
          <strong>
            {errors} 错误 · {warnings} 警告
          </strong>
        </div>
        <div className="problems-actions">
          <button
            type="button"
            title="诊断命令设置"
            onClick={() => setShowSettings((current) => !current)}
          >
            ⚙
          </button>
          <button
            type="button"
            title="重新运行诊断"
            disabled={result?.state === 'running'}
            onClick={() => void runDiagnostics()}
          >
            ↻
          </button>
        </div>
      </div>

      {showSettings ? (
        <div className="problems-settings">
          <label htmlFor={`diagnostics-command-${refreshToken}`}>
            项目诊断命令
          </label>
          <input
            id={`diagnostics-command-${refreshToken}`}
            value={draftCommand}
            placeholder="例如 npx --no-install tsc --noEmit --pretty false"
            spellCheck={false}
            onChange={(event) => setDraftCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void saveCommand()
              }
            }}
          />
          <button
            type="button"
            disabled={savingCommand}
            onClick={() => void saveCommand()}
          >
            保存并运行
          </button>
        </div>
      ) : null}

      {result?.state === 'running' ? (
        <div className="problems-running">
          <span />
          正在运行项目诊断…
        </div>
      ) : result?.state === 'error' ? (
        <div className="problems-message error">
          <strong>诊断命令执行失败</strong>
          <p>{result.error}</p>
        </div>
      ) : allItems.length ? (
        <>
          <div className="problems-list">
            {allItems.map((diagnostic, index) => (
              <div
                className={`problem-row ${diagnostic.severity}`}
                key={`${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.code ?? ''}:${diagnostic.message}:${index}`}
              >
                <button
                  className="problem-main"
                  type="button"
                  title="打开代码位置"
                  onClick={() => onOpenDiagnostic(diagnostic)}
                >
                  <span className="problem-severity">
                    {diagnostic.severity === 'error'
                      ? '×'
                      : diagnostic.severity === 'warning'
                        ? '!'
                        : 'i'}
                  </span>
                  <span className="problem-copy">
                    <strong>{diagnostic.message}</strong>
                    <small>
                      {diagnostic.file}:{diagnostic.line}:{diagnostic.column}
                      {diagnostic.code ? ` · ${diagnostic.code}` : ''}
                    </small>
                  </span>
                </button>
                <button
                  className="problem-agent-button"
                  type="button"
                  title="让 Agent 修复这个问题"
                  onClick={() => onAskAgent([diagnostic])}
                >
                  A
                </button>
              </div>
            ))}
          </div>
          <div className="problems-footer">
            <span>{allItems.length} 个问题</span>
            <button type="button" onClick={() => onAskAgent(allItems)}>
              让 Agent 修复
            </button>
          </div>
        </>
      ) : (
        <div className="problems-empty">
          <div className="problems-empty-icon">✓</div>
          <strong>{result ? '没有发现问题' : '尚未运行诊断'}</strong>
          <p>
            {result
              ? '当前诊断命令没有返回错误或警告。'
              : '点击右上角刷新按钮运行项目诊断。'}
          </p>
        </div>
      )}
    </div>
  )
}

export default ProblemsPanel
