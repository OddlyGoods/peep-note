const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'])
const LINK_PREFIX = 'peepnote-link:'

export type AttachmentMode = 'copy' | 'link'
export type ImportedAttachment = { path: string; name: string; size: number; isImage: boolean; mimeType: string | null }

export function isLinkedAttachment(reference: string): boolean {
  return reference.startsWith(LINK_PREFIX)
}

export function attachmentPath(reference: string): string {
  return isLinkedAttachment(reference) ? reference.slice(LINK_PREFIX.length) : reference
}

export function attachmentReference(filePath: string, mode: AttachmentMode): string {
  return mode === 'link' ? LINK_PREFIX + filePath : filePath
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4)
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`
}

export function attachmentFilename(filePath: string): string {
  const resolved = attachmentPath(filePath)
  return resolved.split(/[\\/]/).pop() || resolved
}

export function isImageAttachment(filePath: string): boolean {
  const extension = attachmentFilename(filePath).split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.has(extension)
}

export function attachmentMimeType(filePath: string): string | null {
  const extension = attachmentFilename(filePath).split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'bmp') return 'image/bmp'
  if (extension === 'tif' || extension === 'tiff') return 'image/tiff'
  return null
}
