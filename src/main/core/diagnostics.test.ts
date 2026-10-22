import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseProjectDiagnostics } from './diagnostics'

describe('diagnostics parser', () => {
  const projectRoot = resolve('diagnostics-project')

  it('parses TypeScript legacy diagnostics', () => {
    const diagnostics = parseProjectDiagnostics(
      'src/app.ts(12,7): error TS2322: Type string is not assignable to number.',
      projectRoot
    )

    expect(diagnostics).toEqual([
      {
        file: expect.stringMatching(/src[\\/]app\.ts$/),
        line: 12,
        column: 7,
        severity: 'error',
        message: 'Type string is not assignable to number.',
        code: 'TS2322'
      }
    ])
  })

  it('parses compact diagnostics and strips ANSI colors', () => {
    const diagnostics = parseProjectDiagnostics(
      '\u001b[31msrc/test.ts:3:2 - warning TS1000: Check this value.\u001b[0m',
      projectRoot
    )

    expect(diagnostics[0]).toMatchObject({
      line: 3,
      column: 2,
      severity: 'warning',
      code: 'TS1000',
      message: 'Check this value.'
    })
  })

  it('ignores diagnostics outside the project and duplicates', () => {
    const line =
      'src/app.ts(1,1): error TS1001: Duplicate diagnostic message'
    const diagnostics = parseProjectDiagnostics(
      [
        line,
        line,
        'C:\\other\\outside.ts(1,1): error TS1002: Outside project'
      ].join('\n'),
      projectRoot
    )

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe('TS1001')
  })
})
