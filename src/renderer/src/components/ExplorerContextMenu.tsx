import { useEffect, useRef, useState } from 'react'
import type {
  CreateWorkspaceEntryInput,
  RenameWorkspaceEntryInput
} from '../../../shared/desktop'

export interface ExplorerContextTarget {
  kind: 'root' | 'directory' | 'file'
  path: string
  directoryPath: string
  name: string
  absolutePath: string
}

interface ExplorerContextMenuProps {
  x: number
  y: number
  target: ExplorerContextTarget
  isCppProject: boolean
  onClose: () => void
  onCreate: (input: CreateWorkspaceEntryInput) => Promise<void>
  onRename: (input: RenameWorkspaceEntryInput) => Promise<void>
  onTrash: (path: string) => Promise<void>
  onDeletePermanently: (path: string) => Promise<void>
  onReveal: (path: string) => Promise<void>
  onOpenFile: (path: string) => void
  onOpenTerminal: (directoryPath: string) => void
  onAskAgent: (target: ExplorerContextTarget) => void
  onCopy: (text: string, label: string) => void
  onRefresh: () => Promise<void>
}

type InputMode =
  | 'file'
  | 'directory'
  | 'header'
  | 'source'
  | 'class'
  | 'rename'
  | null

function cppDirectories(target: ExplorerContextTarget): {
  headers: string
  sources: string
} {
  const separator = target.path.includes('\\') ? '\\' : '/'
  const segments = target.path.split(/[\\/]/).filter(Boolean)
  let srcIndex = -1
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index].toLowerCase() === 'src') {
      srcIndex = index
      break
    }
  }
  const srcRoot =
    srcIndex >= 0 ? segments.slice(0, srcIndex + 1).join(separator) : 'src'
  return {
    headers: [srcRoot, 'Headers'].filter(Boolean).join(separator),
    sources: [srcRoot, 'Sources'].filter(Boolean).join(separator)
  }
}

function ensureCppExtension(name: string, extension: '.h' | '.cpp'): string {
  const trimmed = name.trim()
  return `${trimmed.replace(/\.[^.]+$/, '')}${extension}`
}

