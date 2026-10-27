import { describe, expect, it } from 'vitest'
import { parseInlineMarkdown, parseMarkdown } from './markdown'

describe('Agent markdown rendering', () => {
  it('parses headings, lists and fenced code blocks', () => {
    const blocks = parseMarkdown(`## 验证结果

- 编译通过
- 输出正常

\`\`\`text
3 + 4 = 7
\`\`\`
`)

    expect(blocks).toMatchObject([
      { type: 'heading', level: 2, content: '验证结果' },
      { type: 'list', ordered: false, items: ['编译通过', '输出正常'] },
      { type: 'code', language: 'text', content: '3 + 4 = 7' }
    ])
  })

  it('parses inline formatting and rejects unsafe links', () => {
    const tokens = parseInlineMarkdown(
      '使用 `add()` 和 **Adder**，参见 [文档](https://example.com)，[危险](javascript:alert(1))'
    )

    expect(tokens).toContainEqual({ type: 'code', value: 'add()' })
    expect(tokens).toContainEqual({
      type: 'strong',
      children: [{ type: 'text', value: 'Adder' }]
    })
    expect(tokens).toContainEqual({
      type: 'link',
      href: 'https://example.com',
      label: [{ type: 'text', value: '文档' }]
    })
    expect(
      tokens.some(
        (token) => token.type === 'link' && token.href.startsWith('javascript:')
      )
    ).toBe(false)
  })

  it('keeps an unclosed fence as code instead of exposing backticks', () => {
    expect(parseMarkdown('```\nline one\nline two')).toMatchObject([
      { type: 'code', content: 'line one\nline two' }
    ])
  })
})
