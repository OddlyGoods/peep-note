// Runs only local inference. Network access is limited to downloading the
// pinned public model; note text is never part of a network request.
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs'), path = require('node:path')
const nativeFetch = globalThis.fetch
globalThis.fetch = (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  const method = options.method || input.method || 'GET'
  if (!['GET', 'HEAD'].includes(method) || url.protocol !== 'https:' || url.hostname !== 'huggingface.co') return Promise.reject(new Error('MODEL_DOWNLOAD_ONLY'))
  return nativeFetch(input, options)
}
let extractor, loading
async function model() {
  if (extractor) return extractor
  if (!loading) loading = (async () => {
    const { pipeline, env } = require(workerData.modulePath)
    env.cacheDir = workerData.cacheDir; env.allowLocalModels = true; env.localModelPath = workerData.cacheDir + path.sep; env.useBrowserCache = false
    env.allowRemoteModels = !workerData.offline
    const marker = path.join(workerData.cacheDir, 'ready-' + workerData.revision)
    const localOnly = fs.existsSync(marker)
    let lastProgress = 0
    const pipe = await pipeline('feature-extraction', workerData.model, {
      revision: workerData.revision, dtype: 'q8', device: 'cpu', local_files_only: localOnly || !!workerData.offline,
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
      progress_callback: event => {
        if (!localOnly && event.file?.endsWith('.onnx') && (event.status === 'progress' || event.status === 'done') && Date.now() - lastProgress > 120) {
          lastProgress = Date.now(); parentPort.postMessage({ type: 'download', progress: event.status === 'done' ? 100 : Math.round(event.progress || 0) })
        }
      }
    })
    fs.mkdirSync(workerData.cacheDir, { recursive: true }); fs.writeFileSync(marker, '', { mode: 0o600 })
    extractor = pipe
    return pipe
  })()
  return loading
}
parentPort.on('message', async ({ id, text }) => {
  try {
    const pipe = await model()
    parentPort.postMessage({ type: 'indexing' })
    const tokens = pipe.tokenizer.encode(text, { add_special_tokens: false })
    const vector = new Float32Array(workerData.dimensions)
    // Leave room for the prefix and special tokens; overlap adjacent chunks.
    for (let start = 0; start < tokens.length; start += 416) {
      const chunk = pipe.tokenizer.decode(tokens.slice(start, start + 480), { skip_special_tokens: true })
      const output = await pipe('query: ' + chunk, { pooling: 'mean', normalize: true, truncation: true, max_length: 512 })
      const weight = Math.min(416, tokens.length - start)
      for (let i = 0; i < vector.length; i++) vector[i] += output.data[i] * weight
      if (start + 480 >= tokens.length) break
    }
    let norm = 0
    for (const value of vector) norm += value * value
    norm = Math.sqrt(norm)
    if (!norm || vector.some(value => !Number.isFinite(value))) throw new Error('INVALID_VECTOR')
    for (let i = 0; i < vector.length; i++) vector[i] /= norm
    parentPort.postMessage({ type: 'result', id, vector }, [vector.buffer])
  } catch {
    // Never include note text, local paths or credentials in error messages.
    parentPort.postMessage({ type: 'error', id })
    loading = null
  }
})
