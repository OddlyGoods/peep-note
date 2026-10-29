import { Loader2, Paperclip } from 'lucide-react'
import { useI18n } from '../i18n'

export default function FileDropZone({ onSelect, busy = false, dragging = false, compact = false }: {
  onSelect: () => void
  busy?: boolean
  dragging?: boolean
  compact?: boolean
}) {
  const { t } = useI18n()
  return <button type="button" onClick={onSelect} disabled={busy} aria-label={t('addFiles')} aria-busy={busy}
    data-dragging={dragging}
    className={`file-drop-zone flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed px-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-wait ${compact ? 'min-h-9 py-1.5 text-[11px]' : 'min-h-16 py-3 text-xs'}`}>
    {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Paperclip className="h-3.5 w-3.5 shrink-0" />}
    <span>{t(busy ? 'importingFiles' : dragging ? 'dropFilesActive' : 'dropFiles')}</span>
  </button>
}
