import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useI18n } from '../i18n'
import type { CaptureAnalysisState } from '../../shared/captureAnalysis'

export default function CaptureWorkspaceSelect({ items, value, disabled, onChange }: {
  items: CaptureAnalysisState['workspaces']; value: string | null; disabled: boolean; onChange: (id: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const selected = items.find(item => item.id === value)
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    container.current?.querySelector<HTMLButtonElement>('[role=option][aria-selected=true]')?.focus()
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [open])
  return <div ref={container} className="relative min-w-0">
    <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={t('workspaces')} disabled={disabled || !items.length}
      onClick={() => setOpen(previous => !previous)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}
      className="capture-workspace-trigger flex h-7 max-w-44 items-center gap-1 rounded-md px-2.5 text-xs leading-none transition-colors hover:brightness-110"
      style={{ background: 'var(--workspace-badge-bg)', color: 'var(--workspace-badge-text)', border: '1px solid var(--workspace-badge-border)' }}>
      <span className="truncate">{selected ? selected.isDefault ? t('defaultWorkspace') : selected.name : t('workspaces')}</span>
      <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div role="listbox" aria-label={t('workspaces')}
      className="absolute bottom-full left-0 z-40 mb-1 min-w-44 max-w-64 overflow-hidden rounded-lg p-1 shadow-xl"
      style={{ background: 'var(--overlay-bg)', border: '1px solid var(--medium-border)' }}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]'))
        const index = options.indexOf(document.activeElement as HTMLButtonElement)
        options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
      }}>
      <div className="max-h-48 overflow-y-auto">{items.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === value}
        onClick={() => { onChange(item.id); setOpen(false); trigger.current?.focus() }}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-violet-500/15"
        style={{ color: item.id === value ? 'var(--workspace-badge-text)' : 'var(--title-text)' }}>
        <span className="min-w-0 flex-1 truncate">{item.isDefault ? t('defaultWorkspace') : item.name}</span>
        {item.id === value && <Check className="h-3.5 w-3.5 shrink-0 text-violet-400" />}
      </button>)}</div>
    </div>}
  </div>
}
