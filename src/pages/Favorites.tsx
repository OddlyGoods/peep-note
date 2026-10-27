import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Search, Star } from 'lucide-react'
import { api, type Log } from '../lib/api'
import { useLogStore } from '../stores/logStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useI18n } from '../i18n'
import LogCard from '../components/LogCard'

const PAGE_SIZE = 50

export default function Favorites() {
  const { t } = useI18n()
  const logs = useLogStore(state => state.logs)
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const fetchWorkspaces = useWorkspaceStore(state => state.fetchWorkspaces)
  const [items, setItems] = useState<Log[]>([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const requestRef = useRef(0)
  const pageRef = useRef(1)
  const loadingMoreRef = useRef(false)

  useEffect(() => {
    void fetchWorkspaces()
    const refreshItems = () => setRefresh(value => value + 1)
    window.electronAPI?.on('log-created', refreshItems)
    return () => window.electronAPI?.off('log-created', refreshItems)
  }, [fetchWorkspaces])

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const request = ++requestRef.current
    setLoading(true)
    setError(false)
    setLoadingMore(false)
    loadingMoreRef.current = false
    // Collections deliberately omit the dashboard's dates, type, and workspace.
    api.logs.list({ favorite: true, search, limit: PAGE_SIZE }).then(rows => {
      if (request !== requestRef.current) return
      setItems(rows)
      setHasMore(rows.length === PAGE_SIZE)
      pageRef.current = 1
    }).catch(() => { if (request === requestRef.current) setError(true) })
      .finally(() => { if (request === requestRef.current) setLoading(false) })
    return () => { requestRef.current += 1 }
  }, [logs, search, refresh])

  const loadMore = async () => {
    if (loadingMoreRef.current || loading || !hasMore) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setError(false)
    const request = requestRef.current
    const page = pageRef.current + 1
    try {
      const rows = await api.logs.list({ favorite: true, search, limit: PAGE_SIZE, page })
      if (request !== requestRef.current) return
      setItems(previous => [...previous, ...rows.filter(row => !previous.some(item => item.id === row.id))])
      setHasMore(rows.length === PAGE_SIZE)
      pageRef.current = page
    } catch { if (request === requestRef.current) setError(true) }
    finally {
      if (request === requestRef.current) { setLoadingMore(false); loadingMoreRef.current = false }
    }
  }

  return <main className="relative flex-1 flex flex-col min-w-0 h-full" style={{ background: 'var(--app-bg)' }}>
    <header className="px-6 py-4 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
      <h1 className="text-lg font-semibold text-white">{t('favorites')}</h1>
      <p className="text-xs text-gray-400 mt-0.5">{t('allDatesAndWorkspaces')}</p>
    </header>
    <div className="px-6 py-3 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input className="input pl-8 w-full py-1.5" value={query} onChange={event => setQuery(event.target.value)} aria-label={t('searchPlaceholder')} placeholder={t('searchPlaceholder')} />
      </div>
    </div>
    <div className="dashboard-scroll-area flex-1 overflow-y-auto px-6 pt-6 pb-40" aria-busy={loading || loadingMore}>
      {error && <p role="alert" className="text-red-400 text-sm mb-4">{t('operationFailed')} <button className="underline" onClick={() => setRefresh(value => value + 1)}>{t('retry')}</button></p>}
      {loading ? <div className="flex items-center justify-center h-48" role="status" aria-label={t('loading')}><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
        : !items.length ? <div className="flex flex-col items-center justify-center h-48 text-center">
          <Star className="w-8 h-8 text-gray-400 mb-3" />
          <p className="text-sm text-gray-400">{t(search ? 'noSearchResults' : 'favoritesEmpty')}</p>
          {!search && <p className="text-xs text-gray-500 mt-2">{t('favoritesHint')}</p>}
        </div> : <div className="space-y-3">
          {items.map(log => {
            const workspace = workspaces.find(ws => log.workspace_id ? ws.id === log.workspace_id : ws.is_default)
            return <div key={log.id}>
              <div className="flex items-center gap-1 text-xs text-gray-400 mb-1 px-1"><FolderOpen className="w-3 h-3 shrink-0" /><span className="truncate">{workspace?.is_default ? t('defaultWorkspace') : (workspace?.name || t('defaultWorkspace'))}</span></div>
              <LogCard log={log} basePath="/favorites/log" onMoved={updated => setItems(previous => previous.map(item => item.id === updated.id ? updated : item))} />
            </div>
          })}
          {hasMore && <button className="btn-secondary w-full disabled:opacity-40" disabled={loadingMore} onClick={loadMore}>{t(loadingMore ? 'loading' : 'loadMore')}</button>}
        </div>}
    </div>
  </main>
}
