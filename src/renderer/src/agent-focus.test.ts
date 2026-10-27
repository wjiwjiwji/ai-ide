import { describe, expect, it } from 'vitest'
import { buildAgentPrompt, buildEditorAgentPrompt } from './agent-focus'

describe('Agent workspace focus', () => {
  it('keeps the whole project in scope and includes the active editor', () => {
    const prompt = buildAgentPrompt({
      request: '解释这段代码',
      history: [],
      contextFiles: [],
      workspaceFocus: {
        path: 'src/main.ts',
        dirty: false,
        content: 'const value = 1',
        startLine: 3,
        startColumn: 2,
        endLine: 3,
        endColumn: 17,
        selectedText: 'const value = 1'
      },
      openFilePaths: ['src/main.ts'],
      changedFilePaths: ['src/main.ts'],
      diagnosticFilePaths: []
    })

    expect(prompt).toContain(
      'Project access scope: the entire current project.'
    )
    expect(prompt).toContain('Active editor: src/main.ts at 3:2')
    expect(prompt).toContain('<selected_code>\nconst value = 1')
    expect(prompt).toContain('Git changed files: src/main.ts')
  })

  it('includes unsaved editor content without requiring manual context', () => {
    const prompt = buildAgentPrompt({
      request: '检查当前修改',
      history: [],
      contextFiles: [],
      workspaceFocus: {
        path: 'src/app.ts',
        dirty: true,
        content: 'export const pending = true',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
        selectedText: ''
      },
      openFilePaths: ['src/app.ts'],
      changedFilePaths: [],
      diagnosticFilePaths: []
    })

    expect(prompt).toContain('<unsaved_buffer>')
    expect(prompt).toContain('export const pending = true')
  })

  it('keeps context pinning optional when there is no editor focus', () => {
    expect(
      buildAgentPrompt({
        request: '分析项目',
        history: [],
        contextFiles: [],
        workspaceFocus: null,
        openFilePaths: [],
        changedFilePaths: [],
        diagnosticFilePaths: []
      })
    ).toBe('分析项目')
  })

  it('builds an editor context-menu prompt with the selected range', () => {
    const prompt = buildEditorAgentPrompt({
      intent: 'explain',
      path: 'src/main.ts',
      startLine: 4,
      startColumn: 3,
      endLine: 8,
      selectedText: 'function run() {\n  return true\n}'
    })

    expect(prompt).toContain('src/main.ts:4-8')
    expect(prompt).toContain('作用、调用关系')
    expect(prompt).toContain('function run()')
  })

  it('uses the cursor location when no code is selected', () => {
    const prompt = buildEditorAgentPrompt({
      intent: 'ask',
      path: 'src/app.ts',
      startLine: 12,
      startColumn: 7,
      endLine: 12,
      selectedText: ''
    })

    expect(prompt).toContain('src/app.ts:12:7')
    expect(prompt).toContain('不要直接修改文件')
  })

  it('does not duplicate selected code already quoted in the request', () => {
    const prompt = buildAgentPrompt({
      request: '请解释：\n```\nconst answer = 42\n```',
      history: [],
      contextFiles: [],
      workspaceFocus: {
        path: 'src/answer.ts',
        dirty: false,
        content: 'const answer = 42',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 18,
        selectedText: 'const answer = 42'
      },
      openFilePaths: ['src/answer.ts'],
      changedFilePaths: [],
      diagnosticFilePaths: []
    })

    expect(prompt.match(/const answer = 42/g)).toHaveLength(1)
  })
})
