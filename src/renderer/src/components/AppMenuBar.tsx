import { useEffect, useRef, useState } from 'react'
import type {
  AppMenuCommand,
  EditAction,
  WorkspaceViewSlot
} from '../../../shared/desktop'

type MenuAction =
  | {
      kind: 'command'
      label: string
      command: AppMenuCommand
      shortcut?: string
      disabled?: boolean
      checked?: boolean
    }
  | {
      kind: 'edit'
      label: string
      action: EditAction
      shortcut?: string
      disabled?: boolean
    }
  | {
      kind: 'system'
      label: string
      action: 'fullscreen' | 'quit' | 'guide' | 'github'
      disabled?: boolean
    }
  | {
      kind: 'submenu'
      label: string
      items: MenuAction[]
    }
  | { kind: 'label'; label: string }
  | { kind: 'separator' }

interface MenuGroup {
  label: string
  items: MenuAction[]
}

interface AppMenuBarProps {
  onCommand: (command: AppMenuCommand) => void
  onOpenCommandPalette: () => void
  savedViewSchemes: Array<{
    slot: WorkspaceViewSlot
    savedAt: string
  }>
  checkedCommands: ReadonlySet<AppMenuCommand>
}

const workspaceViewSlots: WorkspaceViewSlot[] = [1, 2, 3, 4, 5]

