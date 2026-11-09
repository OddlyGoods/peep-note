import crypto from 'node:crypto'
import { getAiSummaryContent } from '../shared/aiSummary'
import { EMBEDDING_CACHE_KEY } from '../shared/localEmbeddings'

export type EmbeddingNote = { id: string; title: string; content: string; content_format: string; log_type: string; ocr_text: string }
export function embeddingText(note: EmbeddingNote): string {
  let body = note.log_type === 'summary' ? getAiSummaryContent(note.content) : note.content
  if (note.content_format === 'html') body = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  if (note.content_format === 'markdown' || note.log_type === 'summary') body = body
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*```[^\n]*$/gm, '').replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/[*_`~]/g, '')
  return [note.title, body, note.ocr_text].filter(Boolean).join('\n\n')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g, entity => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity] ?? entity)
    .replace(/\s+/g, ' ').trim()
}
export const embeddingHash = (text: string) => crypto.createHash('sha256').update(EMBEDDING_CACHE_KEY).update('\0').update(text).digest('hex')
