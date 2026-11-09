import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, FileText, FolderOpen, Waypoints, RefreshCw, Search, X } from 'lucide-react'
import { buildKnowledgeGraph, emptyMapSnapshot, type MapNode, type MapSnapshot } from '../../shared/knowledgeMap'
import { api } from '../lib/api'
import { useScreenActive } from '../lib/screenActivity'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useLogStore } from '../stores/logStore'
import { useI18n } from '../i18n'
import { useOpenLog } from '../components/LogNavigationProvider'
import KnowledgeMapCanvas from '../components/KnowledgeMapCanvas'
import SearchClearButton from '../components/SearchClearButton'
import './KnowledgeMap.css'

export default function KnowledgeMap() {
  const { t } = useI18n(), active = useScreenActive(), openLog = useOpenLog()
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const fetchWorkspaces = useWorkspaceStore(state => state.fetchWorkspaces)
  const logs = useLogStore(state => state.logs)
  const [snapshot, setSnapshot] = useState<MapSnapshot>(emptyMapSnapshot)
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [workspace, setWorkspace] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [refresh, setRefresh] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 200); return () => clearTimeout(timer) }, [query])
  useEffect(() => {
    if (!active) { setMenuOpen(false); return }
    void fetchWorkspaces()
    const refreshMap = () => setRefresh(value => value + 1)
    window.addEventListener('focus', refreshMap)
    window.electronAPI?.on('log-created', refreshMap)
    window.electronAPI?.on('mcp-data-changed', refreshMap)
    return () => { window.removeEventListener('focus', refreshMap); window.electronAPI?.off('log-created', refreshMap); window.electronAPI?.off('mcp-data-changed', refreshMap) }
  }, [active, fetchWorkspaces])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    setLoading(true); setError(false)
    const load = async () => {
      try {
        const result = await api.knowledgeMap(workspace, search, controller.signal)
        if (controller.signal.aborted) return
        setSnapshot(result); setError(false)
        if (['downloading', 'indexing'].includes(result.indexing.stage)) timer = setTimeout(() => void load(), 1500)
      } catch {
        if (!controller.signal.aborted) { setError(true); setSnapshot(emptyMapSnapshot()); timer = setTimeout(() => void load(), 5000) }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [active, workspace, search, refresh, logs])
  useEffect(() => {
    if (!menuOpen) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true)
    menu.current?.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus()
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [menuOpen])

  // Progress polling must not restart a 3D layout when its data is unchanged.
  const graphKey = JSON.stringify([snapshot.notes, snapshot.connections])
  const graph = useMemo(() => buildKnowledgeGraph(snapshot.notes, snapshot.connections), [graphKey])
  const nodeById = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph])
  const current = selected ? nodeById.get(selected) : undefined
  useEffect(() => { if (selected && !nodeById.has(selected)) setSelected(null) }, [selected, nodeById])
  const connections = useMemo(() => {
    if (!current) return []
    return graph.edges.filter(edge => edge.source === current.id || edge.target === current.id)
      .sort((a, b) => b.similarity - a.similarity)
      .map(edge => nodeById.get(edge.source === current.id ? edge.target : edge.source)!).filter(Boolean)
  }, [current, graph, nodeById])
  const workspaceName = (note: NonNullable<MapNode['note']>) => note.workspaceDefault ? t('defaultWorkspace') : note.workspaceName || t('defaultWorkspace')
  const name = (node: MapNode) => node.label || t('mapUntitled')
  const select = (id: string | null) => setSelected(id)
  const readNote = (node: MapNode) => {
    if (!node.note) return
    useWorkspaceStore.getState().setSelectedId(node.note.workspaceId || workspaces.find(item => item.is_default)?.id || null)
    openLog(node.note.id)
  }
  const options = [{ id: '', label: t('mapAllWorkspaces') }, ...workspaces.map(item => ({ id: item.id, label: item.is_default ? t('defaultWorkspace') : item.name }))]

  return <section className="knowledge-map" aria-label={t('knowledgeMap')}>
    <header className="knowledge-header">
      <div><h1><Waypoints size={21} />{t('knowledgeMap')}</h1><p>{t('mapDescription')}</p></div>
      <button type="button" className="knowledge-icon-button" disabled={loading} onClick={() => setRefresh(value => value + 1)} title={t('mapRefresh')} aria-label={t('mapRefresh')}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
    </header>
    <div className="knowledge-toolbar">
      <div className="knowledge-search"><Search size={15} className="shrink-0" /><input aria-label={t('mapSearch')} placeholder={t('mapSearch')} value={query} onChange={event => setQuery(event.target.value)} /><SearchClearButton value={query} onClear={() => { setQuery(''); setSearch('') }} /></div>
      <div className="knowledge-workspaces" ref={menu}>
        <button ref={trigger} type="button" aria-label={t('workspaces')} aria-haspopup="listbox" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setMenuOpen(true) } }}>
          <FolderOpen size={14} /><span>{options.find(item => item.id === workspace)?.label ?? t('mapAllWorkspaces')}</span><ChevronDown size={14} />
        </button>
        {menuOpen && <div role="listbox" aria-label={t('workspaces')} className="knowledge-workspace-options" onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]'))
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
        }}>{options.map(item => <button type="button" role="option" key={item.id} aria-selected={workspace === item.id} onClick={() => { setWorkspace(item.id); setMenuOpen(false); trigger.current?.focus() }}><span>{item.label}</span>{workspace === item.id && <Check size={14} />}</button>)}</div>}
      </div>
    </div>
    <div className="knowledge-body">
      <div className={`knowledge-stage${snapshot.total > snapshot.notes.length ? ' knowledge-stage-limited' : ''}`} aria-busy={loading}>
        <div className="knowledge-stats"><span><i className="knowledge-note-dot" />{t('mapNotes')} <b>{snapshot.notes.length}</b></span><span><i className="knowledge-group-dot" />{t('mapConnections')} <b>{graph.edges.length}</b></span></div>
        {['downloading', 'indexing', 'error'].includes(snapshot.indexing.stage) && <div className="knowledge-index-status" role="status">
          {snapshot.indexing.stage === 'error' ? <><span>{t('mapIndexError')}</span><button onClick={() => { void api.retryKnowledgeMap().then(() => setRefresh(value => value + 1)).catch(() => setError(true)) }}>{t('settingsRetry')}</button></> : <><RefreshCw size={13} className="animate-spin" /><span>{snapshot.indexing.stage === 'downloading' ? t('mapDownloading', { progress: snapshot.indexing.progress ?? 0 }) : t('mapIndexing', { completed: snapshot.indexing.completed, total: snapshot.indexing.total })}</span></>}
        </div>}
        <KnowledgeMapCanvas graph={graph} selected={selected} onSelect={select} />
        {loading && <div className="knowledge-loading" role="status" aria-label={t('loading')}><RefreshCw size={20} className="animate-spin" /></div>}
        {!loading && (!snapshot.notes.length || error) && <div className="knowledge-empty" role="status"><Waypoints size={36} /><h2>{error ? t('mapError') : t('mapEmpty')}</h2><p>{error ? '' : t('mapEmptyHint')}</p>{error && <button className="knowledge-action" onClick={() => setRefresh(value => value + 1)}>{t('mapRefresh')}</button>}</div>}
        {snapshot.total > snapshot.notes.length && <div className="knowledge-map-caption">{t('mapLimit', { shown: snapshot.notes.length, total: snapshot.total })}</div>}
      </div>
      <aside className={`knowledge-inspector${current ? '' : ' knowledge-inspector-empty'}`} data-screen-scroll="knowledge-inspector">
        {current ? <>
          <div className="knowledge-inspector-heading">
            <span className="knowledge-kind"><FileText size={14} />{t('mapNotes')}</span>
            <button className="knowledge-icon-button" onClick={() => select(null)} aria-label={t('close')}><X size={15} /></button>
          </div>
            <h2><button type="button" className="knowledge-selected-note" onClick={() => readNote(current)}><span>{name(current)}</span><ArrowUpRight size={14} aria-hidden="true" /></button></h2>
            <h3>{t('mapConnectedNotes')} <span>{connections.length}</span></h3>
            {!connections.length && <p className="knowledge-muted">{t('mapNoConnections')}</p>}
            <div className="knowledge-node-list">{connections.map(node => <button key={node.id} onClick={() => readNote(node)}><FileText size={14} /><span>{name(node)}<small>{workspaceName(node.note!)}</small></span></button>)}</div>
        </> : <div className="knowledge-intro"><Waypoints size={30} /><h2>{t('mapSelect')}</h2><p>{t('mapSelectHint')}</p></div>}
      </aside>
    </div>
  </section>
}
