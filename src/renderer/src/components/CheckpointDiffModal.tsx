import { DiffEditor } from '@monaco-editor/react'
import { useEffect, useState } from 'react'
import type {
  CheckpointDiff,
  CheckpointFileDiff
} from '../../../shared/desktop'

interface CheckpointDiffModalProps {
  checkpointId: string
  onClose: () => void
}

function languageForPath(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase()
  const languages: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    css: 'css',
    html: 'html',
    json: 'json',
    md: 'markdown',
    py: 'python',
    java: 'java',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml'
  }
  return extension ? languages[extension] ?? 'plaintext' : 'plaintext'
}

function CheckpointDiffModal({
  checkpointId,
  onClose
}: CheckpointDiffModalProps): React.JSX.Element {
  const [diff, setDiff] = useState<CheckpointDiff | null>(null)
  const [selectedPath, setSelectedPath] = useState('')
  const [fileDiff, setFileDiff] = useState<CheckpointFileDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!window.desktop) {
      return
    }
    void window.desktop
      .getAgentCheckpointDiff(checkpointId)
      .then((nextDiff) => {
        setDiff(nextDiff)
        if (nextDiff.files[0]) {
          setSelectedPath(nextDiff.files[0].path)
        }
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : '无法读取检查点差异。'
        )
      })
      .finally(() => setLoading(false))
  }, [checkpointId])

  useEffect(() => {
    if (!selectedPath || !window.desktop) {
      return
    }
    setFileDiff(null)
    void window.desktop
      .getAgentCheckpointFileDiff(checkpointId, selectedPath)
      .then(setFileDiff)
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : '无法读取文件差异。'
        )
      })
  }, [checkpointId, selectedPath])

  return (
    <div
      className="checkpoint-diff-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        className="checkpoint-diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label="检查点差异"
      >
        <header className="checkpoint-diff-header">
          <div>
            <span className="eyebrow">Checkpoint diff</span>
            <strong>{diff?.label ?? '检查点差异'}</strong>
          </div>
          <div className="checkpoint-diff-stats">
            {diff ? (
              <>
                <span className="diff-add">+{diff.addedLines}</span>
                <span className="diff-delete">−{diff.deletedLines}</span>
                <span>{diff.files.length} 文件</span>
              </>
            ) : null}
            <button type="button" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <div className="checkpoint-diff-body">
          <aside className="checkpoint-file-list">
            {loading ? (
              <p>正在比较文件…</p>
            ) : diff?.files.length ? (
              diff.files.map((file) => (
                <button
                  className={file.path === selectedPath ? 'active' : ''}
                  type="button"
                  key={file.path}
                  onClick={() => setSelectedPath(file.path)}
                >
                  <span className={`checkpoint-file-status ${file.status}`}>
                    {file.status === 'added'
                      ? 'A'
                      : file.status === 'deleted'
                        ? 'D'
                        : 'M'}
                  </span>
                  <span className="checkpoint-file-copy">
                    <strong>{file.path}</strong>
                    <small>
                      +{file.addedLines} / −{file.deletedLines}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p>检查点创建后没有检测到文件变化。</p>
            )}
          </aside>

          <main className="checkpoint-diff-editor">
            {error ? (
              <div className="checkpoint-diff-message error">{error}</div>
            ) : fileDiff?.isBinary ? (
              <div className="checkpoint-diff-message">二进制文件无法预览。</div>
            ) : fileDiff ? (
              <DiffEditor
                original={fileDiff.originalContent}
                modified={fileDiff.modifiedContent}
                language={languageForPath(fileDiff.path)}
                theme="vs-dark"
                options={{
                  automaticLayout: true,
                  readOnly: true,
                  originalEditable: false,
                  renderSideBySide: true,
                  fontFamily: '"Cascadia Code", Consolas, monospace',
                  fontSize: 12,
                  lineHeight: 20,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  renderOverviewRuler: false
                }}
                loading={
                  <div className="checkpoint-diff-message">正在加载差异…</div>
                }
              />
            ) : (
              <div className="checkpoint-diff-message">选择文件查看差异。</div>
            )}
          </main>
        </div>
      </section>
    </div>
  )
}

export default CheckpointDiffModal
