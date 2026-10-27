import type { BottomToolTab } from './components/BottomPanelContent'

export const BOTTOM_TOOL_TABS: BottomToolTab[] = [
  'console',
  'output',
  'errors',
  'diagnostics',
  'stack',
  'memory'
]

export const INSPECTOR_TOOL_TABS = [
  'changes',
  'problems',
  'terminal'
] as const

export type InspectorToolTab = (typeof INSPECTOR_TOOL_TABS)[number]
export type SidebarToolTab = 'sidebar'
export type ToolTab = BottomToolTab | InspectorToolTab | SidebarToolTab

export interface ToolPanelBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ToolDockPane {
  id: string
  tabs: ToolTab[]
  activeTab: ToolTab
  weight: number
}

export interface FloatingToolWindow {
  id: string
  tabs: ToolTab[]
  activeTab: ToolTab
  bounds: ToolPanelBounds
}

export interface ToolWindowLayout {
  left: ToolTab[]
  right: ToolTab[]
  activeLeft: ToolTab | null
  activeRight: ToolTab | null
  docked: ToolDockPane[]
  floating: FloatingToolWindow[]
}

export type ToolDropPosition = 'left' | 'center' | 'right'
export type InspectorDockPosition = 'right' | 'bottom'
export type InspectorToolDropTarget = InspectorDockPosition | 'float'
export type ToolDockArea = 'left' | 'right' | 'bottom'
export type ToolDockDropTarget = ToolDockArea | 'float'
export type ToolTabGroupId = 'left' | 'right' | `bottom:${string}` | `float:${string}`

export interface ToolWindowRect {
  left: number
  top: number
  width: number
  height: number
}

export function resolveInspectorDockDropTarget(
  clientX: number,
  clientY: number,
  rect: ToolWindowRect
): InspectorDockPosition | null {
  const inside =
    clientX >= rect.left &&
    clientX <= rect.left + rect.width &&
    clientY >= rect.top &&
    clientY <= rect.top + rect.height
  if (!inside) {
    return null
  }

  if (clientY >= rect.top + rect.height * 0.64) {
    return 'bottom'
  }
  if (clientX >= rect.left + rect.width * 0.62) {
    return 'right'
  }
  return null
}

export function resolveInspectorToolDropTarget(
  clientX: number,
  clientY: number,
  rect: ToolWindowRect
): InspectorToolDropTarget {
  return resolveInspectorDockDropTarget(clientX, clientY, rect) ?? 'float'
}

export function resolveToolDockDropTarget(
  clientX: number,
  clientY: number,
  rect: ToolWindowRect,
  sideWidth = 280,
  bottomHeight = 240
): ToolDockDropTarget {
  const inside =
    clientX >= rect.left &&
    clientX <= rect.left + rect.width &&
    clientY >= rect.top &&
    clientY <= rect.top + rect.height
  if (!inside) {
    return 'float'
  }
  if (clientX <= rect.left + Math.min(sideWidth, rect.width * 0.3)) {
    return 'left'
  }
  if (
    clientX >=
    rect.left + rect.width - Math.min(sideWidth, rect.width * 0.3)
  ) {
    return 'right'
  }
  if (clientY >= rect.top + rect.height - bottomHeight) {
    return 'bottom'
  }
  return 'float'
}

let nextToolWindowId = 1

function createId(prefix: 'dock' | 'float'): string {
  return `${prefix}-${Date.now().toString(36)}-${nextToolWindowId++}`
}

export function isBottomToolTab(value: unknown): value is BottomToolTab {
  return BOTTOM_TOOL_TABS.includes(value as BottomToolTab)
}

export function isInspectorToolTab(
  value: unknown
): value is InspectorToolTab {
  return INSPECTOR_TOOL_TABS.includes(value as InspectorToolTab)
}

export function isToolTab(value: unknown): value is ToolTab {
  return (
    isBottomToolTab(value) ||
    isInspectorToolTab(value) ||
    value === 'sidebar'
  )
}

export function isSidebarToolTab(value: unknown): value is SidebarToolTab {
  return value === 'sidebar'
}

export function createToolDockPane(
  tabs: ToolTab[],
  activeTab = tabs[0],
  weight = 1
): ToolDockPane {
  const uniqueTabs = [...new Set(tabs.filter(isToolTab))]
  if (!uniqueTabs.length || !activeTab) {
    throw new Error('工具窗口至少需要一个标签。')
  }
  return {
    id: createId('dock'),
    tabs: uniqueTabs,
    activeTab: uniqueTabs.includes(activeTab) ? activeTab : uniqueTabs[0],
    weight: Math.max(0.2, weight)
  }
}

