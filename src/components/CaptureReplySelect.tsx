import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronUp, Pencil, Text as TextIcon } from 'lucide-react'

export type CaptureReplyMode = 'text' | 'magic-pen'

export default function CaptureReplySelect({ disabled, labels, onReply }: {
  disabled: boolean
  labels: { reply: string; text: string; magicPen: string; method: string }
  onReply: (mode: CaptureReplyMode) => void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<CaptureReplyMode>('text')
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const menuId = useId()
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
  const reply = (next: CaptureReplyMode) => {
    if (disabled) return
    setMode(next)
    setOpen(false)
    trigger.current?.focus()
    onReply(next)
  }
  return <div ref={container} className="capture-reply-select">
    <div className="capture-reply-buttons">
      <button type="button" className="capture-reply-main capture-secondary overlay-close btn-secondary" disabled={disabled}
        onClick={() => reply(mode)}>
        {mode === 'text' ? <TextIcon size={14} /> : <Pencil size={14} />}{labels.reply}
      </button>
      <button ref={trigger} type="button" className="capture-reply-trigger capture-secondary overlay-close btn-secondary" disabled={disabled}
        aria-label={labels.method} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(previous => !previous)}
        onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}>
        <ChevronUp size={12} className={open ? 'rotate-180' : ''} />
      </button>
    </div>
    {open && <div id={menuId} role="listbox" aria-label={labels.method} className="capture-reply-menu"
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]'))
        const index = options.indexOf(document.activeElement as HTMLButtonElement)
        options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
      }}>
      {(['text', 'magic-pen'] as const).map(value => <button key={value} type="button" role="option" aria-selected={mode === value}
        onClick={() => reply(value)}>
        {value === 'text' ? <TextIcon size={14} /> : <Pencil size={14} />}
        <span>{value === 'text' ? labels.text : labels.magicPen}</span>
        {mode === value && <Check size={13} />}
      </button>)}
    </div>}
  </div>
}
