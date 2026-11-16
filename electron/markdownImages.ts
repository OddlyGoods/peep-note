import fs from 'node:fs/promises'
import path from 'node:path'
import { localMarkdownImagePath } from '../shared/markdownImages'

const MAX_IMAGE_BYTES = 32 * 1024 * 1024

function rasterMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return 'image/gif'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (bytes.subarray(0, 2).toString() === 'BM') return 'image/bmp'
  if (bytes.subarray(4, 8).toString() === 'ftyp' && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString())) return 'image/avif'
  return null
}

// Return only raster image data, never arbitrary text, HTML or an active SVG.
// Web images load in the renderer; this bridge does not proxy network requests.
export async function readMarkdownImage(source: unknown): Promise<string | null> {
  const file = localMarkdownImagePath(source)
  if (!file || !path.isAbsolute(file)) return null
  try {
    const handle = await fs.open(file, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || !stat.size || stat.size > MAX_IMAGE_BYTES) return null
      const bytes = Buffer.alloc(stat.size)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytesRead !== stat.size) return null
      const mime = rasterMime(bytes)
      return mime ? `data:${mime};base64,${bytes.toString('base64')}` : null
    } finally { await handle.close() }
  } catch { return null }
}