export function createFloatingToolWindow(
  tab: ToolTab,
  bounds: ToolPanelBounds
): FloatingToolWindow {
  return {
    id: createId('float'),
    tabs: [tab],
    activeTab: tab,
    bounds
  }
}

export function createToolWindowLayout(
  activeTab: ToolTab | null,
  floating?: {
    tab: ToolTab
    bounds: ToolPanelBounds
  } | null
): ToolWindowLayout {
  return {
    left: ['sidebar'],
    right: [...INSPECTOR_TOOL_TABS],
    activeLeft: 'sidebar',
    activeRight: 'changes',
    docked: activeTab
      ? [
          createToolDockPane(
            isBottomToolTab(activeTab)
              ? BOTTOM_TOOL_TABS
              : [activeTab],
            activeTab
          )
        ]
      : [],
    floating: floating
      ? [createFloatingToolWindow(floating.tab, floating.bounds)]
      : []
  }
}

function findDockedTab(
  layout: ToolWindowLayout,
  tab: ToolTab
): ToolDockPane | null {
  return layout.docked.find((pane) => pane.tabs.includes(tab)) ?? null
}

function findFloatingTab(
  layout: ToolWindowLayout,
  tab: ToolTab
): FloatingToolWindow | null {
  return layout.floating.find((window) => window.tabs.includes(tab)) ?? null
}

export function openToolTab(
  layout: ToolWindowLayout,
  tab: ToolTab
): ToolWindowLayout {
  if (layout.left.includes(tab)) {
    return { ...layout, activeLeft: tab }
  }
  if (layout.right.includes(tab)) {
    return { ...layout, activeRight: tab }
  }
  if (isInspectorToolTab(tab)) {
    return dockToolTab(layout, tab, 'right')
  }
  if (isSidebarToolTab(tab)) {
    return dockToolTab(layout, tab, 'left')
  }
  const floating = findFloatingTab(layout, tab)
  if (floating) {
    return {
      ...layout,
      floating: [
        ...layout.floating.filter((window) => window.id !== floating.id),
        { ...floating, activeTab: tab }
      ]
    }
  }

  const pane = findDockedTab(layout, tab)
  if (pane) {
    return {
      ...layout,
      docked: layout.docked.map((candidate) =>
        candidate.id === pane.id
          ? { ...candidate, activeTab: tab }
          : candidate
      )
    }
  }

  const availableTabs: ToolTab[] = isBottomToolTab(tab)
    ? BOTTOM_TOOL_TABS.filter(
        (candidate) => !findFloatingTab(layout, candidate)
      )
    : [tab]
  if (!layout.docked.length) {
    return {
      ...layout,
      docked: [createToolDockPane(availableTabs, tab)]
    }
  }

  const target = layout.docked.at(-1) as ToolDockPane
  return {
    ...layout,
    docked: layout.docked.map((candidate) =>
      candidate.id === target.id
        ? {
            ...candidate,
            tabs: [...new Set([...candidate.tabs, tab])],
            activeTab: tab
          }
        : candidate
    )
  }
}

export function toggleToolTab(
  layout: ToolWindowLayout,
  tab: ToolTab
): ToolWindowLayout {
  if (layout.left.includes(tab)) {
    return layout.activeLeft === tab
      ? {
          ...layout,
          left: layout.left.filter((candidate) => candidate !== tab),
          activeLeft:
            layout.left.find((candidate) => candidate !== tab) ?? null
        }
      : { ...layout, activeLeft: tab }
  }
  if (layout.right.includes(tab)) {
    return layout.activeRight === tab
      ? {
          ...layout,
          right: layout.right.filter((candidate) => candidate !== tab),
          activeRight:
            layout.right.find((candidate) => candidate !== tab) ?? null
        }
      : { ...layout, activeRight: tab }
  }
  const floating = findFloatingTab(layout, tab)
  if (floating) {
    return openToolTab(layout, tab)
  }

  const pane = findDockedTab(layout, tab)
  if (pane?.activeTab === tab) {
    return { ...layout, docked: [] }
  }
  return openToolTab(layout, tab)
}

