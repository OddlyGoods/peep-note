import { getDb, onNotesChanged, queryAll, queryOne, run } from './db'
import { LOCAL_PROFILE_ID } from './localProfile'
import { embeddingText, embeddingHash, type EmbeddingNote } from './embeddingText'
import { EMBEDDING_CACHE_KEY, EMBEDDING_DIMENSIONS, embeddingErrorCode, normalizedVector, type EmbeddingState } from '../shared/localEmbeddings'
import type { LocalEmbedder } from './embeddingWorker'

export const EMBEDDABLE_NOTES = 'user_id = ? AND is_secret = 0 AND deleted_at IS NULL'
export const noteMapEnabled = () => queryOne<{ note_map_enabled: number }>('SELECT note_map_enabled FROM settings WHERE user_id = ?', [LOCAL_PROFILE_ID])?.note_map_enabled === 1
export function saveNoteMapEnabled(enabled: boolean) {
  run('INSERT INTO settings (user_id, note_map_enabled) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET note_map_enabled = excluded.note_map_enabled', [LOCAL_PROFILE_ID, enabled ? 1 : 0])
}
type CacheRow = { note_id: string; content_hash: string; model_id: string; vector: Uint8Array; dimensions: number }
export function decodeEmbedding(row: CacheRow): number[] | null {
  if (row.model_id !== EMBEDDING_CACHE_KEY || row.dimensions !== EMBEDDING_DIMENSIONS || row.vector?.byteLength !== EMBEDDING_DIMENSIONS * 4) return null
  return normalizedVector(new Float32Array(new Uint8Array(row.vector).buffer))
}
export function currentEmbeddingVectors(ids?: string[]): Map<string, number[]> {
  const vectors = new Map<string, number[]>()
  if (ids && !ids.length) return vectors
  const rows = queryAll<CacheRow & EmbeddingNote>(`SELECT e.*, l.id, l.title, l.content, l.content_format, l.log_type, l.ocr_text
    FROM note_embeddings e JOIN logs l ON l.id = e.note_id WHERE l.user_id = ? AND l.is_secret = 0 AND l.deleted_at IS NULL${ids ? ` AND l.id IN (${ids.map(() => '?').join(',')})` : ''}`, [LOCAL_PROFILE_ID, ...(ids ?? [])])
  for (const row of rows) {
    if (row.content_hash !== embeddingHash(embeddingText(row))) continue
    const vector = decodeEmbedding(row)
    if (vector) vectors.set(row.note_id, vector)
  }
  return vectors
}

