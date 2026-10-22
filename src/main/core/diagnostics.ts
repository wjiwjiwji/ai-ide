import { isAbsolute, relative, resolve } from 'node:path'
import type { ProjectDiagnostic } from '../../shared/desktop'

export function normalizeDiagnosticPath(
  projectRoot: string,
  filePath: string
): string | null {
  const absolutePath = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(projectRoot, filePath)
  const relativePath = relative(projectRoot, absolutePath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null
  }
  return relativePath
}

export function parseProjectDiagnostics(
  output: string,
  projectRoot: string
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = []
  const seen = new Set<string>()
  const plainOutput = output.replace(/\u001b\[[0-9;]*m/g, '')

  for (const line of plainOutput.split(/\r?\n/)) {
    let filePath = ''
    let lineNumber = 1
    let column = 1
    let severity: ProjectDiagnostic['severity'] = 'error'
    let code: string | undefined
    let message = ''

    let match =
      /^(.+?)\((\d+),(\d+)\):\s*(error|warning|info)\s+(TS\d+):\s*(.+)$/.exec(
        line
      )
    if (match) {
      filePath = match[1]
      lineNumber = Number(match[2])
      column = Number(match[3])
      severity = match[4] as ProjectDiagnostic['severity']
      code = match[5]
      message = match[6]
    } else {
      match =
        /^(.+?):(\d+):(\d+)\s*-\s*(error|warning|info)\s+(TS\d+):\s*(.+)$/.exec(
          line
        )
      if (match) {
        filePath = match[1]
        lineNumber = Number(match[2])
        column = Number(match[3])
        severity = match[4] as ProjectDiagnostic['severity']
        code = match[5]
        message = match[6]
      } else {
        match =
          /^(.+?):(\d+):(\d+):\s*(error|warning|info)\s*:?\s*(.+)$/.exec(
            line
          )
        if (match) {
          filePath = match[1]
          lineNumber = Number(match[2])
          column = Number(match[3])
          severity = match[4] as ProjectDiagnostic['severity']
          message = match[5]
        }
      }
    }

    if (!filePath || !message) {
      continue
    }
    const relativePath = normalizeDiagnosticPath(projectRoot, filePath)
    if (!relativePath) {
      continue
    }

    const key = `${relativePath}:${lineNumber}:${column}:${severity}:${code ?? ''}:${message}`
    if (seen.has(key) || diagnostics.length >= 1000) {
      continue
    }
    seen.add(key)
    diagnostics.push({
      file: relativePath,
      line: lineNumber,
      column,
      severity,
      message: message.trim(),
      code
    })
  }

  return diagnostics
}
