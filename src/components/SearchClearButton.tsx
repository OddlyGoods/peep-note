import { X } from 'lucide-react'
import { useI18n } from '../i18n'
import './SearchClearButton.css'

export default function SearchClearButton({ value, onClear, disabled = false }: {
  value: string; onClear: () => void; disabled?: boolean
}) {
  const { t } = useI18n()
  if (!value) return null
  return <button type="button" className="search-clear-button" aria-label={t('clearSearch')} disabled={disabled}
    onMouseDown={event => event.preventDefault()}
    onClick={event => {
      const input = event.currentTarget.parentElement?.querySelector('input')
      onClear()
      input?.focus({ preventScroll: true })
    }}>
    <X size={14} aria-hidden="true" />
  </button>
}
