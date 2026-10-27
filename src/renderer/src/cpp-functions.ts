export interface CppFunctionSymbol {
  name: string
  returnType: string
  parameters: string
  qualifiers: string
  className: string | null
  namespaceName: string | null
  hasBody: boolean
}

export interface CppFunctionFile {
  path: string
  content: string
}

export interface LocatedCppFunction extends CppFunctionSymbol {
  path: string
  line: number
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/')
}

export function isCppHeaderPath(path: string): boolean {
  return /\.(?:h|hh|hpp|hxx)$/i.test(path)
}

export function isCppSourcePath(path: string): boolean {
  return /\.(?:c|cc|cpp|cxx)$/i.test(path)
}

function findEnclosingScope(
  lines: string[],
  lineIndex: number
): {
  className: string | null
  namespaceName: string | null
} {
  let className: string | null = null
  let namespaceName: string | null = null
  for (let index = lineIndex; index >= 0; index -= 1) {
    const line = lines[index]
    if (!className) {
      const classMatch = /\b(?:class|struct)\s+([A-Za-z_]\w*)\b/.exec(line)
      if (classMatch) {
        className = classMatch[1]
      }
    }
    if (!namespaceName) {
      const namespaceMatch = /\bnamespace\s+([A-Za-z_]\w*)\b/.exec(line)
      if (namespaceMatch) {
        namespaceName = namespaceMatch[1]
      }
    }
    if (className && namespaceName) {
      break
    }
  }
  return { className, namespaceName }
}

export function parseCppFunctionAt(
  content: string,
  lineNumber: number,
  preferredName?: string
): CppFunctionSymbol | null {
  const lines = content.split(/\r?\n/)
  const targetIndex = Math.min(
    lines.length - 1,
    Math.max(0, lineNumber - 1)
  )
  const name = preferredName?.trim()
  if (!name) {
    return null
  }

  for (
    let startIndex = targetIndex;
    startIndex >= Math.max(0, targetIndex - 4);
    startIndex -= 1
  ) {
    const candidate = lines
      .slice(startIndex, Math.min(lines.length, targetIndex + 5))
      .join(' ')
      .trim()
    if (!new RegExp(`\\b${name}\\s*\\(`).test(candidate)) {
      continue
    }
    if (
      /^(?:return|if|for|while|switch|catch|throw|else|new|delete)\b/.test(
        candidate
      )
    ) {
      continue
    }
    const match =
      /^((?:(?:static|inline|virtual|extern|constexpr|explicit|friend)\s+)*)([A-Za-z_][\w:<>,*&\s]*?)\s+((?:[A-Za-z_]\w*::)*)([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*(const\s*)?(?:noexcept\s*)?(?:->\s*[^{;]+)?\s*(\{|;)/.exec(
        candidate
      )
    if (!match) {
      continue
    }
    if (match[4] !== name) {
      continue
    }
    const scope = findEnclosingScope(lines, startIndex)
    return {
      name: match[4],
      returnType: match[2].trim().replace(/\s+/g, ' '),
      parameters: match[5].trim().replace(/\s+/g, ' '),
      qualifiers: match[6]?.trim() ?? '',
      className:
        match[3].replace(/::$/, '') || scope.className || null,
      namespaceName: scope.namespaceName,
      hasBody: match[7] === '{'
    }
  }
  return null
}

export function locateCppFunctions(
  files: CppFunctionFile[],
  name: string
): LocatedCppFunction[] {
  const locations: LocatedCppFunction[] = []
  for (const file of files) {
    if (!isCppHeaderPath(file.path) && !isCppSourcePath(file.path)) {
      continue
    }
    const lines = file.content.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!line.includes(name)) {
        return
      }
      const parsed = parseCppFunctionAt(file.content, index + 1, name)
      if (parsed) {
        locations.push({ ...parsed, path: file.path, line: index + 1 })
      }
    })
  }
  return locations
}

export function cppImplementationPath(headerPath: string): string {
  const path = normalizedPath(headerPath)
  const separator = headerPath.includes('\\') ? '\\' : '/'
  const parts = path.split('/')
  const headersIndex = parts.findIndex(
    (part) => part.toLowerCase() === 'headers'
  )
  if (headersIndex >= 0) {
    parts[headersIndex] = 'Sources'
  }
  const fileName = parts.at(-1) ?? 'implementation.h'
  parts[parts.length - 1] = fileName.replace(/\.(?:h|hh|hpp|hxx)$/i, '.cpp')
  return parts.join(separator)
}

export function buildCppImplementation(
  symbol: CppFunctionSymbol,
  options: { qualifyScope: boolean }
): {
  qualifiedName: string
  code: string
  insertLine: number
} {
  const qualifiedName = options.qualifyScope
    ? [symbol.namespaceName, symbol.className, symbol.name]
        .filter(Boolean)
        .join('::')
    : [symbol.className, symbol.name].filter(Boolean).join('::') || symbol.name
  const signature = `${symbol.returnType} ${qualifiedName}(${symbol.parameters})${
    symbol.qualifiers ? ` ${symbol.qualifiers}` : ''
  }`
  const body =
    symbol.returnType.trim() === 'void'
      ? '{\n}'
      : '{\n    return {};\n}'
  return {
    qualifiedName,
    code: `${signature}\n${body}`,
    insertLine: 0
  }
}

export function appendCppImplementation(
  content: string,
  headerFileName: string,
  implementationCode: string,
  namespaceName?: string | null
): { content: string; insertLine: number } {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized ? normalized.split('\n') : []
  const escapedHeader = headerFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const includePattern = new RegExp(`^\\s*#\\s*include\\s+[<"]${escapedHeader}[>"]`)
  if (!lines.some((line) => includePattern.test(line))) {
    const includeLine = `#include "${headerFileName}"`
    let insertAt = 0
    for (let index = 0; index < lines.length; index += 1) {
      if (/^\s*#\s*include\b/.test(lines[index])) {
        insertAt = index + 1
      } else if (insertAt > 0 && lines[index].trim()) {
        break
      }
    }
    lines.splice(insertAt, 0, includeLine)
  }
  while (lines.length && !lines.at(-1)?.trim()) {
    lines.pop()
  }
  if (namespaceName) {
    const namespacePattern = new RegExp(
      `^\\s*namespace\\s+${namespaceName.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )}\\s*\\{`
    )
    let namespaceStart = -1
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (namespacePattern.test(lines[index])) {
        namespaceStart = index
        break
      }
    }
    if (namespaceStart >= 0) {
      let depth = 0
      for (let index = namespaceStart; index < lines.length; index += 1) {
        for (const character of lines[index]) {
          if (character === '{') {
            depth += 1
          } else if (character === '}') {
            depth -= 1
            if (depth === 0) {
              lines.splice(index, 0, '', ...implementationCode.split('\n'), '')
              return {
                content: lines.join('\n'),
                insertLine: index + 2
              }
            }
          }
        }
      }
    }
  }
  if (lines.length) {
    lines.push('', '')
  }
  const insertLine = lines.length + 1
  lines.push(...implementationCode.split('\n'), '')
  return { content: lines.join('\n'), insertLine }
}

export function cppFileHasNamespace(
  content: string,
  namespaceName: string | null
): boolean {
  return Boolean(
    namespaceName &&
      new RegExp(
        `\\bnamespace\\s+${namespaceName.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&'
        )}\\b`
      ).test(content)
  )
}
