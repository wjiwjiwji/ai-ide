import { useEffect, useRef, useState } from 'react'
import {
  PROJECT_TEMPLATES,
  type CreateProjectInput,
  type ProjectTemplateId
} from '../../../shared/desktop'

interface NewProjectModalProps {
  onClose: () => void
  onCreate: (input: CreateProjectInput) => Promise<void>
}

function NewProjectModal({
  onClose,
  onCreate
}: NewProjectModalProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [template, setTemplate] =
    useState<ProjectTemplateId>('cpp-console')
  const [initializeGit, setInitializeGit] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    nameInputRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose])

  const chooseParent = async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    setError('')
    try {
      const selected = await window.desktop.chooseProjectParent()
      if (selected) {
        setParentPath(selected)
      }
    } catch (selectionError) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : '选择项目保存位置失败。'
      )
    }
  }

  const createProject = async (): Promise<void> => {
    if (!name.trim()) {
      setError('请输入项目名称。')
      return
    }
    if (!parentPath) {
      setError('请选择项目保存位置。')
      return
    }

    setBusy(true)
    setError('')
    try {
      await onCreate({ name, parentPath, template, initializeGit })
    } catch (creationError) {
      setError(
        creationError instanceof Error
          ? creationError.message
          : '新建项目失败。'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="new-project-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose()
        }
      }}
    >
      <section
        className="new-project-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
      >
        <header>
          <div>
            <span className="eyebrow">工作区</span>
            <h2 id="new-project-title">新建项目</h2>
          </div>
          <button
            type="button"
            className="new-project-close"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="new-project-body">
          <label htmlFor="new-project-name">项目名称</label>
          <input
            ref={nameInputRef}
            id="new-project-name"
            value={name}
            maxLength={80}
            placeholder="例如：my-app"
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void createProject()
              }
            }}
          />

          <label>项目模板</label>
          <div className="project-template-grid" role="radiogroup">
            {PROJECT_TEMPLATES.map((item) => (
              <button
                className={`project-template-card ${
                  template === item.id ? 'selected' : ''
                }`}
                type="button"
                role="radio"
                aria-checked={template === item.id}
                key={item.id}
                disabled={busy}
                onClick={() => setTemplate(item.id)}
              >
                <span className="project-template-badge">{item.badge}</span>
                <span className="project-template-copy">
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                <span className="project-template-language">
                  {item.language}
                </span>
              </button>
            ))}
          </div>

          <label htmlFor="new-project-location">保存位置</label>
          <div className="new-project-location">
            <input
              id="new-project-location"
              value={parentPath}
              readOnly
              placeholder="选择一个父文件夹"
            />
            <button type="button" disabled={busy} onClick={() => void chooseParent()}>
              浏览…
            </button>
          </div>
          {parentPath && name.trim() ? (
            <p className="new-project-preview">
              将创建：{parentPath}\{name.trim()}
            </p>
          ) : (
            <p className="new-project-preview">
              IDE 会在所选位置创建同名文件夹并立即打开。
            </p>
          )}
          <label className="new-project-git">
            <input
              type="checkbox"
              checked={initializeGit}
              disabled={busy}
              onChange={(event) => setInitializeGit(event.target.checked)}
            />
            初始化 Git 仓库
          </label>
          {error ? <p className="new-project-error">{error}</p> : null}
        </div>

        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !name.trim() || !parentPath}
            onClick={() => void createProject()}
          >
            {busy ? '正在创建…' : '创建并打开'}
          </button>
        </footer>
      </section>
    </div>
  )
}

export default NewProjectModal
