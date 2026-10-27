import { DEFAULT_IGNORED_DIRECTORIES } from './workspace-files'

const additionalCheckpointIgnoredDirectories = new Set([
  '.cache',
  '.vs',
  'cmakefiles',
  'cmakestash'
])

export function isCheckpointIgnoredDirectory(name: string): boolean {
  const normalized = name.toLowerCase()
  return (
    DEFAULT_IGNORED_DIRECTORIES.has(name) ||
    additionalCheckpointIgnoredDirectories.has(normalized) ||
    /^cmake-build-.+/.test(normalized)
  )
}
