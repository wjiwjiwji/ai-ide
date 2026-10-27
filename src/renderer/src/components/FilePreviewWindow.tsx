import { useEffect } from 'react'
import { Editor } from '@monaco-editor/react'
import MarkdownContent from './MarkdownContent'

interface FilePreviewWindowProps {
  path: string
  content: string
  language: string
  theme: string
  onClose: () => void
  onOpenEditor: () => void
}

function FilePreviewWindow({
  path,
  content,
  language,
  theme,
  onClose,
  onOpenEditor
}: FilePreviewWindowProps): React.JSX.Element {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="file-preview-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        className="file-preview-window"
        role="dialog"
        aria-modal="true"
        aria-label={`预览 ${path}`}
      >
        <header>
          <div>
            <span>文件预览</span>
            <strong title={path}>{path}</strong>
          </div>
          <button type="button" onClick={onOpenEditor}>
            在编辑器中打开
          </button>
          <button
            className="file-preview-close"
            type="button"
            aria-label="关闭文件预览"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="file-preview-editor">
          {language === 'markdown' ? (
            <div className="file-preview-markdown">
              <MarkdownContent
                text={content}
                headingOffset={0}
                className="markdown-document"
              />
            </div>
          ) : (
            <Editor
              path={`file-preview:///${encodeURI(
                path.replaceAll('\\', '/')
              )}`}
              language={language}
              value={content}
              theme={theme}
              options={{
                automaticLayout: true,
                fontFamily: '"Cascadia Code", Consolas, monospace',
                fontSize: 13,
                lineHeight: 22,
                minimap: { enabled: false },
                padding: { top: 12 },
                readOnly: true,
                renderLineHighlight: 'line',
                scrollBeyondLastLine: false,
                wordWrap: 'off',
                contextmenu: false
              }}
            />
          )}
        </div>
      </section>
    </div>
  )
}

export default FilePreviewWindow
