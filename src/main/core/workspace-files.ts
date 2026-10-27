import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { FileContent, FileEntry } from '../../shared/desktop'
import { assertPathInside } from './path-security'

export const MAX_TEXT_FILE_SIZE = 2 * 1024 * 1024
export const DEFAULT_MAX_PROJECT_ENTRIES = 5000
export const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.idea',
  '.vscode',
  'node_modules',
  'out',
  'dist',
  'build',
  'target',
  '.next',
  'coverage'
])

export interface WorkspaceFileOptions {
  maxFileSize?: number
  maxEntries?: number
  ignoredDirectories?: Set<string>
}

const windowsReservedName =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export function normalizeWorkspaceEntryName(name: string): string {
  if (typeof name !== 'string') {
    throw new Error('名称无效。')
  }
  const normalized = name.trim()
  if (!normalized) {
    throw new Error('请输入文件或文件夹名称。')
  }
  if (normalized.length > 255) {
    throw new Error('名称不能超过 255 个字符。')
  }
  if (normalized === '.' || normalized === '..') {
    throw new Error('名称无效。')
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(normalized)) {
    throw new Error('名称不能包含 < > : " / \\ | ? * 等字符。')
  }
  if (/[. ]$/.test(normalized)) {
    throw new Error('名称不能以句点或空格结尾。')
  }
  if (windowsReservedName.test(normalized)) {
    throw new Error('该名称是 Windows 保留名称。')
  }
  return normalized
}

export async function buildFileTree(
  rootPath: string,
  directoryPath = rootPath,
  depth = 0,
  remainingEntries = { value: DEFAULT_MAX_PROJECT_ENTRIES },
  ignoredDirectories = DEFAULT_IGNORED_DIRECTORIES
): Promise<FileEntry[]> {
  if (depth > 12 || remainingEntries.value <= 0) {
    return []
  }

  const entries = await readdir(directoryPath, { withFileTypes: true })
  const sortedEntries = entries
    .filter(
      (entry) =>
        !(
          entry.isDirectory() &&
          ignoredDirectories.has(entry.name)
        )
    )
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1
      }
      return left.name.localeCompare(right.name, 'zh-CN')
    })

  const nodes: FileEntry[] = []
  for (const entry of sortedEntries) {
    if (remainingEntries.value <= 0) {
      break
    }
    if (entry.isSymbolicLink()) {
      continue
    }

    const absolutePath = join(directoryPath, entry.name)
    const relativePath = relative(rootPath, absolutePath)

    if (entry.isDirectory()) {
      remainingEntries.value -= 1
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children: await buildFileTree(
          rootPath,
          absolutePath,
          depth + 1,
          remainingEntries,
          ignoredDirectories
        )
      })
    } else if (entry.isFile()) {
      remainingEntries.value -= 1
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'file'
      })
    }
  }

  return nodes
}

export class WorkspaceFileService {
  readonly projectPath: string
  private readonly maxFileSize: number
  private readonly maxEntries: number
  private readonly ignoredDirectories: Set<string>

  constructor(projectPath: string, options: WorkspaceFileOptions = {}) {
    this.projectPath = projectPath
    this.maxFileSize = options.maxFileSize ?? MAX_TEXT_FILE_SIZE
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_PROJECT_ENTRIES
    this.ignoredDirectories =
      options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES
  }

  async getRoot(): Promise<string> {
    return realpath(this.projectPath)
  }

  async resolvePath(relativePath: string): Promise<{
    projectRoot: string
    targetPath: string
  }> {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      throw new Error('文件路径无效。')
    }

