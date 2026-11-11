import { utilityProcess, type UtilityProcess } from 'electron'
import { EMBEDDING_MODEL, EMBEDDING_REVISION, EMBEDDING_DIMENSIONS } from '../shared/localEmbeddings'

export type EmbeddingProgress = { stage: 'downloading' | 'indexing'; progress?: number }
export interface LocalEmbedder { embed(text: string, progress: (value: EmbeddingProgress) => void): Promise<number[]>; dispose(): void }
export type EmbeddingWorkerOptions = { workerPath: string; cacheDir: string; modulePath?: string; offline?: boolean; idleMs?: number }
const CHILD_ERRORS = new Set(['NATIVE_MODULE_LOAD_FAILED', 'MODEL_LOAD_FAILED', 'INFERENCE_FAILED', 'INVALID_VECTOR'])

export class EmbeddingWorker implements LocalEmbedder {
  private worker: UtilityProcess | null = null
  private sequence = 0
  private pending: { id: number; resolve: (vector: number[]) => void; reject: (error: Error) => void; progress: (value: EmbeddingProgress) => void; timeout: ReturnType<typeof setTimeout> } | null = null
  private idle: ReturnType<typeof setTimeout> | null = null
  constructor(private options: EmbeddingWorkerOptions) {}
  embed(text: string, progress: (value: EmbeddingProgress) => void): Promise<number[]> {
    if (this.pending) return Promise.reject(new Error('EMBEDDING_BUSY'))
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    try {
      if (!this.worker) {
        // ONNX's native binding cannot be unloaded and re-registered in another
        // worker thread in the same Electron process. A utility process gives
        // every reload a fresh native-module lifetime, including after idle.
        const worker = this.worker = utilityProcess.fork(this.options.workerPath, [], {
          serviceName: 'PeepNote local embeddings',
          execArgv: [],
          env: { ...process.env, HF_TOKEN: '', HUGGING_FACE_HUB_TOKEN: '' }
        })
        worker.on('message', message => {
          if (this.worker !== worker) return
          const pending = this.pending
          if (!pending) return
          if (message.type === 'download') { pending.progress({ stage: 'downloading', progress: message.progress }); return }
          if (message.type === 'indexing') { pending.progress({ stage: 'indexing' }); return }
          if (message.id !== pending.id) return
          clearTimeout(pending.timeout); this.pending = null
          if (message.type === 'result' && (Array.isArray(message.vector) || ArrayBuffer.isView(message.vector))) pending.resolve(Array.from(message.vector as ArrayLike<number>))
          else pending.reject(new Error(`LOCAL_EMBEDDING_${CHILD_ERRORS.has(message.code) ? message.code : 'INFERENCE_FAILED'}`))
          this.idle = setTimeout(() => this.dispose(), this.options.idleMs ?? 30_000); this.idle.unref()
        })
        worker.on('exit', () => { if (this.worker === worker) this.stop('LOCAL_EMBEDDING_PROCESS_EXIT') })
      }
      const config = {
        modulePath: this.options.modulePath ?? require.resolve('@huggingface/transformers'), cacheDir: this.options.cacheDir,
        model: EMBEDDING_MODEL, revision: EMBEDDING_REVISION, dimensions: EMBEDDING_DIMENSIONS, offline: !!this.options.offline
      }
      return new Promise((resolve, reject) => {
        const id = ++this.sequence
        const timeout = setTimeout(() => this.stop('LOCAL_EMBEDDING_TIMEOUT'), 10 * 60_000); timeout.unref()
        this.pending = { id, resolve, reject, progress, timeout }
        try { this.worker!.postMessage({ id, text, config }) }
        catch { this.stop('LOCAL_EMBEDDING_PROCESS_FAILED') }
      })
    } catch {
      this.stop('LOCAL_EMBEDDING_PROCESS_FAILED')
      return Promise.reject(new Error('LOCAL_EMBEDDING_PROCESS_FAILED'))
    }
  }
  private stop(code: string) {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const pending = this.pending; this.pending = null
    if (pending) { clearTimeout(pending.timeout); pending.reject(new Error(code)) }
    const worker = this.worker; this.worker = null
    if (worker) worker.kill()
  }
  dispose() { this.stop('LOCAL_EMBEDDING_CANCELLED') }
}
