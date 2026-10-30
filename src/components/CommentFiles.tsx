import { useEffect, useState } from 'react'
import { attachmentMimeType, isImageAttachment } from '../../shared/attachments'
import { useScreenActive } from '../lib/screenActivity'
import AttachmentFileRow from './AttachmentFileRow'
import { useI18n } from '../i18n'

export default function CommentFiles({ files, busy, onRemove }: { files: string[]; busy: boolean; onRemove: (index: number) => void }) {
  const { t } = useI18n()
  const active = useScreenActive()
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const imageKey = JSON.stringify(files.filter(isImageAttachment))
  useEffect(() => {
    if (!active) { setPreviews({}); return }
    const images = JSON.parse(imageKey) as string[]
    if (!images.length) { setPreviews({}); return }
    let cancelled = false
    void Promise.all([...new Set(images)].map(async reference => {
      try {
        const base64 = await window.electronAPI?.readFileAsBase64(reference)
        return base64 ? [reference, `data:${attachmentMimeType(reference)};base64,${base64}`] as const : null
      } catch { return null }
    })).then(entries => {
      if (!cancelled) setPreviews(Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null)))
    })
    return () => { cancelled = true }
  }, [imageKey, active])
  if (!files.length) return null
  return <div className="mt-2 space-y-1.5" aria-label={t('attachmentFiles')}>
    {files.map((reference, index) => <AttachmentFileRow key={`${reference}-${index}`} reference={reference} url={previews[reference]} compact allowOpen actionsOnHover
      removeStyle="hover" disabled={busy} onRemove={() => onRemove(index)} />)}
  </div>
}
