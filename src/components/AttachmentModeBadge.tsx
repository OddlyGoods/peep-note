import { Copy, Link2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { isLinkedAttachment } from '../../shared/attachments'

export default function AttachmentModeBadge({ reference }: { reference: string }) {
  const { t } = useI18n()
  const linked = isLinkedAttachment(reference)
  const Icon = linked ? Link2 : Copy
  const label = t(linked ? 'attachmentLink' : 'attachmentCopy')
  return <span role="img" aria-label={label} title={label}
    className="tag inline-flex h-5 w-5 shrink-0 items-center justify-center border border-gray-700 bg-gray-800 p-0 text-gray-400">
    <Icon className="h-3 w-3" aria-hidden="true" />
  </span>
}
