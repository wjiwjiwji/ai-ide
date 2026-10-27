import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureRecommendedGitignore,
  mergeRecommendedGitignore,
  recommendedGitignorePatterns
} from './gitignore'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('recommended gitignore repair', () => {
  it('keeps existing rules and appends only missing rules', () => {
    const merged = mergeRecommendedGitignore(
      'out/\n# custom\nsrc/generated/\n'
    )

    expect(merged.content).toContain('out/\n# custom\nsrc/generated/')
    expect(merged.content).not.toContain('\nout/\n')
    expect(merged.addedPatterns).toContain('.vs/')
    expect(merged.addedPatterns).not.toContain('out/')
  })

  it('is idempotent after the rules have been added', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-ide-gitignore-'))
    temporaryDirectories.push(root)
    await writeFile(join(root, '.gitignore'), 'out/\n', 'utf8')

    const first = await ensureRecommendedGitignore(root)
    const contentAfterFirst = await readFile(
      join(root, '.gitignore'),
      'utf8'
    )
    const second = await ensureRecommendedGitignore(root)
    const contentAfterSecond = await readFile(
      join(root, '.gitignore'),
      'utf8'
    )

    expect(first.changed).toBe(true)
    expect(first.addedPatterns).toEqual(
      expectedMissingPatterns(['out/'])
    )
    expect(second.changed).toBe(false)
    expect(second.addedPatterns).toEqual([])
    expect(contentAfterSecond).toBe(contentAfterFirst)
  })
})

function expectedMissingPatterns(existing: string[]): string[] {
  return recommendedGitignorePatterns.filter(
    (pattern) => !existing.includes(pattern)
  )
}
