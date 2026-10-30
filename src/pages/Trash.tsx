import { useScreenActive } from '../lib/screenActivity'
import { useEffect, useRef, useState } from 'react'
import { Trash2, RotateCcw, Camera, Video, Text as TextIcon, Hash, Code2, Globe, Sparkles, Clock, Check, Search, FolderOpen } from 'lucide-react'
import { api, TrashItem } from '../lib/api'
import { useI18n } from '../i18n'
import { useLogStore } from '../stores/logStore'
import ConfirmModal from '../components/ConfirmModal'
import SecretIconBadge from '../components/SecretIconBadge'
import type { TrashRetentionDays } from '../../shared/trashRetention'

const TYPE_CONFIG = {
  note: { icon: TextIcon, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
  screenshot: { icon: Camera, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  video: { icon: Video, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  summary: { icon: Sparkles, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' }
}

const NOTE_ICONS = { text: TextIcon, markdown: Hash, code: Code2, html: Globe }

type Confirmation = { kind: 'selected' | 'all'; ids: string[] }

export default function Trash() {
  const active = useScreenActive()
  const { t, language } = useI18n()
  const [retentionDays, setRetentionDays] = useState<TrashRetentionDays | null>(null)
  const [items, setItems] = useState<TrashItem[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const working = useRef(false)
  const refresh = async () => {
    const [rows, retention] = await Promise.all([api.trash.list(), api.trash.retention()])
    setRetentionDays(retention.days)
    setItems(rows)
    setSelected(prev => prev.filter(id => rows.some(row => row.id === id)))
  }
  useEffect(() => { if (active) void refresh().catch(() => setError(true)).finally(() => setLoading(false)) }, [active])
  const perform = async (action: 'restore' | 'selected' | 'all', ids = selected) => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError(false)
    setConfirmation(null)
    try {
      if (action === 'all') await api.trash.empty()
      else for (let i = 0; i < ids.length; i += 500) {
        await (action === 'restore' ? api.trash.restore : api.trash.purge)(ids.slice(i, i + 500))
      }
      await refresh()
      await Promise.all([useLogStore.getState().fetchLogs(), useLogStore.getState().fetchActiveDates()])
    } catch { setError(true) }
    finally { working.current = false; setBusy(false) }
  }
  const visibleItems = items.filter(item => (item.title || t('untitled')).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const allChecked = visibleItems.length > 0 && visibleItems.every(item => selected.includes(item.id))
  const toggleItem = (id: string) => {
    if (busy) return
    setSelected(prev => prev.includes(id) ? prev.filter(value => value !== id) : [...prev, id])
  }
  return (
    <main className="relative flex-1 flex flex-col min-w-0 h-full" style={{ background: 'var(--app-bg)' }}>
      <header className="flex items-center justify-between gap-3 px-6 py-4 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
        <div>
          <h1 className="text-lg font-semibold text-white">{t('trash')}</h1>
          <p className="text-xs text-gray-400 mt-0.5">{items.length} {t('records')}{selected.length > 0 && ` · ${selected.length} ${t('select')}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-primary flex h-9 items-center gap-1.5 py-0 disabled:opacity-40" disabled={busy || !selected.length} onClick={() => perform('restore')}><RotateCcw className="w-3.5 h-3.5" />{t('restoreRecord')}</button>
          <button className="selection-delete-button btn-secondary flex h-9 items-center gap-1.5 py-0 text-rose-300 disabled:opacity-40" disabled={busy || !selected.length} onClick={() => setConfirmation({ kind: 'selected', ids: [...selected] })}><Trash2 className="w-3.5 h-3.5" />{t('delete')}</button>
          <button className="selection-delete-button btn-secondary flex h-9 items-center gap-1.5 py-0 text-rose-300 disabled:opacity-40" disabled={busy || !items.length} onClick={() => setConfirmation({ kind: 'all', ids: [] })}><Trash2 className="w-3.5 h-3.5" />{t('emptyTrash')}</button>
        </div>
      </header>
      <div className="px-6 md:px-[84px] py-3 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input className="input pl-8 w-full py-1.5" type="text" value={query} placeholder={t('searchTrash')} aria-label={t('searchTrash')} disabled={busy} onChange={event => { setQuery(event.target.value); setSelected([]) }} />
        </div>
      </div>
      <div className="dashboard-scroll-area flex-1 overflow-y-auto px-6 md:px-[84px] pt-6 pb-40" data-screen-scroll="main" data-screen-scroll-key={query} aria-busy={busy || loading}>
        {retentionDays !== null && <p className="text-xs text-gray-400 mb-4">{t('trashHint', { days: retentionDays })}</p>}
        {error && <p role="alert" className="text-red-400 text-sm mb-4">{t('operationFailed')} <button className="underline" onClick={() => { setError(false); refresh().catch(() => setError(true)) }}>{t('retry')}</button></p>}
        {loading ? (
          <div className="flex items-center justify-center h-48" role="status" aria-label={t('loading')}><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : !visibleItems.length ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gray-800 flex items-center justify-center mb-3"><Trash2 className="w-6 h-6 text-gray-400" /></div>
            <p className="text-gray-400 text-sm font-medium">{t(items.length ? 'noSearchResults' : 'trashEmpty')}</p>
          </div>
        ) : <div className="space-y-4">
          <button disabled={busy} onClick={() => setSelected(allChecked ? [] : visibleItems.map(item => item.id))} className="selection-toggle text-xs text-violet-400 hover:text-violet-300 px-2 py-1 rounded hover:bg-violet-500/10 transition-colors flex items-center gap-1.5 disabled:opacity-40">
            <span className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center ${allChecked ? 'bg-violet-600 border-violet-600' : 'border-gray-500'}`}>{allChecked && <span className="block w-1.5 h-1.5 bg-white rounded-sm" />}</span>
            {allChecked ? t('clearSelection') : t('selectAll')}
          </button>
          <div className="space-y-2">
            {visibleItems.map(item => {
              const cfg = TYPE_CONFIG[item.log_type] ?? TYPE_CONFIG.note
              const Icon = item.log_type === 'note' ? (NOTE_ICONS[item.content_format ?? 'text'] ?? TextIcon) : cfg.icon
              const checked = selected.includes(item.id)
              return <div key={item.id} className={`log-card group card relative overflow-hidden p-4 hover:border-gray-700 hover:bg-gray-800/50 transition-all duration-300 cursor-pointer ${checked ? 'border-violet-500/50 bg-violet-500/5' : ''} ${busy ? 'opacity-50' : ''}`}
                onClick={() => toggleItem(item.id)}>
                <div className="flex items-start gap-3">
                  <button type="button" role="checkbox" aria-checked={checked} aria-label={item.title || t('untitled')} disabled={busy} onClick={event => { event.stopPropagation(); toggleItem(item.id) }} className={`shrink-0 w-4 h-4 mt-2 rounded border-2 flex items-center justify-center transition-colors ${checked ? 'bg-violet-600 border-violet-600' : 'border-gray-600 hover:border-violet-500'}`}>{checked && <Check className="w-2.5 h-2.5 text-white" />}</button>
                  <div className={`relative shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center ${cfg.bg}`}>
                    <Icon className={`w-4 h-4 ${cfg.color}`} />
                    {!!item.is_secret && <SecretIconBadge />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-100 truncate">{item.title || t('untitled')}</h3>
                    {!!item.is_secret && <div className="mt-1 text-xs text-gray-500">••••••••••••</div>}
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1" title={t('deletedOn')}><Clock className="w-3 h-3" />{new Date(item.deleted_at * 1000).toLocaleString(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="tag border bg-indigo-500/10 border-indigo-500/20 text-indigo-400 inline-flex items-center gap-1 max-w-48" title={item.workspace_is_default ? t('defaultWorkspace') : (item.workspace_name || t('defaultWorkspace'))}><FolderOpen className="w-3 h-3 shrink-0" /><span className="truncate">{item.workspace_is_default ? t('defaultWorkspace') : (item.workspace_name || t('defaultWorkspace'))}</span></span>
                      <span>{t('trashDays', { count: Math.max(0, Math.ceil((item.expires_at * 1000 - Date.now()) / 86400000)) })}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button disabled={busy} onClick={event => { event.stopPropagation(); perform('restore', [item.id]) }} title={t('restoreRecord')} aria-label={`${t('restoreRecord')}: ${item.title || t('untitled')}`} className="p-1.5 rounded-lg text-gray-400 hover:text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-40"><RotateCcw className="w-3.5 h-3.5" /></button>
                    <button disabled={busy} onClick={event => { event.stopPropagation(); setConfirmation({ kind: 'selected', ids: [item.id] }) }} title={t('delete')} aria-label={`${t('delete')}: ${item.title || t('untitled')}`} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </div>
            })}
          </div>
        </div>}
      </div>
      {confirmation && <ConfirmModal title={t(confirmation.kind === 'all' ? 'emptyTrash' : 'delete')} message={t('permanentDeleteHint')} confirmLabel={t('delete')} onConfirm={() => perform(confirmation.kind, confirmation.ids)} onCancel={() => setConfirmation(null)} />}
    </main>
  )
}
