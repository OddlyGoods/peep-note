import { useI18n } from '../i18n'
import { isLinkedAttachment } from '../../shared/attachments'

export default function AttachmentModeBadge({ reference }: { reference: string }) {
  const { t } = useI18n()
  return <span className="tag shrink-0 border border-gray-700 bg-gray-800 text-gray-400">{t(isLinkedAttachment(reference) ? 'attachmentLink' : 'attachmentCopy')}</span>
}
