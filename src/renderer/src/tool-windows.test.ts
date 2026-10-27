import { describe, expect, it } from 'vitest'
import {
  BOTTOM_TOOL_TABS,
  createFloatingToolWindow,
  createToolDockPane,
  createToolWindowLayout,
  dockToolTab,
  dockFloatingToolWindow,
  floatToolTab,
  openToolTab,
  parseToolWindowLayout,
  resolveInspectorDockDropTarget,
  resolveInspectorToolDropTarget,
  resolveToolDockDropTarget,
  removeToolTab,
  reorderToolTabInGroup,
  splitDockedToolTab,
  tearOffDockedTab,
  toggleToolTab,
  type ToolWindowLayout
} from './tool-windows'

const bounds = { x: 40, y: 80, width: 520, height: 260 }

describe('tool window layout', () => {
  it('recognizes left, right, bottom, and floating dock zones', () => {
    const workspace = { left: 0, top: 0, width: 1000, height: 600 }

    expect(resolveToolDockDropTarget(100, 200, workspace)).toBe('left')
    expect(resolveToolDockDropTarget(900, 200, workspace)).toBe('right')
    expect(resolveToolDockDropTarget(500, 500, workspace)).toBe('bottom')
    expect(resolveToolDockDropTarget(500, 250, workspace)).toBe('float')
  })

  it('moves any tool tab between both side groups and the bottom group', () => {
    const initial = createToolWindowLayout('output')
    const left = dockToolTab(initial, 'terminal', 'left')
    const right = dockToolTab(left, 'terminal', 'right')
    const bottom = dockToolTab(
      right,
      'terminal',
      'bottom',
      'center',
      right.docked[0].id
    )

    expect(left.left).toContain('terminal')
    expect(left.docked.flatMap((pane) => pane.tabs)).not.toContain(
      'terminal'
    )
    expect(right.right).toContain('terminal')
    expect(right.left).not.toContain('terminal')
    expect(
      bottom.docked.flatMap((pane) => pane.tabs)
    ).toContain('terminal')
    expect(bottom.right).not.toContain('terminal')
  })

  it('reorders tabs inside each kind of tab group', () => {
    const layout = createToolWindowLayout('output')
    const reordered = reorderToolTabInGroup(
      layout,
      'right',
      'terminal',
      'changes',
      false
    )
    expect(reordered.right.slice(0, 2)).toEqual(['terminal', 'changes'])

    const paneId = layout.docked[0].id
    const reorderedBottom = reorderToolTabInGroup(
      layout,
      `bottom:${paneId}`,
      'memory',
      'console',
      false
    )
    expect(reorderedBottom.docked[0].tabs[0]).toBe('memory')
  })

  it('adds an inspector tab to the existing bottom tab group', () => {
    const layout = createToolWindowLayout('output')
    const next = dockToolTab(
      layout,
      'terminal',
      'bottom',
      'center',
      layout.docked[0].id
    )

    expect(next.docked).toHaveLength(1)
    expect(next.docked[0].tabs).toEqual(
      expect.arrayContaining(['output', 'terminal'])
    )
    expect(next.docked[0].activeTab).toBe('terminal')
  })

  it('floats and restores an individual inspector tab', () => {
    const layout = createToolWindowLayout('output')
    const floating = floatToolTab(layout, 'changes', bounds)

    expect(floating.floating[0]).toMatchObject({
      tabs: ['changes'],
      activeTab: 'changes'
    })
    expect(floating.docked.flatMap((pane) => pane.tabs)).not.toContain(
      'changes'
    )

    expect(removeToolTab(floating, 'changes').floating).toEqual([])
  })

  it('merges and floats the sidebar as an independent tool tab', () => {
    const layout = createToolWindowLayout('output')
    const docked = dockToolTab(
      layout,
      'sidebar',
      'bottom',
      'center',
      layout.docked[0].id
    )

    expect(docked.docked).toHaveLength(1)
    expect(docked.docked[0].tabs).toContain('sidebar')

    const floating = floatToolTab(docked, 'sidebar', bounds)
    expect(floating.floating[0].activeTab).toBe('sidebar')
    expect(
      floating.docked.flatMap((pane) => pane.tabs)
    ).not.toContain('sidebar')
  })

  it('recognizes the right and bottom inspector drop zones', () => {
    const workbench = { left: 100, top: 50, width: 1000, height: 600 }

    expect(
      resolveInspectorDockDropTarget(850, 180, workbench)
    ).toBe('right')
    expect(
      resolveInspectorDockDropTarget(600, 560, workbench)
    ).toBe('bottom')
    expect(
      resolveInspectorDockDropTarget(420, 220, workbench)
    ).toBeNull()
    expect(
      resolveInspectorDockDropTarget(20, 700, workbench)
    ).toBeNull()
  })

  it('floats a tab dropped anywhere outside the inspector dock zones', () => {
    const workbench = { left: 100, top: 50, width: 1000, height: 600 }

    expect(
      resolveInspectorToolDropTarget(420, 220, workbench)
    ).toBe('float')
    expect(
      resolveInspectorToolDropTarget(20, 700, workbench)
    ).toBe('float')
  })

  it('opens all legacy bottom tabs in one pane', () => {
    const layout = createToolWindowLayout('errors')

    expect(layout.docked).toHaveLength(1)
    expect(layout.docked[0].tabs).toEqual(BOTTOM_TOOL_TABS)
    expect(layout.docked[0].activeTab).toBe('errors')
  })

  it('moves a torn tab into a floating window without duplicating it', () => {
    const layout = createToolWindowLayout('output')
    const next = tearOffDockedTab(layout, 'errors', bounds)

    expect(next.docked[0].tabs).not.toContain('errors')
    expect(next.floating[0]).toMatchObject({
      tabs: ['errors'],
      activeTab: 'errors',
      bounds
    })
    expect(
      [...next.docked.flatMap((pane) => pane.tabs), ...next.floating.flatMap((window) => window.tabs)]
    ).toEqual(expect.arrayContaining(BOTTOM_TOOL_TABS))
    expect(
      new Set([
        ...next.docked.flatMap((pane) => pane.tabs),
        ...next.floating.flatMap((window) => window.tabs)
      ]).size
    ).toBe(BOTTOM_TOOL_TABS.length)
  })

  it('turns a floating window into a separate docked column', () => {
    const layout = createToolWindowLayout('output')
    const torn = tearOffDockedTab(layout, 'errors', bounds)
    const floatingId = torn.floating[0].id
    const next = dockFloatingToolWindow(
      torn,
      floatingId,
      'right',
      torn.docked[0].id
    )

    expect(next.floating).toEqual([])
    expect(next.docked).toHaveLength(2)
    expect(next.docked[0].tabs).toContain('output')
    expect(next.docked[1].tabs).toEqual(['errors'])
  })

  it('merges a floating window back into an existing tab group', () => {
    const layout = createToolWindowLayout('output')
    const torn = tearOffDockedTab(layout, 'errors', bounds)
    const next = dockFloatingToolWindow(
      torn,
      torn.floating[0].id,
      'center',
      torn.docked[0].id
    )

    expect(next.docked).toHaveLength(1)
    expect(next.docked[0].tabs).toContain('errors')
    expect(next.docked[0].activeTab).toBe('errors')
  })

  it('allows multiple floating windows to coexist', () => {
    const layout = createToolWindowLayout('output')
    const first = tearOffDockedTab(layout, 'errors', bounds)
    const second = tearOffDockedTab(first, 'diagnostics', {
      ...bounds,
      x: 620
    })

    expect(second.floating).toHaveLength(2)
  })

  it('splits the active tab into a separate docked column', () => {
    const layout = createToolWindowLayout('output')
    const next = splitDockedToolTab(
      layout,
      layout.docked[0].id,
      'output'
    )

    expect(next.docked).toHaveLength(2)
    expect(next.docked[0].tabs).not.toContain('output')
    expect(next.docked[1]).toMatchObject({
      tabs: ['output'],
      activeTab: 'output'
    })
  })

  it('closes an active docked tab by hiding the dock, then reopens it', () => {
    const layout = createToolWindowLayout('output')
    const hidden = toggleToolTab(layout, 'output')
    const reopened = openToolTab(hidden, 'output')

    expect(hidden.docked).toEqual([])
    expect(reopened.docked[0].activeTab).toBe('output')
    expect(reopened.docked[0].tabs).toContain('memory')
  })

  it('round-trips a split layout and rejects duplicate tabs', () => {
    const pane = createToolDockPane(['output'])
    const floating = createFloatingToolWindow('errors', bounds)
    const layout: ToolWindowLayout = {
      left: ['changes'],
      right: ['problems'],
      activeLeft: 'changes',
      activeRight: 'problems',
      docked: [
        pane,
        {
          ...createToolDockPane(['diagnostics']),
          tabs: ['diagnostics', 'output']
        }
      ],
      floating: [floating]
    }
    const parsed = parseToolWindowLayout(JSON.parse(JSON.stringify(layout)))

    expect(parsed?.docked).toHaveLength(2)
    expect(parsed?.docked[1].tabs).toEqual(['diagnostics'])
    expect(parsed?.floating[0].activeTab).toBe('errors')
  })
})
