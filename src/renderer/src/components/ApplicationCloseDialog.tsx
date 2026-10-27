import { useEffect } from 'react'

interface DirtyFileSummary {
  name: string
  path: string
}

interface ApplicationCloseDialogProps {
  dirtyFiles: DirtyFileSummary[]
  busy: boolean
  error: string
  onSaveAll: () => void
  onDiscard: () => void
  onCancel: () => void
}

function ApplicationCloseDialog({
  dirtyFiles,
  busy,
  error,
  onSaveAll,
  onDiscard,
  onCancel
}: ApplicationCloseDialogProps): React.JSX.Element {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onCancel])

  return (
    <div className="application-close-backdrop" role="presentation">
      <section
        className="application-close-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="application-close-title"
      >
        <div className="unsaved-icon" aria-hidden="true">
          !
        </div>
        <div className="application-close-copy">
          <h2 id="application-close-title">有 {dirtyFiles.length} 个文件尚未保存</h2>
          <p>关闭 AI IDE 前是否保存所有更改？</p>
          <ul>
            {dirtyFiles.slice(0, 5).map((file) => (
              <li key={file.path} title={file.path}>
                {file.name}
              </li>
            ))}
          </ul>
          {dirtyFiles.length > 5 ? (
            <small>以及另外 {dirtyFiles.length - 5} 个文件</small>
          ) : null}
          {error ? <strong>{error}</strong> : null}
        </div>
        <div className="application-close-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button type="button" disabled={busy} onClick={onDiscard}>
            不保存并退出
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={onSaveAll}
          >
            {busy ? '正在保存…' : '保存全部并退出'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default ApplicationCloseDialog
