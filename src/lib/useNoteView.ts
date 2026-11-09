import { useEffect } from 'react'
import { api } from './api'

export function useNoteView(id: string | undefined, active: boolean, ready: boolean) {
  useEffect(() => {
    if (!id || !active || !ready) return
    let viewed = false
    const record = () => {
      if (document.hidden) { viewed = false; return }
      if (viewed) return
      viewed = true
      void api.logs.markViewed(id).catch(() => { viewed = false })
    }
    record()
    document.addEventListener('visibilitychange', record)
    return () => document.removeEventListener('visibilitychange', record)
  }, [id, active, ready])
}
