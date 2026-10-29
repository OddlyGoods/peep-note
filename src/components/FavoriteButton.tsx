import { useEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import type { Log } from '../lib/api'
import { useLogStore } from '../stores/logStore'
import { useI18n } from '../i18n'

export default function FavoriteButton({ log, onChange, variant = 'compact' }: {
  log: Log
  onChange?: (favorite: number) => void
  variant?: 'compact' | 'detail'
}) {
  const { t } = useI18n()
  const storedFavorite = useLogStore(state => state.logs.find(item => item.id === log.id)?.favorite)
  const savedFavorite = storedFavorite ?? log.favorite
  const [favorite, setFavorite] = useState(!!savedFavorite)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const working = useRef(false)
  useEffect(() => { setFavorite(!!savedFavorite); setError(false) }, [log.id, savedFavorite])
  const label = t(favorite ? 'removeFavorite' : 'addFavorite')

  return <span className="inline-flex items-center gap-1">
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={favorite}
      disabled={busy}
      onClick={async event => {
        event.stopPropagation()
        if (working.current) return
        working.current = true
        setBusy(true)
        setError(false)
        try {
          await useLogStore.getState().updateLog(log.id, { favorite: favorite ? 0 : 1 })
          setFavorite(!favorite)
          onChange?.(favorite ? 0 : 1)
        } catch { setError(true) }
        finally { working.current = false; setBusy(false) }
      }}
      className={`favorite-button ${variant === 'detail' ? 'btn-secondary inline-flex h-[38px] w-[38px] items-center justify-center p-0' : 'p-1.5 rounded-lg'} transition-colors disabled:opacity-40 ${favorite ? 'text-violet-300 bg-violet-500/15' : 'text-gray-400'} hover:text-violet-200 hover:bg-violet-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500`}
    >
      <Star className={variant === 'detail' ? 'w-4 h-4' : 'w-3.5 h-3.5'} fill={favorite ? 'currentColor' : 'none'} />
    </button>
    {error && <span role="alert" className="text-xs text-red-400">{t('operationFailed')}</span>}
  </span>
}
