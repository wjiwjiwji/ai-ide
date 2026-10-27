import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitignoreRepairResult } from '../../shared/desktop'

export const recommendedGitignorePatterns = [
  '.vs/',
  'build/',
  'out/',
  'cmake-build-*/',
  'CMakeFiles/',
  'CMakeCache.txt',
  'cmake_install.cmake',
  'CTestTestfile.cmake',
  'Testing/',
  'compile_commands.json',
  'CMakeUserPresets.json',
  '*.VC.db',
  '*.VC.db-shm',
  '*.VC.db-wal',
  '*.VC.opendb',
  '*.suo',
  '*.user',
  '*.userosscache',
  '*.sln.docstates',
  '*.ipch',
  '*.aps',
  '*.ncb',
  '.cache/',
  '*.obj',
  '*.o',
  '*.exe',
  '*.pdb',
  '*.ilk',
  '*.exp'
] as const

export function mergeRecommendedGitignore(existing: string): {
  content: string
  addedPatterns: string[]
} {
  const patterns = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  )
  const addedPatterns = recommendedGitignorePatterns.filter(
    (pattern) => !patterns.has(pattern)
  )
  if (addedPatterns.length === 0) {
    return { content: existing, addedPatterns }
  }

  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  const prefix =
    existing.length === 0
      ? ''
      : existing.endsWith('\n')
        ? newline
        : `${newline}${newline}`
  const content = `${existing}${prefix}# AI IDE recommended local ignores${newline}${addedPatterns.join(newline)}${newline}`
  return { content, addedPatterns }
}

export async function ensureRecommendedGitignore(
  projectPath: string
): Promise<GitignoreRepairResult> {
  const path = join(projectPath, '.gitignore')
  let existing = ''
  try {
    existing = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const merged = mergeRecommendedGitignore(existing)
  if (merged.addedPatterns.length > 0) {
    await writeFile(path, merged.content, 'utf8')
  }
  return {
    path: '.gitignore',
    changed: merged.addedPatterns.length > 0,
    addedPatterns: merged.addedPatterns
  }
}
