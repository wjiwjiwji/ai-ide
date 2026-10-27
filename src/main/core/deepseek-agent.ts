import { exec, execFile } from 'node:child_process'
import {
  mkdir,
  realpath,
  writeFile
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  AgentRunMode,
  AgentStreamEvent,
  CheckpointFileChange
} from '../../shared/desktop'
import { assertPathInside } from './path-security'
import { truncateAgentOutput } from './text-utils'
import { WorkspaceFileService } from './workspace-files'

export interface DeepSeekToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: DeepSeekToolCall[]
  tool_call_id?: string
}

export interface DeepSeekResponse {
  choices?: Array<{
    message?: DeepSeekMessage
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_cache_hit_tokens?: number
  }
}

export type DeepSeekCompletion = (
  messages: DeepSeekMessage[],
  signal: AbortSignal
) => Promise<DeepSeekResponse>

interface DeepSeekToolResult {
  result: string
  toolType: string
  detail: string
  changes: Array<{ path: string; kind?: string }>
}

export interface DeepSeekApprovalRequest {
  toolCall: DeepSeekToolCall
  detail: string
  command?: string
  changes: Array<{ path: string; kind?: string }>
}

export interface DeepSeekAgentOptions {
  runId: string
  taskId: string
  prompt: string
  apiKey: string
  model: string
  mode: AgentRunMode
  projectRoot: string
  workspace: WorkspaceFileService
  signal: AbortSignal
  emit: (event: Omit<AgentStreamEvent, 'runId'>) => void
  requestApproval: (
    request: DeepSeekApprovalRequest
  ) => Promise<boolean>
  createCheckpoint: (label: string) => Promise<void>
  searchCode: (query: string) => string
  complete?: DeepSeekCompletion
}

const deepSeekTools = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List files and directories below a relative path in the current project.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative directory path. Use "." for the project root.'
          }
        },
        required: ['path'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file in the current project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' }
        },
        required: ['path'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_text',
      description:
        'Search project text with ripgrep and return matching lines and paths.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Literal text to search for.' }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description:
        'Search the indexed project by file path, symbol name, or source text.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'File name, symbol, or code text to search for.'
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Replace a text file in the project. This requires explicit user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path.' },
          content: {
            type: 'string',
            description: 'Complete new UTF-8 file content.'
          }
        },
        required: ['path', 'content'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command in the project root. This requires explicit user approval.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Command to execute in the current project.'
          }
        },
        required: ['command'],
        additionalProperties: false
      }
    }
  }
] as const

function createCompletion(
  apiKey: string,
  model: string
): DeepSeekCompletion {
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
        tools: deepSeekTools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 8000,
        stream: false
      }),
      signal
    })
    if (!response.ok) {
      const body = truncateAgentOutput(await response.text(), 4000)
      throw new Error(`DeepSeek API ${response.status}: ${body}`)
    }
    return (await response.json()) as DeepSeekResponse
  }
}

async function searchText(
  projectRoot: string,
  query: string
): Promise<string> {
  if (!query.trim() || query.length > 500) {
    throw new Error('搜索文本无效。')
  }
  return new Promise((resolveSearch, rejectSearch) => {
    execFile(
      'rg',
      [
        '--line-number',
        '--no-heading',
        '--color',
        'never',
        '--max-count',
        '100',
        '--',
        query,
        '.'
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (
          error &&
          typeof (error as { code?: number }).code === 'number' &&
          (error as { code: number }).code === 1
        ) {
          resolveSearch('未找到匹配内容。')
          return
        }
        if (error) {
          rejectSearch(new Error(stderr.trim() || error.message))
          return
        }
        resolveSearch(truncateAgentOutput(stdout))
      }
    )
  })
}

async function writeWorkspaceFile(
  projectRoot: string,
  workspace: WorkspaceFileService,
  relativePath: string,
  content: string
): Promise<void> {
  if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('文件超过 2 MB，Agent 工具无法写入。')
  }
  const { targetPath } = await workspace.resolvePath(relativePath)
  const parentPath = await realpath(dirname(targetPath))
  assertPathInside(projectRoot, parentPath)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content, 'utf8')
}

async function runCommand(
  projectRoot: string,
  command: string
): Promise<string> {
  if (!command.trim() || command.length > 4000) {
    throw new Error('命令无效。')
  }
  return new Promise((resolveCommand) => {
    exec(
      command,
      {
        cwd: projectRoot,
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const errorWithCode = error as
          | (Error & { code?: number | string })
          | null
        resolveCommand(
          JSON.stringify({
            exitCode:
              errorWithCode && typeof errorWithCode.code === 'number'
                ? errorWithCode.code
                : error
                  ? 1
                  : 0,
            stdout: truncateAgentOutput(stdout),
            stderr: truncateAgentOutput(stderr)
          })
        )
      }
    )
  })
}

