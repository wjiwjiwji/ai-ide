import { useEffect, useState } from 'react'
import type {
  ProjectWorkflow,
  WorkflowRunResult,
  WorkflowRunSummary,
  WorkflowStep,
  WorkflowStepKind,
  WorkflowTemplate
} from '../../../shared/desktop'

interface WorkflowModalProps {
  onClose: () => void
  onRunCompleted: (result: WorkflowRunResult) => void
}

function createStep(kind: WorkflowStepKind): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    kind,
    label:
      kind === 'command'
        ? '运行命令'
        : kind === 'diagnostics'
          ? '项目诊断'
          : 'Agent 修复',
    command: kind === 'command' ? '' : undefined,
    prompt:
      kind === 'agent'
        ? 'Review the workflow results, fix failed steps, and verify the project.'
        : undefined,
    continueOnError: kind === 'diagnostics'
  }
}

function createWorkflow(
  template: 'blank' | 'node' | 'python' | 'generic' = 'blank'
): ProjectWorkflow {
  const steps =
    template === 'node'
      ? [
        {
          ...createStep('command'),
          label: '格式化',
          command: 'npm run format --if-present',
          continueOnError: true
        },
        {
          ...createStep('diagnostics'),
          label: '项目诊断',
          continueOnError: true
        },
        {
          ...createStep('command'),
          label: '运行测试',
          command: 'npm test --if-present',
          continueOnError: true
        },
        {
          ...createStep('agent'),
          label: 'Agent 修复',
          prompt:
            'Review the workflow results, fix failed formatting, diagnostics, or tests, and verify the result.'
        }
      ]
      : template === 'python'
        ? [
            {
              ...createStep('command'),
              label: '语法检查',
              command: 'python -m compileall .',
              continueOnError: true
            },
            {
              ...createStep('command'),
              label: '运行测试',
              command: 'python -m pytest -q',
              continueOnError: true
            },
            {
              ...createStep('agent'),
              label: 'Agent 修复',
              prompt:
                'Review the workflow results, fix failing Python checks or tests, and verify the result.'
            }
          ]
        : template === 'generic'
          ? [
              {
                ...createStep('command'),
                label: '构建',
                command: '',
                continueOnError: true
              },
              {
                ...createStep('diagnostics'),
                label: '项目诊断',
                continueOnError: true
              },
              {
                ...createStep('agent'),
                label: 'Agent 修复',
                prompt:
                  'Review the workflow results, fix failed steps, and verify the project.'
              }
            ]
          : [createStep('command')]

  return {
    id: crypto.randomUUID(),
    name:
      template === 'node'
        ? 'Node / TypeScript 验证与修复'
        : template === 'python'
          ? 'Python 检查、测试与修复'
          : template === 'generic'
            ? '通用构建与修复'
            : '新工作流',
    steps,
    acceptance: {
      requireAllStepsSuccess: true,
      requireDiagnosticsPass: template === 'node' || template === 'generic',
      maxChangedFiles: template === 'python' ? 30 : 20,
      maxChangedLines: template === 'python' ? 800 : 500
    },
    updatedAt: new Date().toISOString()
  }
}

