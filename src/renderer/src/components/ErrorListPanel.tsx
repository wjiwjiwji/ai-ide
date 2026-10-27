import { useMemo, useState } from 'react'
import type { ProjectDiagnostic } from '../../../shared/desktop'

interface ErrorListPanelProps {
  items: ProjectDiagnostic[]
  projectName: string
  activeFilePath: string | null
  running: boolean
  error: string
  onRunDiagnostics: () => void
  onOpenDiagnostic: (diagnostic: ProjectDiagnostic) => void
  onAskAgent: (diagnostics: ProjectDiagnostic[]) => void
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function ErrorListPanel({
  items,
  projectName,
  activeFilePath,
  running,
  error,
  onRunDiagnostics,
  onOpenDiagnostic,
  onAskAgent
}: ErrorListPanelProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'project' | 'current'>('project')
  const [severity, setSeverity] = useState<
    'all' | 'error' | 'warning' | 'info'
  >('all')

  const counts = useMemo(
    () => ({
      errors: items.filter((item) => item.severity === 'error').length,
      warnings: items.filter((item) => item.severity === 'warning').length,
      info: items.filter((item) => item.severity === 'info').length
    }),
    [items]
  )
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return items.filter((item) => {
      if (scope === 'current' && item.file !== activeFilePath) {
        return false
      }
      if (severity !== 'all' && item.severity !== severity) {
        return false
      }
      return (
        !normalizedQuery ||
        `${item.message} ${item.code ?? ''} ${item.file}`
          .toLowerCase()
          .includes(normalizedQuery)
      )
    })
  }, [activeFilePath, items, query, scope, severity])

  return (
    <div className="error-list-panel">
      <div className="error-list-toolbar">
        <select
          value={scope}
          aria-label="错误列表范围"
          onChange={(event) =>
            setScope(event.target.value as 'project' | 'current')
          }
        >
          <option value="project">整个项目</option>
          <option value="current">当前文件</option>
        </select>
        <div className="error-list-counts">
          <button
            className={severity === 'error' ? 'active error' : 'error'}
            type="button"
            onClick={() =>
              setSeverity((current) =>
                current === 'error' ? 'all' : 'error'
              )
            }
          >
            <span>×</span> 错误 {counts.errors}
          </button>
          <button
            className={severity === 'warning' ? 'active warning' : 'warning'}
            type="button"
            onClick={() =>
              setSeverity((current) =>
                current === 'warning' ? 'all' : 'warning'
              )
            }
          >
            <span>!</span> 警告 {counts.warnings}
          </button>
          <button
            className={severity === 'info' ? 'active info' : 'info'}
            type="button"
            onClick={() =>
              setSeverity((current) =>
                current === 'info' ? 'all' : 'info'
              )
            }
          >
            <span>i</span> 信息 {counts.info}
          </button>
        </div>
        <button
          className="error-list-run"
          type="button"
          disabled={running}
          onClick={onRunDiagnostics}
        >
          {running ? '正在生成…' : '运行诊断'}
        </button>
        <label className="error-list-search">
          <span>⌕</span>
          <input
            value={query}
            aria-label="搜索错误列表"
            placeholder="搜索错误列表"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {error ? <div className="error-list-message">{error}</div> : null}

      <div className="error-list-table">
        <div className="error-list-head" role="row">
          <span />
          <span>代码</span>
          <span>说明</span>
          <span>项目</span>
          <span>文件</span>
          <span>行</span>
        </div>
        <div className="error-list-rows">
          {visibleItems.length ? (
            visibleItems.map((item, index) => (
              <button
                className={`error-list-row ${item.severity}`}
                type="button"
                key={`${item.file}:${item.line}:${item.column}:${item.code ?? ''}:${item.message}:${index}`}
                title={`${item.file}:${item.line}:${item.column}`}
                onClick={() => onOpenDiagnostic(item)}
              >
                <span className="error-list-glyph">
                  {item.severity === 'error'
                    ? '×'
                    : item.severity === 'warning'
                      ? '!'
                      : 'i'}
                </span>
                <code>{item.code ?? '—'}</code>
                <strong>{item.message}</strong>
                <span>{projectName}</span>
                <span>{fileName(item.file)}</span>
                <span>{item.line}</span>
              </button>
            ))
          ) : (
            <div className="error-list-empty">
              <span>✓</span>
              <strong>{running ? '正在生成错误列表…' : '未找到相关问题'}</strong>
              <p>
                {items.length
                  ? '当前筛选条件下没有诊断项。'
                  : '编译、保存代码或运行诊断后，错误和警告会显示在这里。'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="error-list-footer">
        <span>
          显示 {visibleItems.length} / {items.length} 个问题
        </span>
        <button
          type="button"
          disabled={!visibleItems.length}
          onClick={() => onAskAgent(visibleItems)}
        >
          让 Agent 修复当前列表
        </button>
      </div>
    </div>
  )
}

export default ErrorListPanel
