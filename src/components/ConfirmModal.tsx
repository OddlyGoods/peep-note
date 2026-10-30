import { useScreenActive } from '../lib/screenActivity'
import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { useI18n } from '../i18n'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  confirmTone?: 'default' | 'amber'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = true,
  confirmTone = 'default',
  onConfirm,
  onCancel
}: Props) {
  const active = useScreenActive()
  const titleId = useId()
  const messageId = useId()
  const { t } = useI18n()
  const resolvedConfirmLabel = confirmLabel ?? (danger ? t('delete') : t('confirm'))
  const resolvedCancelLabel = cancelLabel ?? t('cancel')
  const questionMatch = message.match(/^([\s\S]*?[?？])\s*([\s\S]+)$/)
  const primaryMessage = questionMatch?.[1] ?? message
  const secondaryMessage = questionMatch?.[2] ?? ''
  // Esc 키로 닫기
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onConfirm, onCancel])

  if (!active) return null

  return createPortal(
    <div className="confirm-overlay fixed inset-x-0 bottom-0 top-10 z-[100] flex items-center justify-center" onClick={e => e.stopPropagation()}>
      {/* 백드롭 */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(1px)' }}
        onClick={onCancel}
      />

      {/* 모달 */}
      <div
        role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}
        className="relative w-full max-w-sm mx-4 flex flex-col"
        style={{
          background: 'var(--modal-bg)',
          border: '1px solid var(--medium-border)',
          borderRadius: '12px',
          boxShadow: 'var(--modal-shadow)'
        }}
      >
        {/* 헤더 */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(99,102,241,0.12)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: danger ? 'rgba(244,63,94,0.10)' : 'rgba(99,102,241,0.12)',
                border: danger ? '1px solid rgba(244,63,94,0.20)' : '1px solid rgba(99,102,241,0.25)'
              }}
            >
              <AlertTriangle className={`w-3.5 h-3.5 ${danger ? 'text-red-400' : 'text-indigo-400'}`} />
            </div>
            <h3 id={titleId} className="text-sm font-semibold text-slate-100">{title}</h3>
          </div>
          <button
            onClick={onCancel}
            className="w-6 h-6 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 내용 */}
        <div id={messageId} className="confirm-message min-h-[80px] px-5 py-4">
          <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">{primaryMessage}</p>
          {secondaryMessage && (
            <p className="mt-1.5 text-xs text-slate-500 leading-relaxed whitespace-pre-wrap">{secondaryMessage}</p>
          )}
        </div>

        {/* 버튼 */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-4"
          style={{ borderTop: '1px solid rgba(99,102,241,0.1)' }}
        >
          <button
            onClick={onCancel}
            className="confirm-cancel px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {resolvedCancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`confirm-action ${danger ? 'confirm-danger' : ''} px-4 py-2 text-sm font-medium text-white rounded-lg transition-all`}
            style={danger ? {
              background: 'rgba(244,63,94,0.14)',
              border: '1px solid rgba(244,63,94,0.30)',
              color: '#fda4af'
            } : confirmTone === 'amber' ? {
              background: 'rgba(245,158,11,0.06)',
              border: '1px solid rgba(251,191,36,0.55)',
              color: '#fbbf24'
            } : {
              background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              boxShadow: '0 0 12px rgba(79,70,229,0.3)'
            }}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>, document.body
  )
}
