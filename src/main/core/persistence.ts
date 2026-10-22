import { DatabaseSync } from 'node:sqlite'
import type {
  AgentCheckpointInfo,
  AgentTaskRecord,
  AgentTaskSaveInput,
  AgentTaskSummary,
  CodeSearchResult,
  WorkflowRunRecord,
  WorkflowRunResult,
  WorkflowRunSummary,
  WorkflowTemplate,
  ProjectInfo
} from '../../shared/desktop'

interface ProjectKey {
  id: string
  path: string
}

interface CheckpointInsert {
  id: string
  taskId: string
  projectPath: string
  label: string
  snapshotDir: string
  createdAt: string
}

export interface StoredCheckpoint {
  id: string
  taskId: string
  projectPath: string
  label: string
  snapshotDir: string
  createdAt: string
  restoredAt: string | null
}

export interface StoredCodeFile {
  path: string
  mtimeMs: number
  size: number
}

export interface CodeIndexUpdate {
  path: string
  mtimeMs: number
  size: number
  language: string
  content: string
  symbols: Array<{ name: string; kind: string; line: number }>
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T
  } catch {
    return fallback
  }
}

function taskSummaryFromRow(row: Record<string, unknown>): AgentTaskSummary {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    provider: row.provider === 'codex' ? 'codex' : 'deepseek',
    mode:
      row.mode === 'workspace-write' ? 'workspace-write' : 'read-only',
    status:
      row.status === 'completed' ||
      row.status === 'failed' ||
      row.status === 'cancelled'
        ? row.status
        : 'active',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

export class TaskRepository {
  constructor(private readonly database: DatabaseSync) {}

  save(project: ProjectKey, input: AgentTaskSaveInput): AgentTaskSummary {
    const title = input.title.trim().slice(0, 200) || '未命名任务'
    const entriesJson = JSON.stringify(input.entries)
    if (Buffer.byteLength(entriesJson, 'utf8') > 8 * 1024 * 1024) {
      throw new Error('任务记录超过 8 MB，无法保存。')
    }

    const existing = this.database
      .prepare('SELECT project_path, created_at FROM agent_tasks WHERE id = ?')
      .get(input.id) as
      | { project_path?: string; created_at?: string }
      | undefined
    if (existing?.project_path && existing.project_path !== project.path) {
      throw new Error('任务属于其他项目，拒绝覆盖。')
    }

    const now = new Date().toISOString()
    const createdAt = existing?.created_at ?? now
    this.database
      .prepare(`
        INSERT INTO agent_tasks (
          id, project_id, project_path, title, provider, mode, status,
          thread_id, usage_text, entries_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          provider = excluded.provider,
          mode = excluded.mode,
          status = excluded.status,
          thread_id = excluded.thread_id,
          usage_text = excluded.usage_text,
          entries_json = excluded.entries_json,
          updated_at = excluded.updated_at
      `)
      .run(
        input.id,
        project.id,
        project.path,
        title,
        input.provider,
        input.mode,
        input.status,
        input.threadId,
        input.usageText.slice(0, 1000),
        entriesJson,
        createdAt,
        now
      )
    return {
      id: input.id,
      projectId: project.id,
      title,
      provider: input.provider,
      mode: input.mode,
      status: input.status,
      createdAt,
      updatedAt: now
    }
  }

  list(projectId: string): AgentTaskSummary[] {
    const rows = this.database
      .prepare(`
        SELECT id, project_id, title, provider, mode, status, created_at, updated_at
        FROM agent_tasks
        WHERE project_id = ?
        ORDER BY updated_at DESC
        LIMIT 30
      `)
      .all(projectId) as Array<Record<string, unknown>>
    return rows.map(taskSummaryFromRow)
  }

  get(taskId: string, projectId: string): AgentTaskRecord | null {
    const row = this.database
      .prepare(`
        SELECT * FROM agent_tasks
        WHERE id = ? AND project_id = ?
      `)
      .get(taskId, projectId) as Record<string, unknown> | undefined
    if (!row) {
      return null
    }
    let entries: AgentTaskRecord['entries'] = []
    try {
      const parsed = JSON.parse(String(row.entries_json)) as unknown
      if (Array.isArray(parsed)) {
        entries = parsed as AgentTaskRecord['entries']
      }
    } catch {
      entries = []
    }
    return {
      ...taskSummaryFromRow(row),
      entries,
      threadId:
        typeof row.thread_id === 'string' ? row.thread_id : null,
      usageText: typeof row.usage_text === 'string' ? row.usage_text : ''
    }
  }

  exists(taskId: string, projectId: string): boolean {
    return Boolean(
      this.database
        .prepare('SELECT 1 FROM agent_tasks WHERE id = ? AND project_id = ?')
        .get(taskId, projectId)
    )
  }
}

export class CheckpointRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(checkpoint: CheckpointInsert): AgentCheckpointInfo {
    this.database
      .prepare(`
        INSERT INTO agent_checkpoints (
          id, task_id, project_path, label, snapshot_dir, created_at, restored_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL)
      `)
      .run(
        checkpoint.id,
        checkpoint.taskId,
        checkpoint.projectPath,
        checkpoint.label,
        checkpoint.snapshotDir,
        checkpoint.createdAt
      )
    return {
      id: checkpoint.id,
      taskId: checkpoint.taskId,
      label: checkpoint.label,
      createdAt: checkpoint.createdAt,
      restoredAt: null
    }
  }

  list(taskId: string, projectPath: string): AgentCheckpointInfo[] {
    const rows = this.database
      .prepare(`
        SELECT id, task_id, label, created_at, restored_at
        FROM agent_checkpoints
        WHERE task_id = ? AND project_path = ?
        ORDER BY created_at DESC
      `)
      .all(taskId, projectPath) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      label: String(row.label),
      createdAt: String(row.created_at),
      restoredAt:
        typeof row.restored_at === 'string' ? row.restored_at : null
    }))
  }

  get(checkpointId: string): StoredCheckpoint | null {
    const row = this.database
      .prepare(`
        SELECT * FROM agent_checkpoints WHERE id = ?
      `)
      .get(checkpointId) as Record<string, unknown> | undefined
    if (!row) {
      return null
    }
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      projectPath: String(row.project_path),
      label: String(row.label),
      snapshotDir: String(row.snapshot_dir),
      createdAt: String(row.created_at),
      restoredAt:
        typeof row.restored_at === 'string' ? row.restored_at : null
    }
  }

  markRestored(checkpointId: string): void {
    this.database
      .prepare(`
        UPDATE agent_checkpoints SET restored_at = ? WHERE id = ?
      `)
      .run(new Date().toISOString(), checkpointId)
  }
}

