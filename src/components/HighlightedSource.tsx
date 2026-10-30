import { memo, useMemo } from 'react'
import { highlightSource } from '../lib/syntaxHighlight'

const HighlightedSource = memo(function HighlightedSource({ content, format }: {
  content: string
  format: 'code' | 'html'
}) {
  const highlighted = useMemo(() => highlightSource(content, format), [content, format])
  return (
    <pre className="detail-content syntax-source font-mono m-0 break-words whitespace-pre-wrap rounded-xl border border-gray-700 bg-gray-950 p-4 text-sm">
      {/* Only the highlighter's escaped output is inserted; saved HTML is never rendered here. */}
      <code className="syntax-source-code" dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  )
})

export default HighlightedSource
