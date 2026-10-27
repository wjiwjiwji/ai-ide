export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineToken[] }
  | { type: 'emphasis'; children: InlineToken[] }
  | { type: 'strike'; children: InlineToken[] }
  | { type: 'link'; label: InlineToken[]; href: string }

export type MarkdownBlock =
  | { type: 'heading'; level: number; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language: string; content: string }
  | { type: 'quote'; content: string }
  | { type: 'rule' }

function safeHref(value: string): string | null {
  const href = value.trim()
  return /^(?:https?:\/\/|mailto:)/i.test(href) ? href : null
}

export function parseInlineMarkdown(value: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const pattern =
    /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|\[[^\]\n]+\]\([^)\n]+\)|\*[^*\n]+?\*|_[^_\n]+?_)/g
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) {
      tokens.push({ type: 'text', value: value.slice(cursor, index) })
    }
    const token = match[0]
    if (token.startsWith('`')) {
      tokens.push({ type: 'code', value: token.slice(1, -1) })
    } else if (token.startsWith('**') || token.startsWith('__')) {
      tokens.push({
        type: 'strong',
        children: parseInlineMarkdown(token.slice(2, -2))
      })
    } else if (token.startsWith('~~')) {
      tokens.push({
        type: 'strike',
        children: parseInlineMarkdown(token.slice(2, -2))
      })
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      const href = link ? safeHref(link[2]) : null
      if (link && href) {
        tokens.push({
          type: 'link',
          label: parseInlineMarkdown(link[1]),
          href
        })
      } else {
        tokens.push({ type: 'text', value: token })
      }
    } else {
      tokens.push({
        type: 'emphasis',
        children: parseInlineMarkdown(token.slice(1, -1))
      })
    }
    cursor = index + token.length
  }
  if (cursor < value.length) {
    tokens.push({ type: 'text', value: value.slice(cursor) })
  }
  return tokens
}

function startsBlock(line: string): boolean {
  const value = line.trim()
  return (
    /^```/.test(value) ||
    /^~~~/.test(value) ||
    /^#{1,6}\s+/.test(value) ||
    /^>\s?/.test(value) ||
    /^[-*+]\s+/.test(value) ||
    /^\d+\.\s+/.test(value) ||
    /^(?:---+|\*\*\*+)$/.test(value)
  )
}

export function parseMarkdown(value: string): MarkdownBlock[] {
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    if (!trimmed) {
      index += 1
      continue
    }

    const fence = /^(```|~~~)\s*([\w+-]*)\s*$/.exec(trimmed)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (
        index < lines.length &&
        lines[index].trim() !== fence[1]
      ) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({
        type: 'code',
        language: fence[2] ?? '',
        content: codeLines.join('\n')
      })
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        content: heading[2]
      })
      index += 1
      continue
    }

    if (/^(?:---+|\*\*\*+)$/.test(trimmed)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed)
      const items: string[] = []
      const itemPattern = ordered ? /^\d+\.\s+(.+)$/ : /^[-*+]\s+(.+)$/
      while (index < lines.length) {
        const item = itemPattern.exec(lines[index].trim())
        if (!item) {
          break
        }
        items.push(item[1])
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const quote = /^>\s?(.*)$/.exec(lines[index].trim())
        if (!quote) {
          break
        }
        quoteLines.push(quote[1])
        index += 1
      }
      blocks.push({ type: 'quote', content: quoteLines.join('\n') })
      continue
    }

    const paragraphLines = [trimmed]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() &&
      !startsBlock(lines[index])
    ) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    blocks.push({
      type: 'paragraph',
      content: paragraphLines.join('\n')
    })
  }
  return blocks
}
