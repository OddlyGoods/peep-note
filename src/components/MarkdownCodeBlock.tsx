import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import type { ExtraProps } from 'react-markdown'
import { Check, Copy } from 'lucide-react'
import { useI18n } from '../i18n'

export default function MarkdownCodeBlock({ node: _node, children, ...props }: ComponentPropsWithoutRef<'pre'> & ExtraProps) {
  const { t } = useI18n()
  const codeRef = useRef<HTMLPreElement>(null)
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')

  useEffect(() => () => {
    if (resetRef.current) clearTimeout(resetRef.current)
  }, [])

  const copyCode = async () => {
    const code = codeRef.current?.textContent
    if (code == null) return
    try {
      await navigator.clipboard.writeText(code)
      setStatus('copied')
    } catch {
      setStatus('error')
    }
    if (resetRef.current) clearTimeout(resetRef.current)
    resetRef.current = setTimeout(() => setStatus('idle'), 1500)
  }

  return (
    <div className="markdown-code-block">
      <pre {...props} ref={codeRef}>{children}</pre>
      <button type="button" className="markdown-code-copy" onClick={() => void copyCode()}
        data-state={status} aria-label={t('copyCode')} title={t(status === 'error' ? 'copyFailed' : 'copyCode')}>
        {status === 'copied' ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
        <span aria-live="polite">{t(status === 'copied' ? 'copied' : status === 'error' ? 'copyFailed' : 'copy')}</span>
      </button>
    </div>
  )
}
