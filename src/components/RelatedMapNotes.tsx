import { useEffect, useState } from 'react'
import { Camera, FileText, Sparkles, Video, Waypoints } from 'lucide-react'
import { format } from 'date-fns'
import type { RelatedMapSnapshot } from '../../shared/knowledgeMap'
import { api } from '../lib/api'
import { useScreenActive } from '../lib/screenActivity'
import { useLogStore } from '../stores/logStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useI18n } from '../i18n'
import { useOpenLog } from './LogNavigationProvider'

const types = {
  note: { icon: FileText, color: 'text-violet-400', background: 'bg-violet-500/10 border-violet-500/20' },
  screenshot: { icon: Camera, color: 'text-blue-400', background: 'bg-blue-500/10 border-blue-500/20' },
  video: { icon: Video, color: 'text-orange-400', background: 'bg-orange-500/10 border-orange-500/20' },
  summary: { icon: Sparkles, color: 'text-amber-400', background: 'bg-amber-500/10 border-amber-500/20' },
}

export default function RelatedMapNotes({ noteId }: { noteId: string }) {
  const active = useScreenActive(), { t } = useI18n(), openLog = useOpenLog()
  const logs = useLogStore(state => state.logs)
  const [result, setResult] = useState<{ id: string; snapshot: RelatedMapSnapshot } | null>(null)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let request = 0
    const load = async () => {
      const version = ++request
      if (timer) clearTimeout(timer)
      try {
        const snapshot = await api.relatedMapNotes(noteId, controller.signal)
        if (controller.signal.aborted || version !== request) return
        setResult({ id: noteId, snapshot })
        if (['downloading', 'indexing'].includes(snapshot.indexing.stage)) timer = setTimeout(() => void load(), 1500)
      } catch { if (!controller.signal.aborted && version === request) setResult(null) }
    }
    const refresh = () => { void load() }
    void load()
    window.addEventListener('focus', refresh)
    window.electronAPI?.on('mcp-data-changed', refresh)
    window.electronAPI?.on('log-created', refresh)
    return () => {
      controller.abort(); if (timer) clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      window.electronAPI?.off('mcp-data-changed', refresh)
      window.electronAPI?.off('log-created', refresh)
    }
  }, [noteId, active, logs])

  const notes = result?.id === noteId ? result.snapshot.notes : []
  if (!notes.length) return null
  return <section className="related-map-notes" aria-label={t('mapRelatedNotes', { count: notes.length })}>
    <div className="flex items-center gap-1.5 mb-2">
      <Waypoints className="w-3.5 h-3.5 text-violet-400" />
      <span className="text-xs font-medium text-gray-400">{t('mapRelatedNotes', { count: notes.length })}</span>
    </div>
    <div className="space-y-1.5">{notes.map(note => {
      const type = types[note.type as keyof typeof types] ?? types.note, Icon = type.icon
      return <button key={note.id} type="button" onClick={() => {
        if (note.workspaceId) useWorkspaceStore.getState().setSelectedId(note.workspaceId)
        openLog(note.id)
      }} className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-800 bg-gray-800/30 hover:bg-gray-800/60 cursor-pointer transition-colors">
        <span className={`shrink-0 w-6 h-6 rounded-md border flex items-center justify-center ${type.background}`}><Icon className={`w-3 h-3 ${type.color}`} /></span>
        <span className="flex-1 text-sm text-gray-300 truncate">{note.title || t('untitled')}</span>
        <span className="text-xs text-gray-500 shrink-0">{format(new Date(note.createdAt * 1000), 'HH:mm')}</span>
      </button>
    })}</div>
  </section>
}
