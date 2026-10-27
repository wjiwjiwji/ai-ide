import { describe, expect, it } from 'vitest'
import type { AgentCodeCompletionRequest } from '../../shared/desktop'
import {
  buildAgentCompletionMessages,
  cleanAgentCompletion,
  generateAgentCodeCompletion
} from './agent-completion'

const request: AgentCodeCompletionRequest = {
  path: 'src/main.cpp',
  language: 'cpp',
  prefix: 'int add(int left, int right) {\n  ',
  suffix: '\n}\n'
}

describe('Agent code completion', () => {
  it('includes the caret context and asks for insertion-only output', () => {
    const messages = buildAgentCompletionMessages(request)

    expect(messages[0].content).toContain('only the exact text')
    expect(messages[1].content).toContain('int add(int left, int right)')
    expect(messages[1].content).toContain('<suffix>\n\n}')
  })

  it('removes Markdown fences and explanation prefixes', () => {
    expect(
      cleanAgentCompletion(
        '```cpp\nreturn left + right;\n```',
        request
      )
    ).toBe('return left + right;')
    expect(
      cleanAgentCompletion(
        "Here's the completion:\nreturn left + right;",
        request
      )
    ).toBe('return left + right;')
  })

  it('drops empty and duplicated completions', () => {
    expect(cleanAgentCompletion('   ', request)).toBe('')
    expect(cleanAgentCompletion(request.suffix, request)).toBe('')
    expect(
      cleanAgentCompletion('int add(int left, int right) {\n  ', request)
    ).toBe('')
  })

  it('caps oversized completions to 80 lines', () => {
    const result = cleanAgentCompletion(
      Array.from({ length: 120 }, (_, index) => `line ${index}`).join('\n'),
      request
    )

    expect(result.split('\n')).toHaveLength(80)
  })

  it('returns the cleaned model text', async () => {
    const result = await generateAgentCodeCompletion({
      request,
      signal: new AbortController().signal,
      complete: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'return left + right;'
            }
          }
        ]
      })
    })

    expect(result).toBe('return left + right;')
  })
})
