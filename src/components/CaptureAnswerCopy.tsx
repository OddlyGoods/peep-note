import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useI18n } from '../i18n'

export default function CaptureAnswerCopy({ content }: { content: string }) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const [busy, setBusy] = useState(false)
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (reset.current) clearTimeout(reset.current) }, [])
  async function copy() {
    if (busy) return
    setBusy(true)
    try {
      // Keep Markdown, code fences and links intact; copy this answer only.
      await navigator.clipboard.writeText(content)
      setStatus('copied')
    } catch { setStatus('error') }
    finally { setBusy(false) }
    if (reset.current) clearTimeout(reset.current)
    reset.current = setTimeout(() => setStatus('idle'), 1500)
  }
  return <button type="button" className="capture-answer-copy" data-state={status} disabled={busy}
    onClick={() => void copy()} aria-label={t('copy')} title={t(status === 'error' ? 'copyFailed' : 'copy')}>
    {status === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    <span aria-live="polite">{t(status === 'copied' ? 'copied' : status === 'error' ? 'copyFailed' : 'copy')}</span>
  </button>
}
