import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo, AppUpdateStatus } from '../../../shared/desktop'
import {
  APP_THEMES,
  type AppThemeId,
  type AppearanceSettings,
  type ThemePreference
} from '../appearance'

interface SettingsModalProps {
  appearance: AppearanceSettings
  appInfo: AppInfo | null
  updateStatus: AppUpdateStatus | null
  wordWrap: boolean
  activityBarVisible: boolean
  sidebarVisible: boolean
  inspectorVisible: boolean
  onThemeChange: (theme: AppThemeId) => void
  onEditorThemeChange: (theme: ThemePreference) => void
  onAgentThemeChange: (theme: ThemePreference) => void
  onEditorFontSizeChange: (size: number) => void
  onWordWrapChange: (enabled: boolean) => void
  onMinimapChange: (enabled: boolean) => void
  onSmoothCaretChange: (enabled: boolean) => void
  onBracketGuidesChange: (enabled: boolean) => void
  onConfirmDestructiveActionsChange: (enabled: boolean) => void
  onActivityBarVisibleChange: (visible: boolean) => void
  onSidebarVisibleChange: (visible: boolean) => void
  onInspectorVisibleChange: (visible: boolean) => void
  onResetLayout: () => void
  onCheckUpdates: () => void
  onClose: () => void
}

type SettingsCategory =
  | 'appearance'
  | 'editor'
  | 'layout'
  | 'security'
  | 'updates'

interface CategoryDefinition {
  id: SettingsCategory
  parent: string
  label: string
  keywords: string
}

const categories: CategoryDefinition[] = [
  {
    id: 'appearance',
    parent: '环境',
    label: '视觉体验',
    keywords:
      '背景 主题 颜色 深色 浅色 编辑器 Agent 会话 视觉 theme appearance editor agent background visual studio'
  },
  {
    id: 'editor',
    parent: '文本编辑器',
    label: '常规',
    keywords: '字体 字号 自动换行 编辑器 font editor word wrap'
  },
  {
    id: 'layout',
    parent: '工作台',
    label: '外观与布局',
    keywords:
      '活动栏 侧边栏 右侧栏 底部 停靠 宽度 重置 布局 layout workspace reset'
  },
  {
    id: 'security',
    parent: '安全',
    label: '文件删除保护',
    keywords: '删除 回收站 确认 安全 delete trash confirm security'
  },
  {
    id: 'updates',
    parent: '应用',
    label: '更新与版本',
    keywords: '更新 版本 electron update version'
  }
]

