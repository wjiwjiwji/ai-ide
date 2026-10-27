import type { PointerEvent, ReactNode } from 'react'
import type {
  FloatingToolWindow as FloatingToolWindowState,
  ToolTab
} from '../tool-windows'

interface FloatingToolWindowProps {
  window: FloatingToolWindowState
  renderContent: (tab: ToolTab) => ReactNode
  labels: Record<string, string>
  onBeginDrag: (
    windowId: string,
    event: PointerEvent<HTMLButtonElement>
  ) => void
  onDock: (windowId: string) => void
  onBeginTabDrag: (
    tab: ToolTab,
    event: PointerEvent<HTMLButtonElement>
  ) => void
  onActivateTab: (windowId: string, tab: ToolTab) => void
  onClose: (windowId: string) => void
  onDockRight?: (windowId: string) => void
  onDockSidebar?: (windowId: string) => void
}

function FloatingToolWindow({
  window,
  renderContent,
  labels,
  onBeginDrag,
  onDock,
  onBeginTabDrag,
  onActivateTab,
  onClose,
  onDockRight,
  onDockSidebar
}: FloatingToolWindowProps): React.JSX.Element {
  return (
    <section
      className="bottom-panel floating-tool-window floating-tab-window"
      style={{
        left: window.bounds.x,
        top: window.bounds.y,
        width: window.bounds.width,
        height: window.bounds.height
      }}
    >
      <header className="floating-tab-header">
        <button
          className="floating-tab-drag"
          type="button"
          title="拖动到下方停靠区拼接；双击合并回底部标签"
          aria-label="拖动工具窗口"
          onPointerDown={(event) => onBeginDrag(window.id, event)}
          onDoubleClick={() => onDock(window.id)}
        >
          ⠿
        </button>
        <div
          className="floating-tab-titles"
          role="tablist"
          data-tool-tab-group={`float:${window.id}`}
        >
          {window.tabs.map((tab) => (
            <button
              className={window.activeTab === tab ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={window.activeTab === tab}
              data-tool-tab={tab}
              key={tab}
              title="左右拖动调整标签顺序"
              onPointerDown={(event) => onBeginTabDrag(tab, event)}
              onClick={() => onActivateTab(window.id, tab)}
            >
              {labels[tab] ?? tab}
            </button>
          ))}
        </div>
        <button
          type="button"
          title="合并回底部工具窗口"
          aria-label="合并回底部工具窗口"
          onClick={() => onDock(window.id)}
        >
          ▣
        </button>
        {onDockRight ? (
          <button
            type="button"
            title="停靠回右侧栏"
            aria-label="停靠回右侧栏"
            onClick={() => onDockRight(window.id)}
          >
            ⇥
          </button>
        ) : null}
        {onDockSidebar ? (
          <button
            type="button"
            title="停靠回左侧栏"
            aria-label="停靠回左侧栏"
            onClick={() => onDockSidebar(window.id)}
          >
            ⇤
          </button>
        ) : null}
        <button
          type="button"
          title="关闭浮动工具窗口"
          aria-label="关闭浮动工具窗口"
          onClick={() => onClose(window.id)}
        >
          ×
        </button>
      </header>
      <div className="floating-tool-content">
        {renderContent(window.activeTab)}
      </div>
    </section>
  )
}

export default FloatingToolWindow
