import { useEffect, useState, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import { ko, ja, zhCN } from 'date-fns/locale'
import { Plus, Search, FileText, Layers, X, ArrowUp, Trash2, SlidersHorizontal } from 'lucide-react'
import { useLogStore } from '../stores/logStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { api, LogGroup } from '../lib/api'
import LogCard from '../components/LogCard'
import GroupCard from '../components/GroupCard'
import NewLogModal from '../components/NewLogModal'
import ConfirmModal from '../components/ConfirmModal'
import BulkWorkspaceMoveButton from '../components/BulkWorkspaceMoveButton'
import { useI18n } from '../i18n'
import { useLocation, useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const { language, t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const {
    logs, loading, dateFrom, dateTo, filterType, searchQuery, fetchLogs, fetchActiveDates, deleteLogs, setSearchQuery
  } = useLogStore()

  const { selectedId: selectedWorkspaceId, workspaces } = useWorkspaceStore()

  const [showNewLog, setShowNewLog] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [tagOptions, setTagOptions] = useState<{ tag: string; count: number }[]>([])
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [activeTagIndex, setActiveTagIndex] = useState(0)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const tagMenuRef = useRef<HTMLDivElement>(null)
  const skipNextTagMenuOpen = useRef(false)
  const filteredTagOptions = tagOptions.filter(({ tag }) =>
    tag.toLocaleLowerCase().includes(searchInput.trim().slice(1).toLocaleLowerCase())
  )

  // 그룹 모드
  const [groupMode, setGroupMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [groupToRenameId, setGroupToRenameId] = useState<string | null>(null)
  const [groups, setGroups] = useState<LogGroup[]>([])
  const [groupLoading, setGroupLoading] = useState(false)
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [bulkDeletingLogIds, setBulkDeletingLogIds] = useState<string[]>([])
  const [bulkDeletingGroupIds, setBulkDeletingGroupIds] = useState<string[]>([])
  const [bulkCollapsing, setBulkCollapsing] = useState(false)
  const [deleteTransitionLoading, setDeleteTransitionLoading] = useState(() => Boolean(location.state?.deletionTransition))

  useEffect(() => {
    if (!location.state?.deletionTransition) return
    setDeleteTransitionLoading(true)
    // 이 전환 표시는 삭제 직후 한 번만 사용한다. 남겨 두면 이후 뒤로가기에도 반복된다.
    navigate(location.pathname, { replace: true, state: null })
    window.setTimeout(() => setDeleteTransitionLoading(false), 700)
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    let focusFrame: number | undefined
    const handler = (action: unknown) => {
      if (action === 'openOverlay') setShowNewLog(true)
      if (action === 'openMain' && !showNewLog && !showBulkDeleteConfirm) {
        if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
        focusFrame = requestAnimationFrame(() => {
          searchInputRef.current?.focus({ preventScroll: true })
          searchInputRef.current?.select()
        })
      }
    }
    window.electronAPI?.on('hotkey-triggered', handler)
    return () => {
      window.electronAPI?.off('hotkey-triggered', handler)
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    }
  }, [showNewLog, showBulkDeleteConfirm])

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 1000)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    const value = searchInput.trim()
    if (!value.startsWith('#')) {
      setTagMenuOpen(false)
      return
    }
    if (skipNextTagMenuOpen.current) {
      skipNextTagMenuOpen.current = false
      return
    }
    setActiveTagIndex(0)

    let cancelled = false
    api.logs.statsTags({
      date_from: dateFrom,
      date_to: dateTo,
      workspace_id: selectedWorkspaceId ?? undefined
    }).then(tags => {
      if (!cancelled) {
        setTagOptions(tags)
        setActiveTagIndex(0)
        setTagMenuOpen(true)
      }
    }).catch(() => {
      if (!cancelled) setTagOptions([])
    })
    return () => { cancelled = true }
  }, [searchInput, dateFrom, dateTo, selectedWorkspaceId])

  useEffect(() => {
    if (!tagMenuOpen) return
    const closeMenu = (event: MouseEvent) => {
      if (!tagMenuRef.current?.contains(event.target as Node)) setTagMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTagMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [tagMenuOpen])

  const fetchGroups = useCallback(async () => {
    setGroupLoading(true)
    try {
      const result = await api.groups.list({
        date_from: dateFrom,
        date_to: dateTo,
        workspace_id: selectedWorkspaceId ?? undefined,
        type: filterType || undefined,
        search: searchQuery || undefined
      })
      setGroups(result)
    } catch {}
    setGroupLoading(false)
  }, [dateFrom, dateTo, selectedWorkspaceId, filterType, searchQuery])

  useEffect(() => { fetchGroups() }, [fetchGroups])

  const refresh = () => { fetchLogs(); fetchActiveDates(); fetchGroups() }

  // 그룹화된 log id 집합
  const groupedLogIds = new Set(groups.flatMap(g => g.logs.map(l => l.id)))

  // 그룹 모드는 선택 없이 시작한다.
  const enterGroupMode = () => {
    setSelectedIds([])
    setSelectedGroupIds([])
    setGroupMode(true)
  }

  const exitGroupMode = () => {
    setGroupMode(false)
    setSelectedIds([])
    setSelectedGroupIds([])
  }

  const toggleAll = () => {
    const ungroupedIds = logs.filter(l => !groupedLogIds.has(l.id)).map(l => l.id)
    const groupIds = groups.map(group => group.id)
    if (selectedIds.length === ungroupedIds.length && selectedGroupIds.length === groupIds.length) {
      setSelectedIds([])
      setSelectedGroupIds([])
    } else {
      setSelectedIds(ungroupedIds)
      setSelectedGroupIds(groupIds)
    }
  }

  const handleSave = async () => {
    if (selectedIds.length < 2) return
    const createdGroup = await api.groups.create('', selectedIds, selectedWorkspaceId, language)
    setGroupToRenameId(createdGroup.id)
    setSelectedIds([])
    setSelectedGroupIds([])
    refresh()
  }

  const handleBulkDelete = async () => {
    setShowBulkDeleteConfirm(false)
    const logIds = [...selectedIds]
    const groupIds = [...selectedGroupIds]
    setBulkDeletingLogIds(logIds)
    setBulkDeletingGroupIds(groupIds)
    await new Promise(resolve => window.setTimeout(resolve, 700))
    setBulkCollapsing(true)
    await new Promise(resolve => window.setTimeout(resolve, 280))
    try {
      await Promise.all([
        logIds.length > 0 ? deleteLogs(logIds) : Promise.resolve(),
        ...groupIds.map(id => api.groups.delete(id))
      ])
      setSelectedIds([])
      setSelectedGroupIds([])
      refresh()
    } finally {
      setBulkDeletingLogIds([])
      setBulkDeletingGroupIds([])
      setBulkCollapsing(false)
    }
  }

  const handleBulkMoveComplete = () => {
    setSelectedIds([])
    setSelectedGroupIds([])
    refresh()
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const didFetch = useRef(false)

  // 스크롤 위치 복원 — 첫 fetch 완료 후 복원
  useEffect(() => {
    if (loading || groupLoading) {
      didFetch.current = true
      return
    }
    if (!didFetch.current) return
    const saved = sessionStorage.getItem('dashboard_scroll')
    if (!saved) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = parseInt(saved)
          sessionStorage.removeItem('dashboard_scroll')
        }
      })
    })
  }, [loading, groupLoading])

  const pinnedLogs = logs.filter(l => l.pinned && !groupedLogIds.has(l.id))
  const normalLogs = logs.filter(l => !l.pinned && !groupedLogIds.has(l.id))
  const selectedWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)
  const ungroupedTotal = logs.filter(l => !groupedLogIds.has(l.id)).length
  const selectionCount = selectedIds.length + selectedGroupIds.length
  const allChecked = selectionCount > 0 && selectedIds.length === ungroupedTotal && selectedGroupIds.length === groups.length
  const timelineItems = [
    ...normalLogs.map(log => ({ kind: 'log' as const, createdAt: log.created_at, log })),
    ...groups.map(group => ({ kind: 'group' as const, createdAt: group.created_at, group }))
  ].sort((a, b) => b.createdAt - a.createdAt)
  const dateLocale = language === 'ko' ? ko : language === 'ja' ? ja : language === 'zh' ? zhCN : undefined
  const rangeDateFormat = language === 'ko' ? 'M월 d일' : language === 'ja' || language === 'zh' ? 'M月d日' : 'MMM d'
  const rangeEndDateFormat = language === 'ko' ? 'M월 d일 (EEE)' : language === 'ja' || language === 'zh' ? 'M月d日 (EEE)' : 'EEE, MMM d'
  const selectTag = (tag: string) => {
    const value = `#${tag}`
    skipNextTagMenuOpen.current = true
    setSearchInput(value)
    setSearchQuery(value)
    setTagMenuOpen(false)
  }

  return (
    <div className="relative flex-1 flex flex-col min-w-0 h-full">
      {/* 상단 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
        <div>
          <h1 className="text-lg font-semibold text-white">
            {format(new Date(`${dateFrom}T00:00:00`), rangeDateFormat, dateLocale ? { locale: dateLocale } : undefined)}
            {' — '}
            {format(new Date(`${dateTo}T00:00:00`), rangeEndDateFormat, dateLocale ? { locale: dateLocale } : undefined)}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {selectedWorkspace && <span className="text-indigo-400">{selectedWorkspace.is_default ? t('defaultWorkspace') : selectedWorkspace.name} · </span>}
            {logs.length} {t('records')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {groupMode ? (
            <>
              <button
                onClick={handleSave}
                disabled={selectedIds.length < 2}
                className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-40"
              >
                <Layers className="w-3.5 h-3.5" />
                {t('group')}
              </button>
              <BulkWorkspaceMoveButton
                logIds={selectedIds}
                groupIds={selectedGroupIds}
                currentWorkspaceId={selectedWorkspaceId}
                onMoved={handleBulkMoveComplete}
              />
              <button
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={selectionCount === 0}
                className="selection-delete-button btn-secondary flex h-9 items-center gap-1.5 py-0 text-rose-300 disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('delete')}
              </button>
              <button
                onClick={exitGroupMode}
                title={t('cancel')}
                aria-label={t('cancel')}
                className="management-close-button btn-secondary flex h-9 w-9 items-center justify-center p-0 transition-all duration-150"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={enterGroupMode}
                disabled={ungroupedTotal === 0}
                className="group-mode-button flex h-9 items-center justify-center gap-1.5 px-4 py-0 text-sm font-medium text-gray-300 hover:text-white ring-1 ring-inset ring-gray-700 hover:ring-gray-600 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-300 disabled:hover:ring-gray-700 disabled:hover:bg-transparent"
              >
                <SlidersHorizontal className="w-4 h-4" />
                {t('manage')}
              </button>
              <button onClick={() => setShowNewLog(true)} className="btn-primary flex items-center gap-1.5">
                <Plus className="w-4 h-4" />
                {t('add')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 검색 */}
      <div className="px-6 py-3 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
        <div ref={tagMenuRef} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onFocus={() => { if (searchInput.trim().startsWith('#')) setTagMenuOpen(true) }}
            onKeyDown={e => {
              if (searchInput.trim().startsWith('#') && filteredTagOptions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setTagMenuOpen(true)
                  setActiveTagIndex(index => (index + 1) % filteredTagOptions.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setTagMenuOpen(true)
                  setActiveTagIndex(index => (index - 1 + filteredTagOptions.length) % filteredTagOptions.length)
                  return
                }
                if (e.key === 'Enter' && tagMenuOpen) {
                  e.preventDefault()
                  selectTag(filteredTagOptions[activeTagIndex]?.tag ?? filteredTagOptions[0].tag)
                  return
                }
              }
              if (e.key === 'Enter') {
                setSearchQuery(searchInput)
                setTagMenuOpen(false)
              }
            }}
            className="input pl-8 w-full py-1.5"
          />
          {tagMenuOpen && (
            <div className="absolute z-30 left-0 right-0 mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-1.5 shadow-xl">
              {filteredTagOptions.length > 0 ? (
                filteredTagOptions.map(({ tag, count }, index) => {
                    const selected = searchInput.trim() === `#${tag}`
                    const active = index === activeTagIndex
                    return (
                      <button
                        key={tag}
                        type="button"
                        onMouseEnter={() => setActiveTagIndex(index)}
                        onClick={() => selectTag(tag)}
                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors ${selected || active ? 'bg-violet-500/20 text-violet-200' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
                      >
                        <span className="min-w-0 truncate text-violet-300">#{tag}</span>
                        <span className="ml-3 rounded-full bg-gray-800 px-2 py-0.5 text-[11px] text-gray-400">{count}</span>
                      </button>
                    )
                  })
              ) : (
                <p className="px-2.5 py-3 text-center text-xs text-gray-500">{t('noTagsInRange')}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 로그 목록 */}
      <div
        ref={scrollRef}
        className="dashboard-scroll-area flex-1 overflow-y-auto px-6 pt-6 pb-40"
        onScroll={e => {
          const target = e.target as HTMLDivElement
          sessionStorage.setItem('dashboard_scroll', String(target.scrollTop))
          setShowScrollTop(target.scrollTop > 240)
        }}
      >
        {deleteTransitionLoading ? (
          <div className="space-y-3 animate-pulse" aria-label="Loading records">
            {[0, 1, 2, 3].map(index => (
              <div key={index} className="card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gray-800" />
                  <div className="h-3 rounded bg-gray-800" style={{ width: index % 2 ? '28%' : '38%' }} />
                </div>
                <div className="space-y-2 pl-9">
                  <div className="h-2.5 rounded bg-gray-800/80 w-11/12" />
                  <div className="h-2.5 rounded bg-gray-800/80 w-3/5" />
                </div>
              </div>
            ))}
          </div>
        ) : loading || groupLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 && groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gray-800 flex items-center justify-center mb-3">
              <FileText className="w-6 h-6 text-gray-400" />
            </div>
            <p className="text-gray-400 text-sm font-medium">{t('noRecords')}</p>
            <p className="text-gray-400 text-xs mt-1">{t('createRecord')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 그룹 모드 전체체크 */}
            {groupMode && (ungroupedTotal > 0 || groups.length > 0) && (
              <div className="flex items-center">
                <button
                  onClick={toggleAll}
                  className="selection-toggle text-xs text-violet-400 hover:text-violet-300 px-2 py-1 rounded hover:bg-violet-500/10 transition-colors flex items-center gap-1.5"
                >
                  <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center ${allChecked ? 'bg-violet-600 border-violet-600' : 'border-gray-500'}`}>
                    {allChecked && <span className="block w-1.5 h-1.5 bg-white rounded-sm" />}
                  </div>
                  {allChecked ? t('clearSelection') : t('selectAll')}
                </button>
              </div>
            )}
            {/* 고정 */}
            {pinnedLogs.length > 0 && (
              <div>
                <h2 className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-violet-400 inline-block" />{t('pinned')}
                </h2>
                <div className="space-y-2">
                  {pinnedLogs.map(log => (
                    <LogCard
                      key={log.id}
                      log={log}
                      showCheckbox={groupMode}
                      checked={selectedIds.includes(log.id)}
                      isDeleting={bulkDeletingLogIds.includes(log.id)}
                      isCollapsing={bulkCollapsing && bulkDeletingLogIds.includes(log.id)}
                      onCheck={checked => setSelectedIds(prev =>
                        checked ? [...prev, log.id] : prev.filter(id => id !== log.id)
                      )}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 일반 기록과 그룹을 각각 생성된 시점 순으로 함께 표시 */}
            {timelineItems.length > 0 && (
              <div className="space-y-2">
                {timelineItems.map(item => item.kind === 'group' ? (
                  <GroupCard
                    key={item.group.id}
                    group={item.group}
                    onRefresh={refresh}
                    startEditing={item.group.id === groupToRenameId}
                    onStartEditingHandled={() => setGroupToRenameId(current => current === item.group.id ? null : current)}
                    showCheckbox={groupMode}
                    checked={selectedGroupIds.includes(item.group.id)}
                    isDeleting={bulkDeletingGroupIds.includes(item.group.id)}
                    isCollapsing={bulkCollapsing && bulkDeletingGroupIds.includes(item.group.id)}
                    onCheck={checked => setSelectedGroupIds(previous =>
                      checked ? [...previous, item.group.id] : previous.filter(id => id !== item.group.id)
                    )}
                  />
                ) : (
                  <LogCard
                    key={item.log.id}
                    log={item.log}
                    showCheckbox={groupMode}
                    checked={selectedIds.includes(item.log.id)}
                    isDeleting={bulkDeletingLogIds.includes(item.log.id)}
                    isCollapsing={bulkCollapsing && bulkDeletingLogIds.includes(item.log.id)}
                    onCheck={checked => setSelectedIds(prev =>
                      checked ? [...prev, item.log.id] : prev.filter(id => id !== item.log.id)
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showScrollTop && (
        <button
          type="button"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="dashboard-scroll-top absolute right-7 bottom-7 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-purple-400/65 bg-gray-800 text-purple-300 shadow-lg transition-all hover:scale-105 hover:border-purple-300 hover:bg-purple-400/65 hover:text-white"
          title={t('backToTop')}
        >
          <ArrowUp className="w-4 h-4" strokeWidth={2.8} />
        </button>
      )}

      {showBulkDeleteConfirm && (
        <ConfirmModal
          title={t('deleteLog')}
          message={t('deleteSelectedLogsMessage', { count: selectionCount })}
          confirmLabel={t('delete')}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDeleteConfirm(false)}
        />
      )}

      {showNewLog && (
        <NewLogModal
          workspaceId={selectedWorkspaceId}
          workspaceName={selectedWorkspace ? (selectedWorkspace.is_default ? t('defaultWorkspace') : selectedWorkspace.name) : undefined}
          onClose={() => { setShowNewLog(false); refresh() }}
        />
      )}
    </div>
  )
}
