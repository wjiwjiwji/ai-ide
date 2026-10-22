import { execFile } from 'node:child_process'
import {
  lstat,
  readFile,
  realpath
} from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  GitCommitResult,
  GitFileDiff,
  GitStatus
} from '../../shared/desktop'
import { assertPathInside } from './path-security'
import { parseGitStatus } from './git-status'
import { MAX_TEXT_FILE_SIZE } from './workspace-files'

export class GitService {
  readonly projectPath: string
  private readonly maxFileSize: number

  constructor(
    projectPath: string,
    options: { maxFileSize?: number } = {}
  ) {
    this.projectPath = projectPath
    this.maxFileSize = options.maxFileSize ?? MAX_TEXT_FILE_SIZE
  }

  private async getRoot(): Promise<string> {
    return realpath(this.projectPath)
  }

  private async run(
    args: string[],
    maxBuffer = 8 * 1024 * 1024
  ): Promise<Buffer> {
    const projectRoot = await this.getRoot()
    return new Promise((resolvePromise, rejectPromise) => {
      execFile(
        'git',
        ['-C', projectRoot, ...args],
        {
          encoding: 'buffer',
          maxBuffer,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          if (error) {
            const stderrText = Buffer.from(stderr).toString('utf8').trim()
            const gitError = new Error(stderrText || error.message)
            gitError.cause = error
            rejectPromise(gitError)
            return
          }
          resolvePromise(Buffer.from(stdout))
        }
      )
    })
  }

  private async readCurrentBranch(projectRoot: string): Promise<string | null> {
    try {
      const branch = await this.run([
        'symbolic-ref',
        '--quiet',
        '--short',
        'HEAD'
      ])
      return branch.toString('utf8').trim() || null
    } catch {
      try {
        const commit = await this.run([
          'rev-parse',
          '--short',
          'HEAD'
        ])
        return commit.toString('utf8').trim() || null
      } catch {
        return null
      }
    }
  }

  private async readUpstreamCounts(): Promise<{
    ahead: number
    behind: number
  }> {
    try {
      const output = await this.run([
        'rev-list',
        '--left-right',
        '--count',
        'HEAD...@{upstream}'
      ])
      const [ahead, behind] = output
        .toString('utf8')
        .trim()
        .split(/\s+/)
        .map(Number)
      return {
        ahead: Number.isFinite(ahead) ? ahead : 0,
        behind: Number.isFinite(behind) ? behind : 0
      }
    } catch {
      return { ahead: 0, behind: 0 }
    }
  }

  async getStatus(): Promise<GitStatus> {
    const projectRoot = await this.getRoot()
    try {
      const repositoryCheck = await this.run([
        'rev-parse',
        '--is-inside-work-tree'
      ])
      if (repositoryCheck.toString('utf8').trim() !== 'true') {
        throw new Error('当前项目不是 Git 仓库。')
      }

      const [statusOutput, branch, upstreamCounts] = await Promise.all([
        this.run([
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all'
        ]),
        this.readCurrentBranch(projectRoot),
        this.readUpstreamCounts()
      ])

      return {
        isRepository: true,
        branch,
        ...upstreamCounts,
        changes: parseGitStatus(statusOutput.toString('utf8'))
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '无法读取 Git 状态。'
      const isNotRepository =
        message.includes('not a git repository') ||
        message.includes('not a Git repository') ||
        message.includes('不是 Git 仓库')
      return {
        isRepository: false,
        branch: null,
        ahead: 0,
        behind: 0,
        changes: [],
        error: isNotRepository ? '当前项目不是 Git 仓库。' : message
      }
    }
  }

  private async validatePaths(paths: string[]): Promise<{
    projectRoot: string
    paths: string[]
  }> {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 2000) {
      throw new Error('Git 文件路径数量无效。')
    }
    const projectRoot = await this.getRoot()
    const uniquePaths = [...new Set(paths)]
    for (const relativePath of uniquePaths) {
      if (
        typeof relativePath !== 'string' ||
        !relativePath.trim() ||
        relativePath.includes('\0')
      ) {
        throw new Error('Git 文件路径无效。')
      }
      const targetPath = resolve(projectRoot, relativePath)
      assertPathInside(projectRoot, targetPath)
    }
    return { projectRoot, paths: uniquePaths }
  }