function createMenus(
  savedViewSchemes: AppMenuBarProps['savedViewSchemes'],
  checkedCommands: AppMenuBarProps['checkedCommands']
): MenuGroup[] {
  const saveViewItems: MenuAction[] = workspaceViewSlots.map((slot) => {
    const savedScheme = savedViewSchemes.find(
      (scheme) => scheme.slot === slot
    )
    return {
      kind: 'command',
      label: `保存到方案 ${slot}${savedScheme ? '（覆盖）' : ''}`,
      command: `view:save-scheme-${slot}` as AppMenuCommand
    }
  })
  const applyViewItems: MenuAction[] = savedViewSchemes.length
    ? [...savedViewSchemes]
        .sort((left, right) => left.slot - right.slot)
        .map((scheme) => ({
          kind: 'command',
          label: `应用方案 ${scheme.slot} · ${new Date(
            scheme.savedAt
          ).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          })}`,
          command: `view:apply-scheme-${scheme.slot}` as AppMenuCommand
        }))
    : [{ kind: 'label', label: '还没有保存的视图方案' }]

  const menus: MenuGroup[] = [
    {
      label: '文件',
      items: [
        {
          kind: 'command',
          label: '设置…',
          command: 'app:settings',
          shortcut: 'Ctrl+,'
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: '新建项目…',
          command: 'project:new',
          shortcut: 'Ctrl+Shift+N'
        },
        {
          kind: 'command',
          label: '打开项目…',
          command: 'project:open',
          shortcut: 'Ctrl+O'
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: '保存',
          command: 'file:save',
          shortcut: 'Ctrl+S'
        },
        {
          kind: 'command',
          label: '关闭编辑器',
          command: 'file:close-editor',
          shortcut: 'Ctrl+W'
        },
        { kind: 'separator' },
        { kind: 'system', label: '退出', action: 'quit' }
      ]
    },
    {
      label: '编辑',
      items: [
        { kind: 'edit', label: '撤销', action: 'undo', shortcut: 'Ctrl+Z' },
        { kind: 'edit', label: '重做', action: 'redo', shortcut: 'Ctrl+Y' },
        { kind: 'separator' },
        { kind: 'edit', label: '剪切', action: 'cut', shortcut: 'Ctrl+X' },
        { kind: 'edit', label: '复制', action: 'copy', shortcut: 'Ctrl+C' },
        { kind: 'edit', label: '粘贴', action: 'paste', shortcut: 'Ctrl+V' }
      ]
    },
    {
      label: '选择',
      items: [
        {
          kind: 'edit',
          label: '全选',
          action: 'select-all',
          shortcut: 'Ctrl+A'
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: '打开命令面板',
          command: 'command-palette:open',
          shortcut: 'Ctrl+Shift+P'
        }
      ]
    },
    {
      label: '视图',
      items: [
        {
          kind: 'command',
          label: '命令面板…',
          command: 'command-palette:open',
          shortcut: 'Ctrl+Shift+P / F1'
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: '资源管理器',
          command: 'view:explorer',
          shortcut: 'Ctrl+Shift+E'
        },
        {
          kind: 'command',
          label: '搜索代码',
          command: 'view:search',
          shortcut: 'Ctrl+Shift+F'
        },
        {
          kind: 'command',
          label: '源码管理',
          command: 'view:source-control',
          shortcut: 'Ctrl+Shift+G'
        },
        {
          kind: 'command',
          label: '运行',
          command: 'view:run',
          shortcut: 'Ctrl+Shift+D'
        },
        {
          kind: 'command',
          label: 'Agent',
          command: 'view:agent',
          shortcut: 'Ctrl+Alt+I'
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: '问题',
          command: 'view:problems',
          shortcut: 'Ctrl+Shift+M'
        },
        {
          kind: 'command',
          label: '错误列表',
          command: 'view:error-list'
        },
        {
          kind: 'command',
          label: '诊断工具',
          command: 'view:diagnostic-tools'
        },
        {
          kind: 'command',
          label: '输出',
          command: 'view:output',
          shortcut: 'Ctrl+Shift+U'
        },
        {
          kind: 'command',
          label: '调试控制台',
          command: 'view:debug-console',
          shortcut: 'Ctrl+Shift+Y'
        },
        {
          kind: 'command',
          label: '调用堆栈',
          command: 'view:call-stack'
        },
        {
          kind: 'command',
          label: '内存',
          command: 'view:memory'
        },
        {
          kind: 'command',
          label: '终端',
          command: 'view:toggle-terminal',
          shortcut: 'Ctrl+`'
        },
        {
          kind: 'command',
          label: '显示或隐藏底部面板',
          command: 'view:toggle-bottom-panel',
          shortcut: 'Ctrl+J'
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: '显示或隐藏活动栏',
          command: 'view:toggle-activity-bar'
        },
        {
          kind: 'command',
          label: '显示或隐藏侧边栏',
          command: 'view:toggle-sidebar',
          shortcut: 'Ctrl+B'
        },
        {
          kind: 'command',
          label: '显示或隐藏右侧栏',
          command: 'view:toggle-inspector',
          shortcut: 'Ctrl+Alt+B'
        },
        {
          kind: 'command',
          label: '将右侧栏停靠到右侧',
          command: 'view:dock-inspector-right'
        },
        {
          kind: 'command',
          label: '将右侧栏停靠到底部',
          command: 'view:dock-inspector-bottom'
        },
        { kind: 'separator' },
        { kind: 'submenu', label: '保存视图', items: saveViewItems },
        { kind: 'submenu', label: '应用视图', items: applyViewItems },
        {
          kind: 'command',
          label: '自动换行',
          command: 'view:toggle-word-wrap',
          shortcut: 'Alt+Z'
        },
        {
          kind: 'command',
          label: '重置窗口布局',
          command: 'view:reset-layout'
        },
        { kind: 'separator' },
        {
          kind: 'system',
          label: '切换全屏',
          action: 'fullscreen'
        }
      ]
    },
    {
      label: '转到',
      items: [
        {
          kind: 'command',
          label: '转到文件…',
          command: 'command-palette:files',
          shortcut: 'Ctrl+P'
        },
        {
          kind: 'command',
          label: '转到行…',
          command: 'editor:goto-line',
          shortcut: 'Ctrl+G'
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: '下一个编辑器',
          command: 'editor:next',
          shortcut: 'Ctrl+Tab'
        },
        {
          kind: 'command',
          label: '上一个编辑器',
          command: 'editor:previous',
          shortcut: 'Ctrl+Shift+Tab'
        }
      ]
    },
    {
      label: '运行',
      items: [
        {
          kind: 'command',
          label: '启动调试',
          command: 'debug:start',
          shortcut: 'F5'
        },
        {
          kind: 'command',
          label: '继续',
          command: 'debug:continue'
        },
        {
          kind: 'command',
          label: '暂停',
          command: 'debug:pause'
        },
        {
          kind: 'command',
          label: '单步跳过',
          command: 'debug:step-over',
          shortcut: 'F10'
        },
        {
          kind: 'command',
          label: '单步进入',
          command: 'debug:step-in',
          shortcut: 'F11'
        },
        {
          kind: 'command',
          label: '单步退出',
          command: 'debug:step-out',
          shortcut: 'Shift+F11'
        },
        {
          kind: 'command',
          label: '切换断点',
          command: 'debug:toggle-breakpoint',
          shortcut: 'F9'
        },
        {
          kind: 'command',
          label: '停止调试',
          command: 'debug:stop',
          shortcut: 'Shift+F5'
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: '运行当前 C/C++ 文件',
          command: 'file:run-cpp',
          shortcut: 'Ctrl+F5'
        },
        {
          kind: 'command',
          label: '运行当前 Python 文件',
          command: 'file:run-python',
          shortcut: 'Shift+F10'
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: '运行项目',
          command: 'terminal:run'
        },
        {
          kind: 'command',
          label: '运行诊断',
          command: 'diagnostics:run'
        },
        {
          kind: 'command',
          label: '运行工作流…',
          command: 'workflow:open'
        },
        {
          kind: 'command',
          label: '打开 Agent',
          command: 'agent:open'
        }
      ]
    },
    {
      label: '终端',
      items: [
        {
          kind: 'command',
          label: '显示终端',
          command: 'terminal:open',
          shortcut: 'Ctrl+`'
        },
        {
          kind: 'command',
          label: '运行已保存命令',
          command: 'terminal:run'
        }
      ]
    },
    {
      label: '帮助',
      items: [
        {
          kind: 'system',
          label: '使用指南',
          action: 'guide'
        },
        {
          kind: 'system',
          label: 'GitHub 仓库',
          action: 'github'
        },
        {
          kind: 'command',
          label: '检查更新',
          command: 'updates:check'
        },
        { kind: 'separator' },
        {
          kind: 'command',
          label: '关于 AI IDE',
          command: 'help:about'
        }
      ]
    }
  ]
  const withCheckedState = (item: MenuAction): MenuAction => {
    if (item.kind === 'command') {
      return checkedCommands.has(item.command)
        ? { ...item, checked: true }
        : item
    }
    if (item.kind === 'submenu') {
      return {
        ...item,
        items: item.items.map(withCheckedState)
      }
    }
    return item
  }
  return menus.map((menu) => ({
    ...menu,
    items: menu.items.map(withCheckedState)
  }))
}

