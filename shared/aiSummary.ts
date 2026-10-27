export interface AiSummaryResult {
  title: string
  summary: string
  structured: boolean
}

export function normalizeAiSummaryMarkdown(summary: string): string {
  return summary
    .replace(/\\\*\\\*/g, '**')
    .replace(/\\_\\_/g, '__')
}

function cleanModelOutput(raw: string): string {
  let cleaned = raw.trim()
  let previous = ''
  while (cleaned !== previous) {
    previous = cleaned
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
      .trim()
  }
  return cleaned
}

function decodeJsonStringFragment(fragment: string): string {
  try {
    return JSON.parse(`"${fragment}"`)
  } catch {}

  let decoded = ''
  for (let index = 0; index < fragment.length; index += 1) {
    const character = fragment[index]
    if (character !== '\\' || index === fragment.length - 1) {
      decoded += character
      continue
    }

    const escaped = fragment[++index]
    if (escaped === 'n') decoded += '\n'
    else if (escaped === 'r') decoded += '\r'
    else if (escaped === 't') decoded += '\t'
    else if (escaped === 'b') decoded += '\b'
    else if (escaped === 'f') decoded += '\f'
    else if (escaped === '"') decoded += '"'
    else if (escaped === '\\') decoded += '\\'
    else if (escaped === '/') decoded += '/'
    else if (escaped === 'u' && /^[0-9a-f]{4}$/i.test(fragment.slice(index + 1, index + 5))) {
      decoded += String.fromCharCode(Number.parseInt(fragment.slice(index + 1, index + 5), 16))
      index += 4
    } else {
      decoded += `\\${escaped}`
    }
  }
  return decoded
}

function extractQuotedField(source: string, field: string): string | null {
  const match = new RegExp(`"${field}"\\s*:\\s*"`, 'i').exec(source)
  if (!match || match.index === undefined) return null

  const start = match.index + match[0].length
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') return decodeJsonStringFragment(source.slice(start, index))
  }

  // Some providers stop at the token limit before closing the JSON string.
  // Preserve the useful part of the summary instead of displaying raw JSON.
  return decodeJsonStringFragment(source.slice(start).replace(/\s*```$/, ''))
}

export function parseAiSummaryResult(raw: string): AiSummaryResult {
  const cleaned = cleanModelOutput(raw)
  for (const candidate of [cleaned, raw.trim()]) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && typeof parsed.summary === 'string') {
        return {
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : '요약',
          summary: normalizeAiSummaryMarkdown(parsed.summary),
          structured: true
        }
      }
    } catch {}
  }

  const summary = extractQuotedField(cleaned, 'summary')
  if (summary !== null) {
    return {
      title: extractQuotedField(cleaned, 'title')?.trim() || '요약',
      summary: normalizeAiSummaryMarkdown(summary),
      structured: true
    }
  }

  return { title: '요약', summary: normalizeAiSummaryMarkdown(raw), structured: false }
}

export function getAiSummaryContent(content: string): string {
  const parsed = parseAiSummaryResult(content)
  return parsed.summary
}

export function getAiSummaryTitle(content: string, fallback: string): string {
  const parsed = parseAiSummaryResult(content)
  return parsed.structured && parsed.title !== '요약' ? parsed.title : fallback
}
