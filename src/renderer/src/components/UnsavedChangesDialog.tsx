import { useEffect } from 'react'

interface UnsavedChangesDialogProps {
  fileName: string
  busy: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

function UnsavedChangesDialog({
  fileName,
  busy,
  onSave,
  onDiscard,
  onCancel
}: UnsavedChangesDialogProps): React.JSX.Element {
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
    <div className="unsaved-backdrop" role="presentation">
      <section
        className="unsaved-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-dialog-title"
      >
        <div className="unsaved-icon" aria-hidden="true">
          !
        </div>
        <div className="unsaved-copy">
          <h2 id="unsaved-dialog-title">是否保存对“{fileName}”的更改？</h2>
          <p>如果不保存，刚才的修改将会丢失。</p>
        </div>
        <div className="unsaved-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button type="button" disabled={busy} onClick={onDiscard}>
            不保存
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={onSave}
          >
            {busy ? '正在保存…' : '保存'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default UnsavedChangesDialog