function ExplorerContextMenu({
  x,
  y,
  target,
  isCppProject,
  onClose,
  onCreate,
  onRename,
  onTrash,
  onDeletePermanently,
  onReveal,
  onOpenFile,
  onOpenTerminal,
  onAskAgent,
  onCopy,
  onRefresh
}: ExplorerContextMenuProps): React.JSX.Element {
  const [inputMode, setInputMode] = useState<InputMode>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!busy && !menuRef.current?.contains(event.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        if (inputMode) {
          setInputMode(null)
          setError('')
        } else {
          onClose()
        }
        return
      }
      if (!inputMode && !busy) {
        if (event.key.toLowerCase() === 'n') {
          event.preventDefault()
          setName('')
          setInputMode('file')
        } else if (event.key.toLowerCase() === 'd') {
          event.preventDefault()
          setName('')
          setInputMode('directory')
        } else if (event.key === 'F2' && target.kind !== 'root') {
          event.preventDefault()
          setName(target.name)
          setInputMode('rename')
        }
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [busy, inputMode, onClose, target])

  useEffect(() => {
    inputRef.current?.focus()
    if (inputMode === 'rename') {
      inputRef.current?.select()
    }
  }, [inputMode])

  const submit = async (): Promise<void> => {
    if (!inputMode || !name.trim()) {
      return
    }
    setBusy(true)
    setError('')
    try {
      if (inputMode === 'rename') {
        await onRename({ path: target.path, name })
      } else if (
        inputMode === 'header' ||
        inputMode === 'source' ||
        inputMode === 'class'
      ) {
        const directories = cppDirectories(target)
        if (inputMode === 'class') {
          const className = name.trim().replace(/\.(h|hpp|cpp|cxx|cc)$/i, '')
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(className)) {
            throw new Error('类名只能包含字母、数字和下划线，且不能以数字开头。')
          }
          await onCreate({
            directoryPath: directories.headers,
            type: 'file',
            name: `${className}.h`,
            createParentDirectories: true,
            content: `#pragma once

class ${className} {
public:
  ${className}();
  ~${className}();

private:
};
`
          })
          await onCreate({
            directoryPath: directories.sources,
            type: 'file',
            name: `${className}.cpp`,
            createParentDirectories: true,
            content: `#include "${className}.h"

${className}::${className}() = default;
${className}::~${className}() = default;
`
          })
        } else {
          const extension = inputMode === 'header' ? '.h' : '.cpp'
          const fileName = ensureCppExtension(name, extension)
          const includeName = `${fileName.replace(
            /\.(h|hpp|cpp|cxx|cc)$/i,
            ''
          )}.h`
          await onCreate({
            directoryPath:
              inputMode === 'header'
                ? directories.headers
                : directories.sources,
            type: 'file',
            name: fileName,
            createParentDirectories: true,
            content:
              inputMode === 'header'
                ? '#pragma once\n'
                : `#include "${includeName}"\n`
          })
        }
      } else {
        await onCreate({
          directoryPath: target.directoryPath,
          type: inputMode,
          name
        })
      }
      onClose()
    } catch (operationError) {
      setError(
        operationError instanceof Error
          ? operationError.message
          : '操作失败。'
      )
    } finally {
      setBusy(false)
    }
  }

  const left = Math.min(Math.max(8, x), window.innerWidth - 280)
  const menuMaxHeight = Math.min(560, window.innerHeight - 48)
  const top = Math.min(
    Math.max(38, y),
    Math.max(38, window.innerHeight - menuMaxHeight - 8)
  )
  const isDirectoryLike = target.kind !== 'file'
  const relativePath = target.path || '.'
  const terminalDirectory =
    target.kind === 'file' ? target.directoryPath : target.path
  const runAction = (action: () => Promise<void>): void => {
    setError('')
    void action().then(
      onClose,
      (actionError) => {
        setError(
          actionError instanceof Error ? actionError.message : '操作失败。'
        )
      }
    )
  }
  const inputTitle =
    inputMode === 'file'
      ? '新建其他文件'
      : inputMode === 'directory'
        ? '新建文件夹'
        : inputMode === 'header'
          ? '添加头文件'
          : inputMode === 'source'
            ? '添加源文件'
            : inputMode === 'class'
              ? '添加类'
              : '重命名'
  const inputPlaceholder =
    inputMode === 'file'
      ? '文件名，例如 index.ts'
      : inputMode === 'directory'
        ? '文件夹名称'
        : inputMode === 'header'
          ? '头文件名，例如 Student.h'
          : inputMode === 'source'
            ? '源文件名，例如 Student.cpp'
            : inputMode === 'class'
              ? '类名，例如 Student'
              : '新名称'

  return (
    <div
      ref={menuRef}
      className="explorer-context-menu"
      style={{ left, top }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {!inputMode && error ? (
        <span className="explorer-menu-error">{error}</span>
      ) : null}
      {inputMode ? (
        <form
          className="explorer-create-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <strong>{inputTitle}</strong>
          <input
            ref={inputRef}
            value={name}
            maxLength={255}
            disabled={busy}
            placeholder={inputPlaceholder}
            onChange={(event) => setName(event.target.value)}
          />
          {error ? <span className="explorer-create-error">{error}</span> : null}
          <div className="explorer-create-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setInputMode(null)
                setError('')
              }}
            >
              取消
            </button>
            <button type="submit" disabled={busy || !name.trim()}>
              {busy ? '处理中…' : inputMode === 'rename' ? '重命名' : '添加'}
            </button>
          </div>
        </form>
      ) : (
        <>
          {target.kind === 'file' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onOpenFile(target.path)
                onClose()
              }}
            >
              <span>打开</span>
              <kbd>Enter</kbd>
            </button>
          ) : (
            <>
              {isCppProject ? (
                <>
                  <span className="explorer-menu-group-title">
                    C++ 项目
                  </span>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setName('')
                      setInputMode('header')
                    }}
                  >
                    添加头文件…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setName('')
                      setInputMode('source')
                    }}
                  >
                    添加源文件…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setName('')
                      setInputMode('class')
                    }}
                  >
                    添加类…
                  </button>
                  <span
                    className="explorer-context-separator"
                    role="separator"
                  />
                </>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setName('')
                  setInputMode('file')
                }}
              >
                <span>
                  {isCppProject ? '新建其他文件…' : '新建文件…'}
                </span>
                <kbd>N</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setName('')
                  setInputMode('directory')
                }}
              >
                <span>新建文件夹…</span>
                <kbd>D</kbd>
              </button>
            </>
          )}
          <span className="explorer-context-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onAskAgent(target)
              onClose()
            }}
          >
            <span>
              {target.kind === 'root'
                ? '让 Agent 处理整个项目…'
                : target.kind === 'directory'
                  ? '以该文件夹为范围询问 Agent…'
                  : '让 Agent 检查此文件…'}
            </span>
          </button>
          <span className="explorer-context-separator" role="separator" />
          {target.kind !== 'root' ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setName(target.name)
                  setInputMode('rename')
                }}
              >
                <span>重命名</span>
                <kbd>F2</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  runAction(() => onTrash(target.path))
                }}
              >
                移到回收站
              </button>
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  runAction(() => onDeletePermanently(target.path))
                }}
              >
                <span>永久删除</span>
                <kbd>Shift+Del</kbd>
              </button>
            </>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              runAction(() =>
                onReveal(target.kind === 'root' ? '.' : target.path)
              )
            }}
          >
            在文件资源管理器中显示
          </button>
          {isDirectoryLike ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onOpenTerminal(terminalDirectory)
                onClose()
              }}
            >
              在集成终端中打开
            </button>
          ) : null}
          <span className="explorer-context-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCopy(relativePath, '相对路径')
              onClose()
            }}
          >
            复制相对路径
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCopy(target.absolutePath, '完整路径')
              onClose()
            }}
          >
            复制完整路径
          </button>
          <span className="explorer-context-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              runAction(onRefresh)
            }}
          >
            刷新资源管理器
          </button>
        </>
      )}
    </div>
  )
}

export default ExplorerContextMenu
