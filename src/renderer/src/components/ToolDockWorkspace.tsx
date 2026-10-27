import type { PointerEvent, ReactNode } from 'react'
import type {
  ToolDockPane,
  ToolTab,
  ToolWindowLayout
} from '../tool-windows'

interface ToolDockWorkspaceProps {
  layout: ToolWindowLayout
  height: number
  renderContent: (tab: ToolTab) => ReactNode
  errorCount: number
  labels: Record<string, string>
  onBeginResize: (event: PointerEvent<HTMLDivElement>) => void
  onBeginPaneResize: (
    paneIndex: number,
    event: PointerEvent<HTMLDivElement>
  ) => void
  onTearOffTab: (
    tab: ToolDockPane['activeTab'],
    event: PointerEvent<HTMLButtonElement>
  ) => void
  onBeginGroupDrag: (
    paneId: string,
    tab: ToolDockPane['activeTab'],
    event: PointerEvent<HTMLButtonElement>
  ) => void
  onSplitTab: (paneId: string, tab: ToolDockPane['activeTab']) => void
  onActivateTab: (paneId: string, tab: ToolDockPane['activeTab']) => void
  onClosePane: (paneId: string) => void
  onDockSidebar: (tab: ToolDockPane['activeTab']) => void
}

function ToolDockWorkspace({
  layout,
  height,
  renderContent,
  errorCount,
  labels,
  onBeginResize,
  onBeginPaneResize,
  onTearOffTab,
  onBeginGroupDrag,
  onSplitTab,
  onActivateTab,
  onClosePane,
  onDockSidebar
}: ToolDockWorkspaceProps): React.JSX.Element | null {
  if (!layout.docked.length) {
    return null
  }

  return (
    <>
      <div
        className="bottom-panel-resizer"
        role="separator"
        aria-label="调整底部工具窗口高度"
        onPointerDown={onBeginResize}
      />
      <section
        className="bottom-panel tool-dock-shell"
        style={{ height: `${height}px` }}
      >
        {layout.docked.map((pane, paneIndex) => (
          <div className="tool-dock-track" key={pane.id}>
            {paneIndex > 0 ? (
              <div
                className="tool-dock-split-resizer"
                role="separator"
                aria-label={`调整工具窗口 ${paneIndex} 宽度`}
                onPointerDown={(event) =>
                  onBeginPaneResize(paneIndex - 1, event)
                }
              />
            ) : null}
            <div
              className="bottom-panel tool-dock-pane"
              data-tool-pane-id={pane.id}
              style={{ flexGrow: pane.weight }}
            >
              <header
                className="bottom-panel-tabs"
                role="tablist"
                data-tool-tab-group={`bottom:${pane.id}`}
              >
                <button
                  className="tool-dock-grip"
                  type="button"
                  title="拖动当前工具窗口到左侧、右侧或浮动"
                  aria-label="移动当前工具窗口"
                  data-tool-tab-label={
                    labels[pane.activeTab] ?? pane.activeTab
                  }
                  onPointerDown={(event) =>
                    onBeginGroupDrag(pane.id, pane.activeTab, event)
                  }
                >
                  ⠿
                </button>
                {pane.tabs.map((tab) => (
                  <button
                    className={pane.activeTab === tab ? 'active' : ''}
                    type="button"
                    role="tab"
                    aria-selected={pane.activeTab === tab}
                    data-tool-tab={tab}
                    title="左右拖动调整标签顺序"
                    key={tab}
                    onPointerDown={(event) => onTearOffTab(tab, event)}
                    onClick={() => onActivateTab(pane.id, tab)}
                  >
                    {labels[tab] ?? tab}
                    {tab === 'errors' && errorCount ? (
                      <span className="bottom-tab-badge">{errorCount}</span>
                    ) : null}
                  </button>
                ))}
                <button
                  className="tool-dock-split-button"
                  type="button"
                  title="将当前标签拆分为右侧工具窗口"
                  aria-label="拆分当前工具窗口"
                  disabled={pane.tabs.length < 2}
                  onClick={() =>
                    onSplitTab(pane.id, pane.activeTab)
                  }
                >
                  ◫
                </button>
                {pane.tabs.includes('sidebar') ? (
                  <button
                    className="tool-dock-sidebar-button"
                    type="button"
                    title="将侧边栏停靠回左侧"
                    aria-label="将侧边栏停靠回左侧"
                    onClick={() => onDockSidebar('sidebar')}
                  >
                    ⇤
                  </button>
                ) : null}
                <button
                  className="bottom-panel-close"
                  type="button"
                  title="关闭此工具窗口"
                  aria-label="关闭此工具窗口"
                  onClick={() => onClosePane(pane.id)}
                >
                  ×
                </button>
              </header>
              <div className="tool-dock-content">
                {renderContent(pane.activeTab)}
              </div>
            </div>
          </div>
        ))}
      </section>
    </>
  )
}

export default ToolDockWorkspace