async function executeTool(
  options: DeepSeekAgentOptions,
  toolCall: DeepSeekToolCall
): Promise<DeepSeekToolResult> {
  const toolName = toolCall.function.name
  let args: Record<string, unknown>
  try {
    args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
  } catch {
    return {
      result: 'Invalid JSON arguments.',
      toolType: 'mcp_tool_call',
      detail: `${toolName}: invalid arguments`,
      changes: []
    }
  }

  if (toolName === 'list_files') {
    const path = typeof args.path === 'string' ? args.path : '.'
    const entries = await options.workspace.getDirectoryTree(path, 2000)
    return {
      result: JSON.stringify(entries),
      toolType: 'mcp_tool_call',
      detail: `list_files: ${path}`,
      changes: []
    }
  }

  if (toolName === 'read_file') {
    const path = typeof args.path === 'string' ? args.path : ''
    const file = await options.workspace.readText(path)
    return {
      result: file.content,
      toolType: 'mcp_tool_call',
      detail: `read_file: ${path}`,
      changes: []
    }
  }

  if (toolName === 'search_text') {
    const query = typeof args.query === 'string' ? args.query : ''
    return {
      result: await searchText(options.projectRoot, query),
      toolType: 'mcp_tool_call',
      detail: `search_text: ${query}`,
      changes: []
    }
  }

  if (toolName === 'search_code') {
    const query = typeof args.query === 'string' ? args.query : ''
    return {
      result: options.searchCode(query),
      toolType: 'mcp_tool_call',
      detail: `search_code: ${query}`,
      changes: []
    }
  }

  if (toolName === 'write_file') {
    if (options.mode !== 'workspace-write') {
      throw new Error('当前 Agent 处于只读模式，不能写入文件。')
    }
    const path = typeof args.path === 'string' ? args.path : ''
    const content = typeof args.content === 'string' ? args.content : ''
    const changes: CheckpointFileChange[] = [
      {
        path,
        status: 'modified',
        addedLines: 0,
        deletedLines: 0,
        isBinary: false
      }
    ]
    const approved = await options.requestApproval({
      toolCall,
      detail: `写入文件：${path}\n预览：${content.slice(0, 500)}`,
      changes
    })
    if (!approved) {
      return {
        result: JSON.stringify({
          approved: false,
          error: 'User denied this file change.'
        }),
        toolType: 'file_change',
        detail: `写入文件：${path}`,
        changes
      }
    }
    await options.createCheckpoint(`写入文件前：${path}`)
    await writeWorkspaceFile(
      options.projectRoot,
      options.workspace,
      path,
      content
    )
    return {
      result: JSON.stringify({
        approved: true,
        path,
        bytes: Buffer.byteLength(content)
      }),
      toolType: 'file_change',
      detail: `写入文件：${path}`,
      changes
    }
  }

  if (toolName === 'run_command') {
    if (options.mode !== 'workspace-write') {
      throw new Error('当前 Agent 处于只读模式，不能执行命令。')
    }
    const command = typeof args.command === 'string' ? args.command : ''
    const approved = await options.requestApproval({
      toolCall,
      detail: command,
      command,
      changes: []
    })
    if (!approved) {
      return {
        result: JSON.stringify({
          approved: false,
          error: 'User denied this command.'
        }),
        toolType: 'command_execution',
        detail: command,
        changes: []
      }
    }
    await options.createCheckpoint(`执行命令前：${command.slice(0, 80)}`)
    return {
      result: await runCommand(options.projectRoot, command),
      toolType: 'command_execution',
      detail: command,
      changes: []
    }
  }

  throw new Error(`未知工具：${toolName}`)
}

export async function runDeepSeekAgent(
  options: DeepSeekAgentOptions
): Promise<void> {
  const completion =
    options.complete ?? createCompletion(options.apiKey, options.model)
  const messages: DeepSeekMessage[] = [
    {
      role: 'system',
      content: [
        'You are the coding agent inside a local desktop IDE.',
        'Work only inside the current project.',
        'Use search_code to find relevant files and symbols before reading large files.',
        'Use tools to inspect relevant files before making claims about code.',
        options.mode === 'read-only'
          ? 'The session is read-only. Do not request write_file or run_command.'
          : 'The session may request write_file and run_command, but each request still requires explicit user approval.',
        'Keep the final response concise and report verification results.'
      ].join(' ')
    },
    { role: 'user', content: options.prompt }
  ]
  let inputTokens = 0
  let outputTokens = 0

  options.emit({ type: 'thread.started', threadId: options.runId })
  options.emit({ type: 'turn.started' })

  for (let round = 0; round < 12; round += 1) {
    if (options.signal.aborted) {
      return
    }
    const response = await completion(messages, options.signal)
    inputTokens += response.usage?.prompt_tokens ?? 0
    outputTokens += response.usage?.completion_tokens ?? 0
    const assistantMessage = response.choices?.[0]?.message
    if (!assistantMessage) {
      throw new Error('DeepSeek 返回了空响应。')
    }
    messages.push(assistantMessage)

    if (assistantMessage.content?.trim()) {
      options.emit({
        type: 'item.completed',
        item: {
          id: `message-${round}`,
          type: 'agent_message',
          text: assistantMessage.content
        }
      })
    }

    const toolCalls = assistantMessage.tool_calls ?? []
    if (toolCalls.length === 0) {
      options.emit({
        type: 'turn.completed',
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens
        }
      })
      return
    }

    for (const toolCall of toolCalls.slice(0, 8)) {
      if (options.signal.aborted) {
        return
      }
      options.emit({
        type: 'item.started',
        item: {
          id: toolCall.id,
          type: 'mcp_tool_call',
          text: toolCall.function.name,
          status: 'running'
        }
      })
      try {
        const toolResult = await executeTool(options, toolCall)
        options.emit({
          type: 'item.completed',
          item: {
            id: toolCall.id,
            type: toolResult.toolType,
            text: toolResult.detail,
            status: 'completed',
            changes: toolResult.changes
          }
        })
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncateAgentOutput(toolResult.result)
        })
      } catch (toolError) {
        const message =
          toolError instanceof Error ? toolError.message : '工具执行失败。'
        options.emit({
          type: 'item.completed',
          item: {
            id: toolCall.id,
            type: 'mcp_tool_call',
            text: `${toolCall.function.name}: ${message}`,
            status: 'failed'
          }
        })
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: message })
        })
      }
    }
  }

  throw new Error('Agent 工具调用超过最大轮数。')
}
