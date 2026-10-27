import { useEffect, useMemo, useRef, useState } from 'react'

export interface CommandItem {
  id: string
  title: string
  subtitle?: string
  group: string
  shortcut?: string
  keywords?: string[]
  run: () => void | Promise<void>
}

interface CommandPaletteProps {
  commands: CommandItem[]
  onClose: () => void
  placeholder?: string
}

function scoreCommand(command: CommandItem, query: string): number {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return 0
  }

  const title = command.title.toLowerCase()
  const haystack = [
    title,
    command.group,
    command.subtitle ?? '',
    ...(command.keywords ?? [])
  ]
    .join(' ')
    .toLowerCase()

  if (title.startsWith(normalizedQuery)) {
    return 100
  }
  if (title.includes(normalizedQuery)) {
    return 70
  }
  if (haystack.includes(normalizedQuery)) {
    return 40
  }

  const words = normalizedQuery.split(/\s+/)
  if (words.every((word) => haystack.includes(word))) {
    return 20
  }
  return -1
}

function CommandPalette({
  commands,
  onClose,
  placeholder = '搜索命令、项目操作或 Agent 任务'
}: CommandPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredCommands = useMemo(() => {
    return commands
      .map((command) => ({
        command,
        score: scoreCommand(command, query)
      }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.command)
  }, [commands, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const selectedElement = listRef.current?.querySelector(
      `[data-command-index="${selectedIndex}"]`
    )
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const executeCommand = (command: CommandItem): void => {
    onClose()
    void command.run()
  }

  let previousGroup = ''

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
      >
        <div className="command-search">
          <span>›</span>
          <input
            ref={inputRef}
            value={query}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelectedIndex((index) =>
                  Math.min(filteredCommands.length - 1, index + 1)
                )
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelectedIndex((index) => Math.max(0, index - 1))
              } else if (event.key === 'Enter' && filteredCommands.length) {
                event.preventDefault()
                executeCommand(filteredCommands[selectedIndex])
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="command-list" ref={listRef}>
          {filteredCommands.length ? (
            filteredCommands.map((command, index) => {
              const showGroup = command.group !== previousGroup
              previousGroup = command.group
              return (
                <div key={command.id}>
                  {showGroup ? (
                    <div className="command-group-label">{command.group}</div>
                  ) : null}
                  <button
                    className={`command-row ${
                      index === selectedIndex ? 'selected' : ''
                    }`}
                    data-command-index={index}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => executeCommand(command)}
                  >
                    <span className="command-copy">
                      <strong>{command.title}</strong>
                      {command.subtitle ? (
                        <small>{command.subtitle}</small>
                      ) : null}
                    </span>
                    {command.shortcut ? (
                      <kbd>{command.shortcut}</kbd>
                    ) : null}
                  </button>
                </div>
              )
            })
          ) : (
            <div className="command-empty">
              没有匹配的命令。试试“诊断”、“Agent”或“Git”。
            </div>
          )}
        </div>

        <div className="command-footer">
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>{filteredCommands.length} 个命令</span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