function AppMenuBar({
  onCommand,
  onOpenCommandPalette,
  savedViewSchemes,
  checkedCommands
}: AppMenuBarProps): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const menuBarRef = useRef<HTMLElement | null>(null)
  const menus = createMenus(savedViewSchemes, checkedCommands)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!menuBarRef.current?.contains(event.target as Node)) {
        setOpenMenu(null)
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenMenu(null)
        setOpenSubmenu(null)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const runItem = (item: MenuAction): void => {
    if ('disabled' in item && item.disabled) {
      return
    }
    setOpenMenu(null)
    setOpenSubmenu(null)
    if (item.kind === 'command') {
      onCommand(item.command)
      return
    }
    if (item.kind === 'edit') {
      void window.desktop.performEditAction(item.action)
      return
    }
    if (item.kind !== 'system') {
      return
    }

    switch (item.action) {
      case 'fullscreen':
        void window.desktop.toggleFullScreen()
        break
      case 'quit':
        void window.desktop.quitApp()
        break
      case 'guide':
        window.open(
          'https://github.com/wjiwjiwji/ai-ide#readme',
          '_blank',
          'noopener'
        )
        break
      case 'github':
        window.open(
          'https://github.com/wjiwjiwji/ai-ide',
          '_blank',
          'noopener'
        )
        break
    }
  }

  return (
    <header className="app-titlebar">
      <nav ref={menuBarRef} className="app-menu-bar" aria-label="应用菜单">
        <span className="titlebar-mark" aria-hidden="true">
          A
        </span>
        {menus.map((menu) => (
          <div
            className={`app-menu-group ${openMenu === menu.label ? 'open' : ''}`}
            key={menu.label}
            onMouseEnter={() => {
              if (openMenu) {
                setOpenMenu(menu.label)
                setOpenSubmenu(null)
              }
            }}
          >
            <button
              className="app-menu-trigger"
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === menu.label}
              onClick={() =>
                setOpenMenu((current) => {
                  setOpenSubmenu(null)
                  return current === menu.label ? null : menu.label
                })
              }
            >
              {menu.label}
            </button>
            {openMenu === menu.label ? (
              <div className="app-menu-dropdown" role="menu">
                {menu.items.map((item, index) =>
                  item.kind === 'separator' ? (
                    <span
                      className="app-menu-separator"
                      key={`separator-${index}`}
                      role="separator"
                    />
                  ) : item.kind === 'label' ? (
                    <span
                      className="app-menu-caption"
                      key={`caption-${index}`}
                    >
                      {item.label}
                    </span>
                  ) : item.kind === 'submenu' ? (
                    <div
                      className={`app-menu-submenu ${
                        openSubmenu === item.label ? 'open' : ''
                      }`}
                      key={item.label}
                    >
                      <button
                        className="app-menu-submenu-trigger"
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={openSubmenu === item.label}
                        onClick={() =>
                          setOpenSubmenu((current) =>
                            current === item.label ? null : item.label
                          )
                        }
                      >
                        <span>{item.label}</span>
                        <span aria-hidden="true">›</span>
                      </button>
                      {openSubmenu === item.label ? (
                        <div className="app-menu-submenu-panel" role="menu">
                          {item.items.map((subItem, subIndex) =>
                            subItem.kind === 'separator' ? (
                              <span
                                className="app-menu-separator"
                                key={`submenu-separator-${subIndex}`}
                                role="separator"
                              />
                            ) : subItem.kind === 'label' ? (
                              <span
                                className="app-menu-caption"
                                key={`submenu-caption-${subIndex}`}
                              >
                                {subItem.label}
                              </span>
                            ) : (
                              <button
                                type="button"
                                role="menuitem"
                                key={subItem.label}
                                disabled={
                                  'disabled' in subItem
                                    ? subItem.disabled
                                    : false
                                }
                                onClick={() => runItem(subItem)}
                              >
                                <span>{subItem.label}</span>
                                <span className="app-menu-item-meta">
                                  {'shortcut' in subItem &&
                                  subItem.shortcut ? (
                                    <kbd>{subItem.shortcut}</kbd>
                                  ) : null}
                                  {'checked' in subItem &&
                                  subItem.checked ? (
                                    <span
                                      className="app-menu-check"
                                      aria-label="已打开"
                                    >
                                      ✓
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            )
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      key={item.label}
                      disabled={item.disabled}
                      onClick={() => runItem(item)}
                    >
                      <span>{item.label}</span>
                      <span className="app-menu-item-meta">
                        {'shortcut' in item && item.shortcut ? (
                          <kbd>{item.shortcut}</kbd>
                        ) : null}
                        {'checked' in item && item.checked ? (
                          <span
                            className="app-menu-check"
                            aria-label="已打开"
                          >
                            ✓
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                )}
              </div>
            ) : null}
          </div>
        ))}
      </nav>
      <div className="titlebar-center">
        <button
          className="titlebar-search"
          type="button"
          onClick={onOpenCommandPalette}
        >
          <span>搜索项目或运行命令</span>
          <kbd>Ctrl Shift P</kbd>
        </button>
      </div>
    </header>
  )
}

export default AppMenuBar
