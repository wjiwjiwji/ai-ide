import { describe, expect, it } from 'vitest'
import type {
  CheckpointDiff,
  ProjectWorkflow,
  WorkflowStepResult
} from '../../shared/desktop'
import {
  evaluateWorkflowAcceptance,
  normalizeAcceptanceRules,
  normalizeWorkflowDefinition
} from './workflow'

const baseWorkflow: ProjectWorkflow = {
  id: 'workflow-1',
  name: '  Validation  ',
  steps: [
    {
      id: 'step-1',
      kind: 'command',
      label: '  Test  ',
      command: '  npm test  ',
      continueOnError: false
    }
  ],
  acceptance: {
    requireAllStepsSuccess: true,
    requireDiagnosticsPass: false,
    maxChangedFiles: 10,
    maxChangedLines: 100
  },
  updatedAt: new Date(0).toISOString()
}

const successStep: WorkflowStepResult = {
  stepId: 'step-1',
  label: 'Test',
  kind: 'command',
  status: 'success',
  exitCode: 0,
  output: 'ok'
}

const changes: CheckpointDiff = {
  checkpointId: 'checkpoint-1',
  label: 'before',
  createdAt: new Date(0).toISOString(),
  files: [
    {
      path: 'src/app.ts',
      status: 'modified',
      addedLines: 12,
      deletedLines: 3,
      isBinary: false
    }
  ],
  addedFiles: 0,
  modifiedFiles: 1,
  deletedFiles: 0,
  addedLines: 12,
  deletedLines: 3
}

describe('workflow core', () => {
  it('applies defaults and clamps acceptance limits', () => {
    expect(normalizeAcceptanceRules()).toMatchObject({
      requireAllStepsSuccess: true,
      requireDiagnosticsPass: false,
      maxChangedFiles: 20,
      maxChangedLines: 500
    })
    expect(
      normalizeAcceptanceRules({
        maxChangedFiles: -5,
        maxChangedLines: 9_000_000
      })
    ).toMatchObject({
      maxChangedFiles: 0,
      maxChangedLines: 1_000_000
    })
  })

  it('normalizes workflow values and generates stable IDs', () => {
    const normalized = normalizeWorkflowDefinition(
      baseWorkflow,
      () => 'generated-id'
    )
    expect(normalized.name).toBe('Validation')
    expect(normalized.steps[0]).toMatchObject({
      label: 'Test',
      command: 'npm test'
    })
    expect(normalized.id).toBe('workflow-1')
  })

  it('rejects command steps without a command', () => {
    expect(() =>
      normalizeWorkflowDefinition({
        ...baseWorkflow,
        steps: [
          {
            id: 'bad',
            kind: 'command',
            label: 'Empty',
            command: '   ',
            continueOnError: false
          }
        ]
      })
    ).toThrow('缺少有效命令')
  })

  it('accepts successful workflows below change limits', () => {
    expect(
      evaluateWorkflowAcceptance({
        rules: baseWorkflow.acceptance,
        configuredSteps: baseWorkflow.steps,
        stepResults: [successStep],
        changes: { ...changes, addedLines: 4, deletedLines: 1 },
        hasAgentPrompt: false
      })
    ).toMatchObject({
      decision: 'accepted',
      reasons: []
    })
  })

  it('requests review when change thresholds are exceeded', () => {
    const acceptance = evaluateWorkflowAcceptance({
      rules: {
        ...baseWorkflow.acceptance,
        maxChangedFiles: 0,
        maxChangedLines: 10
      },
      configuredSteps: baseWorkflow.steps,
      stepResults: [successStep],
      changes,
      hasAgentPrompt: false
    })
    expect(acceptance.decision).toBe('needs_review')
    expect(acceptance.reasons).toHaveLength(2)
  })

  it('blocks failed steps and missing required diagnostics', () => {
    const failedStep = {
      ...successStep,
      status: 'failed' as const,
      exitCode: 1
    }
    const acceptance = evaluateWorkflowAcceptance({
      rules: {
        ...baseWorkflow.acceptance,
        requireDiagnosticsPass: true
      },
      configuredSteps: baseWorkflow.steps,
      stepResults: [failedStep],
      changes: null,
      hasAgentPrompt: true
    })
    expect(acceptance.decision).toBe('blocked')
    expect(acceptance.reasons).toEqual([
      '有 1 个工作流步骤失败',
      '验收规则要求运行诊断，但工作流没有诊断步骤'
    ])
  })
})
