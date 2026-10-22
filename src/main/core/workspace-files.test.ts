import {
  mkdtemp,
  mkdir,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceFileService } from './workspace-files'

const temporaryDirectories: string[] = []

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ai-ide-workspace-'))
  temporaryDirectories.push(root)
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'dependency'), {
    recursive: true
  })
  await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
  await writeFile(join(root, 'README.md'), '# Test\n')
  await writeFile(
    join(root, 'node_modules', 'dependency', 'index.js'),
    'ignored'
  )
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('workspace file service', () => {
  it('builds a sorted tree while ignoring dependency directories', async () => {
    const root = await createWorkspace()
    const service = new WorkspaceFileService(root)
    const tree = await service.getFileTree()

    expect(tree.map((entry) => entry.name)).toEqual(['src', 'README.md'])
    expect(tree[0].children?.[0].path).toMatch(/src[\\/]app\.ts$/)
  })

  it('reads and saves existing text files', async () => {
    const root = await createWorkspace()
    const service = new WorkspaceFileService(root)
    const relativePath = join('src', 'app.ts')

    expect((await service.readText(relativePath)).content).toContain(
      'value = 1'
    )
    await service.saveText(relativePath, 'export const value = 2\n')
    expect((await service.readText(relativePath)).content).toContain(
      'value = 2'
    )
  })

  it('rejects traversal outside the project', async () => {
    const root = await createWorkspace()
    const service = new WorkspaceFileService(root)

    await expect(service.readText('../outside.txt')).rejects.toThrow(
      '拒绝访问当前项目目录之外的文件。'
    )
  })

  it('limits directory listing entries', async () => {
    const root = await createWorkspace()
    const service = new WorkspaceFileService(root)
    const tree = await service.getDirectoryTree('.', 1)

    expect(tree).toHaveLength(1)
  })
})
