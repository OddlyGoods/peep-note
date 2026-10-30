import { Paperclip, Pencil, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { useAttachmentPicker } from '../lib/useAttachmentPicker'
import { useFileDrop } from '../lib/useFileDrop'
import type { AttachmentMode } from '../../shared/attachments'
import CommentFiles from './CommentFiles'

export default function CommentComposer({ content, files, busy, error, onChange, onFiles, onRemove, onSubmit }: {
  content: string; files: string[]; busy: boolean; error: boolean
  onChange: (content: string) => void
  onFiles: (files: File[], mode: AttachmentMode) => void | Promise<void>
  onRemove: (index: number) => void
  onSubmit: () => void
}) {
  const { t } = useI18n()
  const picker = useAttachmentPicker(onFiles, busy, { topInset: 40 })
  const drop = useFileDrop(picker.dropFiles, busy)
  return <>
    <div className="flex items-end gap-2">
      <div className="comment-composer relative min-w-0 flex-1 rounded-lg border" data-comment-drop data-dragging={drop.dragging} {...drop.handlers}>
        <textarea value={content} maxLength={2000} disabled={busy} onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (!event.nativeEvent.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onSubmit() }
          }}
          className="input comment-composer-input min-h-[42px] resize-y py-2 pr-11 text-sm" placeholder={t('commentPlaceholder')} rows={1} />
        <button type="button" onClick={picker.selectFiles} disabled={busy} title={t('addFiles')} aria-label={t('addFiles')}
          className="btn-ghost absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center p-0"><Paperclip className="h-3.5 w-3.5" /></button>
        {files.length > 0 && <div className="px-2 pb-2"><CommentFiles files={files} busy={busy} onRemove={onRemove} /></div>}
        {picker.input}{picker.dialog}
      </div>
      <button type="button" onClick={onSubmit} disabled={busy || (!content.trim() && !files.length)} title={t('addComment')} aria-label={t('addComment')}
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg border border-violet-500/40 bg-violet-500/15 text-violet-300 transition-colors hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
      </button>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-red-400">{t('operationFailed')}</p>}
  </>
}
