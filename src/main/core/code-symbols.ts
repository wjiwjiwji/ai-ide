export const indexableExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.json',
  '.md',
  '.mdx',
  '.py',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.go',
  '.rs',
  '.sql',
  '.xml',
  '.yaml',
  '.yml',
  '.sh',
  '.ps1',
  '.vue',
  '.svelte'
])

export function getFileLanguage(filePath: string): string {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const languages: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.html': 'html',
    '.json': 'json',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.py': 'python',
    '.java': 'java',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.go': 'go',
    '.rs': 'rust',
    '.sql': 'sql',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.sh': 'shell',
    '.ps1': 'powershell',
    '.vue': 'vue',
    '.svelte': 'svelte'
  }
  return languages[extension] ?? 'plaintext'
}

export function extractCodeSymbols(
  content: string,
  language: string
): Array<{ name: string; kind: string; line: number }> {
  const symbols: Array<{ name: string; kind: string; line: number }> = []
  const seen = new Set<string>()
  const lines = content.split(/\r?\n/)

  const addSymbol = (name: string, kind: string, line: number): void => {
    const key = `${kind}:${name}:${line}`
    if (name && !seen.has(key) && symbols.length < 500) {
      seen.add(key)
      symbols.push({ name, kind, line })
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineNumber = index + 1

    if (language === 'markdown') {
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
      if (heading) {
        addSymbol(heading[2], `h${heading[1].length}`, lineNumber)
      }
      continue
    }

    const common =
      /^\s*(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(function|class|interface|type|enum|struct|trait|record)\s+([A-Za-z_$][\w$]*)/.exec(
        line
      )
    if (common) {
      addSymbol(common[2], common[1], lineNumber)
      continue
    }

    if (['typescript', 'javascript', 'vue', 'svelte'].includes(language)) {
      const variable =
        /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(
          line
        )
      if (variable) {
        addSymbol(variable[1], 'variable', lineNumber)
      }
    } else if (language === 'python') {
      const python = /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(
        line
      )
      if (python) {
        addSymbol(python[2], python[1], lineNumber)
      }
    } else if (language === 'go') {
      const go = /^\s*(func|type)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(
        line
      )
      if (go) {
        addSymbol(go[2], go[1], lineNumber)
      }
    } else if (language === 'rust') {
      const rust =
        /^\s*(?:pub(?:\([^)]*\))?\s+)?(fn|struct|enum|trait|type|const)\s+([A-Za-z_]\w*)/.exec(
          line
        )
      if (rust) {
        addSymbol(rust[2], rust[1], lineNumber)
      }
    }
  }

  return symbols
}
