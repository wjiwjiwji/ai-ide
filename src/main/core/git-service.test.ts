import { execFile } from 'node:child_process'
import {
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitService } from './git-service'

const executeFile = promisify(execFile)
let repositoryPath = ''
let service: GitService

async function git(args: string[]): Promise<string> {
  const result = await executeFile('git', args, {
    cwd: repositoryPath,
    encoding: 'utf8',
    windowsHide: true
  })
  return result.stdout
}

beforeEach(async () => {
  repositoryPath = await mkdtemp(join(tmpdir(), 'ai-ide-git-'))
  await git(['init'])
  await git(['config', 'user.email', 'tests@example.com'])
  await git(['config', 'user.name', 'AI IDE Tests'])
  await writeFile(join(repositoryPath, 'README.md'), '# Initial\n')
  await git(['add', '.'])
  await git(['commit', '-m', 'Initial commit'])
  service = new GitService(repositoryPath)
})

afterEach(async () => {
  await rm(repositoryPath, { recursive: true, force: true })
})

describe('Git service', () => {
  it('reports branch and working tree changes', async () => {
    await writeFile(join(repositoryPath, 'README.md'), '# Changed\n')
    await writeFile(join(repositoryPath, 'new-file.ts'), 'export const x = 1\n')
    const status = await service.getStatus()

    expect(status.isRepository).toBe(true)
    expect(status.branch).toBeTruthy()
    expect(status.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'README.md',
          kind: 'modified',
          unstaged: true
        }),
        expect.objectContaining({
          path: 'new-file.ts',
          kind: 'untracked'
        })
      ])
    )
  })

  it('stages individual files and commits them', async () => {
    await writeFile(join(repositoryPath, 'feature.ts'), 'export const x = 1\n')
    const staged = await service.stageFiles(['feature.ts'])
    expect(
      staged.changes.find((change) => change.path === 'feature.ts')
    ).toMatchObject({ staged: true, kind: 'added' })

    const commit = await service.commitChanges('Add feature file')
    expect(commit.commitHash).toMatch(/^[0-9a-f]{8}$/)
    expect(commit.status.changes).toHaveLength(0)
    expect(await git(['log', '-1', '--pretty=%s'])).toContain(
      'Add feature file'
    )
  })

  it('unstages files without losing working tree changes', async () => {
    await writeFile(join(repositoryPath, 'README.md'), '# Updated\n')
    await service.stageFiles(['README.md'])
    const unstaged = await service.unstageFiles(['README.md'])

    expect(
      unstaged.changes.find((change) => change.path === 'README.md')
    ).toMatchObject({ staged: false, unstaged: true })
  })

  it('returns text diffs for modified files', async () => {
    await writeFile(join(repositoryPath, 'README.md'), '# Modified\n')
    const diff = await service.getFileDiff('README.md')

    expect(diff.isBinary).toBe(false)
    expect(diff.originalContent).toContain('# Initial')
    expect(diff.modifiedContent).toContain('# Modified')
  })

  it('rejects paths outside the repository', async () => {
    await expect(service.stageFiles(['../outside.txt'])).rejects.toThrow(
      '拒绝访问当前项目目录之外的文件。'
    )
  })
})