export class CodeIndexRepository {
  constructor(private readonly database: DatabaseSync) {}

  getFiles(projectId: string): StoredCodeFile[] {
    const rows = this.database
      .prepare(`
        SELECT path, mtime_ms, size
        FROM code_files
        WHERE project_id = ?
      `)
      .all(projectId) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      path: String(row.path),
      mtimeMs: Number(row.mtime_ms),
      size: Number(row.size)
    }))
  }

  replace(
    projectId: string,
    currentPaths: ReadonlySet<string>,
    updates: CodeIndexUpdate[]
  ): { fileCount: number; symbolCount: number } {
    const deleteFileStatement = this.database.prepare(
      'DELETE FROM code_files WHERE project_id = ? AND path = ?'
    )
    const deleteFtsStatement = this.database.prepare(
      'DELETE FROM code_fts WHERE project_id = ? AND path = ?'
    )
    const deleteSymbolsStatement = this.database.prepare(
      'DELETE FROM code_symbols WHERE project_id = ? AND path = ?'
    )
    const insertFileStatement = this.database.prepare(`
      INSERT INTO code_files (
        project_id, path, mtime_ms, size, language, content
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertFtsStatement = this.database.prepare(
      'INSERT INTO code_fts (project_id, path, content) VALUES (?, ?, ?)'
    )
    const insertSymbolStatement = this.database.prepare(`
      INSERT INTO code_symbols (project_id, path, name, kind, line)
      VALUES (?, ?, ?, ?, ?)
    `)

    this.database.exec('BEGIN')
    try {
      for (const file of this.getFiles(projectId)) {
        if (!currentPaths.has(file.path)) {
          deleteFileStatement.run(projectId, file.path)
          deleteFtsStatement.run(projectId, file.path)
          deleteSymbolsStatement.run(projectId, file.path)
        }
      }

      for (const update of updates) {
        deleteFileStatement.run(projectId, update.path)
        deleteFtsStatement.run(projectId, update.path)
        deleteSymbolsStatement.run(projectId, update.path)
        insertFileStatement.run(
          projectId,
          update.path,
          update.mtimeMs,
          update.size,
          update.language,
          update.content
        )
        insertFtsStatement.run(projectId, update.path, update.content)
        for (const symbol of update.symbols) {
          insertSymbolStatement.run(
            projectId,
            update.path,
            symbol.name,
            symbol.kind,
            symbol.line
          )
        }
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }

    const fileCount =
      this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM code_files WHERE project_id = ?'
        )
        .get(projectId) as { count?: number }
    const symbolCount =
      this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM code_symbols WHERE project_id = ?'
        )
        .get(projectId) as { count?: number }
    return {
      fileCount: Number(fileCount.count ?? 0),
      symbolCount: Number(symbolCount.count ?? 0)
    }
  }

  search(projectId: string, query: string): CodeSearchResult[] {
    const normalizedQuery = query.trim().slice(0, 200)
    if (!normalizedQuery) {
      return []
    }

    const likeQuery = `%${normalizedQuery
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_')}%`
    const results: CodeSearchResult[] = []
    const seen = new Set<string>()
    const addResult = (result: CodeSearchResult): void => {
      const key = `${result.kind}:${result.path}:${result.line}:${result.label}`
      if (!seen.has(key) && results.length < 60) {
        seen.add(key)
        results.push(result)
      }
    }

    const fileRows = this.database
      .prepare(`
        SELECT path FROM code_files
        WHERE project_id = ? AND lower(path) LIKE lower(?) ESCAPE '\\'
        ORDER BY length(path)
        LIMIT 12
      `)
      .all(projectId, likeQuery) as Array<{ path?: string }>
    for (const row of fileRows) {
      if (row.path) {
        addResult({
          path: row.path,
          line: 1,
          kind: 'file',
          label: row.path,
          snippet: row.path
        })
      }
    }

    const symbolRows = this.database
      .prepare(`
        SELECT path, name, kind, line FROM code_symbols
        WHERE project_id = ? AND lower(name) LIKE lower(?) ESCAPE '\\'
        ORDER BY length(name), name
        LIMIT 24
      `)
      .all(projectId, likeQuery) as Array<{
      path?: string
      name?: string
      kind?: string
      line?: number
    }>
    for (const row of symbolRows) {
      if (row.path && row.name) {
        addResult({
          path: row.path,
          line: Number(row.line ?? 1),
          kind: 'symbol',
          label: `${row.name} · ${row.kind ?? 'symbol'}`,
          snippet: `${row.path}:${row.line ?? 1}`
        })
      }
    }

    const terms = normalizedQuery.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 8) ?? []
    if (terms.length) {
      const ftsQuery = terms
        .map((term) => `"${term.replaceAll('"', '""')}"*`)
        .join(' AND ')
      try {
        const textRows = this.database
          .prepare(`
            SELECT path, content FROM code_fts
            WHERE project_id = ? AND code_fts MATCH ?
            ORDER BY bm25(code_fts)
            LIMIT 30
          `)
          .all(projectId, ftsQuery) as Array<{
          path?: string
          content?: string
        }>
        for (const row of textRows) {
          if (!row.path || typeof row.content !== 'string') {
            continue
          }
          const location = getLineSnippet(row.content, normalizedQuery)
          addResult({
            path: row.path,
            line: location.line,
            kind: 'text',
            label: row.path,
            snippet: location.snippet
          })
        }
      } catch {
        // File and symbol matches remain usable if the query is not valid FTS.
      }
    }

    return results
  }
}

