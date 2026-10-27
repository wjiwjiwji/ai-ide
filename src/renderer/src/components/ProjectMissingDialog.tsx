import { useEffect } from 'react'

interface ProjectMissingDialogProps {
  projectName: string
  projectPath: string
  busy: boolean
  error: string
  onOpenProject: () => void
  onCancel: () => void
}

function ProjectMissingDialog({
  projectName,
  projectPath,
  busy,
  error,
  onOpenProject,
  onCancel
}: ProjectMissingDialogProps): React.JSX.Element {
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
    <div className="project-missing-backdrop" role="presentation">
      <section
        className="project-missing-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="project-missing-title"
      >
        <div className="project-missing-icon" aria-hidden="true">
          !
        </div>
        <div className="project-missing-copy">
          <span className="eyebrow">项目不可用</span>
          <h2 id="project-missing-title">项目文件夹已丢失</h2>
          <p>
            “{projectName}”所在目录无法访问，可能已被删除、移动或重命名。
          </p>
          <code title={projectPath}>{projectPath}</code>
          {error ? <strong>{error}</strong> : null}
        </div>
        <div className="project-missing-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            取消并返回主界面
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={onOpenProject}
          >
            {busy ? '处理中…' : '打开新的项目'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default ProjectMissingDialog
