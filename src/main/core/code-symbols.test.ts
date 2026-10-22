import { describe, expect, it } from 'vitest'
import {
  extractCodeSymbols,
  getFileLanguage,
  indexableExtensions
} from './code-symbols'

describe('code symbol extraction', () => {
  it('detects common TypeScript declarations', () => {
    const symbols = extractCodeSymbols(
      [
        'export interface User { id: string }',
        'export class UserService {}',
        'export function createUser() {}',
        'const defaultTimeout = 1000'
      ].join('\n'),
      'typescript'
    )

    expect(symbols).toEqual([
      { name: 'User', kind: 'interface', line: 1 },
      { name: 'UserService', kind: 'class', line: 2 },
      { name: 'createUser', kind: 'function', line: 3 },
      { name: 'defaultTimeout', kind: 'variable', line: 4 }
    ])
  })

  it('detects Python, Go and Rust declarations', () => {
    expect(
      extractCodeSymbols(
        'class Worker:\n    async def run(self):\n        pass',
        'python'
      )
    ).toEqual([
      { name: 'Worker', kind: 'class', line: 1 },
      { name: 'run', kind: 'def', line: 2 }
    ])
    expect(
      extractCodeSymbols('func Start() {}\ntype Job struct {}', 'go')
    ).toEqual([
      { name: 'Start', kind: 'func', line: 1 },
      { name: 'Job', kind: 'type', line: 2 }
    ])
    expect(
      extractCodeSymbols('pub struct Config {}\nfn run() {}', 'rust')
    ).toEqual([
      { name: 'Config', kind: 'struct', line: 1 },
      { name: 'run', kind: 'fn', line: 2 }
    ])
  })

  it('extracts Markdown headings and maps languages', () => {
    expect(extractCodeSymbols('# Title\n## Section', 'markdown')).toEqual([
      { name: 'Title', kind: 'h1', line: 1 },
      { name: 'Section', kind: 'h2', line: 2 }
    ])
    expect(getFileLanguage('src/app.tsx')).toBe('typescript')
    expect(getFileLanguage('script.ps1')).toBe('powershell')
    expect(getFileLanguage('unknown.xyz')).toBe('plaintext')
    expect(indexableExtensions.has('.ts')).toBe(true)
    expect(indexableExtensions.has('.exe')).toBe(false)
  })
})