function getLineSnippet(
  content: string,
  query: string
): { line: number; snippet: string } {
  const lowerContent = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const candidates = [
    lowerQuery,
    ...(query.match(/[\p{L}\p{N}_-]+/gu) ?? [])
      .map((term) => term.toLowerCase())
      .sort((left, right) => right.length - left.length)
  ]
  let index = -1
  for (const candidate of candidates) {
    index = lowerContent.indexOf(candidate)
    if (index >= 0) {
      break
    }
  }
  if (index < 0) {
    return { line: 1, snippet: content.slice(0, 240).replace(/\s+/g, ' ') }
  }

  const line = content.slice(0, index).split('\n').length
  const lineStart = content.lastIndexOf('\n', index) + 1
  const lineEnd = content.indexOf('\n', index)
  const snippet = content
    .slice(lineStart, lineEnd >= 0 ? lineEnd : content.length)
    .trim()
    .slice(0, 400)
  return { line, snippet }
}

function workflowSummaryFromRow(
  row: Record<string, unknown>
): WorkflowRunSummary {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    workflowId: String(row.workflow_id),
    workflowName: String(row.workflow_name),
    status:
      row.status === 'failed' || row.status === 'needs_review'
        ? row.status
        : 'completed',
    acceptance:
      row.acceptance_decision === 'blocked' ||
      row.acceptance_decision === 'needs_review'
        ? row.acceptance_decision
        : 'accepted',
    createdAt: String(row.created_at)
  }
}

