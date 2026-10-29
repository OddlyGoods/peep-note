import { Lock } from 'lucide-react'
import { useI18n } from '../i18n'

export default function SecretIconBadge() {
  const { t } = useI18n()
  return (
    <span role="img" aria-label={t('secret')} title={t('secret')}
      className="secret-icon-badge absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border">
      <Lock className="h-2.5 w-2.5" aria-hidden="true" />
    </span>
  )
}
