import { isAbsolute, relative } from 'node:path'

export function isPathInside(rootPath: string, targetPath: string): boolean {
  const pathFromRoot = relative(rootPath, targetPath)
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
  )
}

export function assertPathInside(
  rootPath: string,
  targetPath: string
): void {
  if (!isPathInside(rootPath, targetPath)) {
    throw new Error('拒绝访问当前项目目录之外的文件。')
  }
}
