import {
  DiffEditor,
  Editor,
  type BeforeMount,
  type OnMount
} from '@monaco-editor/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import type {
  AppInfo,
  AppMenuCommand,
  AppUpdateStatus,
  CodeSearchResult,
  CppRunPreparation,
  CreateProjectInput,
  CreateWorkspaceEntryInput,
  DebugBreakpoint,
  DebugStackFrame,
  DebuggerSnapshot,
  FileEntry,
  GitFileChange,
  GitFileDiff,
  GitStatus,
  ProjectDiagnostic,
  ProjectInfo,
  PythonRunPreparation,
  RenameWorkspaceEntryInput,
  MemoryMetrics,
  WorkflowRunResult,
  WorkspaceViewSlot
} from '../../shared/desktop'
import { PROJECT_TEMPLATES } from '../../shared/desktop'
import AgentWorkspace from './components/AgentWorkspace'
import AppMenuBar from './components/AppMenuBar'
import ApplicationCloseDialog from './components/ApplicationCloseDialog'
import BottomPanelContent, {
  type BottomToolTab
} from './components/BottomPanelContent'
import CommandPalette, { type CommandItem } from './components/CommandPalette'
import type {
  DiagnosticEvent,
  DiagnosticMetricSample
} from './components/DiagnosticToolsPanel'
import FloatingToolWindow from './components/FloatingToolWindow'
import ExplorerContextMenu, {
  type ExplorerContextTarget
} from './components/ExplorerContextMenu'
import EditorContextMenu from './components/EditorContextMenu'
import FilePreviewWindow from './components/FilePreviewWindow'
import MarkdownContent from './components/MarkdownContent'
import NewProjectModal from './components/NewProjectModal'
import ProblemsPanel from './components/ProblemsPanel'
import ProjectMissingDialog from './components/ProjectMissingDialog'
import SettingsModal from './components/SettingsModal'
import SidebarPanel from './components/SidebarPanel'
import SideToolDock from './components/SideToolDock'
import SourceControlContent from './components/SourceControlContent'
import TerminalPanel from './components/TerminalPanel'
import ToolDockWorkspace from './components/ToolDockWorkspace'
import UnsavedChangesDialog from './components/UnsavedChangesDialog'
import WorkflowModal from './components/WorkflowModal'
import { parseCompilerDiagnostics } from './compiler-diagnostics'
import {
  appendCppImplementation,
  buildCppImplementation,
  cppFileHasNamespace,
  cppImplementationPath,
  isCppHeaderPath,
  locateCppFunctions,
  parseCppFunctionAt,
  type CppFunctionSymbol,
  type LocatedCppFunction
} from './cpp-functions'
import {
  APP_THEMES,
  monacoThemeFor,
  readAppearanceSettings,
  resolveThemePreference,
  type AppearanceSettings,
  type AppThemeId,
  type ThemePreference
} from './appearance'
import {
  buildEditorAgentPrompt,
  type AgentEditorFocus,
  type EditorAgentIntent
} from './agent-focus'
import {
  BOTTOM_TOOL_TABS,
  INSPECTOR_TOOL_TABS,
  activateToolTab,
  closeDockedToolPane,
  closeFloatingToolWindow,
  createToolWindowLayout,
  dockToolTab,
  dockFloatingToolWindow,
  floatToolTab,
  getActiveDockedTab,
  getVisibleToolTabs,
  isBottomToolTab,
  isInspectorToolTab,
  isSidebarToolTab,
  isToolTab,
  openToolTab,
  parseToolWindowLayout,
  resolveToolDockDropTarget,
  removeToolTab,
  reorderToolTabInGroup,
  splitDockedToolTab,
  tearOffDockedTab,
  updateFloatingToolBounds,
  type ToolDockDropTarget,
  type ToolTabGroupId,
  type ToolDropPosition,
  type ToolTab,
  type ToolWindowLayout
} from './tool-windows'

type WorkspaceTab = 'changes' | 'terminal' | 'diagnostics'

function inspectorTabToToolTab(tab: WorkspaceTab): ToolTab {
  return tab === 'diagnostics' ? 'problems' : tab
}

function toolTabToInspectorTab(tab: ToolTab): WorkspaceTab | null {
  if (tab === 'changes' || tab === 'terminal') {
    return tab
  }
  return tab === 'problems' ? 'diagnostics' : null
}

interface OpenFile {
  path: string
  name: string
  content: string
  savedContent: string
  dirty: boolean
}

interface EditorFunctionContext {
  requestId: number
  symbol: CppFunctionSymbol
  declaration: LocatedCppFunction | null
  definition: LocatedCppFunction | null
  loading: boolean
  canGenerate: boolean
}

const emptyGitStatus: GitStatus = {
  isRepository: false,
  branch: null,
  ahead: 0,
  behind: 0,
  changes: []
}

interface WorkspaceLayout {
  sidebarWidth: number
  inspectorWidth: number
  inspectorHeight: number
  inspectorDock: 'right' | 'bottom'
  bottomPanelHeight: number
  activityBarVisible: boolean
  sidebarVisible: boolean
  inspectorVisible: boolean
}

interface FloatingPanelBounds {
  x: number
  y: number
  width: number
  height: number
}

type BottomPanelTab = BottomToolTab
type SidebarMode = 'explorer' | 'search'
type WorkspaceSurface = 'code' | 'agent'

interface SavedWorkspaceView {
  layout: WorkspaceLayout
  activeInspectorTab: WorkspaceTab
  bottomPanelTab: BottomPanelTab | null
  sidebarMode: SidebarMode
  workspaceSurface: WorkspaceSurface
  floatingBottomPanel: FloatingPanelBounds | null
  floatingBottomTab: ToolTab | null
  floatingInspector: FloatingPanelBounds | null
  toolWindowLayout: ToolWindowLayout
}

interface SavedWorkspaceScheme extends SavedWorkspaceView {
  slot: WorkspaceViewSlot
  savedAt: string
}

interface OutputEntry {
  id: number
  time: string
  message: string
}

const defaultWorkspaceLayout: WorkspaceLayout = {
  sidebarWidth: 260,
  inspectorWidth: 302,
  inspectorHeight: 260,
  inspectorDock: 'right',
  bottomPanelHeight: 230,
  activityBarVisible: true,
  sidebarVisible: true,
  inspectorVisible: true
}

const workspaceViewSlots: WorkspaceViewSlot[] = [1, 2, 3, 4, 5]
const savedWorkspaceSchemesKey = 'ai-ide:workspace-view-schemes'
const toolWindowLayoutKey = 'ai-ide:tool-window-layout'

function normalizeWorkspaceLayout(
  parsed: Partial<WorkspaceLayout>
): WorkspaceLayout {
  return {
    sidebarWidth:
      typeof parsed.sidebarWidth === 'number'
        ? Math.min(520, Math.max(190, parsed.sidebarWidth))
        : defaultWorkspaceLayout.sidebarWidth,
    inspectorWidth:
      typeof parsed.inspectorWidth === 'number'
        ? Math.min(620, Math.max(230, parsed.inspectorWidth))
        : defaultWorkspaceLayout.inspectorWidth,
    inspectorHeight:
      typeof parsed.inspectorHeight === 'number'
        ? Math.min(680, Math.max(170, parsed.inspectorHeight))
        : defaultWorkspaceLayout.inspectorHeight,
    inspectorDock:
      'right',
    bottomPanelHeight:
      typeof parsed.bottomPanelHeight === 'number'
        ? Math.min(620, Math.max(150, parsed.bottomPanelHeight))
        : defaultWorkspaceLayout.bottomPanelHeight,
    activityBarVisible:
      typeof parsed.activityBarVisible === 'boolean'
        ? parsed.activityBarVisible
        : true,
    sidebarVisible:
      typeof parsed.sidebarVisible === 'boolean'
        ? parsed.sidebarVisible
        : true,
    inspectorVisible:
      typeof parsed.inspectorVisible === 'boolean'
        ? parsed.inspectorVisible
        : true
  }
}

function readWorkspaceLayout(): WorkspaceLayout {
  try {
    return normalizeWorkspaceLayout(
      JSON.parse(
        localStorage.getItem('ai-ide:workspace-layout') ?? '{}'
      ) as Partial<WorkspaceLayout>
    )
  } catch {
    return defaultWorkspaceLayout
  }
}

function parseSavedWorkspaceView(value: unknown): SavedWorkspaceView | null {
  try {
    const parsed = value as Partial<SavedWorkspaceView> | null
    if (!parsed?.layout) {
      return null
    }
    const activeInspectorTab: WorkspaceTab =
      parsed.activeInspectorTab === 'terminal' ||
      parsed.activeInspectorTab === 'diagnostics'
        ? parsed.activeInspectorTab
        : 'changes'
    const bottomPanelTab: BottomPanelTab | null = isBottomToolTab(
      parsed.bottomPanelTab
    )
      ? parsed.bottomPanelTab
      : null
    const floatingBottomTab: ToolTab | null = isToolTab(
      parsed.floatingBottomTab
    )
      ? parsed.floatingBottomTab
      : null
    const floatingBottomPanel = parseFloatingPanelBounds(
      parsed.floatingBottomPanel
    )
    const toolWindowLayout =
      parseToolWindowLayout(parsed.toolWindowLayout) ??
      createToolWindowLayout(
        bottomPanelTab,
        floatingBottomTab
          ? {
              tab: floatingBottomTab,
              bounds: floatingBottomPanel ?? {
                x: 36,
                y: 120,
                width: 560,
                height: 260
              }
            }
          : null
      )
    return {
      layout: normalizeWorkspaceLayout(parsed.layout),
      activeInspectorTab,
      bottomPanelTab,
      sidebarMode: parsed.sidebarMode === 'search' ? 'search' : 'explorer',
      workspaceSurface:
        parsed.workspaceSurface === 'agent' ? 'agent' : 'code',
      floatingBottomPanel,
      floatingBottomTab,
      floatingInspector: parseFloatingPanelBounds(parsed.floatingInspector),
      toolWindowLayout
    }
  } catch {
    return null
  }
}

function readToolWindowLayout(): ToolWindowLayout {
  try {
    return (
      parseToolWindowLayout(
        JSON.parse(localStorage.getItem(toolWindowLayoutKey) ?? 'null')
      ) ?? createToolWindowLayout(null)
    )
  } catch {
    return createToolWindowLayout(null)
  }
}

function parseFloatingPanelBounds(
  value: unknown
): FloatingPanelBounds | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Partial<FloatingPanelBounds>
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
    x: Math.max(8, candidate.x as number),
    y: Math.max(34, candidate.y as number),
    width: Math.max(360, candidate.width as number),
    height: Math.max(180, candidate.height as number)
  }
}

function readSavedWorkspaceSchemes(): SavedWorkspaceScheme[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(savedWorkspaceSchemesKey) ?? '[]'
    ) as unknown
    if (Array.isArray(parsed)) {
      const schemes = parsed.flatMap((item) => {
        if (!item || typeof item !== 'object') {
          return []
        }
        const candidate = item as Partial<SavedWorkspaceScheme>
        if (
          typeof candidate.slot !== 'number' ||
          !workspaceViewSlots.includes(candidate.slot as WorkspaceViewSlot)
        ) {
          return []
        }
        const view = parseSavedWorkspaceView(candidate)
        if (!view) {
          return []
        }
        return [
          {
            ...view,
            slot: candidate.slot as WorkspaceViewSlot,
            savedAt:
              typeof candidate.savedAt === 'string'
                ? candidate.savedAt
                : new Date().toISOString()
          }
        ]
      })
      return schemes.sort((left, right) => left.slot - right.slot)
    }
  } catch {
    // Fall through to the legacy single-view format.
  }

  try {
    const legacyView = parseSavedWorkspaceView(
      JSON.parse(
        localStorage.getItem('ai-ide:saved-workspace-view') ?? 'null'
      )
    )
    return legacyView
      ? [
          {
            ...legacyView,
            slot: 1,
            savedAt: new Date().toISOString()
          }
        ]
      : []
  } catch {
    return []
  }
}

interface FileTreeNodeProps {
  node: FileEntry
  depth: number
  activePath: string | null
  selectedPath: string | null
  collapsedPaths: Set<string>
  requireDoubleClick: boolean
  onSelectNode: (node: FileEntry) => void
  onToggleDirectory: (path: string) => void
  onOpenFile: (node: FileEntry) => void
  onOpenContextMenu: (
    event: React.MouseEvent,
    node: FileEntry
  ) => void
}

function collectDirectoryPaths(entries: FileEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.type === 'directory'
      ? [
          entry.path,
          ...collectDirectoryPaths(entry.children ?? [])
        ]
      : []
  )
}

function collectFiles(entries: FileEntry[]): FileEntry[] {
  return entries.flatMap((entry) =>
    entry.type === 'file'
      ? [entry]
      : collectFiles(entry.children ?? [])
  )
}

function findFileEntry(
  entries: FileEntry[],
  path: string
): FileEntry | null {
  const normalizedPath = path.replaceAll('\\', '/')
  for (const entry of entries) {
    if (entry.path.replaceAll('\\', '/') === normalizedPath) {
      return entry
    }
    const nested = findFileEntry(entry.children ?? [], path)
    if (nested) {
      return nested
    }
  }
  return null
}

const languageByExtension: Record<string, string> = {
  c: 'cpp',
  cc: 'cpp',
  cfg: 'ini',
  cmake: 'cmake',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cxx: 'cpp',
  go: 'go',
  h: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  kt: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  md: 'markdown',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'shell',
  sql: 'sql',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml'
}

const fileBadges: Record<string, string> = {
  c: 'C',
  cc: 'C+',
  cmake: 'CM',
  cpp: 'CP',
  cs: 'C#',
  css: 'CS',
  cxx: 'C+',
  go: 'GO',
  h: 'H',
  hpp: 'H+',
  html: 'HT',
  java: 'JV',
  js: 'JS',
  jsx: 'JX',
  json: '{}',
  kt: 'KT',
  lua: 'LU',
  md: 'MD',
  php: 'PH',
  py: 'PY',
  rb: 'RB',
  rs: 'RS',
  sql: 'DB',
  ts: 'TS',
  tsx: 'TX',
  xml: '<>',
  yaml: 'YM',
  yml: 'YM'
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

function extensionFromPath(path: string): string {
  const fileName = fileNameFromPath(path)
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : ''
}

function languageFromPath(path: string): string {
  const fileName = fileNameFromPath(path).toLowerCase()
  if (fileName === 'cmakelists.txt') {
    return 'cmake'
  }
  if (fileName === 'dockerfile') {
    return 'dockerfile'
  }
  return languageByExtension[extensionFromPath(path)] ?? 'plaintext'
}

function isCppSourcePath(path: string): boolean {
  return ['c', 'cc', 'cpp', 'cxx'].includes(extensionFromPath(path))
}

function isPythonSourcePath(path: string): boolean {
  return extensionFromPath(path) === 'py'
}

function fileTreeLooksLikeCpp(entries: FileEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.type === 'directory') {
      return fileTreeLooksLikeCpp(entry.children ?? [])
    }
    return (
      isCppSourcePath(entry.path) ||
      ['h', 'hh', 'hpp', 'hxx'].includes(extensionFromPath(entry.path)) ||
      entry.name.toLowerCase() === 'cmakelists.txt'
    )
  })
}

function bottomTabLabel(tab: BottomPanelTab): string {
  switch (tab) {
    case 'console':
      return '调试控制台'
    case 'output':
      return '输出'
    case 'errors':
      return '错误列表'
    case 'diagnostics':
      return '诊断工具'
    case 'stack':
      return '调用堆栈'
    case 'memory':
      return '内存'
  }
}

function fileBadge(path: string): string {
  const extension = extensionFromPath(path)
  return fileBadges[extension] ?? (extension ? extension.slice(0, 2).toUpperCase() : '·')
}

function projectAbsolutePath(projectPath: string, relativePath: string): string {
  const separator = projectPath.includes('\\') ? '\\' : '/'
  const root = projectPath.replace(/[\\/]+$/, '')
  return relativePath ? `${root}${separator}${relativePath}` : root
}

function replacePathPrefix(
  path: string,
  previousPrefix: string,
  nextPrefix: string
): string {
  if (path === previousPrefix) {
    return nextPrefix
  }
  const separator = path.includes('\\') ? '\\' : '/'
  const prefix = `${previousPrefix}${separator}`
  return path.startsWith(prefix)
    ? `${nextPrefix}${path.slice(previousPrefix.length)}`
    : path
}

function gitKindLabel(change: GitFileChange): string {
  switch (change.kind) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'untracked':
      return '?'
    case 'conflicted':
      return '!'
    case 'modified':
      return 'M'
    default:
      return '·'
  }
}

function readablePath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  if (segments.length <= 3) {
    return path
  }

  return `…\\${segments.slice(-3).join('\\')}`
}

