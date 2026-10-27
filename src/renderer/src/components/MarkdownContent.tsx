import {
  parseInlineMarkdown,
  parseMarkdown,
  type InlineToken
} from '../markdown'

function Inline({ tokens }: { tokens: InlineToken[] }): React.JSX.Element {
  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === 'code') {
          return <code key={index}>{token.value}</code>
        }
        if (token.type === 'strong') {
          return (
            <strong key={index}>
              <Inline tokens={token.children} />
            </strong>
          )
        }
        if (token.type === 'emphasis') {
          return (
            <em key={index}>
              <Inline tokens={token.children} />
            </em>
          )
        }
        if (token.type === 'strike') {
          return (
            <del key={index}>
              <Inline tokens={token.children} />
            </del>
          )
        }
        if (token.type === 'link') {
          return (
            <a
              key={index}
              href={token.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Inline tokens={token.label} />
            </a>
          )
        }
        return <span key={index}>{token.value}</span>
      })}
    </>
  )
}

interface MarkdownContentProps {
  text: string
  headingOffset?: number
  className?: string
}

function MarkdownContent({
  text,
  headingOffset = 2,
  className = ''
}: MarkdownContentProps): React.JSX.Element {
  const blocks = parseMarkdown(text)
  return (
    <div
      className={`agent-markdown ${
        className ? `markdown-content ${className}` : ''
      }`}
    >
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const headingLevel = Math.min(
            6,
            Math.max(1, block.level + headingOffset)
          )
          const Heading = `h${headingLevel}` as
            | 'h1'
            | 'h2'
            | 'h3'
            | 'h4'
            | 'h5'
            | 'h6'
          return (
            <Heading key={index}>
              <Inline tokens={parseInlineMarkdown(block.content)} />
            </Heading>
          )
        }
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline tokens={parseInlineMarkdown(item)} />
                </li>
              ))}
            </List>
          )
        }
        if (block.type === 'code') {
          return (
            <pre key={index} data-language={block.language}>
              <code>{block.content}</code>
            </pre>
          )
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={index}>
              <Inline tokens={parseInlineMarkdown(block.content)} />
            </blockquote>
          )
        }
        if (block.type === 'rule') {
          return <hr key={index} />
        }
        return (
          <p key={index}>
            <Inline tokens={parseInlineMarkdown(block.content)} />
          </p>
        )
      })}
    </div>
  )
}

export default MarkdownContent
