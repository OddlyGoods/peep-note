import AttachmentFileRow from './AttachmentFileRow'
import { useI18n } from '../i18n'

export default function CommentFiles({ files, busy, onRemove }: { files: string[]; busy: boolean; onRemove: (index: number) => void }) {
  const { t } = useI18n()
  if (!files.length) return null
  return <div className="mt-2 space-y-1.5" aria-label={t('attachmentFiles')}>
    {files.map((reference, index) => <AttachmentFileRow key={`${reference}-${index}`} reference={reference} compact allowOpen
      removeStyle="hover" disabled={busy} onRemove={() => onRemove(index)} />)}
  </div>
}