export interface KnowledgeIndex {
  touch(): void; setEnabled(enabled: boolean): void; status(): EmbeddingState; retry(): void; dispose(): void
  searchVector(text: string): Promise<number[]>
}
export class LocalKnowledgeIndex implements KnowledgeIndex {
  private database = getDb()
  private state: EmbeddingState = { stage: 'idle', completed: 0, total: 0 }
  private activated = false
  private enabled = noteMapEnabled()
  private generation = 0
  private disposed = false
  private running = false
  private dirty = false
  private scheduled: ReturnType<typeof setTimeout> | null = null
  private inference: Promise<unknown> = Promise.resolve()
  private queries = new Map<string, Promise<number[]>>()
  private unsubscribe: () => void
  constructor(private embedder: LocalEmbedder) {
    this.unsubscribe = onNotesChanged(() => { if (this.activated) this.schedule() })
    if (this.enabled) this.touch()
  }
  status() { return { ...this.state } }
  touch() { if (this.enabled && !this.activated) { this.activated = true; this.schedule() } }
  private embed(text: string, progress: Parameters<LocalEmbedder['embed']>[1], generation = this.generation) {
    // Indexing and searches share one worker; interleave requests between notes.
    const result = this.inference.then(async () => {
      if (!this.valid(generation)) throw new Error('EMBEDDING_CANCELLED')
      const output = await this.embedder.embed(text, progress)
      if (!this.valid(generation)) throw new Error('EMBEDDING_CANCELLED')
      const vector = normalizedVector(output)
      if (!vector || vector.length !== EMBEDDING_DIMENSIONS) throw new Error('INVALID_EMBEDDING')
      return vector
    })
    this.inference = result.catch(() => {})
    return result
  }
  searchVector(text: string): Promise<number[]> {
    if (!this.valid()) return Promise.reject(new Error('EMBEDDING_CANCELLED'))
    const cached = this.queries.get(text)
    if (cached) return cached
    const result = this.embed(text, () => {})
    this.queries.set(text, result)
    if (this.queries.size > 8) this.queries.delete(this.queries.keys().next().value!)
    void result.catch(() => { if (this.queries.get(text) === result) this.queries.delete(text) })
    return result
  }
  setEnabled(enabled: boolean) {
    if (this.disposed || getDb() !== this.database) return
    saveNoteMapEnabled(enabled)
    if (this.enabled === enabled) return
    this.enabled = enabled; this.generation++
    this.queries.clear()
    this.activated = false; this.dirty = false
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = null
    this.state = { stage: 'idle', completed: 0, total: 0 }
    this.embedder.dispose()
    if (enabled) this.touch()
  }
  retry() {
    if (!this.enabled || this.disposed || this.running) return
    const generation = this.generation
    this.inference = this.inference.then(() => { if (this.valid(generation)) this.embedder.dispose() }).catch(() => {})
    this.queries.clear(); this.state = { ...this.state, stage: 'indexing', progress: undefined, errorCode: undefined }; this.schedule()
  }
  private schedule() {
    if (!this.enabled || this.disposed || getDb() !== this.database || this.state.stage === 'error') return
    this.dirty = true
    this.state = { ...this.state, stage: 'indexing', progress: undefined }
    if (this.running || this.scheduled) return
    this.scheduled = setTimeout(() => { this.scheduled = null; void this.process() }, 150)
    this.scheduled.unref()
  }
  private valid(generation = this.generation) { return this.enabled && !this.disposed && getDb() === this.database && generation === this.generation }
  private async process() {
    if (!this.valid() || this.running) return
    const generation = this.generation
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
          if (!this.valid(generation)) return
          // Re-read before and after inference: edits, deletion, and changing a
          // note to secret must never allow a late result back into the cache.
          const current = queryOne<EmbeddingNote>(`SELECT * FROM logs WHERE id = ? AND ${EMBEDDABLE_NOTES}`, [item.note.id, LOCAL_PROFILE_ID])
          if (!current) continue
          const text = embeddingText(current), hash = embeddingHash(text)
          if (!text) continue
          const output = await this.embed(text, progress => { if (this.valid(generation)) this.state = { ...this.state, stage: progress.stage, progress: progress.progress } }, generation)
          if (!this.valid(generation)) return
          const latest = queryOne<EmbeddingNote>(`SELECT * FROM logs WHERE id = ? AND ${EMBEDDABLE_NOTES}`, [item.note.id, LOCAL_PROFILE_ID])
          if (!latest || embeddingHash(embeddingText(latest)) !== hash) { this.dirty = true; continue }
          const vector = normalizedVector(output)
          if (!vector || vector.length !== EMBEDDING_DIMENSIONS) throw new Error('INVALID_EMBEDDING')
          const bytes = new Uint8Array(new Float32Array(vector).buffer)
          run('INSERT OR REPLACE INTO note_embeddings (note_id, content_hash, model_id, vector, dimensions, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [latest.id, hash, EMBEDDING_CACHE_KEY, bytes, EMBEDDING_DIMENSIONS, Math.floor(Date.now() / 1000)])
          this.state = { ...this.state, stage: 'indexing', completed: this.state.completed + 1, progress: undefined }
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      } while (this.dirty && this.valid(generation))
      if (this.valid(generation)) this.state = { ...this.state, stage: 'ready', progress: undefined, errorCode: undefined }
    } catch (error) {
      if (this.valid(generation)) {
        const errorCode = embeddingErrorCode(error)
        console.warn('Local embedding index failed:', errorCode)
        this.state = { ...this.state, stage: 'error', progress: undefined, errorCode }
      }
    } finally {
      this.running = false
      if (this.valid() && generation !== this.generation) this.schedule()
    }
  }
  dispose() {
    this.disposed = true; this.unsubscribe()
    this.queries.clear()
    if (this.scheduled) clearTimeout(this.scheduled)
    this.embedder.dispose()
  }
}
