import { useEffect, useState } from 'react'
import { ScanText } from 'lucide-react'
import { normalizeOcrText } from '../../shared/ocrText'
import { api, Log } from '../lib/api'
import { useI18n } from '../i18n'
import { isImageAttachment } from '../../shared/attachments'

export default function OcrText({ log }: { log: Log }) {
  const { t } = useI18n()
  const [data, setData] = useState(log)
  const [requesting, setRequesting] = useState(false)
  const [failed, setFailed] = useState(false)
  const pending = data.ocr_status === 'pending' || data.ocr_status === 'processing'
  const hasImage = (data.log_type === 'screenshot' && !!data.file_path && isImageAttachment(data.file_path))
    || data.attachments.some(isImageAttachment)
  useEffect(() => { setData(log) }, [log.id, log.ocr_status, log.ocr_text, log.file_path, log.attachments])
  useEffect(() => {
    if (!pending) return
    let cancelled = false
    const timer = setInterval(() => {
      api.logs.get(log.id).then(row => { if (!cancelled) { setData(row); setFailed(false) } }).catch(() => { if (!cancelled) setFailed(true) })
    }, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [log.id, pending])
  const hasResult = data.ocr_status === 'done' || data.ocr_status === 'error'
  const extracting = pending || (requesting && !hasResult)
  const handleAction = async () => {
    if (requesting) return
    setRequesting(true)
    setFailed(false)
    try {
      if (hasResult) await api.logs.deleteOcr(log.id)
      else await api.logs.extractText(log.id)
      setData(prev => ({ ...prev, ocr_status: hasResult ? 'idle' : 'pending', ocr_text: '' }))
      setFailed(false)
    } catch { setFailed(true) }
    finally { setRequesting(false) }
  }
  if (!hasImage) return null
  if (!hasResult) return (
    <div>
      <button
        type="button"
        onClick={handleAction}
        disabled={extracting}
        aria-busy={extracting}
        className="ml-auto flex w-fit items-center gap-1.5 rounded text-xs text-violet-400 hover:text-violet-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-wait"
      >
        <ScanText className="h-3.5 w-3.5" aria-hidden="true" />
        {t('extractText')}
        {extracting && <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" aria-hidden="true" />}
      </button>
      {failed && <p role="alert" className="mt-2 text-right text-xs text-red-400">{t('operationFailed')}</p>}
    </div>
  )
  return <section className="rounded-xl border p-4 mt-4" style={{ borderColor: 'var(--soft-border)', background: 'var(--side-panel-bg)' }}>
    <div className="flex justify-between items-center gap-3">
      <h3 className="text-xs font-medium text-violet-400">{t('extractText')}</h3>
      <button disabled={requesting} className="text-xs text-red-400 hover:underline disabled:opacity-50" onClick={handleAction}>{t(requesting ? 'loading' : 'delete')}</button>
    </div>
    <p className="mt-2 text-sm text-gray-300 whitespace-normal break-words max-h-64 overflow-auto">{failed ? t('operationFailed') : data.ocr_status === 'error' ? t('ocrError') : normalizeOcrText(data.ocr_text || '') || t('ocrEmpty')}</p>
  </section>
}
