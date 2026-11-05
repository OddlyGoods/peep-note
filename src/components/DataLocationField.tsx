import { Copy, FilePlus2, FolderOpen, Loader2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { formatBytes } from '../../shared/attachments'
import type { DataLocationMode } from '../../shared/dataStorage'

export default function DataLocationField({ directory, usage, usageError, changing, disabled, onChoose }: {
  directory: string
  usage: { bytes: number; partial: boolean } | null
  usageError: boolean
  changing: boolean
  disabled: boolean
  onChoose: (mode: DataLocationMode) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <label htmlFor="data-location-path" className="text-gray-400">{t('dataLocation')}</label>
      <span className="flex items-center gap-1.5 text-xs text-gray-400" aria-live="polite"
        title={usage?.partial ? t('dataUsagePartial') : undefined}>
        <span>{t('dataUsage')}:</span>
        {usage ? <span>{formatBytes(usage.bytes)}{usage.partial ? ' *' : ''}</span>
          : usageError ? <span>{t('dataUsageUnavailable')}</span>
          : <Loader2 className="h-3 w-3 animate-spin" aria-label={t('loading')} />}
      </span>
    </div>
    <div ref={container} className="relative">
      <input id="data-location-path" readOnly value={directory || ''} title={directory}
        className="input w-full py-2.5 pr-11 font-mono text-xs" />
      <button ref={trigger} type="button" onClick={() => setOpen(value => !value)} disabled={disabled || changing}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}
        title={t(changing ? 'dataLocationRestarting' : 'changeDataLocation')}
        aria-label={t(changing ? 'dataLocationRestarting' : 'changeDataLocation')}
        className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-violet-500/15 hover:text-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-50 disabled:cursor-not-allowed">
        {changing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
      </button>
      {open && <div ref={menu} id={menuId} role="menu" aria-label={t('changeDataLocation')}
        className="absolute bottom-full right-0 z-30 mb-1.5 w-80 max-w-full rounded-lg border p-1.5 shadow-xl"
        style={{ background: 'var(--modal-bg)', borderColor: 'var(--medium-border)' }}
        onKeyDown={event => {
          const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1
          if (next >= 0) { event.preventDefault(); items[next]?.focus() }
          if (event.key === 'Tab') setOpen(false)
        }}>
        {([
          { mode: 'copy', label: 'dataLocationCopy', hint: 'dataLocationCopyHint', icon: Copy },
          { mode: 'open', label: 'dataLocationOpen', hint: 'dataLocationOpenHint', icon: FolderOpen },
          { mode: 'new', label: 'dataLocationNew', hint: 'dataLocationNewHint', icon: FilePlus2 },
        ] as const).map(({ mode, label, hint, icon: Icon }) => <button key={mode} type="button" role="menuitem"
          className="flex w-full items-start gap-2.5 rounded-md px-3 py-2.5 text-left text-gray-300 transition-colors hover:bg-violet-500/10 focus-visible:bg-violet-500/10 focus-visible:outline-none"
          onClick={() => { setOpen(false); trigger.current?.focus(); onChoose(mode) }}>
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" aria-hidden="true" />
          <span><span className="block text-[13px] font-medium">{t(label)}</span><span className="mt-1 block text-xs leading-relaxed text-gray-400">{t(hint)}</span></span>
        </button>)}
      </div>}
    </div>
  </>
}