function WorkflowModal({
  onClose,
  onRunCompleted
}: WorkflowModalProps): React.JSX.Element {
  const [workflows, setWorkflows] = useState<ProjectWorkflow[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([])
  const [sidebarMode, setSidebarMode] = useState<
    'workflows' | 'templates' | 'history'
  >('workflows')
  const [draft, setDraft] = useState<ProjectWorkflow | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [result, setResult] = useState<WorkflowRunResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!window.desktop) {
      return
    }
    void Promise.all([
      window.desktop.getProjectWorkflows(),
      window.desktop.listWorkflowTemplates(),
      window.desktop.listWorkflowRuns()
    ])
      .then(([projectWorkflows, workflowTemplates, workflowRuns]) => {
        setWorkflows(projectWorkflows)
        setTemplates(workflowTemplates)
        setRuns(workflowRuns)
        setDraft(projectWorkflows[0] ?? null)
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : '无法读取工作流。'
        )
      })
      .finally(() => setLoading(false))
  }, [])

  const saveDraft = async (): Promise<ProjectWorkflow | null> => {
    if (!draft || !window.desktop) {
      return null
    }
    setSaving(true)
    setError('')
    try {
      const nextWorkflows = [
        draft,
        ...workflows.filter((workflow) => workflow.id !== draft.id)
      ]
      const saved = await window.desktop.saveProjectWorkflows(nextWorkflows)
      setWorkflows(saved)
      const savedDraft = saved.find((workflow) => workflow.id === draft.id)
      if (savedDraft) {
        setDraft(savedDraft)
      }
      return savedDraft ?? null
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : '无法保存工作流。'
      )
      return null
    } finally {
      setSaving(false)
    }
  }

  const saveAsTemplate = async (): Promise<void> => {
    if (!draft || !window.desktop) {
      return
    }
    const now = new Date().toISOString()
    try {
      const nextTemplates = await window.desktop.saveWorkflowTemplate({
        id: crypto.randomUUID(),
        name: draft.name,
        steps: draft.steps.map((step) => ({ ...step })),
        acceptance: { ...draft.acceptance },
        createdAt: now,
        updatedAt: now
      })
      setTemplates(nextTemplates)
      setSidebarMode('templates')
      setError('')
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : '无法保存全局模板。'
      )
    }
  }

  const useGlobalTemplate = (template: WorkflowTemplate): void => {
    setDraft({
      id: crypto.randomUUID(),
      name: template.name,
      steps: template.steps.map((step) => ({
        ...step,
        id: crypto.randomUUID()
      })),
      acceptance: { ...template.acceptance },
      updatedAt: new Date().toISOString()
    })
    setResult(null)
    setSidebarMode('workflows')
  }

  const removeGlobalTemplate = async (
    templateId: string
  ): Promise<void> => {
    if (
      !window.desktop ||
      !window.confirm('删除这个全局工作流模板？')
    ) {
      return
    }
    setTemplates(await window.desktop.deleteWorkflowTemplate(templateId))
  }

  const openHistoryRun = async (runId: string): Promise<void> => {
    if (!window.desktop) {
      return
    }
    const record = await window.desktop.getWorkflowRun(runId)
    if (record) {
      setDraft(null)
      setResult(record.result)
      setSidebarMode('history')
    }
  }

  const runWorkflow = async (workflow: ProjectWorkflow): Promise<void> => {
    if (!window.desktop) {
      return
    }

    const commands = workflow.steps
      .filter((step) => step.kind === 'command' && step.command)
      .map((step) => `• ${step.label}: ${step.command}`)
    if (
      !window.confirm(
        [
          `运行工作流“${workflow.name}”？`,
          '',
          ...commands,
          workflow.steps.some((step) => step.kind === 'diagnostics')
            ? '• 运行项目诊断'
            : '',
          workflow.steps.some((step) => step.kind === 'agent')
            ? '• 准备 Agent 修复任务'
            : ''
        ]
          .filter(Boolean)
          .join('\n')
      )
    ) {
      return
    }

    setRunningId(workflow.id)
    setResult(null)
    setError('')
    try {
      const nextResult = await window.desktop.runProjectWorkflow(workflow.id)
      setResult(nextResult)
      setRuns(await window.desktop.listWorkflowRuns())
      onRunCompleted(nextResult)
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : '工作流执行失败。'
      )
    } finally {
      setRunningId(null)
    }
  }

  const updateStep = (
    stepId: string,
    patch: Partial<WorkflowStep>
  ): void => {
    setDraft((current) =>
      current
        ? {
            ...current,
            steps: current.steps.map((step) =>
              step.id === stepId ? { ...step, ...patch } : step
            )
          }
        : current
    )
  }

  const moveStep = (index: number, direction: -1 | 1): void => {
    setDraft((current) => {
      if (!current) {
        return current
      }
      const target = index + direction
      if (target < 0 || target >= current.steps.length) {
        return current
      }
      const steps = [...current.steps]
      ;[steps[index], steps[target]] = [steps[target], steps[index]]
      return { ...current, steps }
    })
  }

  return (
    <div
      className="workflow-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="workflow-modal"
        role="dialog"
        aria-modal="true"
        aria-label="项目工作流"
      >
        <header className="workflow-modal-header">
          <div>
            <span className="eyebrow">项目自动化</span>
            <h2>项目工作流</h2>
          </div>
          <div className="workflow-header-actions">
            <select
              className="workflow-template-select"
              value=""
              onChange={(event) => {
                const template = event.target.value as
                  | 'node'
                  | 'python'
                  | 'generic'
                if (template) {
                  setDraft(createWorkflow(template))
                }
                event.target.value = ''
              }}
            >
              <option value="">项目模板</option>
              <option value="node">Node / TypeScript</option>
              <option value="python">Python</option>
              <option value="generic">通用项目</option>
            </select>
            <button type="button" onClick={() => setDraft(createWorkflow('blank'))}>
              新建
            </button>
            <button className="workflow-close" type="button" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <div className="workflow-body">
          <aside className="workflow-list">
            <div className="workflow-sidebar-tabs">
              <button
                className={sidebarMode === 'workflows' ? 'active' : ''}
                type="button"
                onClick={() => setSidebarMode('workflows')}
              >
                项目
              </button>
              <button
                className={sidebarMode === 'templates' ? 'active' : ''}
                type="button"
                onClick={() => setSidebarMode('templates')}
              >
                模板
              </button>
              <button
                className={sidebarMode === 'history' ? 'active' : ''}
                type="button"
                onClick={() => setSidebarMode('history')}
              >
                历史
              </button>
            </div>

            {loading ? (
              <p>正在读取工作流…</p>
            ) : sidebarMode === 'workflows' ? (
              workflows.length ? (
                workflows.map((workflow) => (
                  <div
                    className={`workflow-list-item ${
                      draft?.id === workflow.id ? 'active' : ''
                    }`}
                    key={workflow.id}
                  >
                    <button
                      className="workflow-select"
                      type="button"
                      onClick={() => {
                        setDraft(workflow)
                        setResult(null)
                      }}
                    >
                      <strong>{workflow.name}</strong>
                      <small>{workflow.steps.length} 个步骤</small>
                    </button>
                    <button
                      className="workflow-run-small"
                      type="button"
                      disabled={Boolean(runningId)}
                      onClick={() => void runWorkflow(workflow)}
                    >
                      {runningId === workflow.id ? '…' : '▶'}
                    </button>
                  </div>
                ))
              ) : (
                <p>还没有项目工作流。创建新工作流或使用全局模板。</p>
              )
            ) : sidebarMode === 'templates' ? (
              templates.length ? (
                templates.map((template) => (
                  <div className="workflow-list-item" key={template.id}>
                    <button
                      className="workflow-select"
                      type="button"
                      onClick={() => useGlobalTemplate(template)}
                    >
                      <strong>{template.name}</strong>
                      <small>
                        {template.steps.length} 个步骤 · 全局模板
                      </small>
                    </button>
                    <button
                      className="workflow-delete-small"
                      type="button"
                      title="删除全局模板"
                      onClick={() => void removeGlobalTemplate(template.id)}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p>还没有全局模板。打开工作流后点击“存为模板”。</p>
              )
            ) : runs.length ? (
              runs.map((run) => (
                <button
                  className="workflow-history-item"
                  type="button"
                  key={run.id}
                  onClick={() => void openHistoryRun(run.id)}
                >
                  <span
                    className={`workflow-history-decision ${run.acceptance}`}
                  >
                    {run.acceptance}
                  </span>
                  <span>
                    <strong>{run.workflowName}</strong>
                    <small>
                      {new Date(run.createdAt).toLocaleString()}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p>还没有工作流运行记录。</p>
            )}
          </aside>

          <main className="workflow-editor">
            {draft ? (
              <>
                <label className="workflow-name-field">
                  <span>名称</span>
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </label>

                <div className="workflow-steps">
                  {draft.steps.map((step, index) => (
                    <article className="workflow-step" key={step.id}>
                      <div className="workflow-step-heading">
                        <span className="workflow-step-index">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <input
                          value={step.label}
                          onChange={(event) =>
                            updateStep(step.id, { label: event.target.value })
                          }
                        />
                        <span className="workflow-step-kind">{step.kind}</span>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveStep(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === draft.steps.length - 1}
                          onClick={() => moveStep(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              steps: draft.steps.filter(
                                (item) => item.id !== step.id
                              )
                            })
                          }
                        >
                          ×
                        </button>
                      </div>

                      {step.kind === 'command' ? (
                        <input
                          className="workflow-command-input"
                          value={step.command ?? ''}
                          placeholder="例如 npm test"
                          spellCheck={false}
                          onChange={(event) =>
                            updateStep(step.id, {
                              command: event.target.value
                            })
                          }
                        />
                      ) : step.kind === 'agent' ? (
                        <textarea
                          className="workflow-agent-prompt"
                          value={step.prompt ?? ''}
                          rows={3}
                          placeholder="失败后交给 Agent 的修复提示词"
                          onChange={(event) =>
                            updateStep(step.id, {
                              prompt: event.target.value
                            })
                          }
                        />
                      ) : (
                        <p className="workflow-step-description">
                          运行当前项目的诊断命令并收集错误和警告。
                        </p>
                      )}

                      <label className="workflow-continue">
                        <input
                          type="checkbox"
                          checked={step.continueOnError}
                          onChange={(event) =>
                            updateStep(step.id, {
                              continueOnError: event.target.checked
                            })
                          }
                        />
                        失败后继续下一步
                      </label>
                    </article>
                  ))}
                </div>

                <div className="workflow-add-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: [...draft.steps, createStep('command')]
                      })
                    }
                  >
                    + 命令
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: [...draft.steps, createStep('diagnostics')]
                      })
                    }
                  >
                    + 诊断
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: [...draft.steps, createStep('agent')]
                      })
                    }
                  >
                    + Agent
                  </button>
                </div>

                <div className="workflow-acceptance-rules">
                  <div className="workflow-acceptance-heading">
                    <strong>验收规则</strong>
                    <span>用于自动判断是否允许通过</span>
                  </div>
                  <div className="workflow-rule-grid">
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.acceptance.requireAllStepsSuccess}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            acceptance: {
                              ...draft.acceptance,
                              requireAllStepsSuccess: event.target.checked
                            }
                          })
                        }
                      />
                      所有步骤必须成功
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.acceptance.requireDiagnosticsPass}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            acceptance: {
                              ...draft.acceptance,
                              requireDiagnosticsPass: event.target.checked
                            }
                          })
                        }
                      />
                      项目诊断必须通过
                    </label>
                    <label>
                      最大变更文件
                      <input
                        type="number"
                        min="0"
                        max="5000"
                        value={draft.acceptance.maxChangedFiles}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            acceptance: {
                              ...draft.acceptance,
                              maxChangedFiles: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </label>
                    <label>
                      最大变化行数
                      <input
                        type="number"
                        min="0"
                        max="1000000"
                        value={draft.acceptance.maxChangedLines}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            acceptance: {
                              ...draft.acceptance,
                              maxChangedLines: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </label>
                  </div>
                </div>

                <div className="workflow-save-row">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveAsTemplate()}
                  >
                    存为全局模板
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveDraft()}
                  >
                    {saving ? '保存中' : '保存工作流'}
                  </button>
                  <button
                    className="workflow-run-button"
                    type="button"
                    disabled={Boolean(runningId)}
                    onClick={async () => {
                      const savedWorkflow = await saveDraft()
                      if (savedWorkflow) {
                        await runWorkflow(savedWorkflow)
                      }
                    }}
                  >
                    {runningId ? '执行中…' : '保存并运行'}
                  </button>
                </div>
              </>
            ) : (
              <div className="workflow-editor-empty">
                选择工作流，或创建一个新的自动化流程。
              </div>
            )}

            {error ? <div className="workflow-error">{error}</div> : null}

            {result ? (
              <div className="workflow-result">
                <div className="workflow-result-heading">
                  <strong>{result.workflowName}</strong>
                  <div>
                    <span className={result.status}>{result.status}</span>
                    <span
                      className={`acceptance ${result.acceptance.decision}`}
                    >
                      {result.acceptance.decision}
                    </span>
                  </div>
                </div>
                <pre className="workflow-result-report">{result.report}</pre>
                {result.acceptance.reasons.length ? (
                  <div className="workflow-acceptance-reasons">
                    {result.acceptance.reasons.map((reason) => (
                      <span key={reason}>{reason}</span>
                    ))}
                  </div>
                ) : null}
                {result.changes?.files.length ? (
                  <div className="workflow-change-list">
                    {result.changes.files.map((file) => (
                      <div key={file.path}>
                        <span className={`status ${file.status}`}>
                          {file.status}
                        </span>
                        <strong>{file.path}</strong>
                        <small>
                          +{file.addedLines} / −{file.deletedLines}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : null}
                {result.steps.map((step) => (
                  <details className={`workflow-result-step ${step.status}`} key={step.stepId}>
                    <summary>
                      <span>{step.status}</span>
                      {step.label}
                    </summary>
                    <pre>{step.output || '没有输出。'}</pre>
                  </details>
                ))}
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  )
}

export default WorkflowModal
