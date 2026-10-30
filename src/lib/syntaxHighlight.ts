import hljs from 'highlight.js/lib/common'

const MAX_HIGHLIGHT_LENGTH = 100_000
const DETECTION_LENGTH = 8_000

function escapeSource(source: string) {
  return source.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;'
  })[character]!)
}

export function highlightSource(source: string, format: 'code' | 'html') {
  // Bound automatic detection and skip very large notes so opening one stays responsive.
  if (!source || source.length > MAX_HIGHLIGHT_LENGTH) return escapeSource(source)
  try {
    const language = format === 'html' ? 'xml' : hljs.highlightAuto(source.slice(0, DETECTION_LENGTH)).language
    return language ? hljs.highlight(source, { language, ignoreIllegals: true }).value : escapeSource(source)
  } catch {
    return escapeSource(source)
  }
}
