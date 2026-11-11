import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { getDb, queryOne } from './db'
import { LOCAL_PROFILE_ID } from './localProfile'
import { imageMediaPaths, readableMediaPath } from './media'

type ImageRow = { file_path?: string | null; attachments?: string; updated_at?: number }
export type ThumbnailRenderer = (bytes: Uint8Array) => Uint8Array | null
const firstImage = (row: ImageRow) => imageMediaPaths(row)[0]
export function mapImageVersion(row: ImageRow): string | undefined {
  const image = firstImage(row)
  return image ? createHash('sha256').update(image).update(`:${row.updated_at ?? 0}`).digest('hex').slice(0, 20) : undefined
}

export function mapImagePath(id: unknown): string | null {
  if (typeof id !== 'string' || queryOne<{ note_map_enabled: number }>('SELECT note_map_enabled FROM settings WHERE user_id = ?', [LOCAL_PROFILE_ID])?.note_map_enabled !== 1) return null
  const row = queryOne<ImageRow>('SELECT file_path, attachments FROM logs WHERE id = ? AND user_id = ? AND is_secret = 0 AND deleted_at IS NULL', [id, LOCAL_PROFILE_ID])
  const reference = row && firstImage(row)
  return reference ? readableMediaPath(reference) : null
}

// Thumbnails are made in memory and addressed by note ID, never by a client path.
export class MapThumbnails {
  private database = getDb()
  private cache = new Map<string, Uint8Array>()
  constructor(private render: ThumbnailRenderer) {}
  async get(id: string): Promise<Uint8Array | null> {
    const database = getDb()
    if (this.database !== database) { this.cache.clear(); this.database = database }
    const eligible = () => getDb() === database && queryOne<{ note_map_enabled: number }>('SELECT note_map_enabled FROM settings WHERE user_id = ?', [LOCAL_PROFILE_ID])?.note_map_enabled === 1
    const row = () => queryOne<ImageRow>('SELECT file_path, attachments, updated_at FROM logs WHERE id = ? AND user_id = ? AND is_secret = 0 AND deleted_at IS NULL', [id, LOCAL_PROFILE_ID])
    const source = eligible() ? row() : null
    const reference = source && firstImage(source)
    if (!reference) return null
    const version = mapImageVersion(source!)
    const file = readableMediaPath(reference)
    if (!file) return null
    const valid = () => {
      if (!eligible()) return false
      const current = row()
      return !!current && mapImageVersion(current) === version && readableMediaPath(reference) === file
    }
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || !valid()) return null
      const key = `${id}:${version}:${stat.size}:${stat.mtimeMs}`
      let thumbnail = this.cache.get(key)
      if (!thumbnail) {
        const bytes = await fs.readFile(file)
        if (bytes.length > 32 * 1024 * 1024 || !valid()) return null
        thumbnail = this.render(bytes) ?? undefined
        if (!thumbnail || thumbnail.length > 256 * 1024 || !valid()) return null
        this.cache.set(key, thumbnail)
        if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!)
      }
      return valid() ? thumbnail : null
    } catch { return null }
  }
}
