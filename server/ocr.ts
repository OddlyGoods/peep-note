import fs from 'fs'
import path from 'path'
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import { getUserDataPath, queryAll, queryOne, run } from './db'
import { formatOcrText } from './ocrText'
import { imageMediaPaths, readableMediaPath } from './media'

type OcrRow = { id: string; file_path: string | null; attachments: string; log_type: string }
let running: Promise<void> | null = null
let scheduled: ReturnType<typeof setTimeout> | null = null
const candidates = "deleted_at IS NULL AND is_secret = 0 AND (log_type = 'screenshot' OR attachments != '[]')"

async function withTimeout<T>(promise: Promise<T>, milliseconds = 60_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('OCR timed out')), milliseconds)
    })])
  } finally { clearTimeout(timer!) }
}

export async function createLocalOcrWorker(): Promise<Worker> {
  // Copy bundled models to a real local directory that a Node worker can read
  // in both development and packaged Electron (ASAR) installations.
  const langPath = path.join(getUserDataPath(), 'ocr-models', 'best-int-v1')
  fs.mkdirSync(langPath, { recursive: true })
  for (const code of ['eng', 'kor']) {
    const source = require.resolve(`@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`)
    const target = path.join(langPath, `${code}.traineddata.gz`)
    if (!fs.existsSync(target) || fs.statSync(target).size !== fs.statSync(source).size) {
      fs.copyFileSync(source, target)
    }
  }
  const workerPath = require.resolve('tesseract.js/src/worker-script/node/index.js')
    .replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
  let expired = false
  let initialized: Worker | null = null
  const creating = createWorker('kor+eng', OEM.LSTM_ONLY, { workerPath, langPath, cacheMethod: 'none', errorHandler: () => {} })
  void creating.then(worker => { if (expired) void worker.terminate() }).catch(() => {})
  try {
    const worker = await withTimeout(creating)
    initialized = worker
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    return worker
  } catch (error) { expired = true; if (initialized) await initialized.terminate(); throw error }
}

export function scheduleOcr() {
  if (running || scheduled) return
  scheduled = setTimeout(() => {
    scheduled = null
    void processOcrQueue()
  }, 250)
  scheduled.unref?.()
}

export function processOcrQueue(): Promise<void> {
  if (running) return running
  running = (async () => {
    let worker: Worker | null = null
    try {
      for (;;) {
        const row = queryOne<OcrRow>(`SELECT id, file_path, attachments, log_type FROM logs WHERE ${candidates} AND ocr_status = 'pending' ORDER BY created_at DESC LIMIT 1`)
        if (!row) break
        run("UPDATE logs SET ocr_status = 'processing' WHERE id = ?", [row.id])
        try {
          const paths = imageMediaPaths({ ...row, file_path: row.log_type === 'screenshot' ? row.file_path : null })
          if (!paths.length) throw new Error('OCR image is unavailable')
          const texts: string[] = []
          for (const file of new Set(paths)) {
            const resolved = readableMediaPath(file)
            if (!resolved) throw new Error('OCR image is unavailable')
            const stat = await fs.promises.stat(resolved)
            if (!stat.isFile() || stat.size > 40 * 1024 * 1024) throw new Error('OCR image is too large')
            worker ??= await createLocalOcrWorker()
            const image = await fs.promises.readFile(resolved)
            const result = await withTimeout(worker.recognize(image, {}, { text: true, blocks: true }))
            texts.push(formatOcrText(result.data.text, result.data.blocks))
          }
          // Editing an image resets the status; a stale job must not overwrite it.
          run(`UPDATE logs SET ocr_text = ?, ocr_status = 'done' WHERE id = ? AND ${candidates}
            AND ocr_status = 'processing' AND file_path IS ? AND attachments = ?`,
            [texts.join(' ').slice(0, 200_000), row.id, row.file_path, row.attachments])
        } catch (error) {
          console.warn('OCR indexing failed for record:', row.id, error instanceof Error ? error.message : error)
          run("UPDATE logs SET ocr_status = 'error' WHERE id = ? AND ocr_status = 'processing'", [row.id])
          if (worker) { await worker.terminate(); worker = null }
        }
        // Yield between images so the local API remains responsive.
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    } finally {
      if (worker) await worker.terminate()
    }
  })().catch(error => { console.error('OCR queue failed:', error) }).finally(() => {
    running = null
    if (queryOne(`SELECT id FROM logs WHERE ${candidates} AND ocr_status = 'pending' LIMIT 1`)) scheduleOcr()
  })
  return running
}

export function ocrStatus(userId: string) {
  const rows = queryAll<{ ocr_status: string; count: number }>(`SELECT ocr_status, COUNT(*) AS count FROM logs WHERE ${candidates} AND user_id = ? GROUP BY ocr_status`, [userId])
  return Object.fromEntries(rows.map(row => [row.ocr_status, row.count])) as Record<string, number>
}
