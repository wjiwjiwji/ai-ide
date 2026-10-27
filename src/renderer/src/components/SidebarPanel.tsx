import type { PointerEvent, ReactNode } from 'react'
import type {
  CodeSearchResult,
  FileEntry,
  ProjectInfo
} from '../../../shared/desktop'

interface SidebarPanelProps {
  project: ProjectInfo | null
  recentProjects: ProjectInfo[]
  mode: 'explorer' | 'search'
  activePath: string | null
  selectedEntry: FileEntry | null
  searchQuery: string
  searchBusy: boolean
  searchResults: CodeSearchResult[]
  fileTreeContent: ReactNode
  onOpenRootContextMenu: (event: React.MouseEvent) => void
  onNewProject: () => void
  onSearchQueryChange: (query: string) => void
  onRunSearch: () => void
  onOpenSearchResult: (result: CodeSearchResult) => void
  onClearExplorerSelection: () => void
  onDeleteSelected: (permanent: boolean) => void
  onRenameSelected: (currentName: string) => void
  onOpenSelected: () => void
  onOpenRecentProject: (path: string) => void
  onBeginDockDrag: (event: PointerEvent<HTMLButtonElement>) => void
}

function readablePath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments.length <= 3
    ? path
    : `…\\${segments.slice(-3).join('\\')}`
}

function SidebarPanel({
  project,
  recentProjects,
  mode,
  activePath,
  selectedEntry,
  searchQuery,
  searchBusy,
  searchResults,
  fileTreeContent,
  onOpenRootContextMenu,
  onNewProject,
  onSearchQueryChange,
  onRunSearch,
  onOpenSearchResult,
  onClearExplorerSelection,
  onDeleteSelected,
  onRenameSelected,
  onOpenSelected,
  onOpenRecentProject,
  onBeginDockDrag
}: SidebarPanelProps): React.JSX.Element {
  return (
    <div className="sidebar-panel-content">
      <div
        className="sidebar-heading"
        onContextMenu={project ? onOpenRootContextMenu : undefined}
      >
        <div>
          <span className="eyebrow">工作区</span>
          <h2>{project?.name ?? '项目与任务'}</h2>
        </div>
        <div className="sidebar-heading-actions">
          <button
            className="sidebar-dock-handle"
            type="button"
            title="拖动到左侧、右侧、底部或空白区域"
            aria-label="拖动侧边栏"
            data-tool-tab-label="资源管理器"
            onPointerDown={onBeginDockDrag}
          >
            ⠿
          </button>
          {project ? null : (
            <button
              className="icon-button"
              type="button"
              aria-label="新建项目"
              title="新建项目"
              onClick={onNewProject}
            >
              +
            </button>
          )}
        </div>
      </div>

      {project ? (
        <>
          <div
            className="project-summary"
            onContextMenu={onOpenRootContextMenu}
          >
            <span className="project-status-dot" />
            <span title={project.path}>{readablePath(project.path)}</span>
          </div>
          {mode === 'search' ? (
            <section className="sidebar-section search-view">
              <div className="section-label">
                <span>搜索代码</span>
                {searchBusy ? <span className="count">…</span> : null}
              </div>
              <form
                className="sidebar-search-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  onRunSearch()
                }}
              >
                <input
                  autoFocus
                  value={searchQuery}
                  placeholder="文件名、符号或内容"
                  onChange={(event) =>
                    onSearchQueryChange(event.target.value)
                  }
                />
                <button
                  type="submit"
                  disabled={!searchQuery.trim() || searchBusy}
                >
                  搜索
                </button>
              </form>
              <div className="sidebar-search-results">
                {searchResults.length ? (
                  searchResults.map((result) => (
                    <button
                      className="search-result"
                      type="button"
                      key={`${result.kind}:${result.path}:${result.line}:${result.label}`}
                      title={`${result.path}:${result.line}`}
                      onClick={() => onOpenSearchResult(result)}
                    >
                      <span className="search-result-kind">
                        {result.kind === 'symbol'
                          ? 'S'
                          : result.kind === 'file'
                            ? 'F'
                            : 'T'}
                      </span>
                      <span className="search-result-copy">
                        <strong>{result.label}</strong>
                        <small>{result.snippet}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="sidebar-search-empty">
                    {searchQuery
                      ? searchBusy
                        ? '正在搜索…'
                        : '没有匹配结果。'
                      : '输入关键词搜索文件、符号或文本。'}
                  </p>
                )}
              </div>
            </section>
          ) : (
            <section
              className="sidebar-section file-section"
              onContextMenu={(event) => {
                if ((event.target as Element).closest('.tree-row')) {
                  return
                }
                onOpenRootContextMenu(event)
              }}
            >
              <div className="section-label">
                <span>资源管理器</span>
              </div>
              <div
                className="file-tree"
                data-active-path={activePath ?? ''}
                tabIndex={0}
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    onClearExplorerSelection()
                    event.currentTarget.focus()
                  }
                }}
                onKeyDown={(event) => {
                  if (!selectedEntry) {
                    return
                  }
                  if (event.key === 'Delete') {
                    event.preventDefault()
                    event.stopPropagation()
                    onDeleteSelected(event.shiftKey)
                    return
                  }
                  if (event.key === 'F2') {
                    event.preventDefault()
                    event.stopPropagation()
                    onRenameSelected(selectedEntry.name)
                    return
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onOpenSelected()
                  }
                }}
              >
                {fileTreeContent}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="sidebar-section">
            <div className="section-label">
              <span>进行中的任务</span>
              <span className="count">0</span>
            </div>
            <div className="empty-task">
              <div className="empty-task-icon">⌁</div>
              <p>还没有任务</p>
              <span>打开项目后，从一个明确目标开始。</span>
            </div>
          </section>
          <section className="sidebar-section recent-section">
            <div className="section-label">
              <span>最近项目</span>
              <span className="count">{recentProjects.length}</span>
            </div>
            <div className="project-list">
              {recentProjects.length ? (
                recentProjects.map((recentProject) => (
                  <button
                    className="project-item"
                    type="button"
                    key={recentProject.path}
                    title={recentProject.path}
                    onClick={() =>
                      onOpenRecentProject(recentProject.path)
                    }
                  >
                    <span className="project-avatar">
                      {recentProject.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="project-copy">
                      <strong>{recentProject.name}</strong>
                      <small>本地</small>
                    </span>
                  </button>
                ))
              ) : (
                <div className="recent-empty">
                  打开过的项目会显示在这里。
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default SidebarPanel
