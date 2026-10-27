export type AppThemeId =
  | 'obsidian'
  | 'slate'
  | 'ocean'
  | 'forest'
  | 'paper'
  | 'mist'

export type ThemePreference = AppThemeId | 'match-app'

export interface AppearanceSettings {
  theme: AppThemeId
  editorTheme: ThemePreference
  agentTheme: ThemePreference
  editorFontSize: number
  showMinimap: boolean
  smoothCaret: boolean
  bracketGuides: boolean
  confirmDestructiveActions: boolean
}

export interface AppThemeDefinition {
  id: AppThemeId
  name: string
  description: string
  background: string
  panel: string
  accent: string
  menuBackground: string
  menuForeground: string
  menuForegroundStrong: string
  menuMuted: string
  menuDisabled: string
  menuBorder: string
  menuHover: string
  menuSeparator: string
}

const sharedMenuColors = {
  menuBackground: '#2b2b2d',
  menuForeground: '#ffffff',
  menuForegroundStrong: '#ffffff',
  menuMuted: '#ffffff',
  menuDisabled: '#c6c6c6',
  menuBorder: '#55555a',
  menuHover: '#094771',
  menuSeparator: '#48484d'
}

export const APP_THEMES: AppThemeDefinition[] = [
  {
    id: 'obsidian',
    name: 'Visual Studio 深色',
    description: '经典深灰背景与蓝色强调',
    background: '#1e1e1e',
    panel: '#252526',
    accent: '#007acc',
    ...sharedMenuColors
  },
  {
    id: 'slate',
    name: '石墨灰',
    description: '偏中性的蓝灰工作台',
    background: '#15191f',
    panel: '#1d232a',
    accent: '#b7d978',
    ...sharedMenuColors
  },
  {
    id: 'ocean',
    name: '深海蓝',
    description: '低饱和蓝色背景',
    background: '#08141c',
    panel: '#101f29',
    accent: '#72d7e8',
    ...sharedMenuColors
  },
  {
    id: 'forest',
    name: '松林绿',
    description: '深绿色护眼工作区',
    background: '#0b1511',
    panel: '#13201a',
    accent: '#9fda83',
    ...sharedMenuColors
  },
  {
    id: 'paper',
    name: '明亮纸张',
    description: '近白背景、深色文字与蓝色强调',
    background: '#f7f7f4',
    panel: '#ffffff',
    accent: '#0067b8',
    ...sharedMenuColors
  },
  {
    id: 'mist',
    name: '清晨薄雾',
    description: '浅蓝灰背景与青色强调',
    background: '#eaf0f5',
    panel: '#f7f9fb',
    accent: '#007c91',
    ...sharedMenuColors
  }
]

const defaultAppearance: AppearanceSettings = {
  theme: 'obsidian',
  editorTheme: 'match-app',
  agentTheme: 'match-app',
  editorFontSize: 13,
  showMinimap: true,
  smoothCaret: true,
  bracketGuides: true,
  confirmDestructiveActions: true
}

export function resolveThemePreference(
  preference: ThemePreference,
  appTheme: AppThemeId
): AppThemeId {
  return preference === 'match-app' ? appTheme : preference
}

export function readAppearanceSettings(): AppearanceSettings {
  try {
    const parsed = JSON.parse(
      localStorage.getItem('ai-ide:appearance') ?? '{}'
    ) as Partial<AppearanceSettings>
    const theme = APP_THEMES.some((item) => item.id === parsed.theme)
      ? (parsed.theme as AppThemeId)
      : defaultAppearance.theme
    const parseThemePreference = (
      value: unknown
    ): ThemePreference =>
      value === 'match-app' ||
      APP_THEMES.some((item) => item.id === value)
        ? (value as ThemePreference)
        : 'match-app'
    return {
      theme,
      editorTheme: parseThemePreference(parsed.editorTheme),
      agentTheme: parseThemePreference(parsed.agentTheme),
      editorFontSize:
        typeof parsed.editorFontSize === 'number'
          ? Math.min(22, Math.max(11, Math.round(parsed.editorFontSize)))
          : defaultAppearance.editorFontSize,
      showMinimap:
        typeof parsed.showMinimap === 'boolean'
          ? parsed.showMinimap
          : defaultAppearance.showMinimap,
      smoothCaret:
        typeof parsed.smoothCaret === 'boolean'
          ? parsed.smoothCaret
          : defaultAppearance.smoothCaret,
      bracketGuides:
        typeof parsed.bracketGuides === 'boolean'
          ? parsed.bracketGuides
          : defaultAppearance.bracketGuides,
      confirmDestructiveActions:
        typeof parsed.confirmDestructiveActions === 'boolean'
          ? parsed.confirmDestructiveActions
          : defaultAppearance.confirmDestructiveActions
    }
  } catch {
    return defaultAppearance
  }
}

export function monacoThemeFor(theme: AppThemeId): string {
  return `ai-ide-${theme}`
}
