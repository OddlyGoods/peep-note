import { useScreenActive } from './screenActivity'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Link2, X } from 'lucide-react'
import { useI18n } from '../i18n'
import type { AttachmentMode } from '../../shared/attachments'

export function useAttachmentPicker(onFiles: (files: File[], mode: AttachmentMode) => void | Promise<void>, disabled = false) {
  const { t } = useI18n()
  const active = useScreenActive()
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pending = useRef<File[] | null>(null)
  const modeRef = useRef<AttachmentMode>('copy')
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const close = () => { pending.current = null; setOpen(false) }
  useEffect(() => {
    if (!active || !open) return
    previousFocus.current = document.activeElement as HTMLElement
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-mode]')?.focus()
    const hide = () => { if (document.hidden) close() }
    document.addEventListener('visibilitychange', hide)
    return () => { document.removeEventListener('visibilitychange', hide); previousFocus.current?.focus() }
  }, [active, open])
  const choose = (mode: AttachmentMode) => {
    const files = pending.current
    modeRef.current = mode
    close()
    if (files) void onFiles(files, mode)
    else inputRef.current?.click()
  }
  return {
    selectFiles: () => { if (!disabled) { pending.current = null; setOpen(true) } },
    dropFiles: (files: File[]) => { if (!disabled && files.length) { pending.current = files; setOpen(true) } },
    input: <input ref={inputRef} type="file" multiple className="hidden" onChange={event => {
      const files = Array.from(event.currentTarget.files ?? [])
      event.currentTarget.value = ''
      if (files.length && !disabled) void onFiles(files, modeRef.current)
    }} />,
    dialog: active && open ? createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={event => event.stopPropagation()}>
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={close} />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('attachmentModeTitle')}
          className="relative w-full max-w-sm rounded-xl border p-4 shadow-xl"
          style={{ background: 'var(--modal-bg)', borderColor: 'var(--medium-border)' }}
          onKeyDown={event => {
            event.stopPropagation()
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
            if (event.key === 'Tab') {
              const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
              event.preventDefault()
              buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
            }
          }}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-100">{t('attachmentModeTitle')}</h3>
            <button type="button" onClick={close} title={t('cancel')} aria-label={t('cancel')} className="rounded-md p-1 text-gray-400 hover:bg-violet-500/10"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-2">
            {(['link', 'copy'] as const).map(mode => {
              const Icon = mode === 'link' ? Link2 : Copy
              return <button key={mode} data-mode={mode} type="button" onClick={() => choose(mode)}
                className="attachment-mode-option flex w-full items-start gap-3 rounded-lg border border-gray-700 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
                <span><span className="block text-xs font-medium text-gray-200">{t(mode === 'link' ? 'attachAsLink' : 'attachAsCopy')}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-gray-400">{t(mode === 'link' ? 'attachmentLinkHint' : 'attachmentCopyHint')}</span></span>
              </button>
            })}
          </div>
        </div>
      </div>, document.body) : null,
  }
}
