import { useCallback, useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, FileText, Video, X, Lock, File as FileIcon } from 'lucide-react'
import { format } from 'date-fns'
import { ko, ja, zhCN } from 'date-fns/locale'
import { api, Log } from './lib/api'
import { useI18n } from './i18n'
import { QUICK_LIST_RANGE_KEY, readQuickListRange, type QuickListRange } from './lib/quickListRange'

const TYPE = {
  note: { label: 'note', icon: FileText, color: 'var(--quick-note-icon)' },
  screenshot: { label: 'screenshot', icon: ImageIcon, color: 'var(--quick-screenshot-icon)' },
  video: { label: 'video', icon: Video, color: 'var(--quick-video-icon)' },
  summary: { label: 'summary', icon: FileText, color: 'var(--quick-summary-icon)' }
}

function excerpt(log: Log, fallback: string) {
  if (log.is_secret) return '••••••••••••'
  return (log.content || log.title || fallback)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export default function QuickSwitch() {
  const { language, t } = useI18n()
  const [logs, setLogs] = useState<Log[]>([])
  const [selected, setSelected] = useState(0)
  const [moveDirection, setMoveDirection] = useState<'up' | 'down' | null>(null)
  const logsRef = useRef<Log[]>([])
  const selectedRef = useRef(0)
  const pageRef = useRef(1)
  const hasMoreRef = useRef(true)
  const loadingMoreRef = useRef(false)
  const moveLockRef = useRef(false)
  const rangeRef = useRef<QuickListRange>(readQuickListRange())
  const requestVersionRef = useRef(0)

  useEffect(() => {
    const htmlBackground = document.documentElement.style.background
    const bodyBackground = document.body.style.background
    const bodyBackgroundPriority = document.body.style.getPropertyPriority('background')
    document.documentElement.style.background = 'transparent'
    document.body.style.setProperty('background', 'transparent', 'important')
    return () => {
      document.documentElement.style.background = htmlBackground
      document.body.style.setProperty('background', bodyBackground, bodyBackgroundPriority)
    }
  }, [])

  const acquireMoveLock = () => {
    if (moveLockRef.current) return false
    moveLockRef.current = true
    window.setTimeout(() => { moveLockRef.current = false }, 50)
    return true
  }

  const loadRecent = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    const range = readQuickListRange()
    rangeRef.current = range
    logsRef.current = []
    selectedRef.current = 0
    loadingMoreRef.current = false
    hasMoreRef.current = false
    setLogs([])
    setSelected(0)
    try {
      const recent = await api.logs.list({
        page: 1, limit: 10, sort: 'recent',
        date_from: range.dateFrom || undefined, date_to: range.dateTo || undefined
      })
      if (requestVersion !== requestVersionRef.current) return
      logsRef.current = recent
      selectedRef.current = 0
      pageRef.current = 1
      hasMoreRef.current = recent.length === 10
      setLogs(recent)
      setSelected(0)
      setMoveDirection(null)
    } catch {
      if (requestVersion !== requestVersionRef.current) return
      logsRef.current = []
      selectedRef.current = 0
      setLogs([])
    }
  }, [])

  const loadNextPage = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return false
    loadingMoreRef.current = true
    const requestVersion = requestVersionRef.current
    const range = rangeRef.current
    try {
      const nextPage = pageRef.current + 1
      const nextLogs = await api.logs.list({
        page: nextPage, limit: 10, sort: 'recent',
        date_from: range.dateFrom || undefined, date_to: range.dateTo || undefined
      })
      if (requestVersion !== requestVersionRef.current) return false
      pageRef.current = nextPage
      hasMoreRef.current = nextLogs.length === 10
      if (nextLogs.length) {
        logsRef.current = [...logsRef.current, ...nextLogs]
        setLogs([...logsRef.current])
        return true
      }
    } catch {}
    finally {
      if (requestVersion === requestVersionRef.current) loadingMoreRef.current = false
    }
    return false
  }, [])

  const moveNext = useCallback(async () => {
    if (!acquireMoveLock()) return
    const count = logsRef.current.length
    if (!count) return
    let next = selectedRef.current + 1
    if (next >= count) {
      const loaded = await loadNextPage()
      if (!loaded) return
      next = selectedRef.current + 1
    }
    selectedRef.current = next
    setSelected(next)
    setMoveDirection('down')
  }, [loadNextPage])

  const movePrevious = useCallback(() => {
    if (!acquireMoveLock()) return
    const count = logsRef.current.length
    if (!count) return
    const previous = Math.max(selectedRef.current - 1, 0)
    if (previous === selectedRef.current) return
    selectedRef.current = previous
    setSelected(previous)
    setMoveDirection('up')
  }, [])

  const openSelected = useCallback(() => {
    const log = logsRef.current[selectedRef.current]
    if (log) window.electronAPI?.selectQuickLog(log.id)
    else window.electronAPI?.closeQuickSwitch()
  }, [])

  const selectAt = useCallback((index: number) => {
    if (index === selectedRef.current) { openSelected(); return }
    const direction = index > selectedRef.current ? 'down' : 'up'
    selectedRef.current = index
    setSelected(index)
    setMoveDirection(direction)
  }, [openSelected])

  // The first IPC message can arrive before React has attached its listener.
  // Loading on mount guarantees the initial Alt+Q invocation still has data.
  useEffect(() => { loadRecent() }, [loadRecent])

  useEffect(() => {
    const open = () => loadRecent()
    const rangeChanged = (event: StorageEvent) => {
      if (event.key === QUICK_LIST_RANGE_KEY || event.key === null) void loadRecent()
    }
    const next = () => moveNext()
    const previous = () => movePrevious()
    const confirm = () => openSelected()
    window.electronAPI?.on('quick-switch-open', open)
    window.electronAPI?.on('quick-switch-next', next)
    window.electronAPI?.on('quick-switch-previous', previous)
    window.electronAPI?.on('quick-switch-confirm', confirm)
    window.addEventListener('storage', rangeChanged)
    return () => {
      window.electronAPI?.off('quick-switch-open', open)
      window.electronAPI?.off('quick-switch-next', next)
      window.electronAPI?.off('quick-switch-previous', previous)
      window.electronAPI?.off('quick-switch-confirm', confirm)
      window.removeEventListener('storage', rangeChanged)
      requestVersionRef.current += 1
    }
  }, [loadRecent, moveNext, movePrevious, openSelected])

  if (!logs.length) {
    return <div style={emptyStyle}>{t('noRecords')}</div>
  }

  const above = logs[selected - 1]
  const current = logs[selected]!
  const below = logs[selected + 1]
  return (
    <main
      style={shellStyle}
      onWheel={event => {
        event.preventDefault()
        if ((event.target as HTMLElement).closest('button')) return
        if (event.deltaY > 0) void moveNext()
        if (event.deltaY < 0) movePrevious()
      }}
    >
      <style>{`@keyframes quick-switch-rise {
        from { transform: translateY(62px) scale(.93); opacity: var(--quick-enter-opacity); }
        to { transform: translateY(0) scale(1.035); opacity: 1; }
      }
      @keyframes quick-switch-descend {
        from { transform: translateY(-62px) scale(.93); opacity: var(--quick-enter-opacity); }
        to { transform: translateY(0) scale(1.035); opacity: 1; }
      }
      @keyframes quick-switch-leave-up {
        from { transform: translateY(94px) scale(1.035); opacity: 1; }
        to { transform: translateY(0) scale(.93); opacity: var(--quick-leave-opacity); }
      }
      @keyframes quick-switch-leave-down {
        from { transform: translateY(-94px) scale(1.035); opacity: 1; }
        to { transform: translateY(0) scale(.93); opacity: var(--quick-leave-opacity); }
      }`}</style>
      <button
        type="button"
        onClick={() => window.electronAPI?.closeQuickSwitch()}
        style={closeStyle}
        title="Close"
      >
        <X size={14} />
      </button>
      <div style={listStyle}>
        {above ? <QuickItem key={above.id} log={above} language={language} t={t} onClick={() => selectAt(selected - 1)} faded riseToTop={moveDirection === 'down'} /> : <div style={emptySlotStyle} />}
        <QuickItem key={current.id} log={current} language={language} t={t} onClick={openSelected} selected enterFromTop={moveDirection === 'up'} />
        {below ? <QuickItem key={below.id} log={below} language={language} t={t} onClick={() => moveNext()} faded fallToBottom={moveDirection === 'up'} /> : <div style={emptySlotStyle} />}
      </div>
    </main>
  )
}

