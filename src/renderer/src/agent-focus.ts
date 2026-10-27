export interface AgentEditorFocus {
  path: string
  dirty: boolean
  content: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  selectedText: string
}

export interface AgentPromptFocus {
  request: string
  history: string[]
  contextFiles: string[]
  workspaceFocus: AgentEditorFocus | null
  openFilePaths: string[]
  changedFilePaths: string[]
  diagnosticFilePaths: string[]
}

export type EditorAgentIntent = 'ask' | 'explain' | 'modify'

export interface EditorAgentPromptInput {
  intent: EditorAgentIntent
  path: string
  startLine: number
  startColumn: number
  endLine: number
  selectedText: string
}

export function buildEditorAgentPrompt(
  input: EditorAgentPromptInput
): string {
  const hasSelection = Boolean(input.selectedText.trim())
  const location =
    hasSelection && input.startLine !== input.endLine
      ? `${input.path}:${input.startLine}-${input.endLine}`
      : `${input.path}:${input.startLine}:${input.startColumn}`
  if (!hasSelection) {
    return `请检查当前项目中的文件“${input.path}”，重点分析 ${location} 附近的实现、调用关系、潜在问题和改进空间。先给出有依据的建议，不要直接修改文件。`
  }
  const instruction =
    input.intent === 'modify'
      ? `请为以下所选代码（${location}）设计最小、安全的修改方案，并说明验证方式。先不要直接修改文件。`
      : input.intent === 'explain'
        ? `请解释以下所选代码（${location}）的作用、调用关系、边界条件和潜在问题。`
        : `请结合以下所选代码（${location}）分析当前实现，说明它解决的问题、调用关系和潜在风险。`
  return [
    instruction,
    '',
    '```',
    input.selectedText.slice(0, 6_000),
    '```'
  ].join('\n')
}

export function buildAgentPrompt(input: AgentPromptFocus): string {
  const selectedCodeSample =
    input.workspaceFocus?.selectedText.trim().slice(0, 500) ?? ''
  const selectionAlreadyInRequest =
    Boolean(selectedCodeSample) && input.request.includes(selectedCodeSample)
  const workspaceLines = [
    'Project access scope: the entire current project.',
    input.workspaceFocus
      ? `Active editor: ${input.workspaceFocus.path} at ${input.workspaceFocus.startLine}:${input.workspaceFocus.startColumn}`
      : null,
    input.workspaceFocus?.selectedText.trim() && !selectionAlreadyInRequest
      ? [
          `Selected range: ${input.workspaceFocus.startLine}:${input.workspaceFocus.startColumn}-${input.workspaceFocus.endLine}:${input.workspaceFocus.endColumn}`,
          '<selected_code>',
          input.workspaceFocus.selectedText.slice(0, 8_000),
          '</selected_code>'
        ].join('\n')
      : null,
    input.workspaceFocus?.dirty
      ? [
          'The active editor has unsaved changes. Current buffer excerpt:',
          '<unsaved_buffer>',
          input.workspaceFocus.content.slice(0, 16_000),
          '</unsaved_buffer>'
        ].join('\n')
      : null,
    input.openFilePaths.length
      ? `Open editor files: ${input.openFilePaths.slice(0, 20).join(', ')}`
      : null,
    input.changedFilePaths.length
      ? `Git changed files: ${input.changedFilePaths.slice(0, 20).join(', ')}`
      : null,
    input.diagnosticFilePaths.length
      ? `Files with current diagnostics: ${input.diagnosticFilePaths.slice(0, 20).join(', ')}`
      : null
  ].filter((line): line is string => Boolean(line))

  if (
    input.history.length === 0 &&
    input.contextFiles.length === 0 &&
    workspaceLines.length === 1
  ) {
    return input.request
  }

  return [
    'Continue this AI IDE task in the current project.',
    '',
    'Workspace focus provided automatically by the IDE:',
    ...workspaceLines.map((line) =>
      line.startsWith('- ') ? line : `- ${line}`
    ),
    ...(input.contextFiles.length
      ? [
          '',
          'Optional files pinned by the user:',
          ...input.contextFiles.map((path) => `- ${path}`)
        ]
      : []),
    '',
    'Previous conversation:',
    ...input.history,
    '',
    'Current request:',
    input.request
  ].join('\n')
}
