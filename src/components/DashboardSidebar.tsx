import { useEffect, useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Image as ImageIcon, Video, FileText, LayoutGrid, Sparkles,
  SlidersHorizontal, FolderOpen, Pencil, Trash2, Check, X as XIcon
} from 'lucide-react'
import { useLogStore } from '../stores/logStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import MiniCalendar from './MiniCalendar'
import ConfirmModal from './ConfirmModal'
import { useI18n } from '../i18n'
import { api } from '../lib/api'

const TYPE_FILTERS = [
  {
    value: '', label: 'all', icon: LayoutGrid,
    activeClass: 'bg-violet-500/15 text-violet-300 border-violet-400/25',
    badgeClass: 'bg-violet-400/15 text-violet-200'
  },
  {
    value: 'note', label: 'note', icon: FileText,
    activeClass: 'bg-sky-500/12 text-sky-300 border-sky-400/20',
    badgeClass: 'bg-sky-400/15 text-sky-200'
  },
  {
    value: 'screenshot', label: 'screenshot', icon: ImageIcon,
    activeClass: 'bg-amber-500/12 text-amber-300 border-amber-400/20',
    badgeClass: 'bg-amber-400/15 text-amber-200'
  },
  {
    value: 'video', label: 'video', icon: Video,
    activeClass: 'bg-rose-500/12 text-rose-300 border-rose-400/20',
    badgeClass: 'bg-rose-400/15 text-rose-200'
  },
  {
    value: 'summary', label: 'summary', icon: Sparkles,
    activeClass: 'bg-emerald-500/12 text-emerald-300 border-emerald-400/20',
    badgeClass: 'bg-emerald-400/15 text-emerald-200'
  }
]

const WORKSPACE_ACCENTS = [
  'bg-sky-500/12 text-sky-300 border-sky-400/25',
  'bg-emerald-500/12 text-emerald-300 border-emerald-400/25',
  'bg-amber-500/12 text-amber-300 border-amber-400/25',
  'bg-rose-500/12 text-rose-300 border-rose-400/25',
  'bg-violet-500/15 text-violet-300 border-violet-400/25'
]

function workspaceActiveClass(id: string, isDefault: boolean) {
  if (isDefault) return 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
  const hash = [...id].reduce((value, char) => ((value << 5) - value + char.charCodeAt(0)) | 0, 0)
  return `border ${WORKSPACE_ACCENTS[Math.abs(hash) % WORKSPACE_ACCENTS.length]}`
}