export function activateToolTab(
  layout: ToolWindowLayout,
  ownerId: string,
  tab: ToolTab
): ToolWindowLayout {
  return {
    ...layout,
    activeLeft:
      ownerId === 'left' && layout.left.includes(tab)
        ? tab
        : layout.activeLeft,
    activeRight:
      ownerId === 'right' && layout.right.includes(tab)
        ? tab
        : layout.activeRight,
    docked: layout.docked.map((pane) =>
      pane.id === ownerId && pane.tabs.includes(tab)
        ? { ...pane, activeTab: tab }
        : pane
    ),
    floating: layout.floating.map((window) =>
      window.id === ownerId && window.tabs.includes(tab)
        ? { ...window, activeTab: tab }
        : window
    )
  }
}

export function tearOffDockedTab(
  layout: ToolWindowLayout,
  tab: ToolTab,
  bounds: ToolPanelBounds
): ToolWindowLayout {
  if (!findDockedTab(layout, tab) || findFloatingTab(layout, tab)) {
    return layout
  }

  const docked = layout.docked.flatMap((pane) => {
    if (!pane.tabs.includes(tab)) {
      return [pane]
    }
    const tabs = pane.tabs.filter((candidate) => candidate !== tab)
    if (!tabs.length) {
      return []
    }
    return [
      {
        ...pane,
        tabs,
        activeTab:
          pane.activeTab === tab ? tabs[Math.min(1, tabs.length - 1)] : pane.activeTab
      }
    ]
  })

  return {
    ...layout,
    docked,
    floating: [
      ...layout.floating,
      createFloatingToolWindow(tab, bounds)
    ]
  }
}

export function updateFloatingToolBounds(
  layout: ToolWindowLayout,
  windowId: string,
  bounds: ToolPanelBounds
): ToolWindowLayout {
  return {
    ...layout,
    floating: layout.floating.map((window) =>
      window.id === windowId ? { ...window, bounds } : window
    )
  }
}

export function dockFloatingToolWindow(
  layout: ToolWindowLayout,
  windowId: string,
  position: ToolDropPosition,
  targetPaneId?: string
): ToolWindowLayout {
  const floating = layout.floating.find((window) => window.id === windowId)
  if (!floating) {
    return layout
  }

  const remaining = layout.floating.filter((window) => window.id !== windowId)
  if (!layout.docked.length || position === 'center') {
    const target =
      layout.docked.find((pane) => pane.id === targetPaneId) ??
      layout.docked.at(-1)
    if (!target) {
      return {
        ...layout,
        docked: [
          createToolDockPane(floating.tabs, floating.activeTab)
        ],
        floating: remaining
      }
    }
    return {
      ...layout,
      docked: layout.docked.map((pane) =>
        pane.id === target.id
          ? {
              ...pane,
              tabs: [...new Set([...pane.tabs, ...floating.tabs])],
              activeTab: floating.activeTab
            }
          : pane
      ),
      floating: remaining
    }
  }

  const targetIndex = Math.max(
    0,
    layout.docked.findIndex((pane) => pane.id === targetPaneId)
  )
  const insertAt = position === 'left' ? targetIndex : targetIndex + 1
  const docked = [...layout.docked]
  docked.splice(
    insertAt,
    0,
    createToolDockPane(floating.tabs, floating.activeTab)
  )
  return { ...layout, docked, floating: remaining }
}

export function closeDockedToolPane(
  layout: ToolWindowLayout,
  paneId: string
): ToolWindowLayout {
  return {
    ...layout,
    docked: layout.docked.filter((pane) => pane.id !== paneId)
  }
}

export function splitDockedToolTab(
  layout: ToolWindowLayout,
  paneId: string,
  tab: ToolTab
): ToolWindowLayout {
  const paneIndex = layout.docked.findIndex((pane) => pane.id === paneId)
  const pane = layout.docked[paneIndex]
  if (!pane || !pane.tabs.includes(tab)) {
    return layout
  }

  const remainingTabs = pane.tabs.filter((candidate) => candidate !== tab)
  if (!remainingTabs.length) {
    return layout
  }
  const nextPane = createToolDockPane(
    [tab],
    tab,
    Math.max(0.2, pane.weight)
  )
  return {
    ...layout,
    docked: [
      ...layout.docked.slice(0, paneIndex),
      {
        ...pane,
        tabs: remainingTabs,
        activeTab:
          pane.activeTab === tab
            ? remainingTabs[Math.min(1, remainingTabs.length - 1)]
            : pane.activeTab
      },
      nextPane,
      ...layout.docked.slice(paneIndex + 1)
    ]
  }
}

