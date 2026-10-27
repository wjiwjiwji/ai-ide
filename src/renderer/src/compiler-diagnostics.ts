import type {
  DiagnosticSeverity,
  ProjectDiagnostic
} from '../../shared/desktop'

function normalizeFile(
  file: string,
  projectRoot: string | null
): string {
  const normalizedFile = file.trim().replaceAll('/', '\\')
  if (!projectRoot) {
    return normalizedFile
  }
  const root = projectRoot.replaceAll('/', '\\').replace(/\\+$/, '')
  return normalizedFile
    .toLowerCase()
    .startsWith(`${root.toLowerCase()}\\`)
    ? normalizedFile.slice(root.length + 1)
    : normalizedFile
}

function severityFromText(text: string): DiagnosticSeverity {
  if (/^fatal error$/i.test(text) || /^error$/i.test(text)) {
    return 'error'
  }
  if (/^warning$/i.test(text)) {
    return 'warning'
  }
  return 'info'
}

export function parseCompilerDiagnostics(
  output: string,
  projectRoot: string | null
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = []
  const seen = new Set<string>()
  const gccPattern =
    /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning):\s*(.+)$/i
  const msvcPattern =
    /^(.*?)\((\d+)(?:,(\d+))?\):\s*(fatal error|error|warning)\s+[A-Z]\d+:\s*(.+)$/i

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('In file included from')) {
      continue
    }
    const gccMatch = gccPattern.exec(line)
    const msvcMatch = gccMatch ? null : msvcPattern.exec(line)
    const match = gccMatch ?? msvcMatch
    if (!match) {
      continue
    }
    const file = normalizeFile(match[1], projectRoot)
    const lineNumber = Number(
      gccMatch ? match[2] : match[2]
    )
    const column = Number(
      gccMatch ? match[3] : match[3] ?? 1
    )
    const severityText = gccMatch ? match[4] : match[4]
    const message = gccMatch ? match[5] : match[5]
    const key = `${file}:${lineNumber}:${column}:${message}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    diagnostics.push({
      file,
      line: Math.max(1, lineNumber),
      column: Math.max(1, column || 1),
      severity: severityFromText(severityText),
      message: message.trim()
    })
  }

  return diagnostics.slice(0, 200)
}
