import { randomUUID } from 'node:crypto'
import type {
  CheckpointDiff,
  ProjectWorkflow,
  WorkflowAcceptanceResult,
  WorkflowAcceptanceRules,
  WorkflowStep,
  WorkflowStepResult
} from '../../shared/desktop'

export function normalizeAcceptanceRules(
  rules?: Partial<WorkflowAcceptanceRules>
): WorkflowAcceptanceRules {
  return {
    requireAllStepsSuccess: rules?.requireAllStepsSuccess !== false,
    requireDiagnosticsPass: rules?.requireDiagnosticsPass === true,
    maxChangedFiles:
      typeof rules?.maxChangedFiles === 'number'
        ? Math.min(5000, Math.max(0, Math.round(rules.maxChangedFiles)))
        : 20,
    maxChangedLines:
      typeof rules?.maxChangedLines === 'number'
        ? Math.min(1_000_000, Math.max(0, Math.round(rules.maxChangedLines)))
        : 500
  }
}

export function normalizeWorkflowDefinition(
  workflow: ProjectWorkflow,
  createId: () => string = randomUUID
): ProjectWorkflow {
  if (!workflow || typeof workflow !== 'object') {
    throw new Error('工作流定义无效。')
  }
  const name = typeof workflow.name === 'string' ? workflow.name.trim() : ''
  if (!name || name.length > 120) {
    throw new Error('工作流名称无效。')
  }
  if (!Array.isArray(workflow.steps) || workflow.steps.length > 20) {
    throw new Error('工作流步骤数量无效。')
  }

  const steps = workflow.steps.map((step, index) => {
    if (
      !step ||
      !['command', 'diagnostics', 'agent'].includes(step.kind)
    ) {
      throw new Error(`工作流第 ${index + 1} 步类型无效。`)
    }
    const label =
      typeof step.label === 'string' && step.label.trim()
        ? step.label.trim().slice(0, 120)
        : `步骤 ${index + 1}`
    if (step.kind === 'command') {
      if (
        typeof step.command !== 'string' ||
        !step.command.trim() ||
        step.command.length > 4000
      ) {
        throw new Error(`工作流“${label}”缺少有效命令。`)
      }
    }
    if (
      step.kind === 'agent' &&
      step.prompt !== undefined &&
      (typeof step.prompt !== 'string' || step.prompt.length > 10_000)
    ) {
      throw new Error(`工作流“${label}”的 Agent 提示词无效。`)
    }
    return {
      id:
        typeof step.id === 'string' && step.id
          ? step.id.slice(0, 100)
          : createId(),
      kind: step.kind,
      label,
      command: step.command?.trim(),
      prompt: step.prompt?.trim(),
      continueOnError: Boolean(step.continueOnError)
    }
  })

  return {
    id:
      typeof workflow.id === 'string' && workflow.id
        ? workflow.id.slice(0, 100)
        : createId(),
    name,
    steps,
    acceptance: normalizeAcceptanceRules(workflow.acceptance),
    updatedAt: new Date().toISOString()
  }
}

export function evaluateWorkflowAcceptance(input: {
  rules: WorkflowAcceptanceRules
  configuredSteps: WorkflowStep[]
  stepResults: WorkflowStepResult[]
  changes: CheckpointDiff | null
  hasAgentPrompt: boolean
}): WorkflowAcceptanceResult {
  const reasons: string[] = []
  const failedStepCount = input.stepResults.filter(
    (step) => step.status === 'failed'
  ).length
  const hasDiagnosticsStep = input.configuredSteps.some(
    (step) => step.kind === 'diagnostics'
  )
  const diagnosticsFailed = input.stepResults.some(
    (step) => step.kind === 'diagnostics' && step.status === 'failed'
  )

  if (input.rules.requireAllStepsSuccess && failedStepCount > 0) {
    reasons.push(`有 ${failedStepCount} 个工作流步骤失败`)
  }
  if (
    input.rules.requireDiagnosticsPass &&
    (!hasDiagnosticsStep || diagnosticsFailed)
  ) {
    reasons.push(
      !hasDiagnosticsStep
        ? '验收规则要求运行诊断，但工作流没有诊断步骤'
        : '项目诊断未通过'
    )
  }
  if (
    input.changes &&
    input.changes.files.length > input.rules.maxChangedFiles
  ) {
    reasons.push(
      `变更文件数 ${input.changes.files.length} 超过上限 ${input.rules.maxChangedFiles}`
    )
  }

  const totalChangedLines = input.changes
    ? input.changes.addedLines + input.changes.deletedLines
    : 0
  if (totalChangedLines > input.rules.maxChangedLines) {
    reasons.push(
      `代码变化行数 ${totalChangedLines} 超过上限 ${input.rules.maxChangedLines}`
    )
  }

  const blockingFailure =
    input.rules.requireAllStepsSuccess && failedStepCount > 0
  const blockingDiagnostics =
    input.rules.requireDiagnosticsPass &&
    (!hasDiagnosticsStep || diagnosticsFailed)
  const thresholdExceeded = Boolean(
    input.changes &&
      (input.changes.files.length > input.rules.maxChangedFiles ||
        totalChangedLines > input.rules.maxChangedLines)
  )

  return {
    decision:
      blockingFailure || blockingDiagnostics
        ? 'blocked'
        : thresholdExceeded || input.hasAgentPrompt
          ? 'needs_review'
          : 'accepted',
    reasons,
    rules: input.rules
  }
}