export function closeFloatingToolWindow(
  layout: ToolWindowLayout,
  windowId: string
): ToolWindowLayout {
  return {
    ...layout,
    floating: layout.floating.filter((window) => window.id !== windowId)
  }
}

export function getActiveDockedTab(
  layout: ToolWindowLayout
): ToolTab | null {
  return layout.docked.at(-1)?.activeTab ?? null
}

export function getVisibleToolTabs(
  layout: ToolWindowLayout
): ToolTab[] {
  return [
    ...layout.left,
    ...layout.right,
    ...layout.docked.flatMap((pane) => pane.tabs),
    ...layout.floating.flatMap((window) => window.tabs)
  ]
}

export function parseToolWindowLayout(
  value: unknown
): ToolWindowLayout | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Partial<ToolWindowLayout>
  if (!Array.isArray(candidate.docked) || !Array.isArray(candidate.floating)) {
    return null
  }

  const seen = new Set<ToolTab>()
  const readTabs = (tabs: unknown): ToolTab[] => {
    if (!Array.isArray(tabs)) {
      return []
    }
    return tabs.filter((tab): tab is ToolTab => {
      if (!isToolTab(tab) || seen.has(tab)) {
        return false
      }
      seen.add(tab)
      return true
    })
  }

  const docked: ToolDockPane[] = []
  for (const rawPane of candidate.docked) {
    if (!rawPane || typeof rawPane !== 'object') {
      continue
    }
    const tabs = readTabs(rawPane.tabs)
    if (!tabs.length) {
      continue
    }
    docked.push({
      id:
        typeof rawPane.id === 'string' && rawPane.id
          ? rawPane.id
          : createId('dock'),
      tabs,
      activeTab: tabs.includes(rawPane.activeTab)
        ? rawPane.activeTab
        : tabs[0],
      weight:
        typeof rawPane.weight === 'number' &&
        Number.isFinite(rawPane.weight)
          ? Math.min(5, Math.max(0.2, rawPane.weight))
          : 1
    })
  }

  const floating: FloatingToolWindow[] = []
  for (const rawWindow of candidate.floating) {
    if (!rawWindow || typeof rawWindow !== 'object') {
      continue
    }
    const tabs = readTabs(rawWindow.tabs)
    const bounds = parseToolPanelBounds(rawWindow.bounds)
    if (!tabs.length || !bounds) {
      continue
    }
    floating.push({
      id:
        typeof rawWindow.id === 'string' && rawWindow.id
          ? rawWindow.id
          : createId('float'),
      tabs,
      activeTab: tabs.includes(rawWindow.activeTab)
        ? rawWindow.activeTab
        : tabs[0],
      bounds
    })
  }

  const hasSideGroups =
    Array.isArray(candidate.left) && Array.isArray(candidate.right)
  const left = hasSideGroups
    ? readTabs(candidate.left)
    : (['sidebar'] as ToolTab[]).filter(
        (tab) => !seen.has(tab)
      )
  const right = hasSideGroups
    ? readTabs(candidate.right)
    : [...INSPECTOR_TOOL_TABS].filter(
        (tab) => !seen.has(tab)
      )
  return {
    left,
    right,
    activeLeft:
      left.includes(candidate.activeLeft as ToolTab)
        ? (candidate.activeLeft as ToolTab)
        : left[0] ?? null,
    activeRight:
      right.includes(candidate.activeRight as ToolTab)
        ? (candidate.activeRight as ToolTab)
        : right[0] ?? null,
    docked,
    floating
  }
}

export function removeToolTab(
  layout: ToolWindowLayout,
  tab: ToolTab
): ToolWindowLayout {
  const left = layout.left.filter((candidate) => candidate !== tab)
  const right = layout.right.filter((candidate) => candidate !== tab)
  return {
    ...layout,
    left,
    right,
    activeLeft:
      layout.activeLeft === tab
        ? left[Math.min(1, left.length - 1)] ?? null
        : layout.activeLeft,
    activeRight:
      layout.activeRight === tab
        ? right[Math.min(1, right.length - 1)] ?? null
        : layout.activeRight,
    docked: layout.docked.flatMap((pane) => {
      if (!pane.tabs.includes(tab)) {
        return [pane]
      }
      const tabs = pane.tabs.filter((candidate) => candidate !== tab)
      if (!tabs.length) {
        return []
      }
      return [
        {
          ...pane,
          tabs,
          activeTab:
            pane.activeTab === tab
              ? tabs[Math.min(1, tabs.length - 1)]
              : pane.activeTab
        }
      ]
    }),
    floating: layout.floating.flatMap((window) => {
      if (!window.tabs.includes(tab)) {
        return [window]
      }
      const tabs = window.tabs.filter((candidate) => candidate !== tab)
      if (!tabs.length) {
        return []
      }
      return [
        {
          ...window,
          tabs,
          activeTab:
            window.activeTab === tab
              ? tabs[Math.min(1, tabs.length - 1)]
              : window.activeTab
        }
      ]
    })
  }
}