export default function DashboardSidebar() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const {
    logs, dateFrom, dateTo, rangeTarget, filterType, activeDates,
    fetchLogs, fetchActiveDates, markRecentlyCreated, setDateRange, setRangeTarget, setFilterType
  } = useLogStore()

  const handleDateRangeChange = (from: string, to: string) => {
    setDateRange(from, to)
    if (location.pathname !== '/') navigate('/')
  }

  const handleFilterChange = (type: string) => {
    setFilterType(type)
    if (location.pathname !== '/') navigate('/')
  }

  const {
    workspaces, selectedId: selectedWorkspaceId,
    fetchWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace, setSelectedId
  } = useWorkspaceStore()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({})
  const [workspaceCounts, setWorkspaceCounts] = useState<Record<string, number>>({})
  const [workspaceToDelete, setWorkspaceToDelete] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const newInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchWorkspaces().then(() => {
      fetchLogs()
      fetchActiveDates()
    })
    const handler = async (id?: unknown) => {
      await fetchLogs()
      fetchActiveDates()
      if (typeof id === 'string') markRecentlyCreated(id)
    }
    window.electronAPI?.on('log-created', handler)
    return () => window.electronAPI?.off('log-created', handler)
  }, [])

  useEffect(() => {
    if (selectedWorkspaceId) fetchLogs()
  }, [selectedWorkspaceId])

  useEffect(() => {
    api.logs.statsTypes({ date_from: dateFrom, date_to: dateTo, workspace_id: selectedWorkspaceId ?? undefined })
      .then(rows => setTypeCounts(rows.reduce<Record<string, number>>((counts, row) => {
        counts[row.log_type] = row.count
        return counts
      }, {})))
      .catch(() => setTypeCounts({}))
  }, [dateFrom, dateTo, selectedWorkspaceId, logs.length])

  useEffect(() => {
    api.logs.statsWorkspaces({ date_from: dateFrom, date_to: dateTo })
      .then(rows => setWorkspaceCounts(rows.reduce<Record<string, number>>((counts, row) => {
        if (row.workspace_id) counts[row.workspace_id] = row.count
        return counts
      }, {})))
      .catch(() => setWorkspaceCounts({}))
  }, [dateFrom, dateTo, logs.length])

  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus()
  }, [editingId])

  useEffect(() => {
    if (addingNew && newInputRef.current) newInputRef.current.focus()
  }, [addingNew])

  const confirmEdit = async () => {
    if (editingId && editingName.trim()) await updateWorkspace(editingId, editingName.trim())
    setEditingId(null)
    setEditingName('')
  }

  const confirmAdd = async () => {
    if (newName.trim()) await createWorkspace(newName.trim())
    setAddingNew(false)
    setNewName('')
  }

  const confirmDeleteWorkspace = async () => {
    if (!workspaceToDelete) return
    await deleteWorkspace(workspaceToDelete)
    setWorkspaceToDelete(null)
    fetchLogs()
  }

  return (
    <aside className="w-64 shrink-0 flex flex-col border-r overflow-y-auto" style={{ background: 'var(--side-panel-bg)', borderColor: 'var(--soft-border)' }}>
      {/* 캘린더 */}
      <div className="p-4 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
        <MiniCalendar
          dateFrom={dateFrom}
          dateTo={dateTo}
          rangeTarget={rangeTarget}
          activeDates={activeDates}
          onRangeChange={handleDateRangeChange}
          onRangeTargetChange={setRangeTarget}
        />
      </div>

      {/* 타입 필터 */}
      <div className="p-3 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
        <div className="flex items-center gap-2 mb-2 px-1">
          <SlidersHorizontal className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs text-gray-400 font-medium">{t('filter')}</span>
        </div>
        <div className="space-y-0.5">
          {TYPE_FILTERS.map(({ value, label, icon: Icon, activeClass, badgeClass }) => (
            <button
              key={value}
              onClick={() => handleFilterChange(value)}
              className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs transition-colors ${
                filterType === value
                  ? `border ${activeClass}`
                  : 'sidebar-filter-item text-gray-400 hover:text-gray-200 hover:bg-gray-800/70'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t(label as 'all' | 'note' | 'screenshot' | 'video' | 'summary')}
              <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${
                filterType === value ? badgeClass : 'bg-gray-800/80 text-gray-500'
              }`}>
                {value ? (typeCounts[value] ?? 0) : Object.values(typeCounts).reduce((total, count) => total + count, 0)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 워크스페이스 */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs text-gray-400 font-medium">{t('workspaces')}</span>
          </div>
          <button
            onClick={() => setAddingNew(true)}
            className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors text-base leading-none"
            title={t('newWorkspace')}
          >+</button>
        </div>

        <div className="space-y-0.5">
          {workspaces.map(ws => (
            <div key={ws.id} className="group relative">
              {editingId === ws.id ? (
                <div className="rounded-lg border border-violet-500/35 bg-violet-500/10 p-2 shadow-[0_4px_14px_rgba(79,70,229,0.10)]">
                  <div className="flex items-center gap-1.5">
                    <input
                      ref={editInputRef}
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditingId(null) }}
                      className="flex-1 min-w-0 rounded-md border border-violet-500/30 bg-gray-900/50 px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-violet-400"
                    />
                    <button
                      onClick={confirmEdit}
                      className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center bg-violet-600 text-white hover:bg-violet-500 transition-colors"
                      title={t('save')}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
                      title={t('cancel')}
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setSelectedId(ws.id); if (location.pathname !== '/') navigate('/') }}
                  className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs transition-colors ${
                    selectedWorkspaceId === ws.id
                      ? workspaceActiveClass(ws.id, ws.is_default)
                      : 'workspace-list-item text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  <span className="flex-1 text-left truncate">{ws.is_default ? t('defaultWorkspace') : ws.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full bg-gray-800/80 text-gray-500 ${!ws.is_default ? 'group-hover:hidden' : ''}`}>
                    {workspaceCounts[ws.id] ?? 0}
                  </span>
                  {!ws.is_default && (
                    <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <span onClick={e => { e.stopPropagation(); setEditingId(ws.id); setEditingName(ws.name) }}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-violet-500/15 text-gray-500 hover:text-violet-300 cursor-pointer">
                        <Pencil className="w-3 h-3" />
                      </span>
                      <span onClick={e => { e.stopPropagation(); setWorkspaceToDelete(ws.id) }}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 cursor-pointer">
                        <Trash2 className="w-3 h-3" />
                      </span>
                    </span>
                  )}
                </button>
              )}
            </div>
          ))}

          {addingNew && (
            <div className="rounded-lg border border-violet-500/35 bg-violet-500/10 p-2 shadow-[0_4px_14px_rgba(79,70,229,0.10)]">
              <div className="flex items-center gap-1.5">
                <input
                  ref={newInputRef}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmAdd(); if (e.key === 'Escape') { setAddingNew(false); setNewName('') } }}
                  placeholder={t('workspaceName')}
                  className="flex-1 min-w-0 rounded-md border border-violet-500/30 bg-gray-900/50 px-2.5 py-1.5 text-xs text-gray-200 outline-none placeholder:text-gray-500 focus:border-violet-400"
                />
                <button
                  onClick={confirmAdd}
                  className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center bg-violet-600 text-white hover:bg-violet-500 transition-colors"
                  title={t('save')}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setAddingNew(false); setNewName('') }}
                  className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
                  title={t('cancel')}
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {workspaceToDelete && (
        <ConfirmModal
          title={t('delete')}
          message={t('workspaceDelete')}
          onConfirm={confirmDeleteWorkspace}
          onCancel={() => setWorkspaceToDelete(null)}
        />
      )}
    </aside>
  )
}
