import { useEffect, useRef } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import type { LogComment } from '../lib/api'
import { useI18n } from '../i18n'
import { useScreenActive } from '../lib/screenActivity'
import { useAttachmentPicker } from '../lib/useAttachmentPicker'
import { useFileDrop } from '../lib/useFileDrop'
import type { AttachmentMode } from '../../shared/attachments'
import CommentFiles from './CommentFiles'
import AutoGrowTextarea from './AutoGrowTextarea'

export default function CommentCard({ comment, date, draft, files, busy, error, onEdit, onChange, onSave, onCancel, onDelete, onFiles, onRemoveFile }: {
  comment: LogComment
  date: string
  draft: string | null
  files: string[]
  busy: boolean
  error: boolean
  onEdit: () => void
  onChange: (content: string) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  onFiles: (files: File[], mode: AttachmentMode) => void | Promise<void>
  onRemoveFile: (index: number) => void
}) {
  const { t } = useI18n()
  const active = useScreenActive()
  const input = useRef<HTMLTextAreaElement>(null)
  const editing = draft !== null
  const picker = useAttachmentPicker(onFiles, busy, { topInset: 40 })
  const drop = useFileDrop(picker.dropFiles, busy)
  useEffect(() => {
    if (editing && active) input.current?.focus({ preventScroll: true })
  }, [editing, active])

  return <article className="comment-card group/comment relative rounded-lg border border-gray-700 bg-gray-800/40 p-4" aria-busy={busy}
    data-comment-drop data-dragging={drop.dragging} {...drop.handlers}>
    {picker.input}{picker.dialog}
    {editing ? <>
      <AutoGrowTextarea inputRef={input} maxHeight={240} className="input comment-edit-input w-full p-4 text-sm" aria-label={t('editComment')}
        value={draft} maxLength={2000} disabled={busy} onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel() }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onSave() }
        }} />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary text-xs">{t('cancel')}</button>
        <button type="button" onClick={onSave} disabled={busy || (!draft.trim() && !files.length && !(!comment.content.trim() && (comment.attachments?.length ?? 0) > 0))} className="btn-primary text-xs">{t('save')}</button>
      </div>
    </> : <>
      {comment.content || !files.length
        ? <p className="whitespace-pre-wrap break-words pr-16 text-sm text-gray-200">{comment.content || t('noContent')}</p>
        : <div className="flex min-h-7 items-center pr-16 text-xs text-gray-400">{t('attachmentFiles')}</div>}
      <div className="comment-actions absolute right-3 top-3 flex items-center gap-1 opacity-0 pointer-events-none transition-opacity group-hover/comment:opacity-100 group-hover/comment:pointer-events-auto group-focus-within/comment:opacity-100 group-focus-within/comment:pointer-events-auto">
        <button type="button" onClick={onEdit} disabled={busy} title={t('editComment')} aria-label={t('editComment')}
          className="btn-ghost flex h-7 w-7 items-center justify-center p-0 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={onDelete} disabled={busy} title={t('deleteComment')} aria-label={t('deleteComment')}
          className="btn-ghost flex h-7 w-7 items-center justify-center p-0 text-red-400 hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </>}
    <CommentFiles files={files} busy={busy} onRemove={onRemoveFile} />
    <p className="mt-1.5 text-[11px] text-gray-500">{date}</p>
    {error && <p role="alert" className="mt-2 text-xs text-red-400">{t('operationFailed')}</p>}
  </article>
}
