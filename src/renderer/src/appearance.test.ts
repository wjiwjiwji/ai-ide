import { describe, expect, it } from 'vitest'
import {
  APP_THEMES,
  resolveThemePreference
} from './appearance'

function luminance(hex: string): number {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
  if (!channels || channels.length !== 3) {
    throw new Error(`Invalid color: ${hex}`)
  }
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(left: string, right: string): number {
  const light = Math.max(luminance(left), luminance(right))
  const dark = Math.min(luminance(left), luminance(right))
  return (light + 0.05) / (dark + 0.05)
}

describe('menu theme colors', () => {
  it('keeps menu text readable in every app theme', () => {
    for (const theme of APP_THEMES) {
      expect(
        contrast(theme.menuForeground, theme.menuBackground),
        theme.name
      ).toBeGreaterThanOrEqual(7)
      expect(
        contrast(theme.menuForegroundStrong, theme.menuHover),
        `${theme.name} hover`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the context menu visually stable across app themes', () => {
    const backgrounds = new Set<string>()
    for (const theme of APP_THEMES) {
      backgrounds.add(theme.menuBackground)
    }
    expect(backgrounds).toEqual(new Set(['#2b2b2d']))
  })
})

describe('theme preferences', () => {
  it('resolves match-app to the active application theme', () => {
    expect(resolveThemePreference('match-app', 'paper')).toBe('paper')
    expect(resolveThemePreference('match-app', 'obsidian')).toBe('obsidian')
  })

  it('keeps an independent theme when one is selected', () => {
    expect(resolveThemePreference('mist', 'obsidian')).toBe('mist')
    expect(resolveThemePreference('forest', 'paper')).toBe('forest')
  })
})