function QuickItem({ log, language, t, onClick, selected = false, faded = false, riseToTop = false, fallToBottom = false, enterFromTop = false }: { log: Log; language: 'en' | 'ko' | 'ja' | 'zh'; t: (key: any) => string; onClick: () => void; selected?: boolean; faded?: boolean; riseToTop?: boolean; fallToBottom?: boolean; enterFromTop?: boolean }) {
  const config = TYPE[log.log_type] ?? TYPE.note
  const Icon = config.icon
  const dateLocale = language === 'ko' ? ko : language === 'ja' ? ja : language === 'zh' ? zhCN : undefined
  const listDateFormat = language === 'ko' ? 'M월 d일 HH:mm' : language === 'ja' || language === 'zh' ? 'M月d日 HH:mm' : 'MMM d, HH:mm'
  return (
    <article onClick={onClick} style={{ ...itemStyle, ...(selected ? selectedStyle : fadedStyle), ...(riseToTop ? leavingStyle : {}), ...(fallToBottom ? fallingStyle : {}), ...(enterFromTop ? selectedFromTopStyle : {}) }}>
      <div style={{ ...iconStyle, color: config.color }}><Icon size={selected ? 20 : 16} /></div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={metaStyle}>{t(config.label)} · {format(new Date(log.created_at * 1000), listDateFormat, dateLocale ? { locale: dateLocale } : undefined)}</div>
        <div style={{ ...titleStyle, fontSize: selected ? 15 : 13, display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.title || t('untitled')}</span>{log.is_secret && <Lock size={selected ? 14 : 12} style={{ flexShrink: 0 }} />}</div>
        <div style={{ ...excerptStyle, WebkitLineClamp: 2 }}>{excerpt(log, t('noContent'))}</div>
        {(log.attachments?.length ?? 0) > 0 && (
          <div style={quickFooterStyle}>
            <span style={fileBadgeStyle} title={t('attachmentFiles')}>
              <FileIcon size={selected ? 11 : 10} />
              {log.attachments.length}
            </span>
          </div>
        )}
      </div>
      {(log.log_type === 'screenshot' || log.log_type === 'video') && log.file_path && (
        <QuickThumbnail log={log} selected={selected} />
      )}
    </article>
  )
}

function QuickThumbnail({ log, selected }: { log: Log; selected: boolean }) {
  const [source, setSource] = useState<string | null>(null)
  const isVideo = log.log_type === 'video'
  const size: React.CSSProperties = {
    width: selected ? 76 : 56,
    height: selected ? 54 : 42,
    flexShrink: 0,
    overflow: 'hidden',
    borderRadius: 8,
    border: '1px solid var(--medium-border)',
    background: 'var(--quick-icon-bg)'
  }

  useEffect(() => {
    if (!log.file_path) return
    let cancelled = false
    setSource(null)
    window.electronAPI?.readFileAsBase64(log.file_path).then(data => {
      if (!cancelled && data) setSource(`data:${isVideo ? 'video/webm' : 'image/png'};base64,${data}`)
    })
    return () => { cancelled = true }
  }, [log.file_path, isVideo])

  if (!source) return <div style={size} />
  if (isVideo) {
    return (
      <div style={size}>
        <video
          src={source}
          muted
          playsInline
          preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onLoadedMetadata={event => {
            const video = event.currentTarget
            if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.1, video.duration)
          }}
        />
      </div>
    )
  }
  return <img src={source} alt="" style={{ ...size, objectFit: 'cover' }} />
}

