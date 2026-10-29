import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const PREVIEW_COMPONENTS: Components = {
  a: ({ children }) => <span className="note-preview-link">{children}</span>,
  img: ({ alt }) => alt ? <span>{alt}</span> : null
}

const NoteExcerpt = memo(function NoteExcerpt({ content, code, markdown = false, maxLines = 3 }: {
  content: string
  code: boolean
  markdown?: boolean
  maxLines?: number
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    if (markdown) return
    const element = contentRef.current
    if (!element) return
    const checkOverflow = () => setOverflowing(element.scrollHeight > element.clientHeight + 1)
    checkOverflow()
    const observer = new ResizeObserver(checkOverflow)
    observer.observe(element)
    return () => observer.disconnect()
  }, [content, markdown, maxLines])

  return (
    <div className="mt-1">
      <div ref={contentRef}
        className={`text-xs text-gray-400 leading-5 ${markdown ? 'note-markdown-preview' : code ? 'font-mono bg-gray-900 px-2 py-1 rounded text-emerald-400' : ''}`}
        style={{
          maxHeight: `${maxLines * 1.25}rem`,
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          ...(markdown ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: maxLines } : { whiteSpace: 'pre-wrap' })
        }}>
        {markdown ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={PREVIEW_COMPONENTS}>{content}</ReactMarkdown> : content}
      </div>
      {overflowing && !markdown && <p className="text-xs leading-4 text-gray-500">...</p>}
    </div>
  )
})

export default NoteExcerpt
