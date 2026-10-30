// Notes are untrusted input. Only explicit web URLs may leave the app.
export function externalWebUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const href = value.trim()
  if (!/^https?:\/\//i.test(href) || /[\u0000-\u001f\u007f\\]/.test(href)) return null
  try {
    const url = new URL(href)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return url.href
  } catch { return null }
}
