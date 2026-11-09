import { Worker } from 'node:worker_threads'
import { EMBEDDING_MODEL, EMBEDDING_REVISION, EMBEDDING_DIMENSIONS } from '../shared/localEmbeddings'

export type EmbeddingProgress = { stage: 'downloading' | 'indexing'; progress?: number }
export interface LocalEmbedder { embed(text: string, progress: (value: EmbeddingProgress) => void): Promise<number[]>; dispose(): void }
export type EmbeddingWorkerOptions = { workerPath: string; cacheDir: string; modulePath?: string; offline?: boolean }

export class EmbeddingWorker implements LocalEmbedder {
  private worker: Worker | null = null
  private sequence = 0
  private pending: { id: number; resolve: (vector: number[]) => void; reject: (error: Error) => void; progress: (value: EmbeddingProgress) => void; timeout: ReturnType<typeof setTimeout> } | null = null
  private idle: ReturnType<typeof setTimeout> | null = null
  constructor(private options: EmbeddingWorkerOptions) {}
  embed(text: string, progress: (value: EmbeddingProgress) => void): Promise<number[]> {
    if (this.pending) return Promise.reject(new Error('EMBEDDING_BUSY'))
    if (this.idle) clearTimeout(this.idle)
    if (!this.worker) {
      const worker = this.worker = new Worker(this.options.workerPath, { workerData: {
        modulePath: this.options.modulePath ?? require.resolve('@huggingface/transformers'), cacheDir: this.options.cacheDir,
        model: EMBEDDING_MODEL, revision: EMBEDDING_REVISION, dimensions: EMBEDDING_DIMENSIONS, offline: !!this.options.offline
      }, env: { ...process.env, HF_TOKEN: '', HUGGING_FACE_HUB_TOKEN: '' } })
      worker.on('message', message => {
        if (this.worker !== worker) return
        const pending = this.pending
        if (!pending) return
        if (message.type === 'download') { pending.progress({ stage: 'downloading', progress: message.progress }); return }
        if (message.type === 'indexing') { pending.progress({ stage: 'indexing' }); return }
        if (message.id !== pending.id) return
        clearTimeout(pending.timeout); this.pending = null
        if (message.type === 'result') pending.resolve(Array.from(message.vector))
        else pending.reject(new Error('LOCAL_EMBEDDING_FAILED'))
        this.idle = setTimeout(() => this.dispose(), 30_000); this.idle.unref()
      })
      worker.on('error', () => { if (this.worker === worker) this.dispose() })
      worker.on('exit', () => { if (this.worker === worker) this.dispose() })
      worker.unref()
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timeout = setTimeout(() => this.dispose(), 10 * 60_000); timeout.unref()
      this.pending = { id, resolve, reject, progress, timeout }
      this.worker!.postMessage({ id, text })
    })
  }
  dispose() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const pending = this.pending; this.pending = null
    if (pending) { clearTimeout(pending.timeout); pending.reject(new Error('LOCAL_EMBEDDING_FAILED')) }
    const worker = this.worker; this.worker = null
    if (worker) void worker.terminate()
  }
}
