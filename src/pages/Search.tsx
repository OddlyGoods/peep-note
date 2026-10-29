import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Search as SearchIcon, Camera, Video, FileText, LayoutGrid, SlidersHorizontal, FolderOpen, X, Sparkles } from 'lucide-react'
import { api, Log } from '../lib/api'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useSearchStore } from '../stores/searchStore'
import LogCard from '../components/LogCard'
import { useI18n } from '../i18n'
import { useTheme } from '../theme'

const TYPE_FILTERS = [
  { value: '', label: 'all', icon: LayoutGrid },
  { value: 'note', label: 'note', icon: FileText },
  { value: 'screenshot', label: 'screenshot', icon: Camera },
  { value: 'video', label: 'video', icon: Video },
  { value: 'summary', label: 'summary', icon: Sparkles }
] as const

export default function Search({ sidebarOnly }: { sidebarOnly?: boolean }) {
  const { language, t } = useI18n()
  const { theme } = useTheme()
  const { workspaces, fetchWorkspaces } = useWorkspaceStore()
  const {
    query, typeFilter, workspaceFilter, dateFrom, dateTo,
    setQuery, setTypeFilter, setWorkspaceFilter, setDateFrom, setDateTo, setMonthRange, clearFilters
  } = useSearchStore()

  const [results, setResults] = useState<Log[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => { fetchWorkspaces() }, [])

  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState(false)
  const [ocrPending, setOcrPending] = useState(0)
  const requestVersion = useRef(0)
  const previousPending = useRef(0)

  const doSearch = useCallback(async (nextPage = 1) => {
    const version = ++requestVersion.current
    setLoading(true)
    setSearched(true)
    setError(false)
    if (nextPage === 1) setResults([])
    try {
      const data = await api.logs.list({
        search: query || undefined,
        type: typeFilter || undefined,
        workspace_id: workspaceFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page: nextPage, limit: 50, sort: 'recent'
      })
      if (version !== requestVersion.current) return
      setResults(prev => nextPage === 1 ? data : [...prev, ...data.filter(row => !prev.some(item => item.id === row.id))])
      setPage(nextPage)
      setHasMore(data.length === 50)
    } catch {
      if (version === requestVersion.current) setError(true)
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [query, typeFilter, workspaceFilter, dateFrom, dateTo])

  useEffect(() => {
    ++requestVersion.current
    const timer = setTimeout(() => {
      if (query || searched) void doSearch()
      else { setResults([]); setLoading(false) }
    }, 300)
    return () => { clearTimeout(timer); ++requestVersion.current }
  }, [doSearch])

  useEffect(() => {
    if (sidebarOnly) return
    let cancelled = false
    const refresh = async () => {
      try {
        const status = await api.logs.ocrStatus()
        if (cancelled) return
        const pending = (status.pending || 0) + (status.processing || 0)
        setOcrPending(pending)
        if (previousPending.current > 0 && pending === 0 && searched) void doSearch()
        previousPending.current = pending
      } catch { /* Search remains available if indexing status is unavailable. */ }
    }
    void refresh()
    const timer = setInterval(refresh, 4000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [doSearch, searched, sidebarOnly])

  const hasFilters = typeFilter || workspaceFilter || dateFrom || dateTo

  const sidebar = (
    <aside className="w-64 shrink-0 flex flex-col border-r" style={{ background: 'var(--side-panel-bg)', borderColor: 'var(--soft-border)' }}>
        {/* 날짜 범위 */}
        <div className="p-4 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-xs text-gray-400 font-medium">{t('dateRange')}</span>
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="search-sidebar-reset text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 rounded px-1 py-0.5 transition-colors">
                <X className="w-3 h-3" />
                {t('reset')}
              </button>
            )}
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('startDate')}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="search-date-input input py-1.5 text-xs w-full"
                style={{ colorScheme: theme }}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">{t('endDate')}</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="search-date-input input py-1.5 text-xs w-full"
                style={{ colorScheme: theme }}
              />
            </div>
          </div>
          <div className="flex gap-1 mt-3">
            {([{ label: 'months3', months: 3 }, { label: 'months6', months: 6 }, { label: 'year1', months: 12 }] as const).map(({ label, months }) => (
              <button
                key={months}
                onClick={() => setMonthRange(months)}
                className="search-date-preset flex-1 py-1 rounded text-xs text-gray-300 hover:text-white transition-colors"
                style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)' }}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        {/* 타입 필터 */}
        <div className="p-3 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
          <div className="flex items-center gap-2 mb-2 px-1">
            <SlidersHorizontal className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs text-gray-400 font-medium">{t('filter')}</span>
          </div>
          <div className="space-y-0.5">
            {TYPE_FILTERS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setTypeFilter(value)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                  typeFilter === value
                    ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30'
                    : 'search-sidebar-item text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        {/* 워크스페이스 필터 */}
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2 px-1">
            <FolderOpen className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs text-gray-400 font-medium">{t('workspaces')}</span>
          </div>
          <div className="space-y-0.5">
            <button
              onClick={() => setWorkspaceFilter('')}
              className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                workspaceFilter === ''
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                  : 'search-sidebar-item text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              {t('all')}
            </button>
            {workspaces.map(ws => (
              <button
                key={ws.id}
                onClick={() => setWorkspaceFilter(ws.id)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                  workspaceFilter === ws.id
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'search-sidebar-item text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {ws.is_default ? t('defaultWorkspace') : ws.name}
              </button>
            ))}
          </div>
        </div>
    </aside>
  )

  if (sidebarOnly) return sidebar

  return (
    <div className="flex h-full" style={{ background: 'var(--app-bg)' }}>
      {sidebar}

      {/* 메인 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 검색 헤더 */}
        <div className="flex h-20 shrink-0 items-center gap-3 px-6 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch()}
              autoFocus
              className="input pl-9 py-2 w-full text-sm"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => doSearch()}
            className="btn-primary -translate-y-px flex items-center gap-1.5"
          >
            <SearchIcon className="w-4 h-4" />
            {t('search')}
          </button>
        </div>

        {/* 결과 */}
        <div className="search-results-scroll-area flex-1 overflow-y-auto px-6 pt-6 pb-40">
          <p className="text-xs text-gray-400 mb-4">{t('ocrHint')}{ocrPending > 0 && <span className="block mt-1" role="status">{t('ocrWorking')} ({ocrPending})</span>}</p>
          {error && <p role="alert" className="text-sm text-red-400 mb-3">{t('operationFailed')} <button className="underline" onClick={() => doSearch()}>{t('retry')}</button></p>}
          {loading && !results.length ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !searched ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <SearchIcon className="w-10 h-10 text-gray-400 opacity-60 mb-3" />
              <p className="text-gray-400 opacity-75 text-sm">{t('enterSearch')}</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-800 flex items-center justify-center mb-3">
                <SearchIcon className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-gray-400 text-sm font-medium">{t('noSearchResults')}</p>
            </div>
          ) : (
            <div>
              <p className="text-xs text-gray-400 mb-4">{t('results', { count: results.length })}</p>
              <div className="space-y-2">
                {results.reduce<React.ReactNode[]>((acc, log, i) => {
                  const d = new Date(log.created_at * 1000)
                  const locale = language === 'ko' ? 'ko-KR' : language === 'ja' ? 'ja-JP' : language === 'zh' ? 'zh-CN' : 'en-US'
                  const weekday = d.toLocaleDateString(locale, { weekday: 'short' })
                  const dateStr = d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) + ` (${weekday})`
                  const pd = i > 0 ? new Date(results[i - 1].created_at * 1000) : null
                  const prevDateStr = pd ? pd.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) + ` (${pd.toLocaleDateString(locale, { weekday: 'short' })})` : null
                  if (dateStr !== prevDateStr) {
                    acc.push(
                      <div key={`date-${dateStr}`} className="flex items-center gap-3 pt-2 pb-1">
                        <span className="text-xs font-medium text-indigo-400/80">{dateStr}</span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(99,102,241,0.2)' }} />
                      </div>
                    )
                  }
                  acc.push(<LogCard key={log.id} log={log} basePath="/search/log" onMoved={updated => {
                    setResults(previous => workspaceFilter && updated.workspace_id !== workspaceFilter
                      ? previous.filter(item => item.id !== updated.id)
                      : previous.map(item => item.id === updated.id ? updated : item))
                  }} />)
                  return acc
                }, [])}
              </div>
              {hasMore && <button className="btn-secondary mt-5" disabled={loading} onClick={() => doSearch(page + 1)}>{t(loading ? 'loading' : 'loadMore')}</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
