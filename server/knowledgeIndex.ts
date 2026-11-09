import { getDb, onNotesChanged, queryAll, queryOne, run } from './db'
import { LOCAL_PROFILE_ID } from './localProfile'
import { embeddingText, embeddingHash, type EmbeddingNote } from './embeddingText'
import { EMBEDDING_CACHE_KEY, EMBEDDING_DIMENSIONS, normalizedVector, type EmbeddingState } from '../shared/localEmbeddings'
import type { LocalEmbedder } from './embeddingWorker'

export const EMBEDDABLE_NOTES = 'user_id = ? AND is_secret = 0 AND deleted_at IS NULL'
type CacheRow = { note_id: string; content_hash: string; model_id: string; vector: Uint8Array; dimensions: number }
export function decodeEmbedding(row: CacheRow): number[] | null {
  if (row.model_id !== EMBEDDING_CACHE_KEY || row.dimensions !== EMBEDDING_DIMENSIONS || row.vector?.byteLength !== EMBEDDING_DIMENSIONS * 4) return null
  return normalizedVector(new Float32Array(new Uint8Array(row.vector).buffer))
}
export function currentEmbeddingVectors(ids: string[]): Map<string, number[]> {
  const vectors = new Map<string, number[]>()
  if (!ids.length) return vectors
  const rows = queryAll<CacheRow & EmbeddingNote>(`SELECT e.*, l.id, l.title, l.content, l.content_format, l.log_type, l.ocr_text
    FROM note_embeddings e JOIN logs l ON l.id = e.note_id WHERE l.user_id = ? AND l.is_secret = 0 AND l.deleted_at IS NULL AND l.id IN (${ids.map(() => '?').join(',')})`, [LOCAL_PROFILE_ID, ...ids])
  for (const row of rows) {
    if (row.content_hash !== embeddingHash(embeddingText(row))) continue
    const vector = decodeEmbedding(row)
    if (vector) vectors.set(row.note_id, vector)
  }
  return vectors
}

export interface KnowledgeIndex {
  touch(): void; status(): EmbeddingState; retry(): void; dispose(): void
}
export class LocalKnowledgeIndex implements KnowledgeIndex {
  private database = getDb()
  private state: EmbeddingState = { stage: 'idle', completed: 0, total: 0 }
  private activated = false
  private disposed = false
  private running = false
  private dirty = false
  private scheduled: ReturnType<typeof setTimeout> | null = null
  private unsubscribe: () => void
  constructor(private embedder: LocalEmbedder) {
    this.unsubscribe = onNotesChanged(() => { if (this.activated) this.schedule() })
  }
  status() { return { ...this.state } }
  touch() { if (!this.activated) { this.activated = true; this.schedule() } }
  retry() {
    if (this.disposed || this.running) return
    this.embedder.dispose(); this.state = { ...this.state, stage: 'indexing', progress: undefined }; this.schedule()
  }
  private schedule() {
    if (this.disposed || getDb() !== this.database || this.state.stage === 'error') return
    this.dirty = true
    this.state = { ...this.state, stage: 'indexing', progress: undefined }
    if (this.running || this.scheduled) return
    this.scheduled = setTimeout(() => { this.scheduled = null; void this.process() }, 150)
    this.scheduled.unref()
  }
  private valid() { return !this.disposed && getDb() === this.database }
  private async process() {
    if (!this.valid() || this.running) return
    this.running = true
    try {
      do {
        this.dirty = false
        const notes = queryAll<EmbeddingNote>(`SELECT id, title, content, content_format, log_type, ocr_text FROM logs WHERE ${EMBEDDABLE_NOTES} ORDER BY created_at DESC, id`, [LOCAL_PROFILE_ID])
          .map(note => ({ note, text: embeddingText(note) })).filter(item => item.text)
        const cached = new Map(queryAll<CacheRow>('SELECT * FROM note_embeddings').map(row => [row.note_id, row]))
        const missing = notes.filter(item => {
          const cache = cached.get(item.note.id)
          return !cache || cache.content_hash !== embeddingHash(item.text) || !decodeEmbedding(cache)
        })
        this.state = { stage: 'indexing', total: notes.length, completed: notes.length - missing.length }
        for (const item of missing) {
          if (!this.valid()) return
          // Re-read before and after inference: edits, deletion, and changing a
          // note to secret must never allow a late result back into the cache.
          const current = queryOne<EmbeddingNote>(`SELECT * FROM logs WHERE id = ? AND ${EMBEDDABLE_NOTES}`, [item.note.id, LOCAL_PROFILE_ID])
          if (!current) continue
          const text = embeddingText(current), hash = embeddingHash(text)
          if (!text) continue
          const output = await this.embedder.embed(text, progress => { if (this.valid()) this.state = { ...this.state, stage: progress.stage, progress: progress.progress } })
          if (!this.valid()) return
          const latest = queryOne<EmbeddingNote>(`SELECT * FROM logs WHERE id = ? AND ${EMBEDDABLE_NOTES}`, [item.note.id, LOCAL_PROFILE_ID])
          if (!latest || embeddingHash(embeddingText(latest)) !== hash) { this.dirty = true; continue }
          const vector = normalizedVector(output)
          if (!vector || vector.length !== EMBEDDING_DIMENSIONS) throw new Error('INVALID_EMBEDDING')
          const bytes = new Uint8Array(new Float32Array(vector).buffer)
          run('INSERT OR REPLACE INTO note_embeddings (note_id, content_hash, model_id, vector, dimensions, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [latest.id, hash, EMBEDDING_CACHE_KEY, bytes, EMBEDDING_DIMENSIONS, Math.floor(Date.now() / 1000)])
          this.state = { ...this.state, stage: 'indexing', completed: this.state.completed + 1, progress: undefined }
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      } while (this.dirty && this.valid())
      if (this.valid()) this.state = { ...this.state, stage: 'ready', progress: undefined }
    } catch {
      if (this.valid()) this.state = { ...this.state, stage: 'error', progress: undefined }
    } finally { this.running = false }
  }
  dispose() {
    this.disposed = true; this.unsubscribe()
    if (this.scheduled) clearTimeout(this.scheduled)
    this.embedder.dispose()
  }
}
