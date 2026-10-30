import { Download, File as FileIcon, FileOutput, FolderOpen, Image as ImageIcon, Trash2, X } from 'lucide-react'
import { attachmentFilename, formatBytes, isImageAttachment } from '../../shared/attachments'
import { useI18n } from '../i18n'
import AttachmentModeBadge from './AttachmentModeBadge'

export default function AttachmentFileRow({ reference, url, name, size, compact = false, onRemove, allowOpen = !onRemove, removeStyle = 'inline', disabled = false, actionsOnHover = false }: {
  reference: string
  url?: string | null
  name?: string
  size?: number
  compact?: boolean
  onRemove?: () => void
  allowOpen?: boolean
  removeStyle?: 'inline' | 'hover'
  actionsOnHover?: boolean
  disabled?: boolean
}) {
  const { t } = useI18n()
  const filename = name ?? attachmentFilename(reference)
  const image = isImageAttachment(reference)
  const thumbnail = <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg ${compact ? 'h-10 w-12' : 'h-14 w-20'}`}
    style={{ background: 'var(--attachment-thumbnail-bg)', color: 'var(--attachment-thumbnail-text)' }}>
    {image && url ? <img src={url} alt="" className="h-full w-full object-cover" />
      : image ? <ImageIcon className="h-5 w-5" /> : <FileIcon className="h-5 w-5" />}
  </span>

  return <div className={`attachment-file-row group/file flex items-center gap-3 rounded-xl border p-2 ${compact ? '' : 'min-h-16'}`}>
    {!allowOpen ? thumbnail : <button type="button" onClick={() => void window.electronAPI?.openAttachment(reference)}
      title={t('openFile')} aria-label={t('openFile')} className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">{thumbnail}</button>}
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex"><AttachmentModeBadge reference={reference} /></div>
      <p className={`truncate ${compact ? 'text-xs' : 'text-sm'}`} style={{ color: 'var(--title-text)' }} title={filename}>{filename}</p>
      {!!size && <p className="text-[10px] text-gray-400">{formatBytes(size)}</p>}
    </div>
    <div className={`attachment-actions flex shrink-0 items-center gap-1.5 ${actionsOnHover ? 'opacity-0 pointer-events-none transition-opacity group-hover/file:opacity-100 group-hover/file:pointer-events-auto group-focus-within/file:opacity-100 group-focus-within/file:pointer-events-auto' : ''}`}>
      {allowOpen && <>
        <button type="button" onClick={() => void window.electronAPI?.openAttachment(reference)} title={t('openFile')} aria-label={t('openFile')}
          className="attachment-action-button btn-ghost flex h-7 w-7 items-center justify-center p-0"><FileOutput className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => void window.electronAPI?.showAttachmentInFolder?.(reference)} title={t('showInFolder')} aria-label={t('showInFolder')}
          className="attachment-action-button btn-ghost flex h-7 w-7 items-center justify-center p-0"><FolderOpen className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => void window.electronAPI?.downloadAttachment(reference)} title={t('downloadFile')} aria-label={t('downloadFile')}
          className="attachment-action-button btn-ghost flex h-7 w-7 items-center justify-center p-0"><Download className="h-3.5 w-3.5" /></button>
      </>}
      {onRemove && <button type="button" onClick={onRemove} disabled={disabled} title={t('delete')} aria-label={t('delete')}
        className={`attachment-action-button btn-ghost flex h-7 w-7 items-center justify-center p-0 text-red-400 disabled:opacity-40 ${removeStyle === 'hover' ? 'opacity-0 pointer-events-none transition-opacity group-hover/file:opacity-100 group-hover/file:pointer-events-auto group-focus-within/file:opacity-100 group-focus-within/file:pointer-events-auto' : ''}`}>
        {compact && removeStyle === 'inline' ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>}
    </div>
  </div>
}