function reorderTabs(
  tabs: ToolTab[],
  tab: ToolTab,
  targetTab: ToolTab,
  after: boolean
): ToolTab[] {
  if (tab === targetTab) {
    return tabs
  }
  const next = tabs.filter((candidate) => candidate !== tab)
  const targetIndex = next.indexOf(targetTab)
  if (targetIndex < 0) {
    return tabs
  }
  next.splice(targetIndex + (after ? 1 : 0), 0, tab)
  return next
}

export function reorderToolTabInGroup(
  layout: ToolWindowLayout,
  groupId: ToolTabGroupId,
  tab: ToolTab,
  targetTab: ToolTab,
  after: boolean
): ToolWindowLayout {
  if (groupId === 'left') {
    return {
      ...layout,
      left: reorderTabs(layout.left, tab, targetTab, after)
    }
  }
  if (groupId === 'right') {
    return {
      ...layout,
      right: reorderTabs(layout.right, tab, targetTab, after)
    }
  }

  const [kind, ownerId] = groupId.split(':', 2)
  if (kind === 'bottom') {
    return {
      ...layout,
      docked: layout.docked.map((pane) =>
        pane.id === ownerId
          ? {
              ...pane,
              tabs: reorderTabs(
                pane.tabs,
                tab,
                targetTab,
                after
              )
            }
          : pane
      )
    }
  }
  if (kind === 'float') {
    return {
      ...layout,
      floating: layout.floating.map((window) =>
        window.id === ownerId
          ? {
              ...window,
              tabs: reorderTabs(
                window.tabs,
                tab,
                targetTab,
                after
              )
            }
          : window
      )
    }
  }
  return layout
}

export function dockToolTab(
  layout: ToolWindowLayout,
  tab: ToolTab,
  dock: 'left' | 'right' | 'bottom' = 'bottom',
  position: ToolDropPosition = 'center',
  targetPaneId?: string
): ToolWindowLayout {
  const remaining = removeToolTab(layout, tab)
  if (dock === 'left') {
    return {
      ...remaining,
      left: [...new Set([...remaining.left, tab])],
      activeLeft: tab
    }
  }
  if (dock === 'right') {
    return {
      ...remaining,
      right: [...new Set([...remaining.right, tab])],
      activeRight: tab
    }
  }
  if (!remaining.docked.length || position === 'center') {
    const target =
      remaining.docked.find((pane) => pane.id === targetPaneId) ??
      remaining.docked.at(-1)
    if (!target) {
      return {
        ...remaining,
        docked: [createToolDockPane([tab])]
      }
    }
    return {
      ...remaining,
      docked: remaining.docked.map((pane) =>
        pane.id === target.id
          ? {
              ...pane,
              tabs: [...new Set([...pane.tabs, tab])],
              activeTab: tab
            }
          : pane
      )
    }
  }

  const targetIndex = Math.max(
    0,
    remaining.docked.findIndex((pane) => pane.id === targetPaneId)
  )
  const insertAt = position === 'left' ? targetIndex : targetIndex + 1
  const docked = [...remaining.docked]
  docked.splice(insertAt, 0, createToolDockPane([tab]))
  return { ...remaining, docked }
}

export function floatToolTab(
  layout: ToolWindowLayout,
  tab: ToolTab,
  bounds: ToolPanelBounds
): ToolWindowLayout {
  const remaining = removeToolTab(layout, tab)
  return {
    ...remaining,
    floating: [
      ...remaining.floating,
      createFloatingToolWindow(tab, bounds)
    ]
  }
}

export function parseToolPanelBounds(value: unknown): ToolPanelBounds | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Partial<ToolPanelBounds>
  if (
    typeof candidate.x !== 'number' ||
    typeof candidate.y !== 'number' ||
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number' ||
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height)
  ) {
    return null
  }
  return {
    x: Math.max(8, candidate.x),
    y: Math.max(34, candidate.y),
    width: Math.max(360, candidate.width),
    height: Math.max(180, candidate.height)
  }
}
