import { describe, expect, it } from 'vitest'
import { parseCompilerDiagnostics } from './compiler-diagnostics'

describe('compiler diagnostics', () => {
  it('parses GCC source diagnostics and normalizes project paths', () => {
    const diagnostics = parseCompilerDiagnostics(
      [
        'In file included from E:/tmp/header.h:2:',
        'D:\\Code\\test\\src\\main.cpp:6:12: error: expected ; before }',
        'D:\\Code\\test\\src\\main.cpp:8:3: warning: unused variable x'
      ].join('\n'),
      'D:\\Code\\test'
    )

    expect(diagnostics).toEqual([
      expect.objectContaining({
        file: 'src\\main.cpp',
        line: 6,
        column: 12,
        severity: 'error'
      }),
      expect.objectContaining({
        file: 'src\\main.cpp',
        line: 8,
        severity: 'warning'
      })
    ])
  })

  it('parses MSVC diagnostics', () => {
    const diagnostics = parseCompilerDiagnostics(
      'main.cpp(4,9): error C2065: x: undeclared identifier',
      null
    )

    expect(diagnostics[0]).toMatchObject({
      file: 'main.cpp',
      line: 4,
      column: 9,
      severity: 'error',
      message: 'x: undeclared identifier'
    })
  })
})
