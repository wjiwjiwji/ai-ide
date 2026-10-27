import { useEffect } from 'react'

interface EditorContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onChangeAll: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  functionInfo: {
    name: string
    loading: boolean
    hasDeclaration: boolean
    hasDefinition: boolean
    canGenerate: boolean
    onOpenDeclaration: () => void
    onOpenDefinition: () => void
    onGenerateImplementation: () => void
  } | null
  onAskAgent: () => void
  onOpenCommandPalette: () => void
}

function EditorContextMenu({
  x,
  y,
  onClose,
  onChangeAll,
  onCut,
  onCopy,
  onPaste,
  functionInfo,
  onAskAgent,
  onOpenCommandPalette
}: EditorContextMenuProps): React.JSX.Element {
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target as Element).closest('.editor-context-menu')) {
        onClose()
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const left = Math.min(Math.max(8, x), window.innerWidth - 286)
  const top = Math.min(Math.max(38, y), window.innerHeight - 286)
  const run = (action: () => void): void => {
    onClose()
    action()
  }

  return (
    <div
      className="editor-context-menu"
      style={{ left, top }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => run(onChangeAll)}>
        <span>更改所有匹配项</span>
        <kbd>Ctrl+F2</kbd>
      </button>
      <span className="editor-context-separator" role="separator" />
      {functionInfo ? (
        <>
          <span className="editor-context-function-title">
            函数 {functionInfo.name}
          </span>
          <button
            type="button"
            role="menuitem"
            disabled={functionInfo.loading || !functionInfo.hasDeclaration}
            onClick={() => run(functionInfo.onOpenDeclaration)}
          >
            查看声明
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={functionInfo.loading || !functionInfo.hasDefinition}
            onClick={() => run(functionInfo.onOpenDefinition)}
          >
            {functionInfo.loading ? '正在查找函数定义…' : '查看定义'}
          </button>
          {functionInfo.canGenerate ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(functionInfo.onGenerateImplementation)}
            >
              生成空函数实现
            </button>
          ) : null}
          <span className="editor-context-separator" role="separator" />
        </>
      ) : null}
      <button type="button" role="menuitem" onClick={() => run(onCut)}>
        剪切
      </button>
      <button type="button" role="menuitem" onClick={() => run(onCopy)}>
        复制
      </button>
      <button type="button" role="menuitem" onClick={() => run(onPaste)}>
        粘贴
      </button>
      <span className="editor-context-separator" role="separator" />
      <button type="button" role="menuitem" onClick={() => run(onAskAgent)}>
        向 Agent 询问此位置
      </button>
      <span className="editor-context-separator" role="separator" />
      <button
        type="button"
        role="menuitem"
        onClick={() => run(onOpenCommandPalette)}
      >
        <span>命令面板</span>
        <kbd>F1</kbd>
      </button>
    </div>
  )
}

export default EditorContextMenu