const shellStyle: React.CSSProperties = { position: 'relative', height: '100%', color: 'var(--quick-text)', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: 'transparent' }
const listStyle: React.CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', gap: 7, overflow: 'hidden', justifyContent: 'center', padding: '0 12px' }
const closeStyle: React.CSSProperties = { position: 'absolute', right: 12, bottom: 8, zIndex: 10, width: 28, height: 28, display: 'grid', placeItems: 'center', padding: 0, borderRadius: '50%', opacity: .84, color: 'var(--quick-meta)', background: 'var(--quick-faded-bg)', border: '1px solid var(--quick-faded-border)', cursor: 'pointer' }
const itemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid transparent', transition: 'transform .12s ease, opacity .12s ease', flexShrink: 0, cursor: 'pointer' }
const selectedStyle: React.CSSProperties = { minHeight: 116, background: 'var(--quick-selected-bg)', borderColor: 'var(--quick-selected-border)', borderRadius: 18, transform: 'scale(1.035)', boxShadow: 'var(--quick-selected-shadow)', zIndex: 1, animation: 'quick-switch-rise .18s cubic-bezier(.2,.8,.2,1)' }
const fadedStyle: React.CSSProperties = { minHeight: 68, opacity: 'var(--quick-faded-opacity)', background: 'var(--quick-faded-bg)', borderColor: 'var(--quick-faded-border)', transform: 'scale(.93)' }
const emptySlotStyle: React.CSSProperties = { minHeight: 68, flexShrink: 0 }
const leavingStyle: React.CSSProperties = { animation: 'quick-switch-leave-up .18s cubic-bezier(.2,.8,.2,1)' }
const fallingStyle: React.CSSProperties = { animation: 'quick-switch-leave-down .18s cubic-bezier(.2,.8,.2,1)' }
const selectedFromTopStyle: React.CSSProperties = { animation: 'quick-switch-descend .18s cubic-bezier(.2,.8,.2,1)' }
const iconStyle: React.CSSProperties = { width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 10, background: 'var(--quick-icon-bg)' }
const metaStyle: React.CSSProperties = { color: 'var(--quick-meta)', fontSize: 10, marginBottom: 3 }
const titleStyle: React.CSSProperties = { color: 'var(--quick-title)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const excerptStyle: React.CSSProperties = { display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre-wrap', color: 'var(--quick-excerpt)', fontSize: 11, lineHeight: 1.35, marginTop: 4 }
const quickFooterStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', marginTop: 5 }
const fileBadgeStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 17, padding: '1px 6px', borderRadius: 999, border: '1px solid var(--quick-faded-border)', background: 'var(--quick-icon-bg)', color: 'var(--quick-meta)', fontSize: 10, lineHeight: 1 }
const emptyStyle: React.CSSProperties = { height: '100%', display: 'grid', placeItems: 'center', color: 'var(--quick-meta)', fontFamily: 'sans-serif', background: 'var(--overlay-bg)', border: '1px solid var(--medium-border)' }
