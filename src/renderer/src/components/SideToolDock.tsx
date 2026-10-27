import type { PointerEvent, ReactNode } from 'react'
import type { ToolTab } from '../tool-windows'

interface SideToolDockProps {
  side: 'left' | 'right'
  tabs: ToolTab[]
  activeTab: ToolTab | null
  labels: Record<string, string>
  errorCount: number
  renderContent: (tab: ToolTab) => ReactNode
  onBeginTabDrag: (
    tab: ToolTab,
    event: PointerEvent<HTMLButtonElement>
  ) => void
  onBeginGroupDrag: (
    tab: ToolTab,
    event: PointerEvent<HTMLButtonElement>
  ) => void
  onActivateTab: (tab: ToolTab) => void
  onCloseTab: (tab: ToolTab) => void
}

function SideToolDock({
  side,
  tabs,
  activeTab,
  labels,
  errorCount,
  renderContent,
  onBeginTabDrag,
  onBeginGroupDrag,
  onActivateTab,
  onCloseTab
}: SideToolDockProps): React.JSX.Element | null {
  if (!tabs.length) {
    return null
  }

  const visibleTab =
    activeTab && tabs.includes(activeTab) ? activeTab : tabs[0]

  return (
    <section
      className={`side-tool-dock side-tool-dock-${side}`}
      data-tool-dock-area={side}
    >
      <div
        className="inspector-tabs side-tool-tabs"
        role="tablist"
        data-tool-tab-group={side}
      >
        <button
          className="side-tool-grip"
          type="button"
          title="拖动当前工具窗口到左侧、右侧、底部或浮动"
          aria-label="移动当前工具窗口"
          data-tool-tab-label={labels[visibleTab] ?? visibleTab}
          onPointerDown={(event) =>
            onBeginGroupDrag(visibleTab, event)
          }
        >
          ⠿
        </button>
        {tabs.map((tab) => (
          <button
            className={`inspector-tab ${
              visibleTab === tab ? 'active' : ''
            }`}
            type="button"
            role="tab"
            aria-selected={visibleTab === tab}
            data-tool-tab={tab}
            key={tab}
            title="左右拖动调整标签顺序"
            onPointerDown={(event) => onBeginTabDrag(tab, event)}
            onClick={() => onActivateTab(tab)}
          >
            {labels[tab] ?? tab}
            {tab === 'errors' && errorCount ? (
              <span>{errorCount}</span>
            ) : null}
          </button>
        ))}
        <button
          className="inspector-hide-button"
          type="button"
          title={`关闭${labels[visibleTab] ?? visibleTab}`}
          aria-label={`关闭${labels[visibleTab] ?? visibleTab}`}
          onClick={() => onCloseTab(visibleTab)}
        >
          ×
        </button>
      </div>
      <div className="side-tool-content">
        {renderContent(visibleTab)}
      </div>
    </section>
  )
}

export default SideToolDock
