import type { AgentCodeCompletionRequest } from '../../shared/desktop'
import type {
  DeepSeekMessage,
  DeepSeekResponse
} from './deepseek-agent'

const MAX_PREFIX_CHARS = 12_000
const MAX_SUFFIX_CHARS = 6_000
const MAX_RESULT_CHARS = 6_000
const MAX_RESULT_LINES = 80

export type AgentCompletionRequest = (
  messages: DeepSeekMessage[],
  signal: AbortSignal
) => Promise<DeepSeekResponse>

export interface AgentCompletionOptions {
  request: AgentCodeCompletionRequest
  signal: AbortSignal
  complete: AgentCompletionRequest
}

function trimToTail(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(-maxLength) : value
}

function trimToHead(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

export function buildAgentCompletionMessages(
  request: AgentCodeCompletionRequest
): DeepSeekMessage[] {
  const language = request.language.trim().slice(0, 80) || 'plaintext'
  const path = request.path.trim().slice(0, 500) || 'untitled'
  return [
    {
      role: 'system',
      content: [
        'You are an inline code completion engine inside a desktop IDE.',
        'Return only the exact text that should be inserted at the caret.',
        'Never use Markdown fences, XML tags, explanations, or line prefixes.',
        'Continue from the prefix and respect the suffix so the joined code remains valid.',
        'Prefer a small, coherent completion. Use at most 80 lines.',
        'Do not repeat code that already appears before or after the caret.',
        'Return an empty response when a confident completion is not available.'
      ].join(' ')
    },
    {
      role: 'user',
      content: [
        `File: ${path}`,
        `Language: ${language}`,
        '',
        '<prefix>',
        trimToTail(request.prefix, MAX_PREFIX_CHARS),
        '</prefix>',
        '',
        '<suffix>',
        trimToHead(request.suffix, MAX_SUFFIX_CHARS),
        '</suffix>'
      ].join('\n')
    }
  ]
}

export function cleanAgentCompletion(
  value: string | null | undefined,
  request: AgentCodeCompletionRequest
): string {
  if (!value) {
    return ''
  }

  let completion = value
    .replace(/\r\n/g, '\n')
    .replace(/^<completion>\s*/i, '')
    .replace(/\s*<\/completion>\s*$/i, '')
    .trimEnd()

  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(completion.trim())
  if (fenced) {
    completion = fenced[1]
  }

  completion = completion
    .replace(
      /^(?:here(?:'s| is) (?:the )?(?:suggested )?completion|completion)\s*:\s*\n?/i,
      ''
    )
    .trimEnd()

  if (
    !completion.trim() ||
    completion.trim() === request.suffix.trim() ||
    (completion.trim().length >= 16 &&
      request.prefix.trimEnd().endsWith(completion.trimEnd()))
  ) {
    return ''
  }

  const lines = completion.split('\n')
  if (lines.length > MAX_RESULT_LINES) {
    completion = lines.slice(0, MAX_RESULT_LINES).join('\n')
  }
  return completion.slice(0, MAX_RESULT_CHARS)
}

export async function generateAgentCodeCompletion(
  options: AgentCompletionOptions
): Promise<string> {
  if (options.signal.aborted) {
    return ''
  }
  const response = await options.complete(
    buildAgentCompletionMessages(options.request),
    options.signal
  )
  return cleanAgentCompletion(
    response.choices?.[0]?.message?.content,
    options.request
  )
}

export function createDeepSeekAgentCompletionRequest(
  apiKey: string,
  model: string
): AgentCompletionRequest {
  return async (messages, signal) => {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.15,
        max_tokens: 900,
        stream: false
      }),
      signal
    })
    if (!response.ok) {
      const body = (await response.text()).slice(0, 1_500)
      throw new Error(`DeepSeek API ${response.status}: ${body}`)
    }
    return (await response.json()) as DeepSeekResponse
  }
}
