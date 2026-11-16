import { externalWebUrl } from './noteLinks'

// A pasted absolute path refers to a file on this computer, not an app route.
// Relative paths have no document directory to resolve against.
export function localMarkdownImagePath(source: unknown): string | null {
  if (typeof source !== 'string' || /[\u0000-\u001f\u007f]/.test(source)) return null
  let value = source
  try {
    if (/^file:/i.test(value)) {
      const url = new URL(value)
      if (url.hostname && url.hostname !== 'localhost') return null
      value = url.pathname
      if (/^\/[a-z]:\//i.test(value)) value = value.slice(1)
    }
    value = decodeURIComponent(value)
  } catch { return null }
  if (/[\u0000-\u001f\u007f]/.test(value) || value.startsWith('//') || value.startsWith('\\\\')) return null
  return /^(?:\/(?!\/)|[a-z]:[\\/])/i.test(value) ? value : null
}

export function markdownImageSource(source: unknown): string | null {
  if (typeof source !== 'string') return null
  return externalWebUrl(source) ?? (localMarkdownImagePath(source) ? source : null)
}
