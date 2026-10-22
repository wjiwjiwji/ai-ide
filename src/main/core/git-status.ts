import type { GitChangeKind, GitFileChange } from '../../shared/desktop'

export function getGitChangeKind(
  indexStatus: string,
  workTreeStatus: string
): GitChangeKind {
  const status = `${indexStatus}${workTreeStatus}`

  if (status === '??') {
    return 'untracked'
  }

  if (
    indexStatus === 'U' ||
    workTreeStatus === 'U' ||
    ['AA', 'DD', 'AU', 'UA', 'DU', 'UD'].includes(status)
  ) {
    return 'conflicted'
  }

  if (status.includes('R') || status.includes('C')) {
    return 'renamed'
  }

  if (status.includes('A')) {
    return 'added'
  }

  if (status.includes('D')) {
    return 'deleted'
  }

  if (status.includes('M') || status.includes('T')) {
    return 'modified'
  }

  return 'unknown'
}

export function parseGitStatus(output: string): GitFileChange[] {
  const records = output.split('\0').filter(Boolean)
  const changes: GitFileChange[] = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.length < 4) {
      continue
    }

    const indexStatus = record[0]
    const workTreeStatus = record[1]
    const path = record.slice(3)
    let originalPath: string | undefined

    if (
      indexStatus === 'R' ||
      indexStatus === 'C' ||
      workTreeStatus === 'R' ||
      workTreeStatus === 'C'
    ) {
      originalPath = records[index + 1]
      index += 1
    }

    changes.push({
      path,
      originalPath,
      indexStatus,
      workTreeStatus,
      kind: getGitChangeKind(indexStatus, workTreeStatus),
      staged: indexStatus !== ' ' && indexStatus !== '?',
      unstaged: workTreeStatus !== ' ' && workTreeStatus !== '?'
    })
  }

  return changes
}
