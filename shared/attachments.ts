const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'])

export function attachmentFilename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
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
