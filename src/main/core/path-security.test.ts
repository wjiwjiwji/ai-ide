import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertPathInside, isPathInside } from './path-security'

describe('path security', () => {
  const projectRoot = resolve('sandbox-project')

  it('accepts the project root and nested paths', () => {
    expect(isPathInside(projectRoot, projectRoot)).toBe(true)
    expect(
      isPathInside(projectRoot, resolve(projectRoot, 'src', 'main.ts'))
    ).toBe(true)
  })

  it('rejects paths outside the project root', () => {
    const outsidePath = resolve(projectRoot, '..', 'outside.txt')
    expect(isPathInside(projectRoot, outsidePath)).toBe(false)
    expect(() => assertPathInside(projectRoot, outsidePath)).toThrow(
      '拒绝访问当前项目目录之外的文件。'
    )
  })
})
