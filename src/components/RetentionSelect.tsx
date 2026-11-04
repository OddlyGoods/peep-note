import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { TRASH_RETENTION_OPTIONS, type TrashRetentionDays } from '../../shared/trashRetention'
import { useI18n } from '../i18n'
import { useScreenActive } from '../lib/screenActivity'

export default function RetentionSelect({ value, onChange }: { value: TrashRetentionDays; onChange: (days: TrashRetentionDays) => void }) {
  const { t } = useI18n(), active = useScreenActive()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (!active) setOpen(false) }, [active])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    menu.current?.querySelector<HTMLButtonElement>('[role=option][aria-selected=true]')?.focus()
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [open])
  return <div ref={menu} className="relative shrink-0 w-28">
    <button ref={trigger} type="button" id="trash-retention-days" aria-label={t('trashRetention')} aria-describedby="trash-retention-description"
      aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(previous => !previous)}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }}
      className="settings-select-trigger input flex items-center justify-between py-[7px] text-[13px] text-left hover:border-violet-400/50">
      <span>{t('retentionDays', { days: value })}</span><ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div role="listbox" aria-label={t('trashRetention')} className="absolute z-20 right-0 left-0 mt-1.5 p-1.5 rounded-lg border border-gray-700 bg-gray-900 shadow-xl"
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]'))
        const index = options.indexOf(document.activeElement as HTMLButtonElement)
        options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
      }}>{TRASH_RETENTION_OPTIONS.map(days => <button key={days} type="button" role="option" aria-selected={days === value}
        onClick={() => { onChange(days); setOpen(false); trigger.current?.focus() }}
        className={`settings-select-option w-full flex items-center justify-between px-2 py-2 rounded-md text-[13px] text-left transition-colors ${days === value ? 'bg-violet-500/15 text-violet-300' : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'}`}>
        <span>{t('retentionDays', { days })}</span>{days === value && <Check className="w-3.5 h-3.5" />}
      </button>)}</div>}
  </div>
}