export class WorkflowRepository {
  constructor(private readonly database: DatabaseSync) {}

  listTemplates(): WorkflowTemplate[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM workflow_templates ORDER BY updated_at DESC LIMIT 100
      `)
      .all() as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      steps: parseJson<WorkflowTemplate['steps']>(row.steps_json, []),
      acceptance: parseJson<WorkflowTemplate['acceptance']>(
        row.acceptance_json,
        {
          requireAllStepsSuccess: true,
          requireDiagnosticsPass: false,
          maxChangedFiles: 20,
          maxChangedLines: 500
        }
      ),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }))
  }

  saveTemplate(template: WorkflowTemplate): WorkflowTemplate[] {
    this.database
      .prepare(`
        INSERT INTO workflow_templates (
          id, name, steps_json, acceptance_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          steps_json = excluded.steps_json,
          acceptance_json = excluded.acceptance_json,
          updated_at = excluded.updated_at
      `)
      .run(
        template.id,
        template.name,
        JSON.stringify(template.steps),
        JSON.stringify(template.acceptance),
        template.createdAt,
        template.updatedAt
      )
    return this.listTemplates()
  }

  deleteTemplate(templateId: string): WorkflowTemplate[] {
    this.database
      .prepare('DELETE FROM workflow_templates WHERE id = ?')
      .run(templateId)
    return this.listTemplates()
  }

  saveRun(projectId: string, result: WorkflowRunResult): void {
    this.database
      .prepare(`
        INSERT OR REPLACE INTO workflow_runs (
          id, task_id, project_id, workflow_id, workflow_name,
          status, acceptance_decision, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        result.runId,
        result.taskId,
        projectId,
        result.workflowId,
        result.workflowName,
        result.status,
        result.acceptance.decision,
        JSON.stringify(result),
        result.updatedAt
      )
  }

  listRuns(projectId: string, workflowId?: string): WorkflowRunSummary[] {
    const rows = (
      workflowId
        ? this.database
            .prepare(`
              SELECT * FROM workflow_runs
              WHERE project_id = ? AND workflow_id = ?
              ORDER BY created_at DESC LIMIT 100
            `)
            .all(projectId, workflowId)
        : this.database
            .prepare(`
              SELECT * FROM workflow_runs
              WHERE project_id = ?
              ORDER BY created_at DESC LIMIT 100
            `)
            .all(projectId)
    ) as Array<Record<string, unknown>>
    return rows.map(workflowSummaryFromRow)
  }

  getRun(projectId: string, runId: string): WorkflowRunRecord | null {
    const row = this.database
      .prepare(`
        SELECT * FROM workflow_runs
        WHERE id = ? AND project_id = ?
      `)
      .get(runId, projectId) as Record<string, unknown> | undefined
    if (!row) {
      return null
    }
    const result = parseJson<WorkflowRunResult | null>(row.result_json, null)
    if (!result) {
      return null
    }
    return {
      ...workflowSummaryFromRow(row),
      result
    }
  }
}

export class AppDatabase {
  readonly database: DatabaseSync
  readonly tasks: TaskRepository
  readonly checkpoints: CheckpointRepository
  readonly codeIndex: CodeIndexRepository
  readonly workflows: WorkflowRepository

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        thread_id TEXT,
        usage_text TEXT NOT NULL DEFAULT '',
        entries_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_tasks_project
        ON agent_tasks(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        label TEXT NOT NULL,
        snapshot_dir TEXT NOT NULL,
        created_at TEXT NOT NULL,
        restored_at TEXT,
        FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_task
        ON agent_checkpoints(task_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS code_files (
        project_id TEXT NOT NULL,
        path TEXT NOT NULL,
        mtime_ms REAL NOT NULL,
        size INTEGER NOT NULL,
        language TEXT NOT NULL,
        content TEXT NOT NULL,
        PRIMARY KEY(project_id, path)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(
        project_id UNINDEXED,
        path UNINDEXED,
        content
      );

      CREATE TABLE IF NOT EXISTS code_symbols (
        project_id TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_code_symbols_project_name
        ON code_symbols(project_id, name);

      CREATE TABLE IF NOT EXISTS workflow_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        acceptance_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        acceptance_decision TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_runs_project
        ON workflow_runs(project_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
        ON workflow_runs(project_id, workflow_id, created_at DESC);
    `)
    this.tasks = new TaskRepository(this.database)
    this.checkpoints = new CheckpointRepository(this.database)
    this.codeIndex = new CodeIndexRepository(this.database)
    this.workflows = new WorkflowRepository(this.database)
  }

  close(): void {
    this.database.close()
  }
}
