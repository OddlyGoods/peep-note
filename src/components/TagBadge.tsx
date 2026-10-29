import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useSearchStore } from '../stores/searchStore'

export default function TagBadge({ tag, className = '' }: { tag: string; className?: string }) {
  const navigate = useNavigate()
  const { t } = useI18n()

  return (
    <button type="button" className={`tag tag-search-button border border-gray-700 bg-gray-800 text-gray-400 ${className}`}
      aria-label={`${t('search')}: #${tag}`}
      onClick={event => {
        event.stopPropagation()
        useSearchStore.getState().searchTag(tag)
        navigate('/search')
      }}>
      #{tag}
    </button>
  )
}
