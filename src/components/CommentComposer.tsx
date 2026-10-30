import { Pencil, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { useAttachmentPicker } from '../lib/useAttachmentPicker'
import { useFileDrop } from '../lib/useFileDrop'
import type { AttachmentMode } from '../../shared/attachments'
import CommentFiles from './CommentFiles'
import AutoGrowTextarea from './AutoGrowTextarea'

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
    <div className="comment-composer relative min-w-0 overflow-hidden rounded-lg border" data-comment-drop data-dragging={drop.dragging} {...drop.handlers}>
      <div className="relative">
        <AutoGrowTextarea value={content} maxHeight={240} extraLine={false} maxLength={2000} disabled={busy} onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (!event.nativeEvent.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onSubmit() }
          }}
          className="input comment-composer-input min-h-[52px] p-4 pr-14 text-sm" placeholder={t('commentPlaceholder')} aria-label={t('commentPlaceholder')} />
        <button type="button" onClick={onSubmit} disabled={busy || (!content.trim() && !files.length)} title={t('addComment')} aria-label={t('addComment')}
          className="comment-submit absolute inset-y-0 right-0 flex w-11 items-center justify-center border-l border-violet-500/20 bg-violet-500/10 text-violet-300 transition-colors hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
        </button>
      </div>
      {files.length > 0 && <div className="px-2 pb-2"><CommentFiles files={files} busy={busy} onRemove={onRemove} /></div>}
      {picker.input}{picker.dialog}
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-red-400">{t('operationFailed')}</p>}
  </>
}