    const projectRoot = await this.getRoot()
    const targetPath = resolve(projectRoot, relativePath)
    assertPathInside(projectRoot, targetPath)
    return { projectRoot, targetPath }
  }

  async getFileTree(): Promise<FileEntry[]> {
    const projectRoot = await this.getRoot()
    return buildFileTree(
      projectRoot,
      projectRoot,
      0,
      { value: this.maxEntries },
      this.ignoredDirectories
    )
  }

  async getDirectoryTree(
    relativePath: string,
    maxEntries = 2000
  ): Promise<FileEntry[]> {
    const { projectRoot, targetPath } = await this.resolvePath(relativePath)
    const realTargetPath = await realpath(targetPath)
    assertPathInside(projectRoot, realTargetPath)
    const targetStats = await lstat(realTargetPath)
    if (!targetStats.isDirectory()) {
      throw new Error('工具路径不是目录。')
    }
    return buildFileTree(
      projectRoot,
      realTargetPath,
      0,
      { value: maxEntries },
      this.ignoredDirectories
    )
  }

  async readText(relativePath: string): Promise<FileContent> {
    const { projectRoot, targetPath } = await this.resolvePath(relativePath)
    const realTargetPath = await realpath(targetPath)
    assertPathInside(projectRoot, realTargetPath)
    const fileStats = await lstat(realTargetPath)
    if (!fileStats.isFile()) {
      throw new Error('所选路径不是文件。')
    }
    if (fileStats.size > this.maxFileSize) {
      throw new Error('文件超过 2 MB，当前编辑器暂不支持打开。')
    }
    return {
      path: relativePath,
      content: await readFile(realTargetPath, 'utf8'),
      size: fileStats.size
    }
  }

  async saveText(relativePath: string, content: string): Promise<void> {
    if (typeof content !== 'string') {
      throw new Error('文件内容无效。')
    }
    if (Buffer.byteLength(content, 'utf8') > this.maxFileSize) {
      throw new Error('文件超过 2 MB，当前编辑器暂不支持保存。')
    }

    const { projectRoot, targetPath } = await this.resolvePath(relativePath)
    const realTargetPath = await realpath(targetPath)
    assertPathInside(projectRoot, realTargetPath)
    const fileStats = await lstat(realTargetPath)
    if (!fileStats.isFile()) {
      throw new Error('所选路径不是文件。')
    }
    await writeFile(realTargetPath, content, 'utf8')
  }

  async createEntry(
    directoryPath: string,
    type: 'file' | 'directory',
    name: string,
    content = '',
    createParentDirectories = false
  ): Promise<FileEntry> {
    if (type !== 'file' && type !== 'directory') {
      throw new Error('创建类型无效。')
    }
    const normalizedName = normalizeWorkspaceEntryName(name)
    if (typeof content !== 'string') {
      throw new Error('文件初始内容无效。')
    }
    if (Buffer.byteLength(content, 'utf8') > this.maxFileSize) {
      throw new Error('文件超过 2 MB，当前编辑器暂不支持创建。')
    }
    const projectRoot = await this.getRoot()
    const requestedDirectory = directoryPath
      ? resolve(projectRoot, directoryPath)
      : projectRoot
    assertPathInside(projectRoot, requestedDirectory)
    if (createParentDirectories) {
      await mkdir(requestedDirectory, { recursive: true })
    }
    const directoryRoot = await realpath(requestedDirectory)
    assertPathInside(projectRoot, directoryRoot)
    const directoryStats = await lstat(directoryRoot)
    if (!directoryStats.isDirectory()) {
      throw new Error('只能在文件夹中创建内容。')
    }

    const targetPath = join(directoryRoot, normalizedName)
    try {
      await lstat(targetPath)
      throw new Error('同名文件或文件夹已经存在。')
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === '同名文件或文件夹已经存在。'
      ) {
        throw error
      }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    if (type === 'directory') {
      await mkdir(targetPath)
    } else {
      await writeFile(targetPath, content, {
        encoding: 'utf8',
        flag: 'wx'
      })
    }

    return {
      name: normalizedName,
      path: relative(projectRoot, targetPath),
      type
    }
  }

  async renameEntry(relativePath: string, newName: string): Promise<FileEntry> {
    const normalizedName = normalizeWorkspaceEntryName(newName)
    const { projectRoot, targetPath } = await this.resolvePath(relativePath)
    const realTargetPath = await realpath(targetPath)
    assertPathInside(projectRoot, realTargetPath)
    if (realTargetPath === projectRoot) {
      throw new Error('不能重命名项目根目录。')
    }
    const entryStats = await lstat(realTargetPath)
    const nextPath = join(dirname(realTargetPath), normalizedName)
    try {
      await lstat(nextPath)
      throw new Error('同名文件或文件夹已经存在。')
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === '同名文件或文件夹已经存在。'
      ) {
        throw error
      }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    await rename(realTargetPath, nextPath)
    return {
      name: normalizedName,
      path: relative(projectRoot, nextPath),
      type: entryStats.isDirectory() ? 'directory' : 'file'
    }
  }

  async deleteEntry(relativePath: string): Promise<void> {
    const { projectRoot, targetPath } = await this.resolvePath(relativePath)
    const realTargetPath = await realpath(targetPath)
    assertPathInside(projectRoot, realTargetPath)
    if (realTargetPath === projectRoot) {
      throw new Error('不能删除项目根目录。')
    }
    await rm(realTargetPath, {
      recursive: true,
      force: false,
      maxRetries: 2
    })
  }
}