function SettingsModal({
  appearance,
  appInfo,
  updateStatus,
  wordWrap,
  activityBarVisible,
  sidebarVisible,
  inspectorVisible,
  onThemeChange,
  onEditorThemeChange,
  onAgentThemeChange,
  onEditorFontSizeChange,
  onWordWrapChange,
  onMinimapChange,
  onSmoothCaretChange,
  onBracketGuidesChange,
  onConfirmDestructiveActionsChange,
  onActivityBarVisibleChange,
  onSidebarVisibleChange,
  onInspectorVisibleChange,
  onResetLayout,
  onCheckUpdates,
  onClose
}: SettingsModalProps): React.JSX.Element {
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>('appearance')
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)

  const visibleCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return categories
    }
    return categories.filter((category) =>
      `${category.parent} ${category.label} ${category.keywords}`
        .toLowerCase()
        .includes(query)
    )
  }, [searchQuery])

  useEffect(() => {
    if (
      visibleCategories.length > 0 &&
      !visibleCategories.some((category) => category.id === activeCategory)
    ) {
      setActiveCategory(visibleCategories[0].id)
    }
  }, [activeCategory, visibleCategories])

  useEffect(() => {
    searchRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const activeDefinition =
    categories.find((category) => category.id === activeCategory) ??
    categories[0]

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-titlebar">
          <div className="settings-title">
            <span className="settings-title-icon">⚙</span>
            <h2 id="settings-title">设置</h2>
          </div>
          <label className="settings-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              value={searchQuery}
              placeholder="搜索设置"
              aria-label="搜索设置"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <kbd>Ctrl+,</kbd>
          </label>
          <button
            type="button"
            className="settings-close"
            aria-label="关闭设置"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-tree" aria-label="设置分类">
            <div className="settings-tree-heading">所有设置</div>
            {visibleCategories.length > 0 ? (
              visibleCategories.map((category) => (
                <button
                  className={
                    activeCategory === category.id ? 'active' : ''
                  }
                  type="button"
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                >
                  <span className="settings-tree-chevron">›</span>
                  <span>
                    <small>{category.parent}</small>
                    <strong>{category.label}</strong>
                  </span>
                </button>
              ))
            ) : (
              <div className="settings-tree-empty">没有匹配的设置</div>
            )}
          </nav>

          <main className="settings-main">
            <div className="settings-breadcrumb">
              所有设置 <span>›</span> {activeDefinition.parent}{' '}
              <span>›</span> {activeDefinition.label}
            </div>

            {visibleCategories.length === 0 ? (
              <div className="settings-no-results">
                <strong>没有找到匹配的设置</strong>
                <p>尝试搜索“主题”“字体”“布局”或“更新”。</p>
              </div>
            ) : activeCategory === 'appearance' ? (
              <section className="settings-page">
                <div className="settings-page-heading">
                  <h3>视觉体验</h3>
                  <p>
                    工作台、代码编辑器和 Agent 会话可以使用不同主题；默认为跟随应用主题。
                  </p>
                </div>
                <div className="settings-setting-group">
                  <div className="settings-control-label">
                    <strong>应用颜色主题</strong>
                    <small>控制工作台、侧边栏和工具窗口的配色。</small>
                  </div>
                  <div className="theme-grid">
                    {APP_THEMES.map((theme) => (
                      <button
                        className={`theme-card ${
                          appearance.theme === theme.id ? 'selected' : ''
                        }`}
                        type="button"
                        key={theme.id}
                        onClick={() => onThemeChange(theme.id)}
                      >
                        <span
                          className="theme-preview"
                          style={{
                            background: `linear-gradient(135deg, ${theme.background} 0 58%, ${theme.panel} 58% 100%)`
                          }}
                        >
                          <i style={{ background: theme.accent }} />
                        </span>
                        <span>
                          <strong>{theme.name}</strong>
                          <small>{theme.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>编辑器主题</strong>
                      <small>
                        控制代码编辑器、文件预览和差异视图，不受工作台主题限制。
                      </small>
                    </span>
                    <select
                      value={appearance.editorTheme}
                      onChange={(event) =>
                        onEditorThemeChange(
                          event.target.value as ThemePreference
                        )
                      }
                    >
                      <option value="match-app">跟随应用主题</option>
                      {APP_THEMES.map((theme) => (
                        <option value={theme.id} key={theme.id}>
                          {theme.name}
                        </option>
                      ))}
                    </select>
                    <span />
                  </label>
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>Agent 会话主题</strong>
                      <small>
                        单独控制 Agent 对话、工具调用和输入区域的配色。
                      </small>
                    </span>
                    <select
                      value={appearance.agentTheme}
                      onChange={(event) =>
                        onAgentThemeChange(
                          event.target.value as ThemePreference
                        )
                      }
                    >
                      <option value="match-app">跟随应用主题</option>
                      {APP_THEMES.map((theme) => (
                        <option value={theme.id} key={theme.id}>
                          {theme.name}
                        </option>
                      ))}
                    </select>
                    <span />
                  </label>
                </div>
              </section>
            ) : activeCategory === 'editor' ? (
              <section className="settings-page">
                <div className="settings-page-heading">
                  <h3>文本编辑器</h3>
                  <p>调整 Monaco 编辑器和代码差异视图。</p>
                </div>
                <div className="settings-setting-group">
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>编辑器字号</strong>
                      <small>支持 11px 到 22px。</small>
                    </span>
                    <input
                      type="range"
                      min={11}
                      max={22}
                      value={appearance.editorFontSize}
                      onChange={(event) =>
                        onEditorFontSizeChange(Number(event.target.value))
                      }
                    />
                    <output>{appearance.editorFontSize}px</output>
                  </label>
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>自动换行</strong>
                      <small>也可使用 Alt+Z 快速切换。</small>
                    </span>
                    <span />
                    <input
                      type="checkbox"
                      checked={wordWrap}
                      onChange={(event) =>
                        onWordWrapChange(event.target.checked)
                      }
                    />
                  </label>
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>代码缩略图</strong>
                      <small>在编辑器右侧显示 Minimap。</small>
                    </span>
                    <span />
                    <input
                      type="checkbox"
                      checked={appearance.showMinimap}
                      onChange={(event) =>
                        onMinimapChange(event.target.checked)
                      }
                    />
                  </label>
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>平滑光标动画</strong>
                      <small>减少光标移动时的突兀感。</small>
                    </span>
                    <span />
                    <input
                      type="checkbox"
                      checked={appearance.smoothCaret}
                      onChange={(event) =>
                        onSmoothCaretChange(event.target.checked)
                      }
                    />
                  </label>
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>括号参考线</strong>
                      <small>显示括号配对和缩进引导线。</small>
                    </span>
                    <span />
                    <input
                      type="checkbox"
                      checked={appearance.bracketGuides}
                      onChange={(event) =>
                        onBracketGuidesChange(event.target.checked)
                      }
                    />
                  </label>
                </div>
              </section>
            ) : activeCategory === 'layout' ? (
              <section className="settings-page">
                <div className="settings-page-heading">
                  <h3>工作台</h3>
                  <p>控制活动栏、侧边栏、右侧工具窗口和停靠位置。</p>
                </div>
                <div className="settings-setting-group">
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>显示活动栏</strong>
                      <small>左侧图标导航栏。</small>
                    </span>
                    <span />
                    <input
                      type="checkbox"
                      checked={activityBarVisible}
                      onChange={(event) =>
                        onActivityBarVisibleChange(event.target.checked)
                      }
                    />
                  </label>
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>显示侧边栏</strong>
                      <small>资源管理器、搜索和 Agent 导航。</small>
                    </span>
                    <span />
                    <input
                      type="checkbox"
                      checked={sidebarVisible}
                      onChange={(event) =>
                        onSidebarVisibleChange(event.target.checked)
                      }
                    />
                  </label>
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>显示右侧工具组</strong>
                      <small>显示停靠在右侧的工具标签。</small>
                    </span>
                    <span />
                    <input
                      type="checkbox"
                      checked={inspectorVisible}
                      onChange={(event) =>
                        onInspectorVisibleChange(event.target.checked)
                      }
                    />
                  </label>
                  <div className="settings-action-group">
                    <button type="button" onClick={onResetLayout}>
                      重置窗口布局和尺寸
                    </button>
                  </div>
                </div>
              </section>
            ) : activeCategory === 'security' ? (
              <section className="settings-page">
                <div className="settings-page-heading">
                  <h3>安全</h3>
                  <p>控制资源管理器中的危险文件操作。</p>
                </div>
                <div className="settings-setting-group">
                  <label className="settings-control-row">
                    <span className="settings-control-label">
                      <strong>删除前显示确认</strong>
                      <small>
                        对移到回收站和永久删除操作显示确认对话框。
                      </small>
                    </span>
                    <span />
                    <input
                      type="checkbox"
                      checked={appearance.confirmDestructiveActions}
                      onChange={(event) =>
                        onConfirmDestructiveActionsChange(
                          event.target.checked
                        )
                      }
                    />
                  </label>
                </div>
              </section>
            ) : (
              <section className="settings-page">
                <div className="settings-page-heading">
                  <h3>更新与版本</h3>
                  <p>
                    AI IDE {appInfo?.version ?? '—'} · Electron{' '}
                    {appInfo?.electronVersion ?? '—'}
                  </p>
                </div>
                <div className="settings-setting-group settings-action-group">
                  <button
                    type="button"
                    disabled={
                      updateStatus?.state === 'checking' ||
                      updateStatus?.state === 'downloading'
                    }
                    onClick={onCheckUpdates}
                  >
                    {updateStatus?.state === 'checking'
                      ? '正在检查…'
                      : '检查更新'}
                  </button>
                  <span>
                    {updateStatus?.message ??
                      '安装版启动时会自动检查更新。'}
                  </span>
                </div>
              </section>
            )}
          </main>
        </div>

        <footer className="settings-footer">
          <span>{visibleCategories.length} 个设置分类</span>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  )
}

export default SettingsModal