  async stageFiles(paths: string[]): Promise<GitStatus> {
    const { paths: safePaths } = await this.validatePaths(paths)
    await this.run(['add', '-A', '--', ...safePaths])
    return this.getStatus()
  }

  async unstageFiles(paths: string[]): Promise<GitStatus> {
    const { paths: safePaths } = await this.validatePaths(paths)
    let hasHead = true
    try {
      await this.run(['rev-parse', '--verify', 'HEAD'])
    } catch {
      hasHead = false
    }
    if (hasHead) {
      await this.run(['restore', '--staged', '--', ...safePaths])
    } else {
      await this.run(['rm', '--cached', '-r', '--', ...safePaths])
    }
    return this.getStatus()
  }

  async stageAll(): Promise<GitStatus> {
    await this.run(['add', '-A', '--', '.'])
    return this.getStatus()
  }

  async unstageAll(): Promise<GitStatus> {
    let hasHead = true
    try {
      await this.run(['rev-parse', '--verify', 'HEAD'])
    } catch {
      hasHead = false
    }
    if (hasHead) {
      await this.run(['restore', '--staged', '--', '.'])
    } else {
      await this.run(['rm', '--cached', '-r', '--', '.'])
    }
    return this.getStatus()
  }

  async commitChanges(message: string): Promise<GitCommitResult> {
    const summary = message.trim()
    if (!summary) {
      throw new Error('提交信息不能为空。')
    }
    if (summary.length > 4000) {
      throw new Error('提交信息不能超过 4000 个字符。')
    }
    const statusBeforeCommit = await this.getStatus()
    if (!statusBeforeCommit.isRepository) {
      throw new Error(statusBeforeCommit.error ?? '当前项目不是 Git 仓库。')
    }
    if (!statusBeforeCommit.changes.some((change) => change.staged)) {
      throw new Error('没有已暂存的文件可以提交。')
    }

    await this.run(['commit', '-m', summary], 16 * 1024 * 1024)
    const commitHash = (
      await this.run(['rev-parse', '--short=8', 'HEAD'])
    )
      .toString('utf8')
      .trim()
    return {
      status: await this.getStatus(),
      commitHash,
      summary: summary.split(/\r?\n/, 1)[0]
    }
  }

  private async readWorkingFile(relativePath: string): Promise<Buffer> {
    const projectRoot = await this.getRoot()
    const targetPath = resolve(projectRoot, relativePath)
    assertPathInside(projectRoot, targetPath)
    try {
      const realTargetPath = await realpath(targetPath)
      assertPathInside(projectRoot, realTargetPath)
      const fileStats = await lstat(realTargetPath)
      if (!fileStats.isFile()) {
        return Buffer.alloc(0)
      }
      if (fileStats.size > this.maxFileSize) {
        throw new Error('文件超过 2 MB，暂不支持生成差异。')
      }
      return readFile(realTargetPath)
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        return Buffer.alloc(0)
      }
      throw error
    }
  }

  async getFileDiff(
    relativePath: string,
    originalPath?: string
  ): Promise<GitFileDiff> {
    if (
      typeof relativePath !== 'string' ||
      relativePath.includes('\0') ||
      (originalPath !== undefined &&
        (typeof originalPath !== 'string' || originalPath.includes('\0')))
    ) {
      throw new Error('Git 文件路径无效。')
    }

    const projectRoot = await this.getRoot()
    const resolvedWorkingPath = resolve(projectRoot, relativePath)
    assertPathInside(projectRoot, resolvedWorkingPath)

    let originalBuffer: Buffer = Buffer.alloc(0)
    try {
      originalBuffer = await this.run([
        'show',
        `HEAD:${originalPath ?? relativePath}`
      ])
    } catch {
      originalBuffer = Buffer.alloc(0)
    }

    const modifiedBuffer = await this.readWorkingFile(relativePath)
    const isBinary =
      originalBuffer.includes(0) || modifiedBuffer.includes(0)
    if (isBinary) {
      return {
        path: relativePath,
        originalPath,
        originalContent: '',
        modifiedContent: '',
        isBinary: true
      }
    }

    return {
      path: relativePath,
      originalPath,
      originalContent: originalBuffer.toString('utf8'),
      modifiedContent: modifiedBuffer.toString('utf8'),
      isBinary: false
    }
  }
}
