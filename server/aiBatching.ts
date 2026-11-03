import { normalizeAiContextLength } from '../shared/aiContext'
import { parseAiSummaryResult, type AiSummaryResult } from '../shared/aiSummary'

export const SUMMARY_USER_PREFIX = 'Organize the following records:\n\n'
// The actual tokenizer and image encoder belong to the selected model. UTF-8
// bytes deliberately overestimate ordinary text, with extra room for framing.
export const estimateSummaryTokens = (text: string) => Buffer.byteLength(text, 'utf8')
const IMAGE_TOKEN_RESERVE = 4096
const REQUEST_RESERVE = 256

export class SummaryBatchError extends Error {
  constructor(public code: 'CONTEXT_TOO_SMALL' | 'EMPTY_RESPONSE' | 'RECORDS_CHANGED') {
    super(code)
  }
}

export interface SummarySource { text: string; image?: string }
export interface SummaryBatch { text: string; images: string[] }
export const summaryBatchCost = (batch: SummaryBatch) => estimateSummaryTokens(batch.text) + batch.images.length * IMAGE_TOKEN_RESERVE

export function summaryBudget(contextLength: number, systemPrompt: string) {
  const context = normalizeAiContextLength(contextLength)
  const maxOutputTokens = Math.min(3000, Math.floor(context / 8))
  const inputTokens = context - maxOutputTokens - REQUEST_RESERVE
    - estimateSummaryTokens(systemPrompt) - estimateSummaryTokens(SUMMARY_USER_PREFIX)
  if (inputTokens < 128) throw new SummaryBatchError('CONTEXT_TOO_SMALL')
  return { inputTokens, maxOutputTokens }
}

// Split even a single oversized note without dropping text or cutting a
// surrogate pair. Splitting by UTF-16 length alone breaks CJK/emoji budgeting.
export function splitSummaryText(text: string, budget: number): string[] {
  if (budget < 4) throw new SummaryBatchError('CONTEXT_TOO_SMALL')
  const chunks: string[] = []
  let start = 0, position = 0, size = 0, lineBoundary = 0, wordBoundary = 0
  for (const char of text) {
    const bytes = estimateSummaryTokens(char)
    if (size + bytes > budget) {
      let end = position
      // Prefer a nearby line/word boundary to keep ordinary commands and
      // paragraphs together; exceptionally long lines still have a hard cap.
      for (const boundary of [lineBoundary, wordBoundary]) {
        if (boundary <= start) continue
        const remaining = estimateSummaryTokens(text.slice(boundary, position))
        if (remaining <= budget / 3 && remaining + bytes <= budget) { end = boundary; break }
      }
      chunks.push(text.slice(start, end))
      start = end
      size = estimateSummaryTokens(text.slice(start, position))
      lineBoundary = wordBoundary = 0
    }
    size += bytes
    position += char.length
    if (char === '\n') lineBoundary = position
    if (/\s/.test(char)) wordBoundary = position
  }
  if (position > start || !chunks.length) chunks.push(text.slice(start))
  return chunks
}

export function packSummarySources(sources: SummarySource[], budget: number): SummaryBatch[] {
  const units: SummaryBatch[] = []
  sources.forEach((source, index) => {
    // Reserve enough room for fragment labels even with very large groups.
    splitSummaryText(source.text, budget - 64).forEach((text, part) => {
      units.push({ text: `[Source ${index + 1}, part ${part + 1}]\n${text}`, images: [] })
    })
    if (source.image) units.push({ text: `[Source ${index + 1}: capture]`, images: [source.image] })
  })
  const batches: SummaryBatch[] = []
  let current: SummaryBatch = { text: '', images: [] }
  for (const unit of units) {
    if (summaryBatchCost(unit) > budget) throw new SummaryBatchError('CONTEXT_TOO_SMALL')
    const next = { text: current.text ? `${current.text}\n\n${unit.text}` : unit.text, images: [...current.images, ...unit.images] }
    if (summaryBatchCost(next) > budget || next.images.length > 10) {
      batches.push(current)
      current = unit
    } else current = next
  }
  if (current.text || current.images.length) batches.push(current)
  return batches
}

function isContextLimitError(error: unknown): boolean {
  return error instanceof Error && /context[_ ](?:length|window)|maximum context|(?:input|prompt).{0,30}(?:too long|exceed)|(?:exceed|maximum).{0,40}(?:token|context)|n_ctx|num_ctx/i.test(error.message)
}

export async function summarizeInBatches(sources: SummarySource[], options: {
  contextLength: number
  systemPrompt: string
  signal?: AbortSignal
  beforeRequest?: () => void
  request: (batch: SummaryBatch, maxOutputTokens: number) => Promise<string>
}): Promise<AiSummaryResult> {
  const { maxOutputTokens, inputTokens } = summaryBudget(options.contextLength, options.systemPrompt)
  let budget = inputTokens

  async function execute(batch: SummaryBatch): Promise<AiSummaryResult[]> {
    options.signal?.throwIfAborted()
    options.beforeRequest?.()
    if (summaryBatchCost(batch) > budget) {
      const results: AiSummaryResult[] = []
      for (const part of packSummarySources([
        { text: batch.text }, ...batch.images.map(image => ({ text: 'Capture from the preceding records', image })),
      ], budget)) results.push(...await execute(part))
      return results
    }
    let raw: string
    try {
      raw = await options.request(batch, Math.min(maxOutputTokens, Math.max(64, Math.floor(budget / 4))))
    } catch (error) {
      if (!isContextLimitError(error)) throw error
      // Some local servers add a larger chat template or use a different image
      // encoder. Retry only context failures, strictly reducing request size.
      budget = Math.min(budget - 1, Math.floor(summaryBatchCost(batch) / 2))
      if (budget < 128) throw new SummaryBatchError('CONTEXT_TOO_SMALL')
      const smaller = packSummarySources([
        { text: batch.text }, ...batch.images.map(image => ({ text: 'Capture from the preceding records', image })),
      ], budget)
      const results: AiSummaryResult[] = []
      for (const part of smaller) results.push(...await execute(part))
      return results
    }
    options.signal?.throwIfAborted()
    const parsed = parseAiSummaryResult(raw)
    if (!parsed.summary.trim() || raw.trim() === '{}') throw new SummaryBatchError('EMPTY_RESPONSE')
    return [parsed]
  }

  let results: AiSummaryResult[] = []
  for (const batch of packSummarySources(sources, budget)) results.push(...await execute(batch))
  // Merge progressively when intermediate summaries fit together. If a model
  // produces summaries too long to reduce, retain every part locally instead
  // of truncating them or issuing an unbounded chain of API requests.
  for (let round = 0; results.length > 1 && round < 8; round++) {
    const batches = packSummarySources(results.map(result => ({ text: `${result.title}\n${result.summary}` })), budget)
    if (batches.length >= results.length) break
    const merged: AiSummaryResult[] = []
    for (const batch of batches) merged.push(...await execute(batch))
    const previousCount = results.length
    results = merged
    if (results.length >= previousCount) break
  }
  if (!results.length) throw new SummaryBatchError('EMPTY_RESPONSE')
  if (results.length === 1) return results[0]
  return { title: results[0].title, summary: results.map(result => `## ${result.title}\n\n${result.summary}`).join('\n\n'), structured: true }
}
