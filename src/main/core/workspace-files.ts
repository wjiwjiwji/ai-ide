import {
  lstat,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile
} from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
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
}
