import { describe, expect, it } from 'vitest'
import { getGitChangeKind, parseGitStatus } from './git-status'

describe('git status parser', () => {
  it('parses staged, unstaged, untracked and conflicted files', () => {
    const changes = parseGitStatus(
      [
        ' M src/modified.ts',
        'A  src/staged.ts',
        '?? src/new.ts',
        'UU src/conflict.ts'
      ].join('\0') + '\0'
    )

    expect(changes).toHaveLength(4)
    expect(changes[0]).toMatchObject({
      path: 'src/modified.ts',
      kind: 'modified',
      staged: false,
      unstaged: true
    })
    expect(changes[1]).toMatchObject({
      path: 'src/staged.ts',
      kind: 'added',
      staged: true,
      unstaged: false
    })
    expect(changes[2]).toMatchObject({
      path: 'src/new.ts',
      kind: 'untracked',
      staged: false,
      unstaged: false
    })
    expect(changes[3]).toMatchObject({
      path: 'src/conflict.ts',
      kind: 'conflicted'
    })
  })

  it('parses renamed paths from NUL records', () => {
    const changes = parseGitStatus(
      'R  src/new name.ts\0src/old name.ts\0'
    )

    expect(changes).toEqual([
      {
        path: 'src/new name.ts',
        originalPath: 'src/old name.ts',
        indexStatus: 'R',
        workTreeStatus: ' ',
        kind: 'renamed',
        staged: true,
        unstaged: false
      }
    ])
  })

  it('classifies type changes as modifications', () => {
    expect(getGitChangeKind(' ', 'T')).toBe('modified')
    expect(getGitChangeKind('?', '?')).toBe('untracked')
    expect(getGitChangeKind('X', 'Y')).toBe('unknown')
  })
})