function ActivityIcon({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <svg
      className="activity-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function ExplorerIcon(): React.JSX.Element {
  return (
    <ActivityIcon>
      <path d="M3.5 6.5h6l1.8 2h9.2v9.8a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2z" />
      <path d="M3.5 8.5V5.7a2.2 2.2 0 0 1 2.2-2.2h4.1l2 2h6.5a2.2 2.2 0 0 1 2.2 2.2v.8" />
    </ActivityIcon>
  )
}

function AgentIcon(): React.JSX.Element {
  return (
    <ActivityIcon>
      <path d="M8 4.5h8a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-4l-4 3v-3H8a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3z" />
      <path d="M9 9h.01M12 9h.01M15 9h.01M8.8 12.2c1.7 1.4 4.7 1.4 6.4 0" />
    </ActivityIcon>
  )
}

function SearchIcon(): React.JSX.Element {
  return (
    <ActivityIcon>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.2 4.2" />
    </ActivityIcon>
  )
}

function SourceControlIcon(): React.JSX.Element {
  return (
    <ActivityIcon>
      <circle cx="7" cy="4.5" r="2" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="7" cy="19.5" r="2" />
      <path d="M7 6.5v11M9 7h4a4 4 0 0 1 4 4v0" />
      <path d="m13.5 8.5 3.5-1.5V11" />
    </ActivityIcon>
  )
}

function RunDebugIcon(): React.JSX.Element {
  return (
    <ActivityIcon>
      <path d="m8 5 10 7-10 7z" />
      <circle cx="6" cy="6" r="1.6" />
      <circle cx="6" cy="18" r="1.6" />
    </ActivityIcon>
  )
}

function InspectorIcon(): React.JSX.Element {
  return (
    <ActivityIcon>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M14.5 4.5v15" />
    </ActivityIcon>
  )
}

function SettingsIcon(): React.JSX.Element {
  return (
    <ActivityIcon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.1 13.4a7.8 7.8 0 0 0 0-2.8l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.4-1.4L14 2.8h-4l-.3 2.5a8 8 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 2.8l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.4 1.4l.3 2.5h4l.3-2.5a8 8 0 0 0 2.4-1.4l2.4 1 2-3.4z" />
    </ActivityIcon>
  )
}

function configureMonacoTheme(monaco: Parameters<BeforeMount>[0]): void {
  for (const theme of APP_THEMES) {
    const accent = theme.accent.replace('#', '').toUpperCase()
    const isVisualStudio = theme.id === 'obsidian'
    const isLight = theme.id === 'paper' || theme.id === 'mist'
    const menu = {
      background: theme.menuBackground,
      foreground: theme.menuForeground,
      foregroundStrong: theme.menuForegroundStrong,
      border: theme.menuBorder,
      hover: theme.menuHover,
      separator: theme.menuSeparator
    }
    const syntax = isVisualStudio
      ? {
          comment: '6A9955',
          keyword: '569CD6',
          string: 'CE9178',
          number: 'B5CEA8',
          regexp: 'D16969',
          type: '4EC9B0',
          identifier: 'D4D4D4',
          variable: '9CDCFE',
          delimiter: 'D4D4D4',
          operator: 'D4D4D4'
        }
      : isLight
        ? {
            comment: '498246',
            keyword: '005A9E',
            string: 'A31515',
            number: '098658',
            regexp: '811F3F',
            type: '267F99',
            identifier: '24292F',
            variable: '0A5A78',
            delimiter: '52585D',
            operator: '6F42C1'
          }
        : {
          comment: '68727A',
          keyword: accent,
          string: 'B8D7A3',
          number: 'E9B872',
          regexp: 'E8A87C',
          type: '8EC9D8',
          identifier: 'D8DED9',
          variable: 'E3C58A',
          delimiter: '98A3A8',
          operator: 'C7A8DB'
          }
    monaco.editor.defineTheme(monacoThemeFor(theme.id), {
      base: isLight ? 'vs' : 'vs-dark',
      inherit: true,
      rules: [
        {
          token: 'comment',
          foreground: syntax.comment,
          fontStyle: 'italic'
        },
        { token: 'keyword', foreground: syntax.keyword },
        { token: 'string', foreground: syntax.string },
        { token: 'number', foreground: syntax.number },
        { token: 'regexp', foreground: syntax.regexp },
        { token: 'type', foreground: syntax.type },
        { token: 'type.identifier', foreground: syntax.type },
        { token: 'identifier', foreground: syntax.identifier },
        { token: 'variable', foreground: syntax.variable },
        { token: 'delimiter', foreground: syntax.delimiter },
        { token: 'operator', foreground: syntax.operator },
        { token: 'predefined', foreground: syntax.variable },
        { token: 'tag', foreground: syntax.keyword },
        { token: 'attribute.name', foreground: syntax.variable },
        { token: 'attribute.value', foreground: syntax.string }
      ],
      semanticHighlighting: true,
      colors: {
        'editor.background': theme.background.toUpperCase(),
        'editor.foreground': isVisualStudio
          ? '#D4D4D4'
          : isLight
            ? '#24292F'
            : '#D9DCD8',
        'editorLineNumber.foreground': isVisualStudio
          ? '#858585'
          : isLight
            ? '#8C959F'
            : '#465057',
        'editorLineNumber.activeForeground': isVisualStudio
          ? '#C6C6C6'
          : isLight
            ? '#4E5963'
            : '#9AA39F',
        'editorCursor.foreground': theme.accent.toUpperCase(),
        'editor.selectionBackground': isVisualStudio
          ? '#264F78'
          : isLight
            ? '#BBD7F5'
            : '#34452A',
        'editor.inactiveSelectionBackground': isVisualStudio
          ? '#3A3D41'
          : isLight
            ? '#E2EBF5'
            : '#24302A',
        'editor.lineHighlightBackground': isVisualStudio
          ? '#282828'
          : theme.panel.toUpperCase(),
        'editorIndentGuide.background1': isVisualStudio
          ? '#404040'
          : isLight
            ? '#D8DEE3'
            : '#1E252B',
        'editorIndentGuide.activeBackground1': isVisualStudio
          ? '#707070'
          : isLight
            ? '#A8B3BC'
            : '#364047',
        'editorWidget.background': menu.background,
        'editorWidget.foreground': menu.foreground,
        'editorWidget.border': menu.border,
        'menu.background': menu.background,
        'menu.foreground': menu.foreground,
        'menu.border': menu.border,
        'menu.selectionBackground': menu.hover,
        'menu.selectionForeground': menu.foregroundStrong,
        'menu.selectionBorder': '#007ACC',
        'menu.separatorBackground': menu.separator,
        'menu.shadowColor': '#00000066',
        'scrollbarSlider.background': '#FFFFFF12',
        'scrollbarSlider.hoverBackground': '#FFFFFF20'
      }
    })
  }
}

function FileTreeNode({
  node,
  depth,
  activePath,
  selectedPath,
  collapsedPaths,
  requireDoubleClick,
  onSelectNode,
  onToggleDirectory,
  onOpenFile,
  onOpenContextMenu
}: FileTreeNodeProps): React.JSX.Element {
  const isDirectory = node.type === 'directory'
  const isCollapsed = collapsedPaths.has(node.path)
  const isActive = activePath === node.path

  return (
    <div className="tree-node">
      <button
        className={`tree-row ${isDirectory ? 'directory-row' : ''} ${isActive ? 'active' : ''} ${selectedPath === node.path ? 'selected' : ''}`}
        type="button"
        data-tree-path={node.path}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        title={node.path}
        onClick={() => {
          onSelectNode(node)
          if (isDirectory) {
            onToggleDirectory(node.path)
          } else if (!requireDoubleClick) {
            onOpenFile(node)
          }
        }}
        onDoubleClick={() => {
          if (!isDirectory) {
            onOpenFile(node)
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onOpenContextMenu(event, node)
        }}
      >
        <span className={`tree-chevron ${isDirectory ? '' : 'file-spacer'}`}>
          {isDirectory ? (isCollapsed ? '›' : '⌄') : ''}
        </span>
        <span className={`tree-icon ${isDirectory ? 'folder' : 'file'}`}>
          {isDirectory ? '▰' : fileBadge(node.path)}
        </span>
        <span className="tree-name">{node.name}</span>
      </button>

      {isDirectory && !isCollapsed && node.children?.length ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              selectedPath={selectedPath}
              collapsedPaths={collapsedPaths}
              requireDoubleClick={requireDoubleClick}
              onSelectNode={onSelectNode}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
              onOpenContextMenu={onOpenContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [appearance, setAppearance] =
    useState<AppearanceSettings>(readAppearanceSettings)
  const editorTheme = resolveThemePreference(
    appearance.editorTheme,
    appearance.theme
  )
  const agentTheme = resolveThemePreference(
    appearance.agentTheme,
    appearance.theme
  )
  const [explorerContextMenu, setExplorerContextMenu] = useState<{
    x: number
    y: number
    target: ExplorerContextTarget
  } | null>(null)
  const [editorContextMenu, setEditorContextMenu] = useState<{
    x: number
    y: number
    functionContext: EditorFunctionContext | null
  } | null>(null)
  const [filePreview, setFilePreview] = useState<{
    path: string
    content: string
    language: string
  } | null>(null)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [recentProjects, setRecentProjects] = useState<ProjectInfo[]>([])
  const [fileTree, setFileTree] = useState<FileEntry[]>([])
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const [selectedExplorerEntry, setSelectedExplorerEntry] =
    useState<FileEntry | null>(null)
  const [workspaceLayout, setWorkspaceLayout] =
    useState<WorkspaceLayout>(readWorkspaceLayout)
  const [savedWorkspaceSchemes, setSavedWorkspaceSchemes] =
    useState<SavedWorkspaceScheme[]>(readSavedWorkspaceSchemes)
  const [selectedViewSlot, setSelectedViewSlot] =
    useState<WorkspaceViewSlot>(1)
  const [toolWindowLayout, setToolWindowLayout] =
    useState<ToolWindowLayout>(readToolWindowLayout)
  const setActiveTab = useCallback((tab: WorkspaceTab): void => {
    const toolTab = inspectorTabToToolTab(tab)
    setToolWindowLayout((current) => openToolTab(current, toolTab))
    setWorkspaceLayout((current) => ({
      ...current,
      inspectorVisible: true
    }))
  }, [])
  const [toolDropPreview, setToolDropPreview] = useState<{
    position: ToolDropPosition
    targetPaneId?: string
  } | null>(null)
  const [inspectorDropPreview, setInspectorDropPreview] =
    useState<ToolDockDropTarget | null>(null)
  const [tabDragGhost, setTabDragGhost] = useState<{
    label: string
    x: number
    y: number
    width: number
  } | null>(null)
  const [floatingInspector, setFloatingInspector] =
    useState<FloatingPanelBounds | null>(null)
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('explorer')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CodeSearchResult[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [memoryMetrics, setMemoryMetrics] = useState<MemoryMetrics | null>(null)
  const [diagnosticSamples, setDiagnosticSamples] = useState<
    DiagnosticMetricSample[]
  >([])
  const [debugEvents, setDebugEvents] = useState<DiagnosticEvent[]>([])
  const [wordWrap, setWordWrap] = useState(() => {
    return localStorage.getItem('ai-ide:word-wrap') === 'on'
  })
  const [markdownPreviewMode, setMarkdownPreviewMode] = useState(true)
  const [agentCompletionEnabled, setAgentCompletionEnabled] = useState(
    () => localStorage.getItem('ai-ide:agent-completion-enabled') !== 'off'
  )
  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([])
  const [debugCommand, setDebugCommand] = useState('')
  const [consoleEntries, setConsoleEntries] = useState<string[]>([])
  const [debuggerSnapshot, setDebuggerSnapshot] = useState<DebuggerSnapshot>({
    state: 'idle',
    message: '未启动调试会话。',
    frames: [],
    variables: [],
    threads: [],
    programOutput: [],
    output: []
  })
  const [debugBreakpoints, setDebugBreakpoints] = useState<DebugBreakpoint[]>(
    []
  )
  const [compilerDiagnostics, setCompilerDiagnostics] = useState<
    ProjectDiagnostic[]
  >([])
  const [liveCompilerDiagnostics, setLiveCompilerDiagnostics] = useState<
    ProjectDiagnostic[]
  >([])
  const [projectDiagnostics, setProjectDiagnostics] = useState<
    ProjectDiagnostic[]
  >([])
  const [projectDiagnosticsRunning, setProjectDiagnosticsRunning] =
    useState(false)
  const [projectDiagnosticsError, setProjectDiagnosticsError] = useState('')
  const [gitStatus, setGitStatus] = useState<GitStatus>(emptyGitStatus)
  const [gitDiff, setGitDiff] = useState<GitFileDiff | null>(null)
  const [gitBusy, setGitBusy] = useState(false)
  const [gitIgnoreBusy, setGitIgnoreBusy] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [runCommand, setRunCommand] = useState('')
  const [terminalOpened, setTerminalOpened] = useState(false)
  const [diagnosticsOpened, setDiagnosticsOpened] = useState(false)
  const [diagnosticsCount, setDiagnosticsCount] = useState(0)
  const [diagnosticsRefreshToken, setDiagnosticsRefreshToken] = useState(0)
  const [terminalRunRequest, setTerminalRunRequest] = useState(0)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteMode, setCommandPaletteMode] = useState<
    'commands' | 'files'
  >('commands')
  const [workflowModalOpen, setWorkflowModalOpen] = useState(false)
  const [workspaceView, setWorkspaceView] =
    useState<WorkspaceSurface>('code')
  const [agentOpened, setAgentOpened] = useState(false)
  const [agentPromptRequest, setAgentPromptRequest] = useState<{
    id: string
    text: string
    contextFiles: string[]
    taskId?: string
  } | null>(null)
  const [editorPosition, setEditorPosition] = useState<{
    path: string
    line: number
    column: number
  } | null>(null)
  const [editorFocus, setEditorFocus] = useState<
    Omit<AgentEditorFocus, 'dirty' | 'content'> | null
  >(null)
  const [pendingClosePath, setPendingClosePath] = useState<string | null>(null)
  const [closeBusy, setCloseBusy] = useState(false)
  const [missingProject, setMissingProject] = useState<ProjectInfo | null>(null)
  const [missingProjectBusy, setMissingProjectBusy] = useState(false)
  const [missingProjectError, setMissingProjectError] = useState('')
  const [applicationCloseRequested, setApplicationCloseRequested] =
    useState(false)
  const [applicationCloseBusy, setApplicationCloseBusy] = useState(false)
  const [applicationCloseError, setApplicationCloseError] = useState('')
  const [externalRunRequest, setExternalRunRequest] = useState<{
    id: number
    command: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('桌面骨架已就绪，选择一个本地项目开始。')
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const openAgentForEditorContextRef = useRef<
    (intent: EditorAgentIntent) => void
  >(() => undefined)
  const monacoRef = useRef<Parameters<BeforeMount>[0] | null>(null)
  const outputEntryIdRef = useRef(0)
  const lastOutputMessageRef = useRef('')
  const debugDecorationIdsRef = useRef<string[]>([])
  const lastDebugOutputCountRef = useRef(0)
  const lastDebugLogCountRef = useRef(0)
  const lastDebugEventKeyRef = useRef('')
  const debugEventIdRef = useRef(0)
  const lastPausedFrameRef = useRef('')
  const activePathRef = useRef<string | null>(null)
  const workbenchSurfaceRef = useRef<HTMLDivElement | null>(null)
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const inspectorRef = useRef<HTMLElement | null>(null)
  const draggedBottomTabRef = useRef<ToolTab | null>(null)
  const draggedInspectorTabRef = useRef<WorkspaceTab | null>(null)
  const editorFunctionLookupIdRef = useRef(0)

  const activeFile = openFiles.find((file) => file.path === activePath) ?? null
  const isMarkdownFile =
    activeFile !== null &&
    ['md', 'markdown', 'mdx'].includes(
      extensionFromPath(activeFile.path)
    )
  const closeActiveEditor = useCallback((): void => {
    if (!activePath) {
      return
    }
    const file = openFiles.find((item) => item.path === activePath)
    if (file?.dirty) {
      setPendingClosePath(activePath)
      return
    }
    const fileIndex = openFiles.findIndex((item) => item.path === activePath)
    const nextFiles = openFiles.filter((item) => item.path !== activePath)
    setOpenFiles(nextFiles)
    setActivePath(nextFiles[Math.max(0, fileIndex - 1)]?.path ?? null)
  }, [activePath, openFiles])
  const activeDockedToolTab = getActiveDockedTab(toolWindowLayout)
  const bottomPanelTab = isBottomToolTab(activeDockedToolTab)
    ? activeDockedToolTab
    : null
  const visibleToolTabs = useMemo(
    () => new Set(getVisibleToolTabs(toolWindowLayout)),
    [toolWindowLayout]
  )
  const isToolVisible = (tab: ToolTab): boolean =>
    toolWindowLayout.floating.some((window) =>
      window.tabs.includes(tab)
    ) ||
    toolWindowLayout.docked.some((pane) => pane.tabs.includes(tab)) ||
    (workspaceLayout.sidebarVisible &&
      toolWindowLayout.left.includes(tab)) ||
    (workspaceLayout.inspectorVisible &&
      toolWindowLayout.right.includes(tab))
  const checkedMenuCommands = useMemo(() => {
    const checked = new Set<AppMenuCommand>()
    if (workspaceLayout.activityBarVisible) {
      checked.add('view:toggle-activity-bar')
    }
    if (
      workspaceLayout.sidebarVisible &&
      toolWindowLayout.left.length > 0
    ) {
      checked.add('view:toggle-sidebar')
    }
    if (
      workspaceLayout.inspectorVisible &&
      toolWindowLayout.right.length > 0
    ) {
      checked.add('view:toggle-inspector')
    }
    if (isToolVisible('sidebar')) {
      checked.add(
        sidebarMode === 'search' ? 'view:search' : 'view:explorer'
      )
    }
    if (isToolVisible('changes')) {
      checked.add('view:source-control')
    }
    if (isToolVisible('problems')) {
      checked.add('view:problems')
    }
    if (isToolVisible('terminal')) {
      checked.add('view:toggle-terminal')
    }
    if (isToolVisible('output')) {
      checked.add('view:output')
    }
    if (isToolVisible('console')) {
      checked.add('view:debug-console')
    }
    if (isToolVisible('errors')) {
      checked.add('view:error-list')
    }
    if (isToolVisible('diagnostics')) {
      checked.add('view:diagnostic-tools')
    }
    if (isToolVisible('stack')) {
      checked.add('view:call-stack')
    }
    if (isToolVisible('memory')) {
      checked.add('view:memory')
    }
    if (
      isToolVisible('console') ||
      isToolVisible('diagnostics') ||
      isToolVisible('stack')
    ) {
      checked.add('view:run')
    }
    if (toolWindowLayout.docked.length) {
      checked.add('view:toggle-bottom-panel')
    }
    if (workspaceView === 'agent') {
      checked.add('view:agent')
    }
    if (wordWrap) {
      checked.add('view:toggle-word-wrap')
    }
    return checked
  }, [
    sidebarMode,
    toolWindowLayout,
    wordWrap,
    workspaceLayout.activityBarVisible,
    workspaceLayout.inspectorVisible,
    workspaceLayout.sidebarVisible,
    workspaceView
  ])
  const stagedCount = gitStatus.changes.filter((change) => change.staged).length
  const allChangesStaged =
    gitStatus.changes.length > 0 &&
    gitStatus.changes.every((change) => change.staged)
  const hasUnsavedFiles = openFiles.some((file) => file.dirty)
  const dirtyOpenFiles = openFiles.filter((file) => file.dirty)
  const isCppProject = useMemo(
    () => fileTreeLooksLikeCpp(fileTree),
    [fileTree]
  )
  const errorListItems = useMemo(() => {
    const seen = new Set<string>()
    return [
      ...liveCompilerDiagnostics,
      ...compilerDiagnostics,
      ...projectDiagnostics
    ].filter((item) => {
      const key = `${item.file}:${item.line}:${item.column}:${item.code ?? ''}:${item.message}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }, [compilerDiagnostics, liveCompilerDiagnostics, projectDiagnostics])
  const errorListErrorCount = errorListItems.filter(
    (item) => item.severity === 'error'
  ).length
  const agentOpenFilePaths = useMemo(
    () => openFiles.map((file) => file.path),
    [openFiles]
  )
  const agentChangedFilePaths = useMemo(
    () => [...new Set(gitStatus.changes.map((change) => change.path))],
    [gitStatus.changes]
  )
  const agentDiagnosticFilePaths = useMemo(
    () => [...new Set(errorListItems.map((item) => item.file))],
    [errorListItems]
  )
  const agentWorkspaceFocus = useMemo(() => {
    if (!activeFile) {
      return null
    }
    const selection =
      editorFocus?.path === activeFile.path
        ? editorFocus
        : {
            path: activeFile.path,
            startLine: editorPosition?.line ?? 1,
            startColumn: editorPosition?.column ?? 1,
            endLine: editorPosition?.line ?? 1,
            endColumn: editorPosition?.column ?? 1,
            selectedText: ''
          }
    return {
      ...selection,
      dirty: activeFile.dirty,
      content: activeFile.content
    }
  }, [activeFile, editorFocus, editorPosition])

  useEffect(() => {
    activePathRef.current = activePath
    setEditorFocus((current) =>
      current?.path === activePath
        ? current
        : activePath
          ? {
              path: activePath,
              startLine: editorPosition?.line ?? 1,
              startColumn: editorPosition?.column ?? 1,
              endLine: editorPosition?.line ?? 1,
              endColumn: editorPosition?.column ?? 1,
              selectedText: ''
            }
          : null
    )
  }, [activePath, editorPosition?.column, editorPosition?.line])

  useEffect(() => {
    setMarkdownPreviewMode(true)
  }, [activePath])

  useEffect(() => {
    if (!project) {
      return
    }
    if (visibleToolTabs.has('terminal')) {
      setTerminalOpened(true)
    }
    if (visibleToolTabs.has('problems')) {
      setDiagnosticsOpened(true)
    }
  }, [project, visibleToolTabs])

  useEffect(() => {
    window.desktop?.setUnsavedFileCount(dirtyOpenFiles.length)
  }, [dirtyOpenFiles.length])

  useEffect(() => {
    localStorage.setItem(
      'ai-ide:workspace-layout',
      JSON.stringify(workspaceLayout)
    )
  }, [workspaceLayout])

  useEffect(() => {
    localStorage.setItem(
      toolWindowLayoutKey,
      JSON.stringify(toolWindowLayout)
    )
  }, [toolWindowLayout])

  useEffect(() => {
    localStorage.setItem(
      'ai-ide:appearance',
      JSON.stringify(appearance)
    )
  }, [appearance])

  useEffect(() => {
    document.documentElement.dataset.appTheme = appearance.theme
  }, [appearance.theme])

  useEffect(() => {
    localStorage.setItem('ai-ide:word-wrap', wordWrap ? 'on' : 'off')
  }, [wordWrap])

  useEffect(() => {
    localStorage.setItem(
      'ai-ide:agent-completion-enabled',
      agentCompletionEnabled ? 'on' : 'off'
    )
  }, [agentCompletionEnabled])

  useEffect(() => {
    const handleCompletionError = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail
      if (detail) {
        setNotice(detail)
      }
    }
    window.addEventListener('ai-ide:completion-error', handleCompletionError)
    return () =>
      window.removeEventListener(
        'ai-ide:completion-error',
        handleCompletionError
      )
  }, [])

  useEffect(() => {
    if (!notice || notice === lastOutputMessageRef.current) {
      return
    }
    lastOutputMessageRef.current = notice
    setOutputEntries((current) => [
      ...current.slice(-199),
      {
        id: ++outputEntryIdRef.current,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: notice
      }
    ])
  }, [notice])

  useEffect(() => {
    if (
      (!visibleToolTabs.has('memory') &&
        !visibleToolTabs.has('diagnostics')) ||
      !window.desktop
    ) {
      return
    }
    let disposed = false
    const updateMetrics = async (): Promise<void> => {
      try {
        const metrics = await window.desktop.getMemoryMetrics()
        if (!disposed) {
          setMemoryMetrics(metrics)
          setDiagnosticSamples((current) => [
            ...current.slice(-89),
            {
              timestamp: new Date(metrics.timestamp).getTime(),
              cpuPercent: metrics.processes.reduce(
                (total, process) => total + process.cpuPercent,
                0
              ),
              memoryMB: metrics.processes.reduce(
                (total, process) => total + process.memoryMB,
                0
              )
            }
          ])
        }
      } catch {
        // Keep the previous snapshot when metrics are temporarily unavailable.
      }
    }
    void updateMetrics()
    const timer = window.setInterval(() => void updateMetrics(), 2000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [visibleToolTabs])

  const toggleSidebar = useCallback((): void => {
    setWorkspaceLayout((current) => ({
      ...current,
      sidebarVisible: !current.sidebarVisible
    }))
  }, [])

  const toggleInspector = useCallback((): void => {
    setWorkspaceLayout((current) => ({
      ...current,
      inspectorVisible: !current.inspectorVisible
    }))
  }, [])

  const toggleInspectorTab = useCallback(
    (tab: WorkspaceTab): void => {
      const toolTab = inspectorTabToToolTab(tab)
      if (toolWindowLayout.right.includes(toolTab)) {
        if (
          workspaceLayout.inspectorVisible &&
          toolWindowLayout.activeRight === toolTab
        ) {
          setWorkspaceLayout((current) => ({
            ...current,
            inspectorVisible: false
          }))
          return
        }
        setToolWindowLayout((current) =>
          activateToolTab(current, 'right', toolTab)
        )
        setWorkspaceLayout((current) => ({
          ...current,
          inspectorVisible: true
        }))
        return
      }
      setToolWindowLayout((current) => openToolTab(current, toolTab))
    },
    [
      toolWindowLayout.activeRight,
      toolWindowLayout.right,
      workspaceLayout.inspectorVisible
    ]
  )

  const setBottomPanelTab = useCallback(
    (
      next:
        | BottomPanelTab
        | null
        | ((current: BottomPanelTab | null) => BottomPanelTab | null)
    ): void => {
      setToolWindowLayout((current) => {
        const activeTab = getActiveDockedTab(current)
        const requested =
          typeof next === 'function'
            ? next(
                isBottomToolTab(activeTab)
                  ? activeTab
                  : null
              )
            : next
        if (!requested) {
          return { ...current, docked: [] }
        }
        return dockToolTab(current, requested, 'bottom', 'center')
      })
    },
    []
  )

  const toggleBottomPanel = useCallback((tab: BottomPanelTab): void => {
    setToolWindowLayout((current) => {
      const pane = current.docked.find((candidate) =>
        candidate.tabs.includes(tab)
      )
      if (pane?.activeTab === tab) {
        return { ...current, docked: [] }
      }
      return dockToolTab(current, tab, 'bottom', 'center')
    })
  }, [])

  const toggleBottomPanelVisibility = useCallback((): void => {
    setToolWindowLayout((current) => {
      if (current.docked.length) {
        return { ...current, docked: [] }
      }
      return dockToolTab(current, 'output', 'bottom', 'center')
    })
  }, [])

  const toggleActivityBar = useCallback((): void => {
    setWorkspaceLayout((current) => ({
      ...current,
      activityBarVisible: !current.activityBarVisible
    }))
  }, [])

  const resetWorkspaceLayout = useCallback((): void => {
    setWorkspaceLayout(defaultWorkspaceLayout)
    setToolWindowLayout(createToolWindowLayout(null))
    setToolDropPreview(null)
    setInspectorDropPreview(null)
    setFloatingInspector(null)
  }, [])

  const dockInspector = useCallback(
    (position: 'right' | 'bottom'): void => {
      setWorkspaceLayout((current) => ({
        ...current,
        inspectorDock: 'right',
        inspectorVisible: true
      }))
      setToolWindowLayout((current) => {
        if (position === 'bottom') {
          return current.right
            .reduce(
              (layout, tab) =>
                dockToolTab(layout, tab, 'bottom', 'center'),
              current
            )
        }
        return INSPECTOR_TOOL_TABS
          .reduce(
            (layout, tab) =>
              dockToolTab(layout, tab, 'right'),
            current
          )
      })
      setNotice(
        position === 'bottom'
          ? '右侧工具标签已加入底部标签组。'
          : '右侧工具标签已恢复为独立右栏。'
      )
    },
    []
  )

  const saveWorkspaceViewScheme = useCallback(
    (slot: WorkspaceViewSlot): void => {
      const savedScheme: SavedWorkspaceScheme = {
        layout: workspaceLayout,
        activeInspectorTab:
          (toolWindowLayout.activeRight
            ? toolTabToInspectorTab(toolWindowLayout.activeRight)
            : null) ??
          'changes',
        bottomPanelTab,
        sidebarMode,
        workspaceSurface: workspaceView,
        floatingBottomPanel:
          toolWindowLayout.floating[0]?.bounds ?? null,
        floatingBottomTab:
          toolWindowLayout.floating[0]?.activeTab ?? null,
        floatingInspector,
        toolWindowLayout,
        slot,
        savedAt: new Date().toISOString()
      }
      setSavedWorkspaceSchemes((current) => {
        const next = [
          ...current.filter((scheme) => scheme.slot !== slot),
          savedScheme
        ].sort((left, right) => left.slot - right.slot)
        localStorage.setItem(
          savedWorkspaceSchemesKey,
          JSON.stringify(next)
        )
        return next
      })
      setSelectedViewSlot(slot)
      setNotice(`当前视图已保存到方案 ${slot}。`)
    },
    [
      bottomPanelTab,
      floatingInspector,
      sidebarMode,
      toolWindowLayout,
      workspaceLayout,
      workspaceView
    ]
  )

  const applyWorkspaceViewScheme = useCallback(
    (slot: WorkspaceViewSlot): void => {
      const savedScheme = savedWorkspaceSchemes.find(
        (scheme) => scheme.slot === slot
      )
      if (!savedScheme) {
        setSelectedViewSlot(slot)
        setNotice(`方案 ${slot} 还没有保存视图。`)
        return
      }
      setWorkspaceLayout(savedScheme.layout)
      setActiveTab(savedScheme.activeInspectorTab)
      setToolWindowLayout(savedScheme.toolWindowLayout)
      setFloatingInspector(savedScheme.floatingInspector)
      setSidebarMode(savedScheme.sidebarMode)
      setWorkspaceView(savedScheme.workspaceSurface)
      setSelectedViewSlot(slot)
      if (savedScheme.activeInspectorTab === 'terminal' && project) {
        setTerminalOpened(true)
      }
      if (savedScheme.activeInspectorTab === 'diagnostics' && project) {
        setDiagnosticsOpened(true)
      }
      setNotice(`已应用视图方案 ${slot}。`)
    },
    [project, savedWorkspaceSchemes]
  )

  const saveSelectedWorkspaceView = useCallback((): void => {
    saveWorkspaceViewScheme(selectedViewSlot)
  }, [saveWorkspaceViewScheme, selectedViewSlot])

  const applySelectedWorkspaceView = useCallback((): void => {
    applyWorkspaceViewScheme(selectedViewSlot)
  }, [applyWorkspaceViewScheme, selectedViewSlot])

  const openSidebarSearch = useCallback((): void => {
    setSidebarMode('search')
    setToolWindowLayout((current) => openToolTab(current, 'sidebar'))
    setWorkspaceLayout((current) => ({
      ...current,
      sidebarVisible: true
    }))
  }, [])

  const activateExplorerView = useCallback((): void => {
    if (
      workspaceView === 'code' &&
      sidebarMode === 'explorer' &&
      workspaceLayout.sidebarVisible &&
      toolWindowLayout.left.includes('sidebar')
    ) {
      setWorkspaceLayout((current) => ({
        ...current,
        sidebarVisible: false
      }))
      return
    }
    setWorkspaceView('code')
    setSidebarMode('explorer')
    setToolWindowLayout((current) => openToolTab(current, 'sidebar'))
    setWorkspaceLayout((current) => ({
      ...current,
      sidebarVisible: true
    }))
  }, [
    sidebarMode,
    toolWindowLayout.left,
    workspaceLayout.sidebarVisible,
    workspaceView
  ])

  const runCodeSearch = useCallback(async (): Promise<void> => {
    if (!window.desktop || !searchQuery.trim()) {
      setSearchResults([])
      return
    }
    setSearchBusy(true)
    try {
      setSearchResults(await window.desktop.searchCode(searchQuery))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '代码搜索失败。')
      setSearchResults([])
    } finally {
      setSearchBusy(false)
    }
  }, [searchQuery])

  const toggleTerminal = useCallback((): void => {
    if (toolWindowLayout.right.includes('terminal')) {
      toggleInspectorTab('terminal')
      return
    }
    setToolWindowLayout((current) =>
      openToolTab(current, 'terminal')
    )
  }, [toggleInspectorTab, toolWindowLayout.right])

  const beginPanelResize = useCallback(
    (
      panel: 'sidebar' | 'inspector',
      event: React.PointerEvent<HTMLDivElement>
    ): void => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      const startX = event.clientX
      const startWidth =
        panel === 'sidebar'
          ? workspaceLayout.sidebarWidth
          : workspaceLayout.inspectorWidth
      document.body.classList.add('panel-resizing')

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const delta = moveEvent.clientX - startX
        if (panel === 'sidebar') {
          const available = Math.max(
            190,
            window.innerWidth -
              56 -
              360 -
              (workspaceLayout.inspectorVisible
                ? workspaceLayout.inspectorWidth
                : 0)
          )
          setWorkspaceLayout((current) => ({
            ...current,
            sidebarWidth: Math.min(
              Math.min(520, available),
              Math.max(190, startWidth + delta)
            )
          }))
        } else {
          const available = Math.max(
            230,
            window.innerWidth -
              56 -
              360 -
              (workspaceLayout.sidebarVisible
                ? workspaceLayout.sidebarWidth
                : 0)
          )
          setWorkspaceLayout((current) => ({
            ...current,
            inspectorWidth: Math.min(
              Math.min(620, available),
              Math.max(230, startWidth - delta)
            )
          }))
        }
      }
      const handlePointerUp = (): void => {
        document.body.classList.remove('panel-resizing')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [workspaceLayout]
  )

  const beginBottomPanelResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      const startY = event.clientY
      const startHeight = workspaceLayout.bottomPanelHeight
      document.body.classList.add('panel-resizing-vertical')
      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const nextHeight = startHeight + startY - moveEvent.clientY
        setWorkspaceLayout((current) => ({
          ...current,
          bottomPanelHeight: Math.min(
            Math.max(150, window.innerHeight - 250),
            Math.max(150, nextHeight)
          )
        }))
      }
      const handlePointerUp = (): void => {
        document.body.classList.remove('panel-resizing-vertical')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [workspaceLayout.bottomPanelHeight]
  )

  const beginInspectorResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      const dockedAtBottom = workspaceLayout.inspectorDock === 'bottom'
      const startX = event.clientX
      const startY = event.clientY
      const startWidth = workspaceLayout.inspectorWidth
      const startHeight = workspaceLayout.inspectorHeight
      document.body.classList.add(
        dockedAtBottom ? 'panel-resizing-vertical' : 'panel-resizing'
      )

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        if (dockedAtBottom) {
          setWorkspaceLayout((current) => ({
            ...current,
            inspectorHeight: Math.min(
              Math.max(170, window.innerHeight - 250),
              Math.max(170, startHeight + startY - moveEvent.clientY)
            )
          }))
          return
        }
        const available = Math.max(
          230,
          window.innerWidth -
            56 -
            300 -
            (workspaceLayout.sidebarVisible
              ? workspaceLayout.sidebarWidth
              : 0)
        )
        setWorkspaceLayout((current) => ({
          ...current,
          inspectorWidth: Math.min(
            Math.min(620, available),
            Math.max(230, startWidth + startX - moveEvent.clientX)
          )
        }))
      }
      const handlePointerUp = (): void => {
        document.body.classList.remove('panel-resizing')
        document.body.classList.remove('panel-resizing-vertical')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [
      workspaceLayout.inspectorDock,
      workspaceLayout.inspectorHeight,
      workspaceLayout.inspectorWidth,
      workspaceLayout.sidebarVisible,
      workspaceLayout.sidebarWidth
    ]
  )

  const getToolDropTarget = useCallback(
    (
      clientX: number,
      clientY: number
    ): { position: ToolDropPosition; targetPaneId?: string } | null => {
      const workbench = workbenchSurfaceRef.current
      if (!workbench) {
        return null
      }
      const workbenchRect = workbench.getBoundingClientRect()
      const dropTop =
        workbenchRect.top +
        Math.min(
          workbenchRect.height - 100,
          Math.max(180, workbenchRect.height * 0.5)
        )
      if (
        clientX < workbenchRect.left ||
        clientX > workbenchRect.right ||
        clientY < dropTop ||
        clientY > workbenchRect.bottom
      ) {
        return null
      }

      const panes = [
        ...workbench.querySelectorAll<HTMLElement>('.tool-dock-pane')
      ].flatMap((element) => {
        const paneId = element.dataset.toolPaneId
        return paneId ? [[paneId, element] as const] : []
      })
      const target =
        panes.find(([, element]) => {
          const rect = element.getBoundingClientRect()
          return (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
          )
        }) ??
        panes.sort(([, left], [, right]) => {
          const leftRect = left.getBoundingClientRect()
          const rightRect = right.getBoundingClientRect()
          return (
            Math.abs(clientX - (leftRect.left + leftRect.width / 2)) -
            Math.abs(clientX - (rightRect.left + rightRect.width / 2))
          )
        })[0]
      if (!target) {
        return null
      }
      const targetRect = target[1].getBoundingClientRect()
      const relativeX = (clientX - targetRect.left) / targetRect.width
      return {
        position:
          relativeX < 0.3
            ? 'left'
            : relativeX > 0.7
              ? 'right'
              : 'center',
        targetPaneId: target[0]
      }
    },
    []
  )

  const beginInspectorFloatingDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      const element = inspectorRef.current
      if (!element) {
        return
      }
      const rect = element.getBoundingClientRect()
      const initial: FloatingPanelBounds = floatingInspector ?? {
        x: Math.max(8, Math.round(rect.left)),
        y: Math.max(34, Math.round(rect.top)),
        width: Math.min(
          window.innerWidth - 16,
          Math.max(400, Math.round(rect.width))
        ),
        height: Math.min(
          window.innerHeight - 42,
          Math.max(420, Math.round(rect.height))
        )
      }
      if (!floatingInspector) {
        setFloatingInspector(initial)
      }
      const startX = event.clientX
      const startY = event.clientY
      document.body.classList.add('panel-window-dragging')
      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const maxX = Math.max(
          8,
          window.innerWidth - Math.min(initial.width, window.innerWidth - 16)
        )
        const maxY = Math.max(
          34,
          window.innerHeight -
            Math.min(initial.height, window.innerHeight - 50)
        )
        setFloatingInspector({
          ...initial,
          x: Math.min(
            maxX,
            Math.max(8, initial.x + moveEvent.clientX - startX)
          ),
          y: Math.min(
            maxY,
            Math.max(34, initial.y + moveEvent.clientY - startY)
          )
        })
      }
      const handlePointerUp = (): void => {
        document.body.classList.remove('panel-window-dragging')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [floatingInspector]
  )

  const beginToolTabReorderDrag = useCallback(
    (
      tab: ToolTab,
      event: React.PointerEvent<HTMLButtonElement>
    ): void => {
      if (event.button !== 0) {
        return
      }
      const sourceElement = event.currentTarget
      const groupElement =
        sourceElement.closest<HTMLElement>('[data-tool-tab-group]')
      const groupId = groupElement?.dataset
        .toolTabGroup as ToolTabGroupId | undefined
      if (!groupElement || !groupId) {
        return
      }
      const startX = event.clientX
      const startY = event.clientY
      const sourceWidth = sourceElement.getBoundingClientRect().width
      const sourceLabel =
        sourceElement.dataset.toolTabLabel ??
        sourceElement.textContent?.trim() ??
        tab
      let dragging = false
      let reorderTarget: ToolTab | null = null
      let reorderAfter = false

      const clearIndicator = (): void => {
        groupElement
          .querySelectorAll<HTMLElement>('[data-tool-tab-reorder]')
          .forEach((element) => {
            delete element.dataset.toolTabReorder
          })
      }

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        if (
          !dragging &&
          Math.hypot(
            moveEvent.clientX - startX,
            moveEvent.clientY - startY
          ) > 7
        ) {
          dragging = true
          draggedBottomTabRef.current = tab
          draggedInspectorTabRef.current =
            toolTabToInspectorTab(tab)
          document.body.classList.add('panel-docking')
          sourceElement.dataset.toolTabDragging = 'true'
          setTabDragGhost({
            label: sourceLabel,
            x:
              sourceWidth >= groupElement.clientWidth
                ? groupElement.getBoundingClientRect().left +
                  groupElement.clientWidth / 2
                : Math.min(
                    Math.max(
                      moveEvent.clientX,
                      groupElement.getBoundingClientRect().left +
                        sourceWidth / 2
                    ),
                    groupElement.getBoundingClientRect().right -
                      sourceWidth / 2
                  ),
            y:
              groupElement.getBoundingClientRect().top +
              groupElement.getBoundingClientRect().height / 2,
            width: Math.max(90, sourceWidth)
          })
        }
        if (!dragging) {
          return
        }
        const groupRect = groupElement.getBoundingClientRect()
        const clampedX =
          sourceWidth >= groupRect.width
            ? groupRect.left + groupRect.width / 2
            : Math.min(
                Math.max(
                  moveEvent.clientX,
                  groupRect.left + sourceWidth / 2
                ),
                groupRect.right - sourceWidth / 2
              )
        setTabDragGhost((current) =>
          current
            ? {
                ...current,
                x: clampedX,
                y: groupRect.top + groupRect.height / 2
              }
            : current
        )

        const nearest = Array.from(
          groupElement.querySelectorAll<HTMLElement>('[data-tool-tab]')
        )
          .filter((element) => element.dataset.toolTab !== tab)
          .reduce<{ element: HTMLElement; distance: number } | null>(
            (current, element) => {
              const rect = element.getBoundingClientRect()
              const distance = Math.abs(
                clampedX - (rect.left + rect.width / 2)
              )
              return !current || distance < current.distance
                ? { element, distance }
                : current
            },
            null
          )
        if (!nearest) {
          reorderTarget = null
          clearIndicator()
          return
        }
        const targetRect = nearest.element.getBoundingClientRect()
        reorderTarget = nearest.element.dataset.toolTab as ToolTab
        reorderAfter =
          clampedX > targetRect.left + targetRect.width / 2
        clearIndicator()
        nearest.element.dataset.toolTabReorder =
          reorderAfter ? 'after' : 'before'
      }

      const cleanup = (): void => {
        document.body.classList.remove('panel-docking')
        setTabDragGhost(null)
        delete sourceElement.dataset.toolTabDragging
        clearIndicator()
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerCancel)
        if (dragging) {
          window.setTimeout(() => {
            if (draggedBottomTabRef.current === tab) {
              draggedBottomTabRef.current = null
            }
            if (
              draggedInspectorTabRef.current ===
              toolTabToInspectorTab(tab)
            ) {
              draggedInspectorTabRef.current = null
            }
          }, 0)
        }
      }

      const handlePointerUp = (): void => {
        const target = reorderTarget
        const after = reorderAfter
        const before = new Map<string, DOMRect>()
        groupElement
          .querySelectorAll<HTMLElement>('[data-tool-tab]')
          .forEach((element) => {
            before.set(
              element.dataset.toolTab ?? '',
              element.getBoundingClientRect()
            )
          })
        cleanup()
        if (!dragging || !target) {
          return
        }
        setToolWindowLayout((current) =>
          reorderToolTabInGroup(
            current,
            groupId,
            tab,
            target,
            after
          )
        )
        window.requestAnimationFrame(() => {
          groupElement
            .querySelectorAll<HTMLElement>('[data-tool-tab]')
            .forEach((element) => {
              const previous = before.get(element.dataset.toolTab ?? '')
              if (!previous) {
                return
              }
              const next = element.getBoundingClientRect()
              const delta = previous.left - next.left
              if (Math.abs(delta) > 1) {
                element.animate(
                  [
                    { transform: `translateX(${delta}px)` },
                    { transform: 'translateX(0)' }
                  ],
                  {
                    duration: 160,
                    easing: 'cubic-bezier(.2,.8,.2,1)'
                  }
                )
              }
            })
        })
      }

      const handlePointerCancel = (): void => cleanup()
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
    },
    []
  )

  const beginToolWindowDockDrag = useCallback(
    (
      tab: ToolTab,
      event: React.PointerEvent<HTMLButtonElement>
    ): void => {
      if (event.button !== 0) {
        return
      }
      const sourceElement = event.currentTarget
      const sourceWidth = sourceElement.getBoundingClientRect().width
      const sourceLabel =
        sourceElement.dataset.toolTabLabel ??
        sourceElement.textContent?.trim() ??
        tab
      const startX = event.clientX
      const startY = event.clientY
      let dragging = false
      let dropTarget: ToolDockDropTarget = 'float'
      let targetPaneId: string | undefined

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        if (
          !dragging &&
          Math.hypot(
            moveEvent.clientX - startX,
            moveEvent.clientY - startY
          ) > 7
        ) {
          dragging = true
          document.body.classList.add('panel-docking')
          setTabDragGhost({
            label: sourceLabel,
            x: moveEvent.clientX,
            y: moveEvent.clientY,
            width: Math.max(120, sourceWidth)
          })
        }
        if (!dragging) {
          return
        }
        setTabDragGhost((current) =>
          current
            ? {
                ...current,
                x: moveEvent.clientX,
                y: moveEvent.clientY
              }
            : current
        )
        const workspace = workspaceRef.current
        if (!workspace) {
          dropTarget = 'float'
          targetPaneId = undefined
        } else {
          dropTarget = resolveToolDockDropTarget(
            moveEvent.clientX,
            moveEvent.clientY,
            workspace.getBoundingClientRect(),
            Math.max(
              workspaceLayout.sidebarWidth,
              workspaceLayout.inspectorWidth
            ),
            workspaceLayout.bottomPanelHeight
          )
          targetPaneId =
            dropTarget === 'bottom'
              ? getToolDropTarget(
                  moveEvent.clientX,
                  moveEvent.clientY
                )?.targetPaneId
              : undefined
        }
        setInspectorDropPreview(dropTarget)
      }

      const cleanup = (): void => {
        document.body.classList.remove('panel-docking')
        setTabDragGhost(null)
        setInspectorDropPreview(null)
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerCancel)
      }

      const handlePointerUp = (): void => {
        const target = dropTarget
        cleanup()
        if (!dragging) {
          return
        }
        if (tab === 'terminal' && project) {
          setTerminalOpened(true)
        }
        if (tab === 'problems' && project) {
          setDiagnosticsOpened(true)
        }
        if (target === 'float') {
          const rect = workspaceRef.current?.getBoundingClientRect()
          const width = Math.min(
            window.innerWidth - 16,
            Math.max(420, Math.round(rect ? rect.width * 0.42 : 480))
          )
          const height = Math.min(
            window.innerHeight - 50,
            Math.max(360, Math.round(rect ? rect.height * 0.5 : 420))
          )
          setToolWindowLayout((current) =>
            floatToolTab(current, tab, {
              x: Math.max(
                8,
                Math.round((window.innerWidth - width) / 2)
              ),
              y: Math.max(
                34,
                Math.round((window.innerHeight - height) / 2)
              ),
              width,
              height
            })
          )
          return
        }
        setToolWindowLayout((current) =>
          dockToolTab(
            current,
            tab,
            target,
            'center',
            targetPaneId
          )
        )
        if (target === 'left' || target === 'right') {
          setWorkspaceLayout((current) => ({
            ...current,
            sidebarVisible:
              target === 'left' ? true : current.sidebarVisible,
            inspectorVisible:
              target === 'right' ? true : current.inspectorVisible
          }))
        }
      }

      const handlePointerCancel = (): void => cleanup()
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
    },
    [
      getToolDropTarget,
      project,
      workspaceLayout.bottomPanelHeight,
      workspaceLayout.inspectorWidth,
      workspaceLayout.sidebarWidth
    ]
  )

  const beginFloatingToolWindowDrag = useCallback(
    (
      windowId: string,
      event: React.PointerEvent<HTMLButtonElement>
    ): void => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      const floating = toolWindowLayout.floating.find(
        (window) => window.id === windowId
      )
      if (!floating) {
        return
      }
      const initial = floating.bounds
      const startX = event.clientX
      const startY = event.clientY
      let dropTarget: ReturnType<typeof getToolDropTarget> = null
      let sideTarget: ToolDockDropTarget = 'float'
      let sideTargetPaneId: string | undefined
      document.body.classList.add('panel-window-dragging')
      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const maxX = Math.max(
          8,
          window.innerWidth - Math.min(initial.width, window.innerWidth - 16)
        )
        const maxY = Math.max(
          34,
          window.innerHeight -
            Math.min(initial.height, window.innerHeight - 50)
        )
        setToolWindowLayout((current) =>
          updateFloatingToolBounds(current, windowId, {
            ...initial,
            x: Math.min(
              maxX,
              Math.max(8, initial.x + moveEvent.clientX - startX)
            ),
            y: Math.min(
              maxY,
              Math.max(34, initial.y + moveEvent.clientY - startY)
            )
          })
        )
        const workspace = workspaceRef.current
        sideTarget = workspace
          ? resolveToolDockDropTarget(
              moveEvent.clientX,
              moveEvent.clientY,
              workspace.getBoundingClientRect(),
              Math.max(
                workspaceLayout.sidebarWidth,
                workspaceLayout.inspectorWidth
              ),
              workspaceLayout.bottomPanelHeight
            )
          : 'float'
        if (sideTarget === 'bottom') {
          dropTarget = getToolDropTarget(
            moveEvent.clientX,
            moveEvent.clientY
          )
          sideTargetPaneId = dropTarget?.targetPaneId
        } else {
          dropTarget = null
          sideTargetPaneId = undefined
        }
        setInspectorDropPreview(
          sideTarget === 'bottom' ? null : sideTarget
        )
        setToolDropPreview(dropTarget)
      }
      const handlePointerUp = (): void => {
        document.body.classList.remove('panel-window-dragging')
        setToolDropPreview(null)
        setInspectorDropPreview(null)
        if (sideTarget === 'left' || sideTarget === 'right') {
          const side = sideTarget
          setToolWindowLayout((current) =>
            dockToolTab(
              current,
              floating.activeTab,
              side
            )
          )
          setWorkspaceLayout((current) => ({
            ...current,
            sidebarVisible:
              sideTarget === 'left'
                ? true
                : current.sidebarVisible,
            inspectorVisible:
              sideTarget === 'right'
                ? true
                : current.inspectorVisible
          }))
        } else if (sideTarget === 'bottom') {
          setToolWindowLayout((current) =>
            dockFloatingToolWindow(
              current,
              windowId,
              'center',
              sideTargetPaneId
            )
          )
        }
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [
      getToolDropTarget,
      toolWindowLayout.floating,
      workspaceLayout.bottomPanelHeight,
      workspaceLayout.inspectorWidth,
      workspaceLayout.sidebarWidth
    ]
  )

  const beginBottomTabTearOff = useCallback(
    (
      tab: ToolTab,
      event: React.PointerEvent<HTMLButtonElement>
    ): void => {
      if (event.button !== 0) {
        return
      }
      const startX = event.clientX
      const startY = event.clientY
      let detached = false
      const width = Math.min(560, window.innerWidth - 16)
      const height = Math.min(
        Math.max(260, workspaceLayout.bottomPanelHeight),
        window.innerHeight - 50
      )
      const getBounds = (clientX: number, clientY: number) => ({
        x: Math.min(
          window.innerWidth - width - 8,
          Math.max(8, clientX - 90)
        ),
        y: Math.min(
          window.innerHeight - height - 8,
          Math.max(34, clientY - 20)
        ),
        width,
        height
      })
      const handlePointerMove = (moveEvent: PointerEvent): void => {
        if (
          !detached &&
          Math.hypot(
            moveEvent.clientX - startX,
            moveEvent.clientY - startY
          ) > 7
        ) {
          detached = true
          draggedBottomTabRef.current = tab
          setToolWindowLayout((current) =>
            tearOffDockedTab(
              current,
              tab,
              getBounds(moveEvent.clientX, moveEvent.clientY)
            )
          )
          document.body.classList.add('panel-window-dragging')
        }
        if (detached) {
          setToolWindowLayout((current) => {
            const floating = current.floating.find((window) =>
              window.tabs.includes(tab)
            )
            return floating
              ? updateFloatingToolBounds(
                  current,
                  floating.id,
                  getBounds(moveEvent.clientX, moveEvent.clientY)
                )
              : current
          })
        }
      }
      const handlePointerUp = (): void => {
        document.body.classList.remove('panel-window-dragging')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
        window.setTimeout(() => {
          if (draggedBottomTabRef.current === tab) {
            draggedBottomTabRef.current = null
          }
        }, 0)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [workspaceLayout.bottomPanelHeight]
  )

  const beginToolPaneResize = useCallback(
    (
      paneIndex: number,
      event: React.PointerEvent<HTMLDivElement>
    ): void => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      const leftPane = toolWindowLayout.docked[paneIndex]
      const rightPane = toolWindowLayout.docked[paneIndex + 1]
      if (!leftPane || !rightPane) {
        return
      }
      const workbench = workbenchSurfaceRef.current
      const leftElement = workbench?.querySelector<HTMLElement>(
        `[data-tool-pane-id="${leftPane.id}"]`
      )
      const rightElement = workbench?.querySelector<HTMLElement>(
        `[data-tool-pane-id="${rightPane.id}"]`
      )
      if (!leftElement || !rightElement) {
        return
      }
      const startX = event.clientX
      const leftWidth = leftElement.getBoundingClientRect().width
      const rightWidth = rightElement.getBoundingClientRect().width
      const totalWidth = leftWidth + rightWidth
      document.body.classList.add('panel-resizing')
      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const nextLeft = Math.min(
          totalWidth - 180,
          Math.max(180, leftWidth + moveEvent.clientX - startX)
        )
        const ratio = nextLeft / totalWidth
        setToolWindowLayout((current) => ({
          ...current,
          docked: current.docked.map((pane) => {
            if (pane.id === leftPane.id) {
              return { ...pane, weight: Math.max(0.2, ratio * 2) }
            }
            if (pane.id === rightPane.id) {
              return { ...pane, weight: Math.max(0.2, (1 - ratio) * 2) }
            }
            return pane
          })
        }))
      }
      const handlePointerUp = (): void => {
        document.body.classList.remove('panel-resizing')
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [toolWindowLayout.docked]
  )

  const activateBottomTab = useCallback(
    (tab: BottomPanelTab): void => {
      if (draggedBottomTabRef.current === tab) {
        draggedBottomTabRef.current = null
        return
      }
      toggleBottomPanel(tab)
    },
    [toggleBottomPanel]
  )

  const activateInspectorTab = useCallback(
    (tab: WorkspaceTab): void => {
      if (draggedInspectorTabRef.current === tab) {
        draggedInspectorTabRef.current = null
        return
      }
      if (tab === 'terminal' && project) {
        setTerminalOpened(true)
      }
      if (tab === 'diagnostics' && project) {
        setDiagnosticsOpened(true)
      }
      toggleInspectorTab(tab)
    },
    [project, toggleInspectorTab]
  )

  const dockSidebarBack = useCallback((): void => {
    setToolWindowLayout((current) =>
      dockToolTab(current, 'sidebar', 'left')
    )
    setWorkspaceLayout((current) => ({
      ...current,
      sidebarVisible: true
    }))
  }, [])

  const refreshRecentProjects = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }

    const projects = await window.desktop.listRecentProjects()
    setRecentProjects(projects)
  }, [])

  const refreshGitStatus = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }

    setGitBusy(true)
    try {
      const status = await window.desktop.getGitStatus()
      setGitStatus(status)
      setGitDiff((currentDiff) => {
        if (
          currentDiff &&
          !status.changes.some((change) => change.path === currentDiff.path)
        ) {
          return null
        }
        return currentDiff
      })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法读取 Git 状态。')
    } finally {
      setGitBusy(false)
    }
  }, [])

  const repairGitignore = useCallback(async (): Promise<void> => {
    if (!window.desktop || gitIgnoreBusy) {
      return
    }
    setGitIgnoreBusy(true)
    try {
      const result =
        await window.desktop.ensureRecommendedGitignore()
      await refreshGitStatus()
      setNotice(
        result.changed
          ? `已向 .gitignore 添加 ${result.addedPatterns.length} 条推荐规则。`
          : '推荐忽略规则已经完整，无需修改。'
      )
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '修复忽略规则失败。'
      )
    } finally {
      setGitIgnoreBusy(false)
    }
  }, [gitIgnoreBusy, refreshGitStatus])

  const clearProjectWorkspace = useCallback((): void => {
    setProject(null)
    setFileTree([])
    setOpenFiles([])
    setActivePath(null)
    setSelectedExplorerEntry(null)
    setGitStatus(emptyGitStatus)
    setGitDiff(null)
    setRunCommand('')
    setTerminalOpened(false)
    setDiagnosticsOpened(false)
    setDiagnosticsCount(0)
    setProjectDiagnostics([])
    setProjectDiagnosticsError('')
    setProjectDiagnosticsRunning(false)
    setDiagnosticSamples([])
    setActiveTab('changes')
    setWorkspaceView('code')
    setAgentOpened(false)
    setAgentPromptRequest(null)
    setEditorPosition(null)
    setCollapsedPaths(new Set())
    setSearchQuery('')
    setSearchResults([])
    setPendingClosePath(null)
  }, [])

  const closeMissingProject = useCallback(
    async (notice: string): Promise<void> => {
      if (!window.desktop) {
        return
      }
      setMissingProjectBusy(true)
      setMissingProjectError('')
      try {
        await window.desktop.closeCurrentProject()
        clearProjectWorkspace()
        setMissingProject(null)
        await refreshRecentProjects()
        setNotice(notice)
      } catch (error) {
        setMissingProjectError(
          error instanceof Error ? error.message : '无法关闭丢失的项目。'
        )
      } finally {
        setMissingProjectBusy(false)
      }
    },
    [clearProjectWorkspace, refreshRecentProjects]
  )

  const loadProject = useCallback(async (projectInfo: ProjectInfo): Promise<void> => {
    if (!window.desktop) {
      return
    }

    setBusy(true)
    try {
      const availability =
        await window.desktop.checkProjectAvailability()
      if (
        availability.project?.path === projectInfo.path &&
        !availability.available
      ) {
        setMissingProject(projectInfo)
        setMissingProjectError('')
        return
      }
      const [tree, status, savedRunCommand] = await Promise.all([
        window.desktop.getFileTree(),
        window.desktop.getGitStatus(),
        window.desktop.getRunCommand()
      ])
      setProject(projectInfo)
      setFileTree(tree)
      setOpenFiles([])
      setActivePath(null)
      setSelectedExplorerEntry(null)
      setSidebarMode('explorer')
      setSearchQuery('')
      setSearchResults([])
      setGitDiff(null)
      setGitStatus(status)
      setRunCommand(savedRunCommand)
      setTerminalOpened(false)
      setDiagnosticsOpened(false)
      setDiagnosticsCount(0)
      setProjectDiagnostics([])
      setProjectDiagnosticsError('')
      setProjectDiagnosticsRunning(false)
      setDiagnosticSamples([])
      setDiagnosticsRefreshToken((token) => token + 1)
      setActiveTab('changes')
      setWorkspaceView('code')
      setAgentOpened(false)
      setAgentPromptRequest(null)
      setEditorPosition(null)
      setCollapsedPaths(new Set(collectDirectoryPaths(tree)))
      setNotice(`已打开项目：${projectInfo.name}`)
      await refreshRecentProjects()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '读取项目失败。')
    } finally {
      setBusy(false)
    }
  }, [refreshRecentProjects])

  const openProjectAfterMissing = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    setMissingProjectBusy(true)
    setMissingProjectError('')
    try {
      await window.desktop.closeCurrentProject()
      clearProjectWorkspace()
      await refreshRecentProjects()
      const selectedProject = await window.desktop.openProject()
      setMissingProject(null)
      if (selectedProject) {
        await loadProject(selectedProject)
      } else {
        setNotice('项目文件夹已丢失，已返回主界面。')
      }
    } catch (error) {
      setMissingProjectError(
        error instanceof Error ? error.message : '打开新项目失败。'
      )
    } finally {
      setMissingProjectBusy(false)
    }
  }, [
    clearProjectWorkspace,
    loadProject,
    refreshRecentProjects
  ])

  const verifyProjectAvailability = useCallback(async (): Promise<void> => {
    if (!window.desktop || !project || missingProject) {
      return
    }
    try {
      const availability =
        await window.desktop.checkProjectAvailability()
      if (
        availability.project?.path === project.path &&
        !availability.available
      ) {
        setMissingProject(project)
        setMissingProjectError('')
      }
    } catch {
      // Temporary IPC failures should not be treated as a deleted project.
    }
  }, [missingProject, project])

  useEffect(() => {
    if (!project || missingProject || !window.desktop) {
      return
    }
    const handleFocus = (): void => {
      void verifyProjectAvailability()
    }
    const timer = window.setInterval(
      () => void verifyProjectAvailability(),
      2500
    )
    window.addEventListener('focus', handleFocus)
    void verifyProjectAvailability()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
    }
  }, [missingProject, project, verifyProjectAvailability])

  useEffect(() => {
    if (!window.desktop) {
      setNotice('浏览器预览模式：桌面桥接仅在 Electron 中可用。')
      return
    }

    void Promise.all([
      window.desktop
        .getAppInfo()
        .then(setAppInfo)
        .catch(() => setNotice('无法读取 Electron 运行环境。')),
      refreshRecentProjects()
    ])

    void window.desktop.getCurrentProject().then((currentProject) => {
      if (currentProject) {
        void loadProject(currentProject)
      }
    })
  }, [loadProject, refreshRecentProjects])

  useEffect(() => {
    if (!window.desktop) {
      return
    }
    void window.desktop.getUpdateStatus().then(setUpdateStatus)
    return window.desktop.onUpdateStatus(setUpdateStatus)
  }, [])

  useEffect(() => {
    if (!window.desktop) {
      return
    }
    return window.desktop.onCloseRequested(() => {
      setApplicationCloseError('')
      setApplicationCloseRequested(true)
    })
  }, [])

  useEffect(() => {
    if (!window.desktop) {
      return
    }
    void window.desktop.getDebuggerSnapshot().then(setDebuggerSnapshot)
    return window.desktop.onDebuggerSnapshot(setDebuggerSnapshot)
  }, [])

  const handleCheckForUpdates = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    try {
      const status = await window.desktop.checkForUpdates()
      setUpdateStatus(status)
      setNotice(status.message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '检查更新失败。')
    }
  }, [])

  const handleDownloadUpdate = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    try {
      const status = await window.desktop.downloadUpdate()
      setUpdateStatus(status)
      setNotice(status.message)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '下载更新失败。')
    }
  }, [])

  const handleInstallUpdate = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }
    try {
      await window.desktop.installUpdate()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '安装更新失败。')
    }
  }, [])

  const handleOpenProject = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      setNotice('请在 Electron 桌面应用中使用项目选择器。')
      return
    }

    setBusy(true)
    try {
      const selectedProject = await window.desktop.openProject()
      if (selectedProject) {
        await loadProject(selectedProject)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '打开项目失败。')
    } finally {
      setBusy(false)
    }
  }, [loadProject])

  const handleCreateProject = useCallback(
    async (input: CreateProjectInput): Promise<void> => {
      if (!window.desktop) {
        return
      }

      setBusy(true)
      try {
        const createdProject = await window.desktop.createProject(input)
        await loadProject(createdProject)
        setNewProjectModalOpen(false)
        const templateName =
          PROJECT_TEMPLATES.find((template) => template.id === input.template)
            ?.name ?? '项目'
        setNotice(`已创建 ${templateName}：${createdProject.name}`)
      } finally {
        setBusy(false)
      }
    },
    [loadProject]
  )

  const handleOpenRecentProject = useCallback(
    async (path: string): Promise<void> => {
      if (!window.desktop) {
        return
      }

      setBusy(true)
      try {
        const selectedProject = await window.desktop.openRecentProject(path)
        await loadProject(selectedProject)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '无法打开最近项目。'
        await refreshRecentProjects()
        setNotice(
          message.includes('项目已经删除')
            ? '项目已经删除，已从最近项目列表移除。'
            : message
        )
      } finally {
        setBusy(false)
      }
    },
    [loadProject, refreshRecentProjects]
  )

  const openFile = useCallback(
    async (node: FileEntry): Promise<void> => {
      if (!window.desktop) {
        return
      }
      setSelectedExplorerEntry(node)

      const existingFile = openFiles.find((file) => file.path === node.path)
      if (existingFile) {
        setActivePath(node.path)
        setGitDiff(null)
        setEditorPosition(null)
        return
      }

      setBusy(true)
      try {
        const file = await window.desktop.readFile(node.path)
        setOpenFiles((currentFiles) => [
          ...currentFiles,
          {
            path: node.path,
            name: node.name,
            content: file.content,
            savedContent: file.content,
            dirty: false
          }
        ])
        setActivePath(node.path)
        setGitDiff(null)
        setEditorPosition(null)
        setNotice(`已打开 ${node.name}`)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '无法读取文件。')
      } finally {
        setBusy(false)
      }
    },
    [openFiles]
  )

  const previewWorkspaceFile = useCallback(
    async (path: string, name = fileNameFromPath(path)): Promise<void> => {
      const existingFile = openFiles.find((file) => file.path === path)
      if (existingFile) {
        setFilePreview({
          path,
          content: existingFile.content,
          language: languageFromPath(path)
        })
        return
      }
      if (!window.desktop) {
        return
      }
      try {
        const file = await window.desktop.readFile(path)
        setFilePreview({
          path,
          content: file.content,
          language: languageFromPath(path)
        })
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : `无法预览文件：${name}`
        )
      }
    },
    [openFiles]
  )

  const openWorkspaceFile = useCallback(
    (node: FileEntry): void => {
      if (workspaceView === 'agent') {
        setSelectedExplorerEntry(node)
        void previewWorkspaceFile(node.path, node.name)
        return
      }
      void openFile(node)
    },
    [openFile, previewWorkspaceFile, workspaceView]
  )

  const openAgentRelatedPath = useCallback(
    (path: string): void => {
      const separator = project?.path.includes('\\') ? '\\' : '/'
      let normalizedPath =
        separator === '\\' ? path.replaceAll('/', '\\') : path.replaceAll('\\', '/')
      const projectRoot = project?.path.replace(/[\\/]+$/, '') ?? ''
      if (
        projectRoot &&
        normalizedPath
          .toLowerCase()
          .startsWith(`${projectRoot.toLowerCase()}${separator}`)
      ) {
        normalizedPath = normalizedPath.slice(projectRoot.length + 1)
      }
      const entry = findFileEntry(fileTree, normalizedPath)
      const segments = normalizedPath.split(/[\\/]/).filter(Boolean)
      setCollapsedPaths((current) => {
        const next = new Set(current)
        for (let index = 1; index <= segments.length; index += 1) {
          next.delete(segments.slice(0, index).join(separator))
        }
        return next
      })
      setSidebarMode('explorer')
      setWorkspaceLayout((current) => ({
        ...current,
        sidebarVisible: true
      }))
      const revealTreeRow = (): void => {
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(
              `[data-tree-path="${CSS.escape(normalizedPath)}"]`
            )
            ?.scrollIntoView({ block: 'center' })
        })
      }
      if (entry?.type === 'directory') {
        setSelectedExplorerEntry(entry)
        setNotice(`已在资源管理器中定位文件夹：${entry.name}`)
        revealTreeRow()
        return
      }
      setSelectedExplorerEntry(entry)
      const file =
        entry ?? {
          name: fileNameFromPath(path),
          path: normalizedPath,
          type: 'file' as const
        }
      if (workspaceView === 'agent') {
        void previewWorkspaceFile(file.path, file.name)
      } else {
        void openFile(file)
      }
      revealTreeRow()
    },
    [
      fileTree,
      openFile,
      previewWorkspaceFile,
      project?.path,
      workspaceView
    ]
  )

  useEffect(() => {
    const previousCount = lastDebugLogCountRef.current
    const output = debuggerSnapshot.output
    const nextEntries = output.slice(
      output.length < previousCount ? 0 : previousCount
    )
    lastDebugLogCountRef.current = output.length
    if (nextEntries.length) {
      const time = new Date().toLocaleTimeString('zh-CN', {
        hour12: false
      })
      setOutputEntries((current) => [
        ...current.slice(-199),
        ...nextEntries.map((message) => ({
          id: ++outputEntryIdRef.current,
          time,
          message
        }))
      ])
    }
  }, [debuggerSnapshot.output])

  useEffect(() => {
    const previousCount = lastDebugOutputCountRef.current
    const output = debuggerSnapshot.programOutput
    const nextEntries = output.slice(
      output.length < previousCount ? 0 : previousCount
    )
    lastDebugOutputCountRef.current = output.length
    if (nextEntries.length) {
      setConsoleEntries((current) => [
        ...current.slice(-999),
        ...nextEntries
      ])
    }
  }, [debuggerSnapshot.programOutput])

  useEffect(() => {
    const message = debuggerSnapshot.message.trim()
    if (!message) {
      return
    }
    const eventKey = `${debuggerSnapshot.state}:${message}`
    if (eventKey === lastDebugEventKeyRef.current) {
      return
    }
    lastDebugEventKeyRef.current = eventKey
    setDebugEvents((current) => [
      ...current.slice(-99),
      {
        id: ++debugEventIdRef.current,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message
      }
    ])
  }, [debuggerSnapshot.message, debuggerSnapshot.state])

  useEffect(() => {
    if (
      debuggerSnapshot.state !== 'paused' ||
      !project ||
      !debuggerSnapshot.frames[0]?.source
    ) {
      return
    }
    const frame = debuggerSnapshot.frames[0]
    const source = frame.source
    if (!source) {
      return
    }
    const frameKey = `${source}:${frame.line}`
    if (lastPausedFrameRef.current === frameKey) {
      return
    }
    lastPausedFrameRef.current = frameKey
    const separator = project.path.includes('\\') ? '\\' : '/'
    const root = project.path.replace(/[\\/]+$/, '')
    const absoluteSource = source.replaceAll(
      separator === '\\' ? '/' : '\\',
      separator
    )
    const relativePath = absoluteSource
      .toLowerCase()
      .startsWith(`${root.toLowerCase()}${separator}`)
      ? absoluteSource.slice(root.length + 1)
      : absoluteSource
    void openFile({
      name: fileNameFromPath(relativePath),
      path: relativePath,
      type: 'file'
    }).then(() =>
      setEditorPosition({
        path: relativePath,
        line: frame.line,
        column: frame.column
      })
    )
  }, [debuggerSnapshot.frames, debuggerSnapshot.state, openFile, project])

  const refreshFileTree = useCallback(async (): Promise<void> => {
    if (!window.desktop || !project) {
      return
    }
    setFileTree(await window.desktop.getFileTree())
  }, [project])

  const handleCreateWorkspaceEntry = useCallback(
    async (input: CreateWorkspaceEntryInput): Promise<void> => {
      if (!window.desktop) {
        return
      }
      const created = await window.desktop.createWorkspaceEntry(input)
      setFileTree(await window.desktop.getFileTree())
      if (input.directoryPath) {
        setCollapsedPaths((current) => {
          const next = new Set(current)
          next.delete(input.directoryPath)
          return next
        })
      }
      setSelectedExplorerEntry(created)
      if (created.type === 'file') {
        await openFile(created)
      } else {
        setNotice(`已创建文件夹：${created.name}`)
      }
    },
    [openFile]
  )

  const handleRenameWorkspaceEntry = useCallback(
    async (input: RenameWorkspaceEntryInput): Promise<void> => {
      if (!window.desktop || !project) {
        return
      }
      const renamed = await window.desktop.renameWorkspaceEntry(input)
      setFileTree(await window.desktop.getFileTree())
      setOpenFiles((currentFiles) =>
        currentFiles.map((file) => {
          const nextPath = replacePathPrefix(
            file.path,
            input.path,
            renamed.path
          )
          return nextPath === file.path
            ? file
            : {
                ...file,
                path: nextPath,
                name:
                  file.path === input.path
                    ? renamed.name
                    : fileNameFromPath(nextPath)
              }
        })
      )
      setActivePath((currentPath) =>
        currentPath
          ? replacePathPrefix(currentPath, input.path, renamed.path)
          : null
      )
      setSelectedExplorerEntry((current) => {
        if (!current) {
          return null
        }
        const nextPath = replacePathPrefix(
          current.path,
          input.path,
          renamed.path
        )
        return nextPath === current.path
          ? current
          : {
              ...current,
              path: nextPath,
              name:
                current.path === input.path
                  ? renamed.name
                  : current.name
            }
      })
      setCollapsedPaths((current) => {
        const next = new Set<string>()
        for (const path of current) {
          next.add(replacePathPrefix(path, input.path, renamed.path))
        }
        return next
      })
      await refreshGitStatus()
      setNotice(`已重命名为：${renamed.name}`)
    },
    [project, refreshGitStatus]
  )

  const handleTrashWorkspaceEntry = useCallback(
    async (path: string): Promise<void> => {
      if (!window.desktop) {
        return
      }
      const name = fileNameFromPath(path)
      if (
        appearance.confirmDestructiveActions &&
        !window.confirm(`将“${name}”移到回收站？`)
      ) {
        return
      }
      await window.desktop.trashWorkspaceEntry(path)
      const separator = path.includes('\\') ? '\\' : '/'
      const isRemoved = (candidate: string): boolean =>
        candidate === path || candidate.startsWith(`${path}${separator}`)
      setOpenFiles((currentFiles) =>
        currentFiles.filter((file) => !isRemoved(file.path))
      )
      setActivePath((currentPath) =>
        currentPath && isRemoved(currentPath) ? null : currentPath
      )
      setSelectedExplorerEntry((current) =>
        current && isRemoved(current.path) ? null : current
      )
      setFileTree(await window.desktop.getFileTree())
      await refreshGitStatus()
      setNotice(`已移到回收站：${name}`)
    },
    [appearance.confirmDestructiveActions, refreshGitStatus]
  )

  const permanentlyDeleteWorkspaceEntry = useCallback(
    async (path: string): Promise<void> => {
      if (!window.desktop) {
        return
      }
      const name = fileNameFromPath(path)
      if (
        appearance.confirmDestructiveActions &&
        !window.confirm(
          `永久删除“${name}”？\n\n此操作不会进入回收站，且无法撤销。`
        )
      ) {
        return
      }
      await window.desktop.deleteWorkspaceEntry(path)
      const separator = path.includes('\\') ? '\\' : '/'
      const isRemoved = (candidate: string): boolean =>
        candidate === path || candidate.startsWith(`${path}${separator}`)
      setOpenFiles((currentFiles) =>
        currentFiles.filter((file) => !isRemoved(file.path))
      )
      setActivePath((currentPath) =>
        currentPath && isRemoved(currentPath) ? null : currentPath
      )
      setSelectedExplorerEntry((current) =>
        current && isRemoved(current.path) ? null : current
      )
      setFileTree(await window.desktop.getFileTree())
      await refreshGitStatus()
      setNotice(`已永久删除：${name}`)
    },
    [appearance.confirmDestructiveActions, refreshGitStatus]
  )

  const openExplorerContextMenu = useCallback(
    (
      event: React.MouseEvent,
      target: Omit<ExplorerContextTarget, 'absolutePath'>
    ): void => {
      event.preventDefault()
      event.stopPropagation()
      setExplorerContextMenu({
        x: event.clientX,
        y: event.clientY,
        target: {
          ...target,
          absolutePath: projectAbsolutePath(
            project?.path ?? '',
            target.path
          )
        }
      })
    },
    [project]
  )

  const openExplorerNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: FileEntry): void => {
      setSelectedExplorerEntry(node)
      const separator = node.path.includes('\\') ? '\\' : '/'
      const parentPath = node.path
        .split(/[\\/]/)
        .slice(0, -1)
        .join(separator)
      openExplorerContextMenu(event, {
        kind: node.type,
        path: node.path,
        directoryPath: node.type === 'directory' ? node.path : parentPath,
        name: node.name
      })
    },
    [openExplorerContextMenu]
  )

  const openRootExplorerContextMenu = useCallback(
    (event: React.MouseEvent): void => {
      setSelectedExplorerEntry(null)
      openExplorerContextMenu(event, {
        kind: 'root',
        path: '',
        directoryPath: '',
        name: project?.name ?? ''
      })
    },
    [openExplorerContextMenu, project]
  )

  const copyExplorerPath = useCallback(
    (text: string, label: string): void => {
      void navigator.clipboard.writeText(text).then(
        () => setNotice(`已复制${label}`),
        () => setNotice('复制路径失败。')
      )
    },
    []
  )

  const openExplorerDirectoryInTerminal = useCallback(
    (directoryPath: string): void => {
      if (!project) {
        return
      }
      const absolutePath = projectAbsolutePath(project.path, directoryPath)
      const escapedPath = absolutePath.replaceAll("'", "''")
      setTerminalOpened(true)
      setActiveTab('terminal')
      setExternalRunRequest({
        id: Date.now(),
        command: `Set-Location -LiteralPath '${escapedPath}'`
      })
      setNotice(`终端已切换到：${directoryPath || project.name}`)
    },
    [project]
  )

  const openGitDiff = useCallback(async (change: GitFileChange): Promise<void> => {
    if (!window.desktop) {
      return
    }

    setGitBusy(true)
    try {
      const diff = await window.desktop.getGitFileDiff(
        change.path,
        change.originalPath
      )
      setGitDiff(diff)
      setNotice(`正在查看 ${change.path} 的 Git 变更。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法读取文件差异。')
    } finally {
      setGitBusy(false)
    }
  }, [])

  const openDiagnostic = useCallback(
    async (diagnostic: ProjectDiagnostic): Promise<void> => {
      if (!window.desktop) {
        return
      }

      const existingFile = openFiles.find(
        (file) => file.path === diagnostic.file
      )
      if (!existingFile) {
        setBusy(true)
        try {
          const file = await window.desktop.readFile(diagnostic.file)
          setOpenFiles((currentFiles) => [
            ...currentFiles,
            {
              path: diagnostic.file,
              name: fileNameFromPath(diagnostic.file),
              content: file.content,
              savedContent: file.content,
              dirty: false
            }
          ])
        } catch (error) {
          setNotice(
            error instanceof Error ? error.message : '无法打开诊断文件。'
          )
          return
        } finally {
          setBusy(false)
        }
      }

      setActivePath(diagnostic.file)
      setGitDiff(null)
      setWorkspaceView('code')
      setEditorPosition({
        path: diagnostic.file,
        line: diagnostic.line,
        column: diagnostic.column
      })
    },
    [openFiles]
  )

  const runErrorListDiagnostics = useCallback(async (): Promise<void> => {
    if (!window.desktop || !project || projectDiagnosticsRunning) {
      return
    }
    setProjectDiagnosticsRunning(true)
    setProjectDiagnosticsError('')
    try {
      const result = await window.desktop.runProjectDiagnostics()
      setProjectDiagnostics(result.items)
      if (result.state === 'error') {
        setProjectDiagnosticsError(
          result.error ?? '项目诊断命令执行失败。'
        )
      }
    } catch (error) {
      setProjectDiagnosticsError(
        error instanceof Error ? error.message : '项目诊断失败。'
      )
    } finally {
      setProjectDiagnosticsRunning(false)
    }
  }, [project, projectDiagnosticsRunning])

  const openAgentWithPrompt = useCallback(
    (
      text: string,
      contextFiles: string[] = [],
      taskId?: string
    ): void => {
      if (!project) {
        setNotice('请先打开项目，再启动 Agent 任务。')
        return
      }
      setAgentPromptRequest({
        id: crypto.randomUUID(),
        text,
        contextFiles: [...new Set(contextFiles)],
        taskId
      })
      setAgentOpened(true)
      setWorkspaceView('agent')
    },
    [project]
  )

  const askAgentAboutExplorerTarget = useCallback(
    (target: ExplorerContextTarget): void => {
      const prompt =
        target.kind === 'root'
          ? '请先阅读当前项目结构，找出最值得优先处理的问题，并给出有依据的建议。'
          : target.kind === 'directory'
            ? `请以当前项目中的文件夹“${target.path}”为重点检查范围，理解其职责、依赖和主要风险。需要修改时先说明方案，并保持改动最小。`
            : `请检查当前项目中的文件“${target.path}”，分析实现、潜在问题和改进空间。需要修改时先说明方案，并保持改动最小。`
      openAgentWithPrompt(
        prompt,
        target.kind === 'root' ? [] : [target.path]
      )
    },
    [openAgentWithPrompt]
  )

  const openAgentForEditorContext = useCallback(
    (intent: EditorAgentIntent): void => {
      const path = activePathRef.current
      const editor = editorRef.current
      if (!path || !editor) {
        setNotice('请先打开一个代码文件。')
        return
      }
      const model = editor.getModel()
      const selection = editor.getSelection()
      const position = editor.getPosition()
      if (!model || !position) {
        return
      }
      const hasSelection = Boolean(selection && !selection.isEmpty())
      const startLine = selection?.startLineNumber ?? position.lineNumber
      const endLine = selection?.endLineNumber ?? position.lineNumber
      const selectedCode = hasSelection
        ? model.getValueInRange(selection!).slice(0, 6_000)
        : ''
      const prompt = buildEditorAgentPrompt({
        intent,
        path,
        startLine,
        startColumn: selection?.startColumn ?? position.column,
        endLine,
        selectedText: selectedCode
      })
      openAgentWithPrompt(prompt, [path])
    },
    [openAgentWithPrompt]
  )

  useEffect(() => {
    openAgentForEditorContextRef.current = openAgentForEditorContext
  }, [openAgentForEditorContext])

  const openCppFunctionLocation = useCallback(
    (location: LocatedCppFunction): void => {
      setEditorContextMenu(null)
      void openFile({
        name: fileNameFromPath(location.path),
        path: location.path,
        type: 'file'
      }).then(() => {
        setWorkspaceView('code')
        setEditorPosition({
          path: location.path,
          line: location.line,
          column: 1
        })
      })
    },
    [openFile]
  )

  const resolveEditorFunctionContext = useCallback(
    async (
      symbol: CppFunctionSymbol,
      currentPath: string,
      currentContent: string,
      currentLine: number,
      requestId: number
    ): Promise<void> => {
      try {
        const results = window.desktop
          ? await window.desktop.searchCode(symbol.name)
          : []
        const candidatePaths = [
          currentPath,
          ...results
            .map((result) => result.path)
            .filter(
              (path) =>
                isCppHeaderPath(path) ||
                /\.(?:c|cc|cpp|cxx)$/i.test(path)
            )
        ].filter((path, index, paths) => paths.indexOf(path) === index)
        const files = (
          await Promise.all(
            candidatePaths.slice(0, 40).map(async (path) => {
              try {
                const content =
                  path === currentPath
                    ? currentContent
                    : (await window.desktop.readFile(path)).content
                return { path, content }
              } catch {
                return null
              }
            })
          )
        ).filter(
          (file): file is { path: string; content: string } => Boolean(file)
        )
        const locations = locateCppFunctions(files, symbol.name)
        const declaration =
          locations.find(
            (location) =>
              !location.hasBody && location.path === currentPath
          ) ??
          locations.find((location) => !location.hasBody) ??
          (!symbol.hasBody
            ? {
                ...symbol,
                path: currentPath,
                line: currentLine
              }
            : null)
        const definition =
          locations.find((location) => location.hasBody) ?? null
        if (editorFunctionLookupIdRef.current !== requestId) {
          return
        }
        setEditorContextMenu((current) =>
          current
            ? {
                ...current,
                functionContext: {
                  requestId,
                  symbol,
                  declaration,
                  definition,
                  loading: false,
                  canGenerate:
                    !symbol.hasBody &&
                    isCppHeaderPath(currentPath) &&
                    !definition
                }
              }
            : current
        )
      } catch {
        if (editorFunctionLookupIdRef.current === requestId) {
          setEditorContextMenu((current) =>
            current
              ? {
                  ...current,
                  functionContext: {
                    requestId,
                    symbol,
                    declaration: !symbol.hasBody
                      ? {
                          ...symbol,
                          path: currentPath,
                          line: currentLine
                        }
                      : null,
                    definition: null,
                    loading: false,
                    canGenerate:
                      !symbol.hasBody && isCppHeaderPath(currentPath)
                  }
                }
              : current
          )
        }
      }
    },
    []
  )

  const generateCppFunctionImplementation = useCallback(
    async (symbol: CppFunctionSymbol): Promise<void> => {
      if (
        !window.desktop ||
        !project ||
        !activeFile ||
        !isCppHeaderPath(activeFile.path)
      ) {
        return
      }
      if (activeFile.dirty) {
        setNotice('请先保存头文件，再生成函数实现。')
        return
      }
      const sourcePath = cppImplementationPath(activeFile.path)
      const openedSource = openFiles.find(
        (file) => file.path === sourcePath
      )
      if (openedSource?.dirty) {
        setNotice('目标源文件有未保存更改，请先保存后再生成函数实现。')
        return
      }
      const sourceEntry = findFileEntry(fileTree, sourcePath)
      try {
        const existingContent =
          openedSource?.content ??
          (sourceEntry
            ? (await window.desktop.readFile(sourcePath)).content
            : '')
        const existingDefinition = locateCppFunctions(
          [{ path: sourcePath, content: existingContent }],
          symbol.name
        ).find((location) => location.hasBody)
        if (existingDefinition) {
          openCppFunctionLocation(existingDefinition)
          setNotice(
            `函数实现已存在于：${sourcePath}:${existingDefinition.line}`
          )
          return
        }
        const sourceHasNamespace = cppFileHasNamespace(
          existingContent,
          symbol.namespaceName
        )
        const implementation = buildCppImplementation(symbol, {
          qualifyScope: !sourceHasNamespace
        })
        const appended = appendCppImplementation(
          existingContent,
          fileNameFromPath(activeFile.path),
          implementation.code,
          sourceHasNamespace ? symbol.namespaceName : null
        )
        if (sourceEntry || existingContent) {
          await window.desktop.saveFile(sourcePath, appended.content)
        } else {
          await window.desktop.createWorkspaceEntry({
            directoryPath:
              sourcePath.split(/[\\/]/).slice(0, -1).join(
                sourcePath.includes('\\') ? '\\' : '/'
              ),
            type: 'file',
            name: fileNameFromPath(sourcePath),
            content: appended.content,
            createParentDirectories: true
          })
        }
        setFileTree(await window.desktop.getFileTree())
        const nextFile: OpenFile = {
          path: sourcePath,
          name: fileNameFromPath(sourcePath),
          content: appended.content,
          savedContent: appended.content,
          dirty: false
        }
        setOpenFiles((current) =>
          current.some((file) => file.path === sourcePath)
            ? current.map((file) =>
                file.path === sourcePath ? nextFile : file
              )
            : [...current, nextFile]
        )
        setActivePath(sourcePath)
        setGitDiff(null)
        setWorkspaceView('code')
        setEditorPosition({
          path: sourcePath,
          line: appended.insertLine,
          column: 1
        })
        setEditorContextMenu(null)
        await refreshGitStatus()
        setNotice(
          `已生成空函数实现：${implementation.qualifiedName} → ${sourcePath}`
        )
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : '生成函数实现失败。'
        )
      }
    },
    [
      activeFile,
      fileTree,
      openCppFunctionLocation,
      openFiles,
      project,
      refreshGitStatus
    ]
  )

  const askAgentToFixDiagnostics = useCallback(
    (diagnostics: ProjectDiagnostic[]): void => {
      const selectedDiagnostics = diagnostics.slice(0, 50)
      if (!selectedDiagnostics.length) {
        return
      }

      const prompt = [
        'Fix the following project diagnostics.',
        'Inspect the relevant code first, make the smallest correct change, and verify it with the project diagnostics command.',
        '',
        ...selectedDiagnostics.map(
          (diagnostic) =>
            `- ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.severity}${diagnostic.code ? ` ${diagnostic.code}` : ''}] ${diagnostic.message}`
        )
      ].join('\n')

      openAgentWithPrompt(
        prompt,
        selectedDiagnostics.map((diagnostic) => diagnostic.file)
      )
    },
    [openAgentWithPrompt]
  )

  const setChangeStaged = useCallback(
    async (change: GitFileChange, shouldStage: boolean): Promise<void> => {
      if (!window.desktop) {
        return
      }

      const paths = [change.path, change.originalPath].filter(
        (path): path is string => Boolean(path)
      )

      setGitBusy(true)
      try {
        const status = shouldStage
          ? await window.desktop.stageFiles(paths)
          : await window.desktop.unstageFiles(paths)
        setGitStatus(status)
        setNotice(
          shouldStage
            ? `已暂存 ${change.path}`
            : `已取消暂存 ${change.path}`
        )
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '无法更新暂存区。')
      } finally {
        setGitBusy(false)
      }
    },
    []
  )

  const setAllChangesStaged = useCallback(async (shouldStage: boolean): Promise<void> => {
    if (!window.desktop) {
      return
    }

    setGitBusy(true)
    try {
      const status = shouldStage
        ? await window.desktop.stageAll()
        : await window.desktop.unstageAll()
      setGitStatus(status)
      setNotice(shouldStage ? '已暂存全部变更。' : '已取消暂存全部变更。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法更新暂存区。')
    } finally {
      setGitBusy(false)
    }
  }, [])

  const createCommit = useCallback(async (): Promise<void> => {
    if (!window.desktop) {
      return
    }

    const summary = commitMessage.trim()
    if (!summary || stagedCount === 0) {
      return
    }

    setGitBusy(true)
    try {
      const result = await window.desktop.commitChanges(summary)
      setGitStatus(result.status)
      setCommitMessage('')
      setGitDiff(null)
      setNotice(`已创建提交 ${result.commitHash}：${result.summary}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '创建提交失败。')
    } finally {
      setGitBusy(false)
    }
  }, [commitMessage, stagedCount])

  const saveProjectRunCommand = useCallback(
    async (command: string): Promise<void> => {
      if (!window.desktop) {
        return
      }

      await window.desktop.saveRunCommand(command)
      setRunCommand(command.trim())
      setNotice(command.trim() ? '项目运行命令已保存。' : '项目运行命令已清除。')
    },
    []
  )

  const handleAgentRunFinished = useCallback(async (
    announce = true
  ): Promise<void> => {
    if (!window.desktop) {
      return
    }

    try {
      const tree = await window.desktop.getFileTree()
      setFileTree(tree)

      const refreshedFiles = await Promise.all(
        openFiles.map(async (file) => {
          try {
            const content = await window.desktop.readFile(file.path)
            return {
              ...file,
              content: content.content,
              savedContent: content.content,
              dirty: false
            }
          } catch {
            return file
          }
        })
      )
      setOpenFiles(refreshedFiles)
      await refreshGitStatus()
      await window.desktop.rebuildCodeIndex()
      setDiagnosticsRefreshToken((token) => token + 1)
      if (announce) {
        setNotice('Agent 任务已结束，项目状态已刷新。')
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '刷新 Agent 结果失败。'
      )
    }
  }, [openFiles, refreshGitStatus])

  const handleWorkflowCompleted = useCallback(
    (result: WorkflowRunResult): void => {
      if (result.agentPrompt) {
        setWorkflowModalOpen(false)
      }
      void handleAgentRunFinished(false)
      setNotice(
        result.status === 'completed'
          ? `工作流“${result.workflowName}”执行完成。`
          : result.status === 'failed'
            ? `工作流“${result.workflowName}”存在失败步骤。`
            : `工作流“${result.workflowName}”已准备 Agent 修复任务。`
      )
      if (result.agentPrompt) {
        openAgentWithPrompt(result.agentPrompt, [], result.taskId)
      }
    },
    [handleAgentRunFinished, openAgentWithPrompt]
  )

  const saveFileForPath = useCallback(
    async (path: string): Promise<boolean> => {
      if (!window.desktop) {
        return false
      }
      const file = openFiles.find((item) => item.path === path)
      if (!file || !file.dirty) {
        return true
      }

      setBusy(true)
      try {
        await window.desktop.saveFile(file.path, file.content)
        setOpenFiles((currentFiles) =>
          currentFiles.map((item) =>
            item.path === file.path
              ? { ...item, savedContent: item.content, dirty: false }
              : item
          )
        )
        setNotice(`已保存 ${file.name}`)
        setGitDiff(null)
        await refreshGitStatus()
        void window.desktop.rebuildCodeIndex()
        setDiagnosticsRefreshToken((token) => token + 1)
        return true
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '保存文件失败。')
        return false
      } finally {
        setBusy(false)
      }
    },
    [openFiles, refreshGitStatus]
  )

  const saveActiveFile = useCallback(async (): Promise<void> => {
    if (activeFile) {
      await saveFileForPath(activeFile.path)
    }
  }, [activeFile, saveFileForPath])

  const saveAllAndCloseApplication = useCallback(async (): Promise<void> => {
    if (!window.desktop || applicationCloseBusy) {
      return
    }
    setApplicationCloseBusy(true)
    setApplicationCloseError('')
    try {
      for (const file of dirtyOpenFiles) {
        if (!(await saveFileForPath(file.path))) {
          setApplicationCloseError(
            `无法保存“${file.name}”，IDE 尚未关闭。请检查文件是否仍存在。`
          )
          return
        }
      }
      await window.desktop.confirmClose()
    } catch (error) {
      setApplicationCloseError(
        error instanceof Error ? error.message : '保存文件失败，IDE 尚未关闭。'
      )
    } finally {
      setApplicationCloseBusy(false)
    }
  }, [applicationCloseBusy, dirtyOpenFiles, saveFileForPath])

  const discardAndCloseApplication = useCallback(async (): Promise<void> => {
    if (!window.desktop || applicationCloseBusy) {
      return
    }
    setApplicationCloseBusy(true)
    setApplicationCloseError('')
    try {
      await window.desktop.confirmClose()
    } catch (error) {
      setApplicationCloseError(
        error instanceof Error ? error.message : '关闭 IDE 失败。'
      )
    } finally {
      setApplicationCloseBusy(false)
    }
  }, [applicationCloseBusy])

  const cancelApplicationClose = useCallback((): void => {
    if (!applicationCloseBusy) {
      setApplicationCloseRequested(false)
      setApplicationCloseError('')
    }
  }, [applicationCloseBusy])

  const runActiveCppFile = useCallback(async (): Promise<void> => {
    if (!window.desktop || !activeFile) {
      return
    }
    if (!isCppSourcePath(activeFile.path)) {
      setNotice('当前文件不是 C/C++ 源文件。')
      return
    }
    if (activeFile.dirty && !(await saveFileForPath(activeFile.path))) {
      return
    }

    setBusy(true)
    try {
      const preparation: CppRunPreparation =
        await window.desktop.prepareCppRun(activeFile.path)
      setExternalRunRequest({
        id: Date.now(),
        command: preparation.command
      })
      setTerminalOpened(true)
      setActiveTab('terminal')
      setBottomPanelTab('output')
      setNotice(`正在使用 ${preparation.compiler} 编译并运行 ${activeFile.name}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法运行当前文件。')
    } finally {
      setBusy(false)
    }
  }, [activeFile, saveFileForPath])

  const runActivePythonFile = useCallback(async (): Promise<void> => {
    if (!window.desktop || !activeFile) {
      return
    }
    if (!isPythonSourcePath(activeFile.path)) {
      setNotice('当前文件不是 Python 源文件。')
      return
    }
    if (activeFile.dirty && !(await saveFileForPath(activeFile.path))) {
      return
    }

    setBusy(true)
    try {
      const preparation: PythonRunPreparation =
        await window.desktop.preparePythonRun(activeFile.path)
      setExternalRunRequest({
        id: Date.now(),
        command: preparation.command
      })
      setTerminalOpened(true)
      setToolWindowLayout((current) =>
        dockToolTab(current, 'terminal', 'bottom', 'center')
      )
      setNotice(`正在使用 ${preparation.interpreter} 运行 ${activeFile.name}`)
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '无法运行当前 Python 文件。'
      )
    } finally {
      setBusy(false)
    }
  }, [activeFile, saveFileForPath])

  const controlDebugger = useCallback(
    async (
      action:
        | 'continue'
        | 'pause'
        | 'step-over'
        | 'step-in'
        | 'step-out'
        | 'stop'
    ): Promise<void> => {
      if (!window.desktop) {
        return
      }
      try {
        await window.desktop.debugControl(action)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '调试操作失败。')
      }
    },
    []
  )

  const startDebugCurrentFile = useCallback(async (): Promise<void> => {
    if (!window.desktop || !activeFile) {
      return
    }
    if (!isCppSourcePath(activeFile.path)) {
      setNotice('当前文件不是 C/C++ 源文件。')
      return
    }
    if (debuggerSnapshot.state === 'starting') {
      await controlDebugger('stop')
      return
    }
    if (debuggerSnapshot.state === 'paused') {
      await controlDebugger('continue')
      return
    }
    if (activeFile.dirty && !(await saveFileForPath(activeFile.path))) {
      return
    }
    setCompilerDiagnostics([])
    setConsoleEntries([])
    setDiagnosticSamples([])
    setDebugEvents([])
    lastDebugOutputCountRef.current = 0
    lastDebugEventKeyRef.current = ''
    setBottomPanelTab('console')
    setDebuggerSnapshot((current) => ({
      ...current,
      state: 'starting',
      message: '正在准备调试器…'
    }))
    try {
      const snapshot = await window.desktop.startCppDebug(
        activeFile.path,
        debugBreakpoints
      )
      setDebuggerSnapshot((current) =>
        current.state === 'paused' ? current : snapshot
      )
      setNotice(snapshot.message)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '调试启动失败。'
      if (/取消|abort|cancel/i.test(message)) {
        setDebuggerSnapshot((current) => ({
          ...current,
          state: 'idle',
          message: '调试已取消。',
          frames: [],
          variables: []
        }))
      } else {
        setCompilerDiagnostics(
          parseCompilerDiagnostics(message, project?.path ?? null)
        )
        setDiagnosticsOpened(true)
        setDebuggerSnapshot((current) => ({
          ...current,
          state: 'error',
          message
        }))
        setBottomPanelTab('output')
        setOutputEntries((current) => [
          ...current.slice(-199),
          {
            id: ++outputEntryIdRef.current,
            time: new Date().toLocaleTimeString('zh-CN', {
              hour12: false
            }),
            message: `调试启动失败：${message}`
          }
        ])
      }
      setNotice(message)
    }
  }, [
    activeFile,
    controlDebugger,
    debugBreakpoints,
    debuggerSnapshot.state,
    project?.path,
    saveFileForPath
  ])

  const toggleDebugBreakpoint = useCallback(
    (line: number): void => {
      const path = activePathRef.current
      if (!path) {
        return
      }
      setDebugBreakpoints((current) => {
        const existing = current.some(
          (breakpoint) =>
            breakpoint.path === path && breakpoint.line === line
        )
        const next = existing
          ? current.filter(
              (breakpoint) =>
                !(
                  breakpoint.path === path &&
                  breakpoint.line === line
                )
            )
          : [...current, { path, line }]
        void window.desktop
          ?.setDebugBreakpoints(next)
          .catch((error: unknown) =>
            setNotice(
              error instanceof Error
                ? error.message
                : '更新调试断点失败。'
            )
          )
        return next
      })
    },
    []
  )

  const openDebugFrame = useCallback(
    (frame: DebugStackFrame): void => {
      if (!frame.source || !project) {
        return
      }
      const separator = project.path.includes('\\') ? '\\' : '/'
      const root = project.path.replace(/[\\/]+$/, '')
      const source = frame.source.replaceAll(
        separator === '\\' ? '/' : '\\',
        separator
      )
      const relativePath = source
        .toLowerCase()
        .startsWith(`${root.toLowerCase()}${separator}`)
        ? source.slice(root.length + 1)
        : source
      void openFile({
        name: fileNameFromPath(relativePath),
        path: relativePath,
        type: 'file'
      }).then(() =>
        setEditorPosition({
          path: relativePath,
          line: frame.line,
          column: frame.column
        })
      )
    },
    [openFile, project]
  )

  const runDebugConsoleCommand = useCallback(
    async (): Promise<void> => {
      const command = debugCommand.trim()
      if (!command) {
        return
      }
      setDebugCommand('')
      const append = (message: string): void => {
        setConsoleEntries((current) => [...current.slice(-199), message])
      }
      append(`> ${command}`)
      switch (command.toLowerCase()) {
        case 'help':
          append(
            '可用命令：help（帮助）、clear（清空）、output（输出）、memory（内存）、problems（问题）、run（运行）、debug（调试）、layout reset（重置布局）'
          )
          break
        case 'clear':
          setConsoleEntries([])
          break
        case 'output':
          setBottomPanelTab('output')
          break
        case 'memory':
          setBottomPanelTab('memory')
          break
        case 'problems':
          if (!project) {
            append('请先打开项目。')
            break
          }
          setDiagnosticsOpened(true)
          setActiveTab('diagnostics')
          setDiagnosticsRefreshToken((token) => token + 1)
          setWorkspaceLayout((current) => ({
            ...current,
            inspectorVisible: true
          }))
          break
        case 'run':
          await runActiveCppFile()
          break
        case 'debug':
          await startDebugCurrentFile()
          break
        case 'layout reset':
          resetWorkspaceLayout()
          append('工作区布局已重置。')
          break
        default:
          if (debuggerSnapshot.state === 'paused') {
            try {
              const result =
                await window.desktop.evaluateDebugExpression(command)
              append(result)
            } catch (error) {
              append(
                error instanceof Error
                  ? error.message
                  : '调试表达式计算失败。'
              )
            }
          } else {
            append(`未知命令：${command}。输入 help 查看可用命令。`)
          }
      }
    },
    [
      debugCommand,
      debuggerSnapshot.state,
      project,
      resetWorkspaceLayout,
      runActiveCppFile,
      startDebugCurrentFile
    ]
  )

  useEffect(() => {
    const handleWorkspaceShortcut = (event: KeyboardEvent): void => {
      const isCommandOrControl = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (isCommandOrControl && key === 's') {
        event.preventDefault()
        void saveActiveFile()
      }

      if (isCommandOrControl && key === 'o') {
        event.preventDefault()
        void handleOpenProject()
      }

      if (isCommandOrControl && !event.shiftKey && key === 'p') {
        event.preventDefault()
        setCommandPaletteMode('files')
        setCommandPaletteOpen(true)
      }

      if (isCommandOrControl && event.shiftKey && key === 'p') {
        event.preventDefault()
        setCommandPaletteMode('commands')
        setCommandPaletteOpen(true)
      }

      if (isCommandOrControl && !event.shiftKey && key === 'q') {
        event.preventDefault()
        setCommandPaletteMode('commands')
        setCommandPaletteOpen(true)
      }

      if (event.key === 'F1') {
        event.preventDefault()
        setCommandPaletteMode('commands')
        setCommandPaletteOpen(true)
      }

      if (isCommandOrControl && key === 'w') {
        event.preventDefault()
        closeActiveEditor()
      }

      if (isCommandOrControl && key === 'j') {
        event.preventDefault()
        toggleBottomPanelVisibility()
      }

      if (isCommandOrControl && event.shiftKey && key === 'u') {
        event.preventDefault()
        setBottomPanelTab('output')
      }
    }

    window.addEventListener('keydown', handleWorkspaceShortcut)
    return () => window.removeEventListener('keydown', handleWorkspaceShortcut)
  }, [
    closeActiveEditor,
    handleOpenProject,
    saveActiveFile,
    setBottomPanelTab,
    toggleBottomPanelVisibility
  ])

  useEffect(() => {
    const handleCommitShortcut = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        void setAllChangesStaged(true)
        return
      }

      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.altKey &&
        event.key.toLowerCase() === 'u'
      ) {
        event.preventDefault()
        void setAllChangesStaged(false)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void createCommit()
      }
    }

    window.addEventListener('keydown', handleCommitShortcut)
    return () => window.removeEventListener('keydown', handleCommitShortcut)
  }, [createCommit, setAllChangesStaged])

  useEffect(() => {
    if (
      !editorPosition ||
      editorPosition.path !== activePath ||
      !editorRef.current
    ) {
      return
    }

    const frame = requestAnimationFrame(() => {
      editorRef.current?.revealPositionInCenter({
        lineNumber: editorPosition.line,
        column: editorPosition.column
      })
      editorRef.current?.setPosition({
        lineNumber: editorPosition.line,
        column: editorPosition.column
      })
      editorRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [activePath, editorPosition])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activePath) {
      return
    }
    const decorations = debugBreakpoints
      .filter((breakpoint) => breakpoint.path === activePath)
      .map((breakpoint) => ({
        range: {
          startLineNumber: breakpoint.line,
          startColumn: 1,
          endLineNumber: breakpoint.line,
          endColumn: 1
        },
        options: {
          isWholeLine: true,
          className: 'debug-breakpoint-line',
          glyphMarginClassName: 'debug-breakpoint-glyph'
        }
      }))
    debugDecorationIdsRef.current = editor.deltaDecorations(
      debugDecorationIdsRef.current,
      decorations
    )
  }, [activePath, debugBreakpoints])

  useEffect(() => {
    if (!window.desktop || !activeFile || !isCppSourcePath(activeFile.path)) {
      setLiveCompilerDiagnostics([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void window.desktop
        .checkCppSyntax(activeFile.path, activeFile.content)
        .then((result) => {
          if (cancelled) {
            return
          }
          const normalizedOutput = [
            result.temporarySource,
            result.temporarySource.replaceAll('\\', '/'),
            result.temporarySource.replaceAll('/', '\\')
          ].reduce(
            (output, temporaryPath) =>
              output.replaceAll(temporaryPath, result.sourcePath),
            result.output
          )
          setLiveCompilerDiagnostics(
            parseCompilerDiagnostics(normalizedOutput, project?.path ?? null)
          )
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setNotice(
              error instanceof Error
                ? error.message
                : '实时语法检查失败。'
            )
          }
        })
    }, 600)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeFile, project?.path])

  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel()
    if (!editor || !monaco || !model || !activePath) {
      return
    }
    const normalizedActivePath = activePath
      .replaceAll('\\', '/')
      .toLowerCase()
    const markers = [...liveCompilerDiagnostics, ...compilerDiagnostics]
      .filter(
        (diagnostic) =>
          diagnostic.file.replaceAll('\\', '/').toLowerCase() ===
          normalizedActivePath
      )
      .map((diagnostic) => ({
        startLineNumber: diagnostic.line,
        startColumn: diagnostic.column,
        endLineNumber: diagnostic.line,
        endColumn: diagnostic.column + 1,
        message: diagnostic.message,
        severity:
          diagnostic.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : diagnostic.severity === 'warning'
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info
      }))
    monaco.editor.setModelMarkers(
      model,
      'ai-ide-compiler',
      markers
    )
  }, [activePath, compilerDiagnostics, liveCompilerDiagnostics])

  const toggleDirectory = useCallback((path: string): void => {
    setCollapsedPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths)
      if (nextPaths.has(path)) {
        nextPaths.delete(path)
      } else {
        nextPaths.add(path)
      }
      return nextPaths
    })
  }, [])

  const removeOpenFile = (path: string): void => {
    const fileIndex = openFiles.findIndex((item) => item.path === path)
    const nextFiles = openFiles.filter((item) => item.path !== path)
    setOpenFiles(nextFiles)

    if (activePath === path) {
      const nextActiveFile = nextFiles[Math.max(0, fileIndex - 1)] ?? null
      setActivePath(nextActiveFile?.path ?? null)
    }
  }

  const closeFile = (
    path: string,
    event: { stopPropagation: () => void }
  ): void => {
    event.stopPropagation()
    const file = openFiles.find((item) => item.path === path)
    if (file?.dirty) {
      setPendingClosePath(path)
      return
    }
    removeOpenFile(path)
  }

  const cancelPendingClose = useCallback((): void => {
    if (!closeBusy) {
      setPendingClosePath(null)
    }
  }, [closeBusy])

  const discardPendingClose = (): void => {
    if (!pendingClosePath || closeBusy) {
      return
    }
    removeOpenFile(pendingClosePath)
    setPendingClosePath(null)
  }

  const savePendingClose = async (): Promise<void> => {
    if (!pendingClosePath || closeBusy) {
      return
    }
    setCloseBusy(true)
    try {
      if (await saveFileForPath(pendingClosePath)) {
        removeOpenFile(pendingClosePath)
        setPendingClosePath(null)
      }
    } finally {
      setCloseBusy(false)
    }
  }

  const handleEditorChange = (value: string | undefined): void => {
    if (!activeFile) {
      return
    }

    const nextContent = value ?? ''
    setOpenFiles((currentFiles) =>
      currentFiles.map((file) =>
        file.path === activeFile.path
          ? {
              ...file,
              content: nextContent,
              dirty: nextContent !== file.savedContent
            }
          : file
      )
    )
  }

  const quickFileCommands = useMemo<CommandItem[]>(
    () =>
      collectFiles(fileTree)
        .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'))
        .map((file) => ({
          id: `file.quick-open.${file.path}`,
          title: file.name,
          subtitle: file.path,
          group: '文件',
          keywords: [file.path],
          run: () => openWorkspaceFile(file)
        })),
    [fileTree, openWorkspaceFile]
  )

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: 'app.settings',
        title: '打开设置',
        subtitle: '背景样式、编辑器字号、自动换行和布局',
        group: '应用',
        shortcut: 'Ctrl+,',
        keywords: ['settings', 'preferences', 'theme', 'appearance'],
        run: () => setSettingsModalOpen(true)
      },
      {
        id: 'agent.complete',
        title: '触发 Agent 代码补全',
        subtitle: '根据当前文件上下文在光标处生成补全',
        group: 'Agent',
        shortcut: 'Alt+\\',
        keywords: ['completion', 'inline', 'suggest', '补全', '代码'],
        run: () => {
          if (!agentCompletionEnabled) {
            localStorage.setItem('ai-ide:agent-completion-enabled', 'on')
            setAgentCompletionEnabled(true)
          }
          editorRef.current?.trigger(
            'ai-completion',
            'editor.action.inlineSuggest.trigger',
            {}
          )
        }
      },
      {
        id: 'layout.dock-inspector-right',
        title: '将右侧栏停靠到右侧',
        subtitle: '把变更、问题、终端等视图放回编辑器右侧',
        group: '视图',
        keywords: ['layout', 'dock', 'inspector', 'right', '视图', '停靠'],
        run: () => dockInspector('right')
      },
      {
        id: 'layout.dock-inspector-bottom',
        title: '将右侧栏停靠到底部',
        subtitle: '把变更、问题、终端等视图横向放到编辑器下方',
        group: '视图',
        keywords: ['layout', 'dock', 'inspector', 'bottom', '视图', '停靠'],
        run: () => dockInspector('bottom')
      },
      {
        id: 'layout.save-view',
        title: `保存当前视图到方案 ${selectedViewSlot}`,
        subtitle: '记住面板停靠、尺寸、标签页和显示状态',
        group: '视图',
        keywords: ['layout', 'save', 'workspace', 'view', '保存', '视图'],
        run: saveSelectedWorkspaceView
      },
      {
        id: 'layout.restore-view',
        title: `应用视图方案 ${selectedViewSlot}`,
        subtitle: '重新应用该方案保存的布局和面板状态',
        group: '视图',
        keywords: ['layout', 'apply', 'workspace', 'view', '应用', '视图'],
        run: applySelectedWorkspaceView
      },
      {
        id: 'view.error-list',
        title: '打开错误列表',
        subtitle: '查看编译错误、警告和项目诊断结果',
        group: '视图',
        keywords: ['errors', 'warnings', 'problems', '错误', '警告'],
        run: () => setBottomPanelTab('errors')
      },
      {
        id: 'view.diagnostic-tools',
        title: '打开诊断工具',
        subtitle: '查看调试事件、CPU 和内存变化',
        group: '视图',
        keywords: ['diagnostics', 'cpu', 'memory', '诊断', '性能'],
        run: () => setBottomPanelTab('diagnostics')
      },
      {
        id: 'project.new',
        title: '新建项目',
        subtitle: '创建本地文件夹并立即打开',
        group: '项目',
        shortcut: 'Ctrl+Shift+N',
        keywords: ['new', 'create', 'folder', 'workspace'],
        run: () => setNewProjectModalOpen(true)
      },
      {
        id: 'project.open',
        title: '打开或切换项目',
        subtitle: '选择本地项目文件夹',
        group: '项目',
        shortcut: 'Ctrl+O',
        keywords: ['open', 'folder', 'workspace'],
        run: handleOpenProject
      },
      {
        id: 'agent.open',
        title: '打开 Agent 工作台',
        subtitle: '开始或继续一个 AI 开发任务',
        group: 'Agent',
        shortcut: 'T',
        keywords: ['ai', 'deepseek', 'task'],
        run: () => {
          if (!project) {
            setNotice('请先打开项目，再启动 Agent。')
            return
          }
          setAgentOpened(true)
          setWorkspaceView('agent')
        }
      },
      {
        id: 'workflow.open',
        title: '打开项目工作流',
        subtitle: '编辑并运行可复用自动化步骤',
        group: '工作流',
        keywords: ['workflow', 'automation', 'format', 'test'],
        run: () => {
          if (!project) {
            setNotice('请先打开项目，再配置工作流。')
            return
          }
          setWorkflowModalOpen(true)
        }
      },
      {
        id: 'changes.open',
        title: '查看 Git 变更',
        subtitle: '打开源码管理面板',
        group: 'Git',
        keywords: ['diff', 'source', 'control'],
        run: () => setActiveTab('changes')
      },
      {
        id: 'diagnostics.run',
        title: '运行项目诊断',
        subtitle: '执行 TypeScript 或自定义诊断命令',
        group: '诊断',
        keywords: ['problems', 'errors', 'typescript', 'tsc'],
        run: () => {
          if (!project) {
            setNotice('请先打开项目。')
            return
          }
          setDiagnosticsOpened(true)
          setActiveTab('diagnostics')
          setDiagnosticsRefreshToken((token) => token + 1)
        }
      },
      {
        id: 'index.rebuild',
        title: '重建项目代码索引',
        subtitle: '刷新文件名、符号和全文搜索',
        group: '索引',
        keywords: ['index', 'search', 'symbol'],
        run: async () => {
          if (!window.desktop || !project) {
            return
          }
          const status = await window.desktop.rebuildCodeIndex()
          setNotice(
            status.state === 'ready'
              ? `索引完成：${status.indexedFiles} 个文件，${status.indexedSymbols} 个符号。`
              : status.error ?? '代码索引失败。'
          )
        }
      },
      {
        id: 'terminal.open',
        title: '打开项目终端',
        subtitle: 'PowerShell 或系统默认 Shell',
        group: '终端',
        keywords: ['shell', 'powershell', 'command'],
        run: () => {
          if (!project) {
            setNotice('请先打开项目。')
            return
          }
          setTerminalOpened(true)
          setActiveTab('terminal')
        }
      },
      {
        id: 'terminal.run',
        title: '运行项目命令',
        subtitle: runCommand || '在终端中执行已保存的项目命令',
        group: '终端',
        keywords: ['run', 'start', 'dev', 'build'],
        run: () => {
          if (!project) {
            setNotice('请先打开项目。')
            return
          }
          if (!runCommand.trim()) {
            setTerminalOpened(true)
            setActiveTab('terminal')
            setNotice('请先在终端中配置项目运行命令。')
            return
          }
          setTerminalOpened(true)
          setActiveTab('terminal')
          setTerminalRunRequest((request) => request + 1)
        }
      }
    ]

    if (activeFile) {
      items.push(
        {
          id: 'file.save',
          title: '保存当前文件',
          subtitle: activeFile.path,
          group: '文件',
          shortcut: 'Ctrl+S',
          keywords: ['save', 'write'],
          run: saveActiveFile
        },
        {
          id: 'agent.review.file',
          title: 'Agent：审查当前文件',
          subtitle: activeFile.path,
          group: 'Agent 预设',
          keywords: ['review', 'file', 'quality'],
          run: () =>
            openAgentWithPrompt(
              `Review ${activeFile.path} for bugs, maintainability issues, and missing tests. Do not modify files unless I ask you to.`,
              [activeFile.path]
            )
        },
        {
          id: 'agent.explain.file',
          title: 'Agent：解释当前文件',
          subtitle: activeFile.path,
          group: 'Agent 预设',
          keywords: ['explain', 'architecture', 'file'],
          run: () =>
            openAgentWithPrompt(
              `Explain the structure and responsibilities of ${activeFile.path}. Focus on the main flow and important edge cases.`,
              [activeFile.path]
            )
        }
      )
      if (isCppSourcePath(activeFile.path)) {
        items.push({
          id: 'debug.start-cpp',
          title: '启动 C/C++ 调试',
          subtitle: '编译并使用 GDB 启动调试会话',
          group: '调试',
          shortcut: 'F5',
          keywords: ['debug', 'cpp', 'c++', 'gdb', 'breakpoint'],
          run: startDebugCurrentFile
        })
        items.push({
          id: 'file.run-cpp',
          title: '编译并运行当前 C/C++ 文件',
          subtitle: '使用 MSVC、GCC 或 Clang 在集成终端中运行',
          group: '运行',
          shortcut: 'Ctrl+F5',
          keywords: ['cpp', 'c++', 'compile', 'run', 'msvc'],
          run: runActiveCppFile
        })
      }
      if (isPythonSourcePath(activeFile.path)) {
        items.push({
          id: 'file.run-python',
          title: '运行当前 Python 文件',
          subtitle: '使用项目虚拟环境或系统 Python 在集成终端中运行',
          group: '运行',
          shortcut: 'Shift+F10',
          keywords: ['python', 'py', 'run', 'venv', 'pycharm'],
          run: runActivePythonFile
        })
      }
    }

    if (project) {
      items.push(
        {
          id: 'git.stage.all',
          title: 'Git：暂存全部变更',
          subtitle: '将全部修改加入暂存区',
          group: 'Git',
          shortcut: 'Ctrl+Shift+A',
          keywords: ['stage', 'add'],
          run: () => setAllChangesStaged(true)
        },
        {
          id: 'git.unstage.all',
          title: 'Git：取消暂存全部变更',
          subtitle: '清空当前暂存区',
          group: 'Git',
          shortcut: 'Ctrl+Shift+Alt+U',
          keywords: ['unstage', 'reset'],
          run: () => setAllChangesStaged(false)
        },
        {
          id: 'agent.review.changes',
          title: 'Agent：审查 Git 变更',
          subtitle: '检查未提交修改和行为风险',
          group: 'Agent 预设',
          keywords: ['review', 'diff', 'changes'],
          run: () =>
            openAgentWithPrompt(
              'Review the current uncommitted Git changes. Identify bugs, regressions, missing tests, and risky behavior. Do not modify files unless I ask you to.'
            )
        },
        {
          id: 'agent.fix.diagnostics',
          title: 'Agent：修复项目问题',
          subtitle: '运行诊断并修复发现的问题',
          group: 'Agent 预设',
          keywords: ['fix', 'diagnostics', 'errors'],
          run: () =>
            openAgentWithPrompt(
              'Run the project diagnostics command, inspect the failing code, fix the reported problems, and rerun diagnostics to verify the result.'
            )
        }
      )
    }

    return items
  }, [
    activeFile,
    agentCompletionEnabled,
    applySelectedWorkspaceView,
    dockInspector,
    handleOpenProject,
    openAgentWithPrompt,
    project,
    runActiveCppFile,
    runActivePythonFile,
    runCommand,
    saveSelectedWorkspaceView,
    selectedViewSlot,
    saveActiveFile,
    setBottomPanelTab,
    startDebugCurrentFile,
    setAllChangesStaged
  ])

  const handleAppMenuCommand = useCallback(
    (command: AppMenuCommand) => {
      const saveSchemeMatch = /^view:save-scheme-([1-5])$/.exec(command)
      if (saveSchemeMatch) {
        saveWorkspaceViewScheme(
          Number(saveSchemeMatch[1]) as WorkspaceViewSlot
        )
        return
      }
      const applySchemeMatch = /^view:apply-scheme-([1-5])$/.exec(command)
      if (applySchemeMatch) {
        applyWorkspaceViewScheme(
          Number(applySchemeMatch[1]) as WorkspaceViewSlot
        )
        return
      }
      switch (command) {
        case 'app:settings':
          setSettingsModalOpen(true)
          break
        case 'project:new':
          setNewProjectModalOpen(true)
          break
        case 'project:open':
          void handleOpenProject()
          break
        case 'file:save':
          void saveActiveFile()
          break
        case 'file:close-editor':
          closeActiveEditor()
          break
        case 'file:run-cpp':
          void runActiveCppFile()
          break
        case 'file:run-python':
          void runActivePythonFile()
          break
        case 'debug:start':
          void startDebugCurrentFile()
          break
        case 'debug:continue':
          void controlDebugger('continue')
          break
        case 'debug:pause':
          void controlDebugger('pause')
          break
        case 'debug:step-over':
          void controlDebugger('step-over')
          break
        case 'debug:step-in':
          void controlDebugger('step-in')
          break
        case 'debug:step-out':
          void controlDebugger('step-out')
          break
        case 'debug:toggle-breakpoint': {
          const line = editorRef.current?.getPosition()?.lineNumber
          if (line) {
            toggleDebugBreakpoint(line)
          }
          break
        }
        case 'debug:stop':
          void controlDebugger('stop')
          break
        case 'command-palette:open':
          setCommandPaletteMode('commands')
          setCommandPaletteOpen(true)
          break
        case 'command-palette:files':
          setCommandPaletteMode('files')
          setCommandPaletteOpen(true)
          break
        case 'view:changes':
          toggleInspectorTab('changes')
          break
        case 'view:toggle-sidebar':
          toggleSidebar()
          break
        case 'view:toggle-inspector':
          toggleInspector()
          break
        case 'view:dock-inspector-right':
          dockInspector('right')
          break
        case 'view:dock-inspector-bottom':
          dockInspector('bottom')
          break
        case 'view:toggle-terminal':
          toggleTerminal()
          break
        case 'view:toggle-bottom-panel':
          toggleBottomPanelVisibility()
          break
        case 'view:toggle-activity-bar':
          toggleActivityBar()
          break
        case 'view:reset-layout':
          resetWorkspaceLayout()
          break
        case 'view:explorer':
          activateExplorerView()
          break
        case 'view:search':
          openSidebarSearch()
          break
        case 'view:run':
          if (!project) {
            setNotice('请先打开项目。')
            break
          }
          setWorkspaceLayout((current) => ({
            ...current,
            inspectorVisible: true
          }))
          setTerminalOpened(true)
          setActiveTab('terminal')
          if (runCommand.trim()) {
            setTerminalRunRequest((request) => request + 1)
          }
          break
        case 'view:source-control':
          setWorkspaceView('code')
          setActiveTab('changes')
          setWorkspaceLayout((current) => ({
            ...current,
            inspectorVisible: true
          }))
          break
        case 'view:problems':
          if (!project) {
            setNotice('请先打开项目。')
            break
          }
          setDiagnosticsOpened(true)
          setDiagnosticsRefreshToken((token) => token + 1)
          toggleInspectorTab('diagnostics')
          break
        case 'view:error-list':
          toggleBottomPanel('errors')
          break
        case 'view:diagnostic-tools':
          toggleBottomPanel('diagnostics')
          break
        case 'view:output':
          toggleBottomPanel('output')
          break
        case 'view:debug-console':
          toggleBottomPanel('console')
          break
        case 'view:call-stack':
          toggleBottomPanel('stack')
          break
        case 'view:memory':
          toggleBottomPanel('memory')
          break
        case 'view:toggle-word-wrap':
          setWordWrap((current) => !current)
          break
        case 'view:agent':
          if (!project) {
            setNotice('请先打开项目，再启动 Agent。')
            break
          }
          setAgentOpened(true)
          setWorkspaceView('agent')
          break
        case 'diagnostics:run':
          if (!project) {
            setNotice('请先打开项目。')
            break
          }
          setDiagnosticsOpened(true)
          setActiveTab('diagnostics')
          setDiagnosticsRefreshToken((token) => token + 1)
          break
        case 'terminal:open':
          if (!project) {
            setNotice('请先打开项目。')
            break
          }
          setTerminalOpened(true)
          setActiveTab('terminal')
          break
        case 'terminal:run':
          if (!project) {
            setNotice('请先打开项目。')
            break
          }
          setTerminalOpened(true)
          setActiveTab('terminal')
          if (runCommand.trim()) {
            setTerminalRunRequest((request) => request + 1)
          } else {
            setNotice('请先在终端中配置项目运行命令。')
          }
          break
        case 'workflow:open':
          if (!project) {
            setNotice('请先打开项目，再配置工作流。')
            break
          }
          setWorkflowModalOpen(true)
          break
        case 'agent:open':
          if (!project) {
            setNotice('请先打开项目，再启动 Agent。')
            break
          }
          setAgentOpened(true)
          setWorkspaceView('agent')
          break
        case 'editor:goto-line':
          editorRef.current?.getAction('editor.action.gotoLine')?.run()
          break
        case 'editor:next':
        case 'editor:previous':
          setActivePath((currentPath) => {
            if (openFiles.length < 2) {
              return currentPath
            }
            const currentIndex = Math.max(
              0,
              openFiles.findIndex((file) => file.path === currentPath)
            )
            const offset = command === 'editor:next' ? 1 : -1
            const nextIndex =
              (currentIndex + offset + openFiles.length) % openFiles.length
            return openFiles[nextIndex]?.path ?? currentPath
          })
          break
        case 'updates:check':
          void handleCheckForUpdates()
          break
        case 'help:about':
          setNotice(
            `AI IDE ${appInfo?.version ?? '0.1.2'} · DeepSeek Agent · Electron ${appInfo?.electronVersion ?? ''}`
          )
          break
      }
    },
    [
      appInfo,
      activateExplorerView,
      applyWorkspaceViewScheme,
      closeActiveEditor,
      controlDebugger,
      dockInspector,
      handleCheckForUpdates,
      handleOpenProject,
      openFiles,
      project,
      runCommand,
      runActiveCppFile,
      runActivePythonFile,
      saveWorkspaceViewScheme,
      saveActiveFile,
      startDebugCurrentFile,
      toggleDebugBreakpoint,
      openSidebarSearch,
      resetWorkspaceLayout,
      toggleActivityBar,
      toggleBottomPanel,
      toggleBottomPanelVisibility,
      toggleInspector,
      toggleInspectorTab,
      toggleSidebar,
      toggleTerminal
    ]
  )

  useEffect(() => {
    if (!window.desktop) {
      return
    }
    return window.desktop.onAppMenuCommand(handleAppMenuCommand)
  }, [handleAppMenuCommand])

  const bottomToolLabels = Object.fromEntries(
    BOTTOM_TOOL_TABS.map((tab) => [tab, bottomTabLabel(tab)])
  ) as Record<string, string>
  const toolLabels = {
    ...bottomToolLabels,
    changes: '变更',
    problems: '问题',
    terminal: '终端',
    sidebar: '资源管理器'
  }
  const bottomToolContentProps = {
    outputEntries,
    consoleEntries,
    debugCommand,
    projectName: project?.name ?? '当前项目',
    activeFilePath: activeFile?.path ?? null,
    errorListItems,
    projectDiagnosticsRunning,
    projectDiagnosticsError,
    diagnosticSamples,
    diagnosticEvents: debugEvents,
    memoryMetrics,
    debuggerSnapshot,
    onClearOutput: () => setOutputEntries([]),
    onClearConsole: () => setConsoleEntries([]),
    onDebugCommandChange: setDebugCommand,
    onRunDebugConsoleCommand: () => void runDebugConsoleCommand(),
    onRunDiagnostics: () => void runErrorListDiagnostics(),
    onOpenDiagnostic: (diagnostic: ProjectDiagnostic) =>
      void openDiagnostic(diagnostic),
    onAskAgent: askAgentToFixDiagnostics,
    onControlDebugger: (action: Parameters<typeof controlDebugger>[0]) =>
      void controlDebugger(action),
    onStartDebug: () => void startDebugCurrentFile(),
    onOpenDebugFrame: (frame: DebugStackFrame) => openDebugFrame(frame)
  }
  const renderInspectorToolContent = (
    tab: WorkspaceTab,
    visible = true
  ): React.ReactNode => {
    if (tab === 'changes') {
      return (
        <SourceControlContent
          project={project}
          gitStatus={gitStatus}
          gitDiff={gitDiff}
          gitBusy={gitBusy}
          gitIgnoreBusy={gitIgnoreBusy}
          commitMessage={commitMessage}
          stagedCount={stagedCount}
          allChangesStaged={allChangesStaged}
          onRepairGitignore={() => void repairGitignore()}
          onRefreshGitStatus={() => void refreshGitStatus()}
          onOpenGitDiff={(change) => void openGitDiff(change)}
          onSetChangeStaged={(change, staged) =>
            void setChangeStaged(change, staged)
          }
          onCommitMessageChange={setCommitMessage}
          onSetAllChangesStaged={(staged) =>
            void setAllChangesStaged(staged)
          }
          onCreateCommit={() => void createCommit()}
        />
      )
    }

    if (tab === 'terminal') {
      return project && terminalOpened ? (
        <div className="terminal-container">
          <TerminalPanel
            key={project.path}
            project={project}
            visible={visible}
            runCommand={runCommand}
            runRequest={terminalRunRequest}
            externalRunRequest={externalRunRequest}
            onRunCommandChange={setRunCommand}
            onSaveRunCommand={saveProjectRunCommand}
          />
        </div>
      ) : (
        <div className="terminal-preview">
          <div className="terminal-bar">
            <span>终端</span>
            <span className="terminal-status">等待项目</span>
          </div>
          <div className="terminal-body">
            <span className="terminal-prompt">PS</span>
            <span className="terminal-cursor">▌</span>
          </div>
          <p className="terminal-hint">打开项目后即可启动项目终端。</p>
        </div>
      )
    }

    if (project && diagnosticsOpened) {
      return (
        <div className="problems-container">
          <ProblemsPanel
            key={project.path}
            visible={visible}
            refreshToken={diagnosticsRefreshToken}
            externalDiagnostics={[
              ...liveCompilerDiagnostics,
              ...compilerDiagnostics
            ]}
            onCountChange={setDiagnosticsCount}
            onOpenDiagnostic={(diagnostic) =>
              void openDiagnostic(diagnostic)
            }
            onAskAgent={askAgentToFixDiagnostics}
          />
        </div>
      )
    }

    return null
  }
  const renderSidebarContent = (): React.ReactNode => (
    <SidebarPanel
      project={project}
      recentProjects={recentProjects}
      mode={sidebarMode}
      activePath={activePath}
      selectedEntry={selectedExplorerEntry}
      searchQuery={searchQuery}
      searchBusy={searchBusy}
      searchResults={searchResults}
      fileTreeContent={
        fileTree.length ? (
          fileTree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              activePath={activePath}
              selectedPath={selectedExplorerEntry?.path ?? null}
              collapsedPaths={collapsedPaths}
              requireDoubleClick={workspaceView === 'agent'}
              onSelectNode={setSelectedExplorerEntry}
              onToggleDirectory={toggleDirectory}
              onOpenFile={openWorkspaceFile}
              onOpenContextMenu={openExplorerNodeContextMenu}
            />
          ))
        ) : (
          <div className="tree-empty">
            这个项目中没有可显示的文件。
            <span>右键此处新建文件或文件夹。</span>
          </div>
        )
      }
      onOpenRootContextMenu={openRootExplorerContextMenu}
      onNewProject={() => setNewProjectModalOpen(true)}
      onSearchQueryChange={setSearchQuery}
      onRunSearch={() => void runCodeSearch()}
      onOpenSearchResult={(result) => {
        void openFile({
          name: fileNameFromPath(result.path),
          path: result.path,
          type: 'file'
        }).then(() =>
          setEditorPosition({
            path: result.path,
            line: result.line,
            column: 1
          })
        )
      }}
      onClearExplorerSelection={() => setSelectedExplorerEntry(null)}
      onDeleteSelected={(permanent) => {
        if (!selectedExplorerEntry) {
          return
        }
        if (permanent) {
          void permanentlyDeleteWorkspaceEntry(selectedExplorerEntry.path)
        } else {
          void handleTrashWorkspaceEntry(selectedExplorerEntry.path)
        }
      }}
      onRenameSelected={(currentName) => {
        if (!selectedExplorerEntry) {
          return
        }
        const nextName = window.prompt('输入新名称', currentName)?.trim()
        if (nextName && nextName !== currentName) {
          void handleRenameWorkspaceEntry({
            path: selectedExplorerEntry.path,
            name: nextName
          })
        }
      }}
      onOpenSelected={() => {
        if (!selectedExplorerEntry) {
          return
        }
        if (selectedExplorerEntry.type === 'file') {
          openWorkspaceFile(selectedExplorerEntry)
        } else {
          toggleDirectory(selectedExplorerEntry.path)
        }
      }}
      onOpenRecentProject={(path) => void handleOpenRecentProject(path)}
      onBeginDockDrag={(event) =>
        beginToolWindowDockDrag('sidebar', event)
      }
    />
  )
  const renderToolContent = (tab: ToolTab): React.ReactNode => {
    if (isBottomToolTab(tab)) {
      return (
        <BottomPanelContent tab={tab} {...bottomToolContentProps} />
      )
    }
    if (isSidebarToolTab(tab)) {
      return (
        <div className="sidebar sidebar-embedded">
          {renderSidebarContent()}
        </div>
      )
    }
    const inspectorTab = toolTabToInspectorTab(tab)
    return inspectorTab
      ? renderInspectorToolContent(inspectorTab)
      : null
  }

  return (
    <div
      className={`app-shell app-theme-${appearance.theme}`}
      data-theme={appearance.theme}
    >
      <AppMenuBar
        onCommand={handleAppMenuCommand}
        onOpenCommandPalette={() => {
          setCommandPaletteMode('commands')
          setCommandPaletteOpen(true)
        }}
        savedViewSchemes={savedWorkspaceSchemes.map((scheme) => ({
          slot: scheme.slot,
          savedAt: scheme.savedAt
        }))}
        checkedCommands={checkedMenuCommands}
      />
      {updateStatus &&
      ['available', 'downloading', 'downloaded'].includes(
        updateStatus.state
      ) ? (
        <section className="update-banner" aria-live="polite">
          <div>
            <strong>
              {updateStatus.state === 'downloaded'
                ? '更新已准备完成'
                : `发现 AI IDE ${updateStatus.availableVersion}`}
            </strong>
            <span>{updateStatus.message}</span>
          </div>
          {updateStatus.state === 'available' ? (
            <button type="button" onClick={() => void handleDownloadUpdate()}>
              下载更新
            </button>
          ) : null}
          {updateStatus.state === 'downloaded' ? (
            <button type="button" onClick={() => void handleInstallUpdate()}>
              重启并安装
            </button>
          ) : null}
        </section>
      ) : null}

      <div
        ref={workspaceRef}
        className="workspace"
        style={
          {
            '--sidebar-width': `${workspaceLayout.sidebarWidth}px`,
            '--inspector-width': `${workspaceLayout.inspectorWidth}px`,
            '--inspector-height': `${workspaceLayout.inspectorHeight}px`
          } as CSSProperties
        }
      >
        <nav
          className="activity-bar"
          aria-label="主要视图"
          hidden={!workspaceLayout.activityBarVisible}
        >
          <button
            className={`activity-button ${
              workspaceView === 'code' &&
              ((visibleToolTabs.has('sidebar') &&
                sidebarMode === 'explorer') ||
                (workspaceLayout.sidebarVisible &&
                  sidebarMode === 'explorer'))
                ? 'active'
                : ''
            }`}
            type="button"
            aria-label="项目和代码"
            data-tooltip="资源管理器 (Ctrl+Shift+E)"
            onClick={activateExplorerView}
          >
            <ExplorerIcon />
          </button>
          <button
            className={`activity-button ${workspaceView === 'agent' ? 'active' : ''}`}
            type="button"
            aria-label="Agent 任务"
            data-tooltip="Agent (Ctrl+Alt+I)"
            onClick={() => {
              if (!project) {
                setNotice('请先打开项目，再启动 Agent。')
                return
              }
              setAgentOpened(true)
              setWorkspaceView('agent')
              setWorkspaceLayout((current) => ({
                ...current,
                sidebarVisible: true
              }))
            }}
          >
            <AgentIcon />
          </button>
          <button
            className={`activity-button ${
              workspaceView === 'code' &&
              ((visibleToolTabs.has('sidebar') &&
                sidebarMode === 'search') ||
                (workspaceLayout.sidebarVisible &&
                  sidebarMode === 'search'))
                ? 'active'
                : ''
            }`}
            type="button"
            aria-label="搜索"
            data-tooltip="搜索代码 (Ctrl+Shift+F)"
            onClick={openSidebarSearch}
          >
            <SearchIcon />
          </button>
          <button
            className={`activity-button ${
              workspaceView === 'code' &&
              workspaceLayout.inspectorVisible &&
              toolWindowLayout.activeRight === 'changes'
                ? 'active'
                : ''
            }`}
            type="button"
            aria-label="源代码管理"
            data-tooltip="源代码管理 (Ctrl+Shift+G)"
            onClick={() => {
              setWorkspaceView('code')
              if (
                workspaceLayout.inspectorVisible &&
                toolWindowLayout.activeRight === 'changes'
              ) {
                toggleInspector()
                return
              }
              setToolWindowLayout((current) =>
                openToolTab(current, 'changes')
              )
              setWorkspaceLayout((current) => ({
                ...current,
                inspectorVisible: true
              }))
            }}
          >
            <SourceControlIcon />
          </button>
          <button
            className={`activity-button ${
              bottomPanelTab === 'stack' ||
              bottomPanelTab === 'console' ||
              bottomPanelTab === 'diagnostics'
                ? 'active'
                : ''
            }`}
            type="button"
            aria-label="运行和调试"
            data-tooltip="运行和调试 (Ctrl+Shift+D)"
            onClick={() => {
              setWorkspaceView('code')
              if (
                bottomPanelTab === 'stack' ||
                bottomPanelTab === 'console' ||
                bottomPanelTab === 'diagnostics'
              ) {
                setBottomPanelTab(null)
              } else {
                setBottomPanelTab('stack')
              }
            }}
          >
            <RunDebugIcon />
          </button>
          <div className="activity-spacer" />
          <button
            className={`activity-button ${settingsModalOpen ? 'active' : ''}`}
            type="button"
            aria-label="设置"
            data-tooltip="设置 (Ctrl+,)"
            onClick={() => setSettingsModalOpen(true)}
          >
            <SettingsIcon />
          </button>
          <button
            className={`activity-button ${workspaceLayout.inspectorVisible ? 'active' : ''}`}
            type="button"
            aria-label="切换右侧栏"
            title="切换右侧栏"
            data-tooltip="切换右侧栏 (Ctrl+Alt+B)"
            onClick={toggleInspector}
          >
            <InspectorIcon />
          </button>
        </nav>

        {workspaceLayout.sidebarVisible ? (
          <SideToolDock
            side="left"
            tabs={toolWindowLayout.left}
            activeTab={toolWindowLayout.activeLeft}
            labels={toolLabels}
            errorCount={errorListErrorCount}
            renderContent={renderToolContent}
            onBeginTabDrag={beginToolTabReorderDrag}
            onBeginGroupDrag={beginToolWindowDockDrag}
            onActivateTab={(tab) => {
              if (draggedBottomTabRef.current === tab) {
                draggedBottomTabRef.current = null
                return
              }
              setToolWindowLayout((current) =>
                activateToolTab(current, 'left', tab)
              )
            }}
            onCloseTab={(tab) =>
              setToolWindowLayout((current) =>
                removeToolTab(current, tab)
              )
            }
          />
        ) : null}

        <div
          className="panel-resizer sidebar-resizer"
          role="separator"
          aria-label="调整侧边栏宽度"
          hidden={
            !workspaceLayout.sidebarVisible ||
            toolWindowLayout.left.length === 0
          }
          onPointerDown={(event) => beginPanelResize('sidebar', event)}
        />

        <div
          ref={workbenchSurfaceRef}
          className={`workbench-surface dock-${workspaceLayout.inspectorDock}`}
        >
        <main className={project ? 'main-stage editor-mode' : 'main-stage'}>
          <div className="main-editor-area">
          {project ? (
            <>
              <div className="code-workspace-view" hidden={workspaceView !== 'code'}>
                {gitDiff ? (
              <section className="editor-workspace diff-workspace">
                <div className="diff-toolbar">
                  <div className="diff-title">
                    <button
                      className="diff-close"
                      type="button"
                      aria-label="关闭差异视图"
                      onClick={() => setGitDiff(null)}
                    >
                      ×
                    </button>
                    <span className="diff-badge">差异</span>
                    <span className="diff-path" title={gitDiff.path}>
                      {gitDiff.path}
                    </span>
                    {gitDiff.originalPath ? (
                      <span className="diff-renamed-from">← {gitDiff.originalPath}</span>
                    ) : null}
                  </div>
                  <span className="diff-source">HEAD ↔ 工作区</span>
                </div>
                <div className="editor-breadcrumb">
                  <span>{project.name}</span>
                  {gitDiff.path.split(/[\\/]/).map((part, index, segments) => (
                    <span
                      className={index === segments.length - 1 ? 'current' : ''}
                      key={`${part}-${index}`}
                    >
                      <span className="crumb-separator">›</span>
                      {part}
                    </span>
                  ))}
                </div>
                <div className="monaco-shell">
                  {gitDiff.isBinary ? (
                    <div className="binary-diff">
                      <strong>二进制文件发生变化</strong>
                      <p>当前版本暂不支持预览二进制文件的差异。</p>
                    </div>
                  ) : (
                    <DiffEditor
                      original={gitDiff.originalContent}
                      modified={gitDiff.modifiedContent}
                      language={languageFromPath(gitDiff.path)}
                      theme={monacoThemeFor(editorTheme)}
                      beforeMount={(monacoInstance) => {
                        monacoRef.current = monacoInstance
                        configureMonacoTheme(monacoInstance)
                      }}
                      loading={<div className="editor-loading">正在加载差异…</div>}
                      options={{
                        automaticLayout: true,
                        readOnly: true,
                        originalEditable: false,
                        renderSideBySide: true,
                        fontFamily: '"Cascadia Code", Consolas, monospace',
                        fontSize: appearance.editorFontSize,
                        lineHeight: 22,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        renderOverviewRuler: false,
                        ignoreTrimWhitespace: false,
                        fixedOverflowWidgets: true,
                        hover: { above: false },
                        diffWordWrap: wordWrap ? 'on' : 'off'
                      }}
                    />
                  )}
                </div>
              </section>
            ) : activeFile ? (
              <section className="editor-workspace">
                <div className="editor-toolbar">
                  <div className="editor-tabs" role="tablist" aria-label="打开的文件">
                    {openFiles.map((file) => (
                      <button
                        className={`editor-tab ${file.path === activePath ? 'active' : ''}`}
                        key={file.path}
                        type="button"
                        role="tab"
                        aria-selected={file.path === activePath}
                        title={file.path}
                        onClick={() => setActivePath(file.path)}
                      >
                        <span className="tab-file-badge">{fileBadge(file.path)}</span>
                        <span className="tab-file-name">{file.name}</span>
                        {file.dirty ? <span className="dirty-dot" /> : null}
                        <span
                          className="tab-close"
                          role="button"
                          tabIndex={0}
                          aria-label={`关闭 ${file.name}`}
                          onClick={(event) => closeFile(file.path, event)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              closeFile(file.path, event)
                            }
                          }}
                        >
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                  {isCppSourcePath(activeFile.path) ? (
                    <>
                      <button
                        className="debug-file-button"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (debuggerSnapshot.state === 'starting') {
                            void controlDebugger('stop')
                          } else {
                            void startDebugCurrentFile()
                          }
                        }}
                      >
                        {debuggerSnapshot.state === 'starting'
                          ? '取消调试'
                          : '调试'}
                        {debuggerSnapshot.state !== 'starting' ? (
                          <kbd>F5</kbd>
                        ) : null}
                      </button>
                      <button
                        className="run-file-button"
                        type="button"
                        disabled={busy}
                        onClick={() => void runActiveCppFile()}
                      >
                        运行
                        <kbd>Ctrl F5</kbd>
                      </button>
                    </>
                  ) : null}
                  {isPythonSourcePath(activeFile.path) ? (
                    <button
                      className="run-file-button python-run-button"
                      type="button"
                      disabled={busy}
                      onClick={() => void runActivePythonFile()}
                    >
                      运行
                      <kbd>Shift F10</kbd>
                    </button>
                  ) : null}
                  {isMarkdownFile ? (
                    <div
                      className="markdown-view-toggle"
                      role="group"
                      aria-label="Markdown 显示模式"
                    >
                      <button
                        className={markdownPreviewMode ? 'active' : ''}
                        type="button"
                        aria-pressed={markdownPreviewMode}
                        onClick={() => setMarkdownPreviewMode(true)}
                      >
                        预览
                      </button>
                      <button
                        className={!markdownPreviewMode ? 'active' : ''}
                        type="button"
                        aria-pressed={!markdownPreviewMode}
                        onClick={() => setMarkdownPreviewMode(false)}
                      >
                        源码
                      </button>
                    </div>
                  ) : null}
                  <button
                    className="save-button"
                    type="button"
                    disabled={!activeFile.dirty || busy}
                    onClick={() => void saveActiveFile()}
                  >
                    保存
                    <kbd>Ctrl S</kbd>
                  </button>
                </div>
                <div className="editor-breadcrumb">
                  <span>{project.name}</span>
                  {activeFile.path.split(/[\\/]/).map((part, index, segments) => (
                    <span className={index === segments.length - 1 ? 'current' : ''} key={`${part}-${index}`}>
                      <span className="crumb-separator">›</span>
                      {part}
                    </span>
                  ))}
                </div>
                <div
                  className={`monaco-shell ${
                    isMarkdownFile && markdownPreviewMode
                      ? 'markdown-preview-shell'
                      : ''
                  }`}
                >
                  <Editor
                    path={activeFile.path}
                    language={languageFromPath(activeFile.path)}
                    value={activeFile.content}
                    theme={monacoThemeFor(editorTheme)}
                    beforeMount={(monacoInstance) => {
                      monacoRef.current = monacoInstance
                      configureMonacoTheme(monacoInstance)
                    }}
                    onChange={handleEditorChange}
                    onMount={(editor, monaco) => {
                      editorRef.current = editor
                      const syncEditorFocus = (): void => {
                        const model = editor.getModel()
                        const position = editor.getPosition()
                        const path = activePathRef.current
                        const selection = editor.getSelection()
                        if (!model || !position || !path) {
                          setEditorFocus(null)
                          return
                        }
                        setEditorFocus({
                          path,
                          startLine:
                            selection?.startLineNumber ?? position.lineNumber,
                          startColumn:
                            selection?.startColumn ?? position.column,
                          endLine: selection?.endLineNumber ?? position.lineNumber,
                          endColumn: selection?.endColumn ?? position.column,
                          selectedText:
                            selection && !selection.isEmpty()
                              ? model
                                  .getValueInRange(selection)
                                  .slice(0, 8_000)
                              : ''
                        })
                      }
                      const cursorListener =
                        editor.onDidChangeCursorSelection(syncEditorFocus)
                      const positionListener =
                        editor.onDidChangeCursorPosition(syncEditorFocus)
                      const contextMenuListener = editor.onContextMenu((event) => {
                        event.event.preventDefault()
                        event.event.stopPropagation()
                        const model = editor.getModel()
                        const position =
                          event.target.position ?? editor.getPosition()
                        const word =
                          model && position
                            ? model.getWordAtPosition(position)
                            : null
                        const symbol =
                          model && position && word
                            ? parseCppFunctionAt(
                                model.getValue(),
                                position.lineNumber,
                                word.word
                              )
                            : null
                        const requestId = ++editorFunctionLookupIdRef.current
                        setEditorContextMenu({
                          x: event.event.browserEvent.clientX,
                          y: event.event.browserEvent.clientY,
                          functionContext: symbol
                            ? {
                                requestId,
                                symbol,
                                declaration: null,
                                definition: null,
                                loading: true,
                                canGenerate: false
                              }
                            : null
                        })
                        if (symbol && model && position && activePathRef.current) {
                          void resolveEditorFunctionContext(
                            symbol,
                            activePathRef.current,
                            model.getValue(),
                            position.lineNumber,
                            requestId
                          )
                        }
                      })
                      editor.onDidDispose(() => {
                        cursorListener.dispose()
                        positionListener.dispose()
                        contextMenuListener.dispose()
                      })
                      syncEditorFocus()
                      editor.addAction({
                        id: 'ai-ide.agent-completion',
                        label: 'Agent 代码补全',
                        keybindings: [
                          monaco.KeyMod.Alt |
                            monaco.KeyCode.Backslash
                        ],
                        run: () => {
                          if (
                            localStorage.getItem(
                              'ai-ide:agent-completion-enabled'
                            ) === 'off'
                          ) {
                            setNotice(
                              'Agent 代码补全已关闭，请点击状态栏“AI 补全”重新开启。'
                            )
                            return
                          }
                          editor.trigger(
                            'ai-completion',
                            'editor.action.inlineSuggest.trigger',
                            {}
                          )
                        }
                      })
                      editor.addAction({
                        id: 'ai-ide.agent-ask',
                        label: '向 Agent 询问此位置',
                        precondition: 'editorTextFocus',
                        contextMenuGroupId: 'ai-ide-agent',
                        contextMenuOrder: 1,
                        run: () => openAgentForEditorContextRef.current('ask')
                      })
                      editor.addAction({
                        id: 'ai-ide.agent-explain-selection',
                        label: '让 Agent 解释所选代码',
                        precondition: 'editorHasSelection',
                        contextMenuGroupId: 'ai-ide-agent',
                        contextMenuOrder: 2,
                        run: () =>
                          openAgentForEditorContextRef.current('explain')
                      })
                      editor.addAction({
                        id: 'ai-ide.agent-modify-selection',
                        label: '让 Agent 修改所选代码…',
                        precondition: 'editorHasSelection',
                        contextMenuGroupId: 'ai-ide-agent',
                        contextMenuOrder: 3,
                        run: () =>
                          openAgentForEditorContextRef.current('modify')
                      })
                      editor.addAction({
                        id: 'ai-ide.command-palette',
                        label: '打开 AI IDE 命令面板',
                        keybindings: [monaco.KeyCode.F1],
                        run: () => {
                          setCommandPaletteMode('commands')
                          setCommandPaletteOpen(true)
                        }
                      })
                      editor.onMouseDown((event) => {
                        if (
                          event.target.type ===
                            monaco.editor.MouseTargetType
                              .GUTTER_GLYPH_MARGIN &&
                          event.target.position
                        ) {
                          toggleDebugBreakpoint(
                            event.target.position.lineNumber
                          )
                        }
                      })
                      if (editorPosition?.path === activeFile.path) {
                        editor.revealPositionInCenter({
                          lineNumber: editorPosition.line,
                          column: editorPosition.column
                        })
                        editor.setPosition({
                          lineNumber: editorPosition.line,
                          column: editorPosition.column
                        })
                        editor.focus()
                      }
                    }}
                    loading={<div className="editor-loading">正在加载编辑器…</div>}
                    options={{
                      automaticLayout: true,
                      contextmenu: false,
                      fontFamily: '"Cascadia Code", Consolas, monospace',
                      fontSize: appearance.editorFontSize,
                      lineHeight: 22,
                      minimap: {
                        enabled: appearance.showMinimap,
                        scale: 0.75
                      },
                      padding: { top: 14 },
                      scrollBeyondLastLine: false,
                      smoothScrolling: true,
                      inlineSuggest: {
                        enabled: agentCompletionEnabled
                      },
                      wordWrap: wordWrap ? 'on' : 'off',
                      glyphMargin: true,
                      renderLineHighlight: 'all',
                      overviewRulerBorder: false,
                      cursorBlinking: 'smooth',
                      cursorSmoothCaretAnimation: appearance.smoothCaret
                        ? 'on'
                        : 'off',
                      bracketPairColorization: { enabled: true },
                      guides: {
                        bracketPairs: appearance.bracketGuides,
                        indentation: true
                      },
                      fixedOverflowWidgets: true,
                      hover: { above: false }
                    }}
                  />
                  {isMarkdownFile && markdownPreviewMode ? (
                    <div className="markdown-editor-preview">
                      <MarkdownContent
                        text={activeFile.content}
                        headingOffset={0}
                        className="markdown-document"
                      />
                    </div>
                  ) : null}
                </div>
              </section>
            ) : (
              <section className="project-empty-editor">
                <div className="project-emblem">{project.name.slice(0, 1).toUpperCase()}</div>
                <span className="welcome-kicker">
                  <span className="kicker-line" />
                  PROJECT READY
                </span>
                <h1>{project.name}</h1>
                <p>{project.path}</p>
                <div className="project-facts">
                  <div>
                    <span>文件树</span>
                    <strong>{fileTree.length} 个根节点</strong>
                  </div>
                  <div>
                    <span>编辑模式</span>
                    <strong>本地文本</strong>
                  </div>
                  <div>
                    <span>工作流</span>
                    <strong>等待任务</strong>
                  </div>
                </div>
                <div className="project-empty-hint">
                  从左侧资源管理器选择一个文件，或打开命令面板开始工作。
                </div>
              </section>
                )}
              </div>

              {agentOpened ? (
                <div
                  className={`agent-workspace-view agent-theme-${agentTheme}`}
                  data-agent-theme={agentTheme}
                  hidden={workspaceView !== 'agent'}
                >
                  <AgentWorkspace
                    key={project.path}
                    project={project}
                    visible={workspaceView === 'agent'}
                    editorTheme={monacoThemeFor(editorTheme)}
                    hasUnsavedFiles={hasUnsavedFiles}
                    workspaceFocus={agentWorkspaceFocus}
                    openFilePaths={agentOpenFilePaths}
                    changedFilePaths={agentChangedFilePaths}
                    diagnosticFilePaths={agentDiagnosticFilePaths}
                    gitChanges={gitStatus.changes}
                    onRunFinished={handleAgentRunFinished}
                    onOpenFile={openAgentRelatedPath}
                    externalPrompt={agentPromptRequest}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <section className="welcome">
              <div className="welcome-kicker">
                <span className="kicker-line" />
                AI-NATIVE WORKSPACE
              </div>
              <h1>
                从一个项目开始，
                <br />
                让 Agent 完成剩下的工作。
              </h1>
              <p className="welcome-description">
                把需求、代码变更、命令和验证结果放在同一条工作流里。你负责目标和判断，
                Agent 负责检索、修改与执行。
              </p>

              <div className="quick-actions">
                <button
                  className="quick-action"
                  type="button"
                  onClick={() => setNewProjectModalOpen(true)}
                >
                  <span className="action-index">01</span>
                  <span className="action-title">新建项目</span>
                  <span className="action-description">创建本地目录并立即打开</span>
                  <span className="action-arrow">↗</span>
                </button>
                <button
                  className="quick-action"
                  type="button"
                  onClick={handleOpenProject}
                >
                  <span className="action-index">02</span>
                  <span className="action-title">打开项目</span>
                  <span className="action-description">连接已有本地目录</span>
                  <span className="action-arrow">↗</span>
                </button>
                <button
                  className="quick-action"
                  type="button"
                  onClick={() => setNotice('请先打开项目，再启动 Agent。')}
                >
                  <span className="action-index">03</span>
                  <span className="action-title">调用 Agent</span>
                  <span className="action-description">读取项目、修改代码并运行验证</span>
                  <span className="action-arrow">↗</span>
                </button>
              </div>

              <div className="prompt-panel">
                <div className="prompt-heading">
                  <span>描述你想完成的工作</span>
                  <span className="agent-offline">
                    <span className="offline-dot" />
                    Agent 未连接
                  </span>
                </div>
                <div className="prompt-placeholder">
                  例如：分析这个项目的结构，并告诉我应该从哪一部分开始……
                </div>
                <div className="prompt-footer">
                  <div className="prompt-context">
                    <span className="context-chip">@ 添加上下文</span>
                    <span className="context-chip">/ 选择任务</span>
                  </div>
                  <button
                    className="send-button"
                    type="button"
                    onClick={() => setNotice('请先打开项目并接入 Agent 运行时。')}
                  >
                    发送
                    <span>↗</span>
                  </button>
                </div>
              </div>
            </section>
          )}
          </div>

          <ToolDockWorkspace
            layout={toolWindowLayout}
            height={workspaceLayout.bottomPanelHeight}
            renderContent={renderToolContent}
            errorCount={errorListErrorCount}
            labels={toolLabels}
            onBeginResize={beginBottomPanelResize}
            onBeginPaneResize={beginToolPaneResize}
            onTearOffTab={beginToolTabReorderDrag}
            onBeginGroupDrag={(_, tab, event) =>
              beginToolWindowDockDrag(tab, event)
            }
            onSplitTab={(paneId, tab) =>
              setToolWindowLayout((current) =>
                splitDockedToolTab(current, paneId, tab)
              )
            }
            onActivateTab={(paneId, tab) => {
              if (draggedBottomTabRef.current === tab) {
                draggedBottomTabRef.current = null
                return
              }
              setToolWindowLayout((current) =>
                activateToolTab(current, paneId, tab)
              )
            }}
            onClosePane={(paneId) => {
              setToolWindowLayout((current) =>
                closeDockedToolPane(current, paneId)
              )
            }}
            onDockSidebar={() => dockSidebarBack()}
          />

          {toolWindowLayout.floating.map((window) => (
            <FloatingToolWindow
              window={window}
              key={window.id}
              renderContent={renderToolContent}
              labels={toolLabels}
              onBeginDrag={beginFloatingToolWindowDrag}
              onBeginTabDrag={beginToolTabReorderDrag}
              onDock={(windowId) =>
                setToolWindowLayout((current) =>
                  dockFloatingToolWindow(current, windowId, 'center')
                )
              }
              onActivateTab={(windowId, tab) =>
                setToolWindowLayout((current) =>
                  activateToolTab(current, windowId, tab)
                )
              }
              onClose={(windowId) => {
                setToolWindowLayout((current) =>
                  closeFloatingToolWindow(current, windowId)
                )
              }}
              onDockSidebar={
                window.activeTab === 'sidebar'
                  ? () => dockSidebarBack()
                  : undefined
              }
              onDockRight={
                isInspectorToolTab(window.activeTab)
                  ? (windowId) => {
                      const floating = toolWindowLayout.floating.find(
                        (candidate) => candidate.id === windowId
                      )
                      if (!floating) {
                        return
                      }
                      const inspectorTab = toolTabToInspectorTab(
                        floating.activeTab
                      )
                      setToolWindowLayout((current) =>
                        dockToolTab(
                          current,
                          floating.activeTab,
                          'right'
                        )
                      )
                      if (inspectorTab) {
                        setActiveTab(inspectorTab)
                        setWorkspaceLayout((current) => ({
                          ...current,
                          inspectorVisible: true,
                          inspectorDock: 'right'
                        }))
                        if (inspectorTab === 'terminal' && project) {
                          setTerminalOpened(true)
                        }
                        if (
                          inspectorTab === 'diagnostics' &&
                          project
                        ) {
                          setDiagnosticsOpened(true)
                        }
                      }
                    }
                  : undefined
              }
            />
          ))}
        </main>

        {toolDropPreview ? (
          <div
            className="tool-window-drop-overlay"
            role="presentation"
            aria-hidden="true"
          >
            <div
              className={`tool-window-drop-zone ${
                toolDropPreview.position === 'left' ? 'active' : ''
              }`}
            >
              <strong>拼接在左侧</strong>
              <span>成为独立工具窗口</span>
            </div>
            <div
              className={`tool-window-drop-zone ${
                toolDropPreview.position === 'center' ? 'active' : ''
              }`}
            >
              <strong>合并为标签</strong>
              <span>放回同一工具窗口</span>
            </div>
            <div
              className={`tool-window-drop-zone ${
                toolDropPreview.position === 'right' ? 'active' : ''
              }`}
            >
              <strong>拼接在右侧</strong>
              <span>成为独立工具窗口</span>
            </div>
          </div>
        ) : null}

        <div
          className="panel-resizer inspector-resizer"
          role="separator"
          aria-label="调整右边栏宽度"
          hidden={
            !workspaceLayout.inspectorVisible ||
            toolWindowLayout.right.length === 0
          }
          onPointerDown={beginInspectorResize}
        />

        {workspaceLayout.inspectorVisible ? (
          <SideToolDock
            side="right"
            tabs={toolWindowLayout.right}
            activeTab={toolWindowLayout.activeRight}
            labels={toolLabels}
            errorCount={errorListErrorCount}
            renderContent={renderToolContent}
            onBeginTabDrag={beginToolTabReorderDrag}
            onBeginGroupDrag={beginToolWindowDockDrag}
            onActivateTab={(tab) => {
              if (draggedBottomTabRef.current === tab) {
                draggedBottomTabRef.current = null
                return
              }
              setToolWindowLayout((current) =>
                activateToolTab(current, 'right', tab)
              )
            }}
            onCloseTab={(tab) =>
              setToolWindowLayout((current) =>
                removeToolTab(current, tab)
              )
            }
          />
        ) : null}

        {inspectorDropPreview ? (
          <div
            className="inspector-dock-overlay"
            role="presentation"
            aria-hidden="true"
          >
            <div
              className={`inspector-dock-zone dock-left-zone ${
                inspectorDropPreview === 'left' ? 'active' : ''
              }`}
            >
              <strong>加入左侧标签组</strong>
              <span>与左侧工具窗口组成标签</span>
            </div>
            <div
              className={`inspector-dock-zone dock-right-zone ${
                inspectorDropPreview === 'right' ? 'active' : ''
              }`}
            >
              <strong>停靠到右侧</strong>
              <span>回到右侧标签组</span>
            </div>
            <div
              className={`inspector-dock-zone dock-bottom-zone ${
                inspectorDropPreview === 'bottom' ? 'active' : ''
              }`}
            >
              <strong>加入底部标签组</strong>
              <span>与其他底部窗口放在一起</span>
            </div>
            <div
              className={`inspector-dock-zone dock-float-zone ${
                inspectorDropPreview === 'float' ? 'active' : ''
              }`}
            >
              <strong>单独浮动</strong>
              <span>作为独立窗口移动到任意位置</span>
            </div>
          </div>
        ) : null}

        </div>
      </div>

      <footer className="statusbar">
        <div className="status-left">
          <span className="status-item status-ready">
            <span className="status-dot" />
            {busy ? '处理中' : '就绪'}
          </span>
          <span className="status-separator" />
          <span className="status-note">{notice}</span>
        </div>
        <div className="status-right">
          {gitStatus.isRepository ? (
            <span>{gitStatus.branch ?? 'detached'}</span>
          ) : null}
          {activeFile ? (
            <>
              <span>{languageFromPath(activeFile.path)}</span>
              <span>{activeFile.dirty ? '未保存' : '已保存'}</span>
            </>
          ) : null}
          {updateStatus ? (
            <button
              className={`update-status update-${updateStatus.state}`}
              type="button"
              title={updateStatus.message}
              disabled={
                updateStatus.state === 'checking' ||
                updateStatus.state === 'downloading' ||
                updateStatus.state === 'disabled'
              }
              onClick={() => {
                if (updateStatus.state === 'available') {
                  void handleDownloadUpdate()
                } else if (updateStatus.state === 'downloaded') {
                  void handleInstallUpdate()
                } else {
                  void handleCheckForUpdates()
                }
              }}
            >
              {updateStatus.state === 'available'
                ? `可更新 v${updateStatus.availableVersion}`
                : updateStatus.state === 'downloading'
                  ? `更新 ${Math.round(updateStatus.progress?.percent ?? 0)}%`
                  : updateStatus.state === 'downloaded'
                    ? '重启安装'
                    : updateStatus.state === 'checking'
                      ? '检查更新中'
                      : updateStatus.state === 'not-available'
                        ? `v${updateStatus.currentVersion} 已是最新`
                        : updateStatus.state === 'error'
                          ? '更新检查失败'
                          : '开发版'}
            </button>
          ) : null}
          <span className="status-panel-buttons">
            <button
              className={bottomPanelTab === 'output' ? 'active' : ''}
              type="button"
              onClick={() => toggleBottomPanel('output')}
            >
              输出
            </button>
            <button
              className={bottomPanelTab === 'console' ? 'active' : ''}
              type="button"
              onClick={() => toggleBottomPanel('console')}
            >
              控制台
            </button>
            <button
              className={bottomPanelTab === 'errors' ? 'active' : ''}
              type="button"
              onClick={() => toggleBottomPanel('errors')}
            >
              错误
            </button>
            <button
              className={bottomPanelTab === 'diagnostics' ? 'active' : ''}
              type="button"
              onClick={() => toggleBottomPanel('diagnostics')}
            >
              诊断
            </button>
            <button
              className={bottomPanelTab === 'stack' ? 'active' : ''}
              type="button"
              onClick={() => toggleBottomPanel('stack')}
            >
              堆栈
            </button>
            <button
              className={bottomPanelTab === 'memory' ? 'active' : ''}
              type="button"
              onClick={() => toggleBottomPanel('memory')}
            >
              内存
            </button>
            <button
              className={agentCompletionEnabled ? 'active' : ''}
              type="button"
              title="开启或关闭 Agent 内联代码补全 (Alt+\\)；启用后会把光标附近代码片段发送给 DeepSeek"
              onClick={() => {
                setAgentCompletionEnabled((enabled) => {
                  const next = !enabled
                  localStorage.setItem(
                    'ai-ide:agent-completion-enabled',
                    next ? 'on' : 'off'
                  )
                  setNotice(
                    next
                      ? 'Agent 代码补全已开启；在编辑器中按 Alt+\\ 可主动触发。'
                      : 'Agent 代码补全已关闭。'
                  )
                  return next
                })
              }}
            >
              AI 补全
            </button>
          </span>
          <span className="status-view-actions">
            <label className="status-view-picker">
              <span>视图</span>
              <select
                value={selectedViewSlot}
                aria-label="选择视图方案"
                onChange={(event) =>
                  setSelectedViewSlot(
                    Number(event.target.value) as WorkspaceViewSlot
                  )
                }
              >
                {workspaceViewSlots.map((slot) => {
                  const isSaved = savedWorkspaceSchemes.some(
                    (scheme) => scheme.slot === slot
                  )
                  return (
                    <option value={slot} key={slot}>
                      方案 {slot}
                      {isSaved ? ' · 已保存' : ''}
                    </option>
                  )
                })}
              </select>
            </label>
            <button
              type="button"
              title={`保存当前面板、尺寸和显示状态到方案 ${selectedViewSlot}`}
              onClick={saveSelectedWorkspaceView}
            >
              保存
            </button>
            <button
              type="button"
              title={`应用视图方案 ${selectedViewSlot}`}
              onClick={applySelectedWorkspaceView}
            >
              应用视图
            </button>
          </span>
          <span>{appInfo ? `Electron ${appInfo.electronVersion}` : '桌面环境'}</span>
          <span>UTF-8</span>
          <span>{appInfo?.platform === 'win32' ? 'Windows' : appInfo?.platform ?? '桌面'}</span>
        </div>
      </footer>

      {tabDragGhost ? (
        <div
          className="tab-drag-ghost"
          style={{
            width: `${tabDragGhost.width}px`,
            transform: `translate3d(${tabDragGhost.x - tabDragGhost.width / 2}px, ${tabDragGhost.y - 18}px, 0)`
          }}
          aria-hidden="true"
        >
          {tabDragGhost.label}
        </div>
      ) : null}

      {editorContextMenu ? (
        <EditorContextMenu
          x={editorContextMenu.x}
          y={editorContextMenu.y}
          onClose={() => setEditorContextMenu(null)}
          onChangeAll={() =>
            editorRef.current?.trigger(
              'ai-ide-context-menu',
              'editor.action.changeAll',
              null
            )
          }
          onCut={() =>
            editorRef.current?.trigger(
              'ai-ide-context-menu',
              'editor.action.clipboardCutAction',
              null
            )
          }
          onCopy={() =>
            editorRef.current?.trigger(
              'ai-ide-context-menu',
              'editor.action.clipboardCopyAction',
              null
            )
          }
          onPaste={() =>
            editorRef.current?.trigger(
              'ai-ide-context-menu',
              'editor.action.clipboardPasteAction',
              null
            )
          }
          functionInfo={
            editorContextMenu.functionContext
              ? {
                  name: editorContextMenu.functionContext.symbol.name,
                  loading: editorContextMenu.functionContext.loading,
                  hasDeclaration: Boolean(
                    editorContextMenu.functionContext.declaration
                  ),
                  hasDefinition: Boolean(
                    editorContextMenu.functionContext.definition
                  ),
                  canGenerate:
                    editorContextMenu.functionContext.canGenerate,
                  onOpenDeclaration: () => {
                    const declaration =
                      editorContextMenu.functionContext?.declaration
                    if (declaration) {
                      openCppFunctionLocation(declaration)
                    }
                  },
                  onOpenDefinition: () => {
                    const definition =
                      editorContextMenu.functionContext?.definition
                    if (definition) {
                      openCppFunctionLocation(definition)
                    }
                  },
                  onGenerateImplementation: () =>
                    void generateCppFunctionImplementation(
                      editorContextMenu.functionContext!.symbol
                    )
                }
              : null
          }
          onAskAgent={() =>
            openAgentForEditorContextRef.current('ask')
          }
          onOpenCommandPalette={() => {
            setCommandPaletteMode('commands')
            setCommandPaletteOpen(true)
          }}
        />
      ) : null}

      {filePreview ? (
        <FilePreviewWindow
          path={filePreview.path}
          content={filePreview.content}
          language={filePreview.language}
          theme={monacoThemeFor(editorTheme)}
          onClose={() => setFilePreview(null)}
          onOpenEditor={() => {
            const preview = filePreview
            setFilePreview(null)
            setWorkspaceView('code')
            const entry = findFileEntry(fileTree, preview.path)
            void openFile(
              entry ?? {
                name: fileNameFromPath(preview.path),
                path: preview.path,
                type: 'file'
              }
            )
          }}
        />
      ) : null}

      {commandPaletteOpen ? (
        <CommandPalette
          commands={
            commandPaletteMode === 'files' ? quickFileCommands : commands
          }
          placeholder={
            commandPaletteMode === 'files'
              ? '输入文件名或路径快速打开'
              : '搜索命令、项目操作或 Agent 任务'
          }
          onClose={() => setCommandPaletteOpen(false)}
        />
      ) : null}

      {workflowModalOpen && project ? (
        <WorkflowModal
          onClose={() => setWorkflowModalOpen(false)}
          onRunCompleted={handleWorkflowCompleted}
        />
      ) : null}

      {newProjectModalOpen ? (
        <NewProjectModal
          onClose={() => setNewProjectModalOpen(false)}
          onCreate={handleCreateProject}
        />
      ) : null}

      {explorerContextMenu && project ? (
        <ExplorerContextMenu
          x={explorerContextMenu.x}
          y={explorerContextMenu.y}
          target={explorerContextMenu.target}
          isCppProject={isCppProject}
          onClose={() => setExplorerContextMenu(null)}
          onCreate={handleCreateWorkspaceEntry}
          onRename={handleRenameWorkspaceEntry}
          onTrash={handleTrashWorkspaceEntry}
          onDeletePermanently={permanentlyDeleteWorkspaceEntry}
          onReveal={(path) =>
            window.desktop.revealWorkspaceEntry(path)
          }
          onOpenFile={(path) =>
            openWorkspaceFile({
              name: fileNameFromPath(path),
              path,
              type: 'file'
            })
          }
          onOpenTerminal={openExplorerDirectoryInTerminal}
          onAskAgent={askAgentAboutExplorerTarget}
          onCopy={copyExplorerPath}
          onRefresh={refreshFileTree}
        />
      ) : null}

      {pendingClosePath ? (
        <UnsavedChangesDialog
          fileName={
            openFiles.find((file) => file.path === pendingClosePath)?.name ??
            '当前文件'
          }
          busy={closeBusy}
          onSave={() => void savePendingClose()}
          onDiscard={discardPendingClose}
          onCancel={cancelPendingClose}
        />
      ) : null}

      {missingProject ? (
        <ProjectMissingDialog
          projectName={missingProject.name}
          projectPath={missingProject.path}
          busy={missingProjectBusy}
          error={missingProjectError}
          onOpenProject={() => void openProjectAfterMissing()}
          onCancel={() =>
            void closeMissingProject('项目文件夹已丢失，已返回主界面。')
          }
        />
      ) : null}

      {settingsModalOpen ? (
        <SettingsModal
          appearance={appearance}
          appInfo={appInfo}
          updateStatus={updateStatus}
          wordWrap={wordWrap}
          activityBarVisible={workspaceLayout.activityBarVisible}
          sidebarVisible={workspaceLayout.sidebarVisible}
          inspectorVisible={workspaceLayout.inspectorVisible}
          onThemeChange={(theme: AppThemeId) =>
            setAppearance((current) => ({ ...current, theme }))
          }
          onEditorThemeChange={(editorTheme: ThemePreference) =>
            setAppearance((current) => ({ ...current, editorTheme }))
          }
          onAgentThemeChange={(agentTheme: ThemePreference) =>
            setAppearance((current) => ({ ...current, agentTheme }))
          }
          onEditorFontSizeChange={(editorFontSize) =>
            setAppearance((current) => ({
              ...current,
              editorFontSize
            }))
          }
          onWordWrapChange={setWordWrap}
          onMinimapChange={(showMinimap) =>
            setAppearance((current) => ({ ...current, showMinimap }))
          }
          onSmoothCaretChange={(smoothCaret) =>
            setAppearance((current) => ({ ...current, smoothCaret }))
          }
          onBracketGuidesChange={(bracketGuides) =>
            setAppearance((current) => ({ ...current, bracketGuides }))
          }
          onConfirmDestructiveActionsChange={(confirmDestructiveActions) =>
            setAppearance((current) => ({
              ...current,
              confirmDestructiveActions
            }))
          }
          onActivityBarVisibleChange={(activityBarVisible) =>
            setWorkspaceLayout((current) => ({
              ...current,
              activityBarVisible
            }))
          }
          onSidebarVisibleChange={(sidebarVisible) =>
            setWorkspaceLayout((current) => ({
              ...current,
              sidebarVisible
            }))
          }
          onInspectorVisibleChange={(inspectorVisible) =>
            setWorkspaceLayout((current) => ({
              ...current,
              inspectorVisible
            }))
          }
          onResetLayout={resetWorkspaceLayout}
          onCheckUpdates={() => void handleCheckForUpdates()}
          onClose={() => setSettingsModalOpen(false)}
        />
      ) : null}

      {applicationCloseRequested ? (
        <ApplicationCloseDialog
          dirtyFiles={dirtyOpenFiles.map((file) => ({
            name: file.name,
            path: file.path
          }))}
          busy={applicationCloseBusy}
          error={applicationCloseError}
          onSaveAll={() => void saveAllAndCloseApplication()}
          onDiscard={() => void discardAndCloseApplication()}
          onCancel={cancelApplicationClose}
        />
      ) : null}
    </div>
  )
}

export default App
