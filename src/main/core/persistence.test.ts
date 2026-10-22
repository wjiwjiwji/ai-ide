import {
  mkdtemp,
  rm
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './persistence'

const temporaryDirectories: string[] = []
const databases: AppDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close()
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function createDatabase(): Promise<AppDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-ide-db-'))
  temporaryDirectories.push(directory)
  const database = new AppDatabase(join(directory, 'test.sqlite'))
  databases.push(database)
  return database
}

const project = {
  id: 'project-1',
  path: 'E:\\Workspace\\project-1'
}

describe('task and checkpoint persistence', () => {
  it('saves, updates and lists tasks without changing creation time', async () => {
    const database = await createDatabase()
    const created = database.tasks.save(project, {
      id: 'task-1',
      title: 'First task',
      provider: 'deepseek',
      mode: 'read-only',
      status: 'active',
      entries: [{ id: 'm1', kind: 'user', text: 'Hello' }],
      threadId: null,
      usageText: ''
    })
    await new Promise((resolve) => setTimeout(resolve, 2))
    const updated = database.tasks.save(project, {
      id: 'task-1',
      title: 'Updated task',
      provider: 'deepseek',
      mode: 'workspace-write',
      status: 'completed',
      entries: [{ id: 'm2', kind: 'assistant', text: 'Done' }],
      threadId: 'thread-1',
      usageText: '10 tokens'
    })

    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.status).toBe('completed')
    expect(database.tasks.list(project.id)).toHaveLength(1)
    expect(database.tasks.get('task-1', project.id)).toMatchObject({
      title: 'Updated task',
      threadId: 'thread-1',
      usageText: '10 tokens',
      entries: [{ id: 'm2', kind: 'assistant', text: 'Done' }]
    })
  })

  it('isolates tasks by project and rejects cross-project updates', async () => {
    const database = await createDatabase()
    database.tasks.save(project, {
      id: 'task-1',
      title: 'Task',
      provider: 'deepseek',
      mode: 'read-only',
      status: 'completed',
      entries: [],
      threadId: null,
      usageText: ''
    })

    expect(database.tasks.list('project-2')).toEqual([])
    expect(database.tasks.get('task-1', 'project-2')).toBeNull()
    expect(() =>
      database.tasks.save(
        { id: 'project-2', path: 'E:\\Workspace\\project-2' },
        {
          id: 'task-1',
          title: 'Conflict',
          provider: 'deepseek',
          mode: 'read-only',
          status: 'failed',
          entries: [],
          threadId: null,
          usageText: ''
        }
      )
    ).toThrow('任务属于其他项目')
  })

  it('stores checkpoints and marks them restored', async () => {
    const database = await createDatabase()
    database.tasks.save(project, {
      id: 'task-1',
      title: 'Task',
      provider: 'deepseek',
      mode: 'workspace-write',
      status: 'active',
      entries: [],
      threadId: null,
      usageText: ''
    })
    database.checkpoints.insert({
      id: 'checkpoint-1',
      taskId: 'task-1',
      projectPath: project.path,
      label: 'Before write',
      snapshotDir: 'C:\\snapshots\\checkpoint-1',
      createdAt: new Date(0).toISOString()
    })
    database.checkpoints.markRestored('checkpoint-1')

    expect(database.checkpoints.get('checkpoint-1')).toMatchObject({
      taskId: 'task-1',
      label: 'Before write',
      restoredAt: expect.any(String)
    })
    expect(
      database.checkpoints.list('task-1', project.path)
    ).toHaveLength(1)
  })
})

describe('code index persistence', () => {
  it('replaces changed files and searches paths, symbols and text', async () => {
    const database = await createDatabase()
    database.codeIndex.replace(
      project.id,
      new Set(['src/alpha.ts', 'src/beta.ts']),
      [
        {
          path: 'src/alpha.ts',
          mtimeMs: 100,
          size: 20,
          language: 'typescript',
          content: 'export function AlphaWorker() { return 1 }',
          symbols: [{ name: 'AlphaWorker', kind: 'function', line: 1 }]
        },
        {
          path: 'src/beta.ts',
          mtimeMs: 200,
          size: 18,
          language: 'typescript',
          content: 'export const betaValue = "legacy"',
          symbols: [{ name: 'betaValue', kind: 'variable', line: 1 }]
        }
      ]
    )

    expect(database.codeIndex.getFiles(project.id)).toHaveLength(2)
    expect(database.codeIndex.search(project.id, 'AlphaWorker')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/alpha.ts',
          kind: 'symbol',
          line: 1
        })
      ])
    )

    const counts = database.codeIndex.replace(
      project.id,
      new Set(['src/alpha.ts']),
      [
        {
          path: 'src/alpha.ts',
          mtimeMs: 300,
          size: 24,
          language: 'typescript',
          content: 'export function AlphaWorker() { return 2 }',
          symbols: [{ name: 'AlphaWorker', kind: 'function', line: 1 }]
        }
      ]
    )

    expect(counts).toEqual({ fileCount: 1, symbolCount: 1 })
    expect(database.codeIndex.search(project.id, 'legacy')).toEqual([])
  })
})

describe('workflow persistence', () => {
  it('stores templates and isolates workflow runs by project', async () => {
    const database = await createDatabase()
    const createdAt = new Date(0).toISOString()
    database.workflows.saveTemplate({
      id: 'template-1',
      name: 'Quality gate',
      steps: [
        {
          id: 'step-1',
          kind: 'diagnostics',
          label: 'Type check',
          continueOnError: false
        }
      ],
      acceptance: {
        requireAllStepsSuccess: true,
        requireDiagnosticsPass: true,
        maxChangedFiles: 20,
        maxChangedLines: 500
      },
      createdAt,
      updatedAt: createdAt
    })

    expect(database.workflows.listTemplates()).toMatchObject([
      { id: 'template-1', name: 'Quality gate' }
    ])

    const result = {
      runId: 'run-1',
      taskId: 'task-1',
      checkpointId: null,
      workflowId: 'workflow-1',
      workflowName: 'Quality gate',
      status: 'completed' as const,
      steps: [],
      agentPrompt: null,
      changes: null,
      report: 'Passed',
      acceptance: {
        decision: 'accepted' as const,
        reasons: [],
        rules: {
          requireAllStepsSuccess: true,
          requireDiagnosticsPass: true,
          maxChangedFiles: 20,
          maxChangedLines: 500
        }
      },
      updatedAt: createdAt
    }
    database.workflows.saveRun(project.id, result)

    expect(database.workflows.listRuns(project.id)).toMatchObject([
      { id: 'run-1', status: 'completed', acceptance: 'accepted' }
    ])
    expect(database.workflows.getRun(project.id, 'run-1')).toMatchObject({
      id: 'run-1',
      result: { report: 'Passed' }
    })
    expect(database.workflows.getRun('project-2', 'run-1')).toBeNull()
    expect(database.workflows.deleteTemplate('template-1')).toEqual([])
  })
})
