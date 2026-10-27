import {
  mkdtemp,
  mkdir,
  readFile,
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

  it('creates files and directories and rejects duplicate names', async () => {
    const root = await createWorkspace()
    const service = new WorkspaceFileService(root)

    const file = await service.createEntry(
      'src',
      'file',
      'new-file.ts',
      'export const created = true\n'
    )
    const directory = await service.createEntry(
      '',
      'directory',
      'new-folder'
    )

    expect(file).toMatchObject({
      name: 'new-file.ts',
      type: 'file'
    })
    expect(directory).toMatchObject({
      name: 'new-folder',
      type: 'directory'
    })
    expect(
      await readFile(join(root, 'src', 'new-file.ts'), 'utf8')
    ).toBe('export const created = true\n')
    await service.createEntry(
      join('src', 'Headers'),
      'file',
      'Student.h',
      '#pragma once\n',
      true
    )
    expect(
      await readFile(join(root, 'src', 'Headers', 'Student.h'), 'utf8')
    ).toBe('#pragma once\n')
    await expect(
      service.createEntry('src', 'file', 'new-file.ts')
    ).rejects.toThrow('同名文件或文件夹已经存在')
  })

  it('rejects traversal and unsafe entry names', async () => {
    const root = await createWorkspace()
    const service = new WorkspaceFileService(root)

    await expect(
      service.createEntry('../outside', 'file', 'test.ts')
    ).rejects.toThrow('拒绝访问当前项目目录之外的文件')
    await expect(
      service.createEntry('src', 'file', '../outside.ts')
    ).rejects.toThrow('名称不能包含')
    await expect(
      service.createEntry('src', 'directory', 'CON')
    ).rejects.toThrow('Windows 保留名称')
  })

  it('renames files and directories without allowing overwrites', async () => {
    const root = await createWorkspace()
    const service = new WorkspaceFileService(root)

    const renamedFile = await service.renameEntry(
      join('src', 'app.ts'),
      'main.ts'
    )
    const renamedDirectory = await service.renameEntry('src', 'source')

    expect(renamedFile).toMatchObject({ name: 'main.ts', type: 'file' })
    expect(renamedDirectory).toMatchObject({
      name: 'source',
      type: 'directory'
    })
    await expect(
      service.renameEntry('README.md', 'source')
    ).rejects.toThrow('同名文件或文件夹已经存在')
  })

  it('permanently deletes a selected entry but protects the project root', async () => {
    const root = await createWorkspace()
    const service = new WorkspaceFileService(root)

    await service.deleteEntry(join('src', 'app.ts'))
    expect((await service.getFileTree()).some((entry) => entry.name === 'src')).toBe(
      true
    )
    await expect(service.deleteEntry('.')).rejects.toThrow(
      '不能删除项目根目录'
    )
  })
})
