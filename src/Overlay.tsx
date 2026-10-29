import { useState, useEffect, useRef } from 'react'
import { X, Maximize2, Minimize2, Camera, Video, FileText, Text as TextIcon, StopCircle, Code2, Globe, Hash, Lock, SlidersHorizontal, Paperclip, File as FileIcon, ChevronDown, Check, Loader2 } from 'lucide-react'
import { api, type Workspace } from './lib/api'
import { useI18n } from './i18n'
import { startRegionRecording, RecordingRegion } from './lib/regionRecording'
import { attachmentFilename, type AttachmentMode } from '../shared/attachments'
import { useAttachmentPicker } from './lib/useAttachmentPicker'
import AttachmentModeBadge from './components/AttachmentModeBadge'

type LogType = 'note' | 'screenshot' | 'video'
type ContentFormat = 'text' | 'markdown' | 'code' | 'html'

const TYPES: { value: LogType; label: string; icon: React.ElementType; color: string; accent: string }[] = [
  { value: 'note',       label: 'note',     icon: FileText, color: 'text-violet-400', accent: 'rgba(139,92,246,0.15)' },
  { value: 'screenshot', label: 'screenshot', icon: Camera, color: 'text-blue-400',   accent: 'rgba(96,165,250,0.15)' },
  { value: 'video',      label: 'video',    icon: Video,    color: 'text-orange-400', accent: 'rgba(251,146,60,0.15)' }
]

const FORMATS: { value: ContentFormat; label: string; icon: React.ElementType }[] = [
  { value: 'text', label: 'text', icon: TextIcon },
  { value: 'markdown', label: 'markdown', icon: Hash },
  { value: 'code', label: 'code',   icon: Code2 },
  { value: 'html', label: 'HTML',   icon: Globe }
]

type Attachment = { path: string; name: string; size?: number; url?: string }
type SelectedWorkspace = Pick<Workspace, 'id' | 'name' | 'is_default'>

function formatFileSize(size?: number) {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function getWorkspaceFromStorage(): SelectedWorkspace | null {
  try {
    const raw = localStorage.getItem('openpeepnote_workspace')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export default function Overlay() {
  const { t } = useI18n()
  const [type, setType] = useState<LogType>('note')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [importingFiles, setImportingFiles] = useState(false)
  const [attachmentError, setAttachmentError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [recording, setRecording] = useState(false)
  useEffect(() => {
    void window.electronAPI?.setRecordingActive?.(recording)
    return () => { void window.electronAPI?.setRecordingActive?.(false) }
  }, [recording])
  const [recordingTime, setRecordingTime] = useState(0)
  const [maximized, setMaximized] = useState(false)
  const [format, setFormat] = useState<ContentFormat>('text')
  const [isSecret, setIsSecret] = useState(false)
  const [workspace, setWorkspace] = useState<SelectedWorkspace | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const attachmentsRef = useRef<Attachment[]>([])
  const savedAttachmentsRef = useRef(false)
  const dragDepthRef = useRef(0)
  const attachmentGenerationRef = useRef(0)
  const recordedVideoPathRef = useRef<string | null>(null)
  const discardRecordedVideoRef = useRef(false)
  const savedVideoLogRef = useRef(false)
  const workspaceMenuRef = useRef<HTMLDivElement>(null)

  const refreshWorkspaces = async () => {
    setWorkspaceLoading(true)
    try {
      const nextWorkspaces = await api.workspaces.list()
      const storedWorkspace = getWorkspaceFromStorage()
      const selected = nextWorkspaces.find(item => item.id === storedWorkspace?.id)
        ?? nextWorkspaces.find(item => item.is_default)
        ?? nextWorkspaces[0]
        ?? null

      setWorkspaces(nextWorkspaces)
      if (selected) {
        const nextSelected = { id: selected.id, name: selected.name, is_default: selected.is_default }
        setWorkspace(nextSelected)
        localStorage.setItem('openpeepnote_workspace', JSON.stringify(nextSelected))
      } else {
        setWorkspace(null)
        localStorage.removeItem('openpeepnote_workspace')
      }
    } catch (error) {
      console.error(error)
    } finally {
      setWorkspaceLoading(false)
    }
  }

  const selectWorkspace = (nextWorkspace: Workspace) => {
    const nextSelected = { id: nextWorkspace.id, name: nextWorkspace.name, is_default: nextWorkspace.is_default }
    setWorkspace(nextSelected)
    localStorage.setItem('openpeepnote_workspace', JSON.stringify(nextSelected))
    setWorkspaceMenuOpen(false)
    requestAnimationFrame(() => contentRef.current?.focus())
  }

  const discardUnsavedVideo = () => {
    if (savedVideoLogRef.current) return
    discardRecordedVideoRef.current = true
    const videoPath = recordedVideoPathRef.current
    recordedVideoPathRef.current = null
    if (videoPath) void window.electronAPI?.deleteVideo(videoPath)
  }

  const updateAttachments = (updater: (current: Attachment[]) => Attachment[]) => {
    setAttachments(current => {
      const next = updater(current)
      attachmentsRef.current = next
      return next
    })
  }

  const clearAttachments = (deleteFiles: boolean) => {
    attachmentGenerationRef.current += 1
    const current = attachmentsRef.current
    attachmentsRef.current = []
    setAttachments([])
    if (deleteFiles) current.forEach(attachment => void window.electronAPI?.deleteAttachmentFile(attachment.path))
  }

  useEffect(() => {
    const syncWorkspace = () => setWorkspace(getWorkspaceFromStorage())
    syncWorkspace()
    void refreshWorkspaces()
    contentRef.current?.focus()
    window.electronAPI?.on('screenshot-captured', (path: unknown) => {
      setType('screenshot')
      setFilePath(path as string)
      window.electronAPI?.readFileAsBase64(path as string).then(b64 => {
        if (b64) setPreviewUrl(`data:image/png;base64,${b64}`)
      })
    })
    window.electronAPI?.on('start-recording', () => startRecording())
    window.electronAPI?.on('start-recording-region', (region: unknown) => {
      if (region && typeof region === 'object') void startRecordingFromRegion(region as RecordingRegion)
    })
    window.electronAPI?.on('stop-recording', () => stopRecording())
    const handleVisibilityChange = () => {
      if (document.hidden) {
        discardUnsavedVideo()
        clearAttachments(!savedAttachmentsRef.current)
        savedAttachmentsRef.current = false
        stopRecording()
        setType('note')
        setTitle('')
        setContent('')
        setFilePath(null)
        setPreviewUrl(null)
        setFormat('text')
        setIsSecret(false)
      } else {
        syncWorkspace()
        setWorkspaceMenuOpen(false)
        void refreshWorkspaces()
        requestAnimationFrame(() => contentRef.current?.focus())
      }
    }
    const handleWorkspaceStorage = (event: StorageEvent) => {
      if (event.key === 'openpeepnote_workspace' || event.key === null) syncWorkspace()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('storage', handleWorkspaceStorage)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('storage', handleWorkspaceStorage)
    }
  }, [])

  useEffect(() => {
    if (!workspaceMenuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) setWorkspaceMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [workspaceMenuOpen])

  const handleScreenshot = async (forceChoose = false) => {
    const path = await window.electronAPI?.startSnipping(forceChoose)
    if (path) {
      setFilePath(path)
      const b64 = await window.electronAPI?.readFileAsBase64(path)
      if (b64) setPreviewUrl(`data:image/png;base64,${b64}`)
    }
  }

  const handleSnip = async () => {
    const path = await window.electronAPI?.startSnipping()
    if (!path) return
    const b64 = await window.electronAPI?.readFileAsBase64(path)
    if (!b64) return
    updateAttachments(prev => [...prev, { path, name: attachmentFilename(path), url: `data:image/png;base64,${b64}` }])
  }

  const removeAttachment = (i: number) => {
    const attachment = attachmentsRef.current[i]
    updateAttachments(prev => prev.filter((_, idx) => idx !== i))
    if (attachment) void window.electronAPI?.deleteAttachmentFile(attachment.path)
  }

  const handleDragEnter = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDraggingFiles(true)
  }

  const handleDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDraggingFiles(false)
  }

  const importFiles = async (files: File[], mode: AttachmentMode) => {
    if (!files.length || importingFiles) return
    setImportingFiles(true)
    setAttachmentError(false)
    const generation = attachmentGenerationRef.current
    try {
      const imported = await window.electronAPI?.importAttachments(files, mode) ?? []
      if (generation !== attachmentGenerationRef.current || document.hidden) {
        imported.forEach(attachment => void window.electronAPI?.deleteAttachmentFile(attachment.path))
        return
      }
      const prepared = await Promise.all(imported.map(async attachment => {
        if (!attachment.isImage || !attachment.mimeType) return attachment as Attachment
        const base64 = await window.electronAPI?.readFileAsBase64(attachment.path)
        return { ...attachment, url: base64 ? `data:${attachment.mimeType};base64,${base64}` : undefined }
      }))
      if (generation !== attachmentGenerationRef.current || document.hidden) {
        imported.forEach(attachment => void window.electronAPI?.deleteAttachmentFile(attachment.path))
        return
      }
      updateAttachments(current => [...current, ...prepared])
      setAttachmentError(imported.length !== files.length)
    } catch {
      setAttachmentError(true)
    } finally {
      setImportingFiles(false)
    }
  }

  const attachmentPicker = useAttachmentPicker(importFiles, importingFiles)

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setDraggingFiles(false)
    attachmentPicker.dropFiles(Array.from(event.dataTransfer.files))
  }


  const startRecordingFromRegion = async (region: RecordingRegion) => {
    // A repeated global-hotkey event must not create a second recorder whose
    // stream can no longer be stopped from the UI.
    if (mediaRecorderRef.current?.state === 'recording') return
    discardRecordedVideoRef.current = false
    savedVideoLogRef.current = false
    try {
      const mr = await startRegionRecording(region, async blob => {
        if (mediaRecorderRef.current === mr) mediaRecorderRef.current = null
        const buf = await blob.arrayBuffer()
        const saved = await window.electronAPI?.saveVideo(buf, `video_${Date.now()}.webm`)
        if (!saved) return
        if (discardRecordedVideoRef.current) {
          await window.electronAPI?.deleteVideo(saved)
          return
        }
        recordedVideoPathRef.current = saved
        setPreviewUrl(URL.createObjectURL(blob))
        setFilePath(saved)
      })
      mediaRecorderRef.current = mr
      setType('video')
      setRecording(true)
      setRecordingTime(0)
      recordingStartedAtRef.current = Date.now()
      timerRef.current = window.setInterval(() => {
        if (recordingStartedAtRef.current) {
          setRecordingTime(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000))
        }
      }, 250)
    } catch (e) { console.error(e) }
  }

  const startRecording = async (forceChoose = false) => {
    const region = await window.electronAPI?.selectRecordingRegion(forceChoose)
    if (region) await startRecordingFromRegion(region)
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
    if (timerRef.current !== null) clearInterval(timerRef.current)
    timerRef.current = null
    recordingStartedAtRef.current = null
    setRecording(false)
  }

  const handleTypeChange = (nextType: LogType) => {
    if (nextType === type) return
    if (type === 'video') {
      discardUnsavedVideo()
      stopRecording()
    }
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    setFilePath(null)
    setPreviewUrl(null)
    if (nextType !== 'note') setIsSecret(false)
    setType(nextType)
  }

  const handleSave = async () => {
    if (recording) return
    if (!title.trim() && !content.trim() && !filePath && attachments.length === 0) return
    setSaving(true)
    try {
      const createdLog = await api.logs.create({
        title: title || ({ note: t('note'), screenshot: t('screenshot'), video: t('video') }[type]),
        content,
        log_type: type,
        content_format: type === 'note' ? format : 'text',
        file_path: filePath,
        tags: [],
        attachments: attachments.map(a => a.path),
        workspace_id: workspace?.id ?? null,
        is_secret: type === 'note' && isSecret
      })
      if (type === 'video') savedVideoLogRef.current = true
      savedAttachmentsRef.current = true
      setSaved(true)
      window.electronAPI?.notifyLogCreated(createdLog.id)
      setTimeout(() => { setSaved(false); handleClose() }, 700)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  const handleClose = () => {
    // Hiding a BrowserWindow does not stop getUserMedia/MediaRecorder.
    discardUnsavedVideo()
    clearAttachments(!savedAttachmentsRef.current)
    savedAttachmentsRef.current = false
    stopRecording()
    window.electronAPI?.closeOverlay()
    setTitle(''); setContent(''); setFilePath(null); setPreviewUrl(null)
    setType('note'); setFormat('text'); setIsSecret(false); setRecording(false)
    setAttachmentError(false); setDraggingFiles(false)
    setWorkspaceMenuOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (workspaceMenuOpen) setWorkspaceMenuOpen(false)
      else handleClose()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSave()
  }

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div
      className="relative h-screen w-screen flex items-stretch"
      style={{ background: 'transparent' } as React.CSSProperties}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {draggingFiles && (
        <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-violet-400 bg-violet-950/85 text-sm font-semibold text-violet-200 shadow-2xl">
          <div className="flex flex-col items-center gap-2"><Paperclip className="h-6 w-6" />{t('dropFilesActive')}</div>
        </div>
      )}
      <div
        className="flex-1 flex flex-col overflow-hidden"
        style={{ background: 'var(--overlay-bg)', border: '1px solid var(--medium-border)' }}
      >
        {/* 드래그 타이틀바 */}
        <div
          className="flex items-center justify-between px-3 py-2 shrink-0 cursor-grab active:cursor-grabbing"
          style={{
            WebkitAppRegion: 'drag',
            background: 'var(--titlebar-bg)',
            borderBottom: '1px solid var(--soft-border)'
          } as React.CSSProperties}
        >
          <div className="flex items-center gap-1.5">
            <div style={{ width: 16, height: 16, flexShrink: 0 }}>
              <img src="/icon.png" alt="logo"
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                draggable={false} />
            </div>
            <span className="text-[11px] font-bold tracking-wider translate-y-px" style={{ color: 'var(--title-text)' }}>
              PeepNote
            </span>
            <div ref={workspaceMenuRef} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={workspaceMenuOpen}
                onClick={() => {
                  setWorkspaceMenuOpen(open => !open)
                  if (workspaces.length === 0) void refreshWorkspaces()
                }}
                className="flex max-w-44 items-center gap-1 rounded px-1.5 py-1 text-[10px] leading-none transition-colors hover:brightness-110"
                style={{ background: 'var(--workspace-badge-bg)', color: 'var(--workspace-badge-text)', border: '1px solid var(--workspace-badge-border)' }}
              >
                <span className="truncate">{workspace ? (workspace.is_default ? t('defaultWorkspace') : workspace.name) : t('workspaces')}</span>
                <ChevronDown className={`h-2.5 w-2.5 shrink-0 transition-transform ${workspaceMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {workspaceMenuOpen && (
                <div
                  role="listbox"
                  aria-label={t('workspaces')}
                  className="absolute left-0 top-full z-40 mt-1 min-w-44 max-w-64 overflow-hidden rounded-lg p-1 shadow-xl"
                  style={{ background: 'var(--overlay-bg)', border: '1px solid var(--medium-border)' }}
                >
                  <div className="max-h-48 overflow-y-auto">
                    {workspaceLoading && workspaces.length === 0 ? (
                      <div className="flex items-center justify-center px-3 py-3" style={{ color: 'var(--muted-text)' }}>
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : workspaces.map(item => {
                      const selected = item.id === workspace?.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => selectWorkspace(item)}
                          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-violet-500/15"
                          style={{ color: selected ? 'var(--workspace-badge-text)' : 'var(--title-text)' }}
                        >
                          <span className="min-w-0 flex-1 truncate">{item.is_default ? t('defaultWorkspace') : item.name}</span>
                          {selected && <Check className="h-3.5 w-3.5 shrink-0 text-violet-400" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button onClick={async () => {
              await window.electronAPI?.overlayMaximize()
              setMaximized(!!(await window.electronAPI?.overlayIsMaximized()))
            }} className="w-5 h-5 flex items-center justify-center rounded text-indigo-800 hover:text-indigo-400 hover:bg-indigo-500/15 transition-all cursor-pointer">
              {maximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </button>
            <button onClick={handleClose}
              className="w-5 h-5 flex items-center justify-center rounded text-indigo-800 hover:text-red-400 hover:bg-red-500/15 transition-all cursor-pointer">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 타입 탭 */}
        <div className="flex items-center gap-1 px-3 py-2 shrink-0"
          style={{ borderBottom: type === 'note' ? 'none' : '1px solid rgba(99,102,241,0.1)' }}>
          {TYPES.map(({ value, label, icon: Icon, color, accent }) => (
            <button key={value} onClick={() => handleTypeChange(value)}
              className={`overlay-tab ${type !== value ? 'overlay-tab-inactive' : ''} flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-1 justify-center ${
                type === value ? 'text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
              style={type === value ? { background: accent, border: `1px solid ${accent.replace('0.15', '0.4')}` } : { border: '1px solid transparent' }}>
              <Icon className={`w-3.5 h-3.5 ${type === value ? color : ''}`} />
              {t(label as 'note' | 'screenshot' | 'video')}
            </button>
          ))}
        </div>

        {/* 포맷 토글 (노트) */}
        {type === 'note' && (
          <div className="flex items-center gap-1 px-3 py-1.5 shrink-0"
            style={{ borderBottom: '1px solid rgba(99,102,241,0.1)' }}>
            {FORMATS.map(({ value, label, icon: Icon }) => (
              <button key={value} onClick={() => setFormat(value)}
                className={`overlay-tab flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-all ${
                  format === value
                    ? 'text-violet-300 bg-violet-500/15 border border-violet-500/30'
                    : 'text-slate-500 hover:text-slate-400 border border-transparent'
                }`}>
                <Icon className="w-3 h-3" />
                {value === 'html' ? label : t(label as 'text' | 'markdown' | 'code')}
              </button>
            ))}
            <button type="button" onClick={() => setIsSecret(value => !value)} aria-pressed={isSecret}
              className={`ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${isSecret ? 'border-violet-500/50 bg-violet-500/15 text-violet-300' : 'text-slate-400 hover:text-slate-200'}`}
              style={!isSecret ? { borderColor: 'var(--soft-border)', background: 'var(--side-panel-bg)', color: 'var(--title-text)' } : undefined}>
              <Lock className="h-3.5 w-3.5" />
              {t('secret')}
            </button>
          </div>
        )}

        {/* 입력 영역 */}
        <div className="flex-1 flex flex-col overflow-y-auto px-3 pt-2.5 pb-2 gap-2 min-h-0">
          <input type="text" className="input py-1.5 text-sm shrink-0" placeholder={t('titleOptional')}
            value={title} onChange={e => setTitle(e.target.value)} />

          <textarea ref={contentRef}
            className={`input resize-none text-sm flex-1 min-h-0 ${
              format === 'code' && type === 'note' ? 'font-mono text-emerald-400 bg-gray-950' :
              format === 'html' && type === 'note' ? 'font-mono text-sky-300 bg-gray-950' : ''
            }`}
            style={{ minHeight: previewUrl ? '36px' : '80px' }}
            placeholder={
              format === 'code' ? t('codeInput') :
              format === 'html' ? t('htmlInput') :
              type === 'note' ? t('overlayContent') : t('descriptionOptional')
            }
            value={content} onChange={e => setContent(e.target.value)} />

          {attachmentPicker.input}
          {attachmentPicker.dialog}
          <button type="button" onClick={attachmentPicker.selectFiles} disabled={importingFiles}
            className="flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-[11px] transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-wait"
            style={{ borderColor: 'var(--medium-border)', color: 'var(--quick-meta)', background: 'var(--side-panel-bg)' }}>
            {importingFiles
              ? <span className="h-3.5 w-3.5 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
              : <Paperclip className="h-3.5 w-3.5" />}
            {t(importingFiles ? 'importingFiles' : 'dropFiles')}
          </button>
          {attachmentError && <p className="shrink-0 text-right text-[11px] text-red-400">{t('fileImportFailed')}</p>}

          {/* 스크린샷 캡처 버튼 */}
          {type === 'screenshot' && (
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => handleScreenshot()}
                className="flex flex-1 items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
                style={{ border: '1px dashed rgba(96,165,250,0.3)', fontWeight: 800 }}>
                <Camera className="w-3.5 h-3.5" />
                {t('captureScreen')}
              </button>
              <button onClick={() => handleScreenshot(true)} title={t('edit')} aria-label={t('edit')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 transition-colors"
                style={{ border: '1px dashed rgba(96,165,250,0.3)' }}>
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {type === 'video' && !previewUrl && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={recording ? stopRecording : () => startRecording()}
                className={`flex flex-1 items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-colors ${
                  recording
                    ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10 animate-pulse'
                    : 'text-orange-400 hover:text-orange-300 hover:bg-orange-500/10'
                }`}
                style={{ border: `1px dashed ${recording ? 'rgba(239,68,68,0.38)' : 'rgba(251,146,60,0.38)'}`, fontWeight: 800 }}
              >
                {recording ? <StopCircle className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                {recording ? `${t('stopRecording')} · ${fmt(recordingTime)}` : t('startRecording')}
              </button>
              {!recording && (
                <button onClick={() => startRecording(true)} title={t('edit')} aria-label={t('edit')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-orange-400 hover:bg-orange-500/10 hover:text-orange-300 transition-colors"
                  style={{ border: '1px dashed rgba(251,146,60,0.38)' }}>
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* 스크린샷 미리보기 (screenshot 타입) */}
          {previewUrl && type !== 'video' && (
            <div className="relative group h-28 rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid rgba(99,102,241,0.2)' }}>
              <img src={previewUrl} alt="preview" className="w-full h-full object-contain bg-black/20" />
              <button
                onClick={() => { setPreviewUrl(null); setFilePath(null) }}
                className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)' }}>
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          )}
          {previewUrl && type === 'video' && (
            <div className="relative group h-28 rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid rgba(99,102,241,0.2)' }}>
              <video src={previewUrl} className="w-full h-full object-cover" />
              <button
                onClick={() => { setPreviewUrl(null); setFilePath(null) }}
                className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)' }}>
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          )}

          {/* 첨부 파일 */}
          {attachments.length > 0 && (
            <div className="flex flex-col gap-1.5 shrink-0 overflow-y-auto" style={{ maxHeight: '160px' }}>
              {attachments.map((att, i) => (
                <div key={`${att.path}-${i}`} className="group flex items-center gap-2 rounded-lg p-1.5"
                  style={{ border: '1px solid rgba(99,102,241,0.2)', background: 'var(--side-panel-bg)' }}>
                  {att.url
                    ? <img src={att.url} alt="" className="h-9 w-11 shrink-0 rounded object-cover bg-black/20" />
                    : <span className="flex h-9 w-11 shrink-0 items-center justify-center rounded bg-violet-500/10"><FileIcon className="h-4 w-4 text-violet-400" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs" style={{ color: 'var(--title-text)' }}>{att.name}</p>
                    {!!att.size && <p className="text-[10px] text-slate-500">{formatFileSize(att.size)}</p>}
                  </div>
                  <AttachmentModeBadge reference={att.path} />
                  <button
                    onClick={() => removeAttachment(i)}
                    className="h-6 w-6 shrink-0 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-red-500/15 transition-all">
                    <X className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 하단 툴바 */}
        <div className="flex items-center gap-2 px-3 py-2 shrink-0"
          style={{ borderTop: '1px solid rgba(99,102,241,0.1)' }}>

          {/* 노트 타입: 스니핑 캡처 버튼 */}
          {type === 'note' && (
            <button onClick={handleSnip} title={t('regionCapture')}
              className="p-1.5 text-indigo-800 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors">
              <Camera className="w-3.5 h-3.5" />
            </button>
          )}

          <div className="flex-1" />
          <span className="text-xs font-medium" style={{ color: 'var(--title-text)' }}>Ctrl+Enter</span>

          <button onClick={handleSave} disabled={saving || saved || recording}
            className="overlay-save flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
            style={saved ? {
              background: 'linear-gradient(135deg, #10b981, #059669)',
              boxShadow: '0 0 10px rgba(16,185,129,0.3)'
            } : {
              background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              boxShadow: '0 0 10px rgba(79,70,229,0.3)'
            }}>
            {saving
              ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : null
            }
            {saved ? t('saved') : t('save')}
          </button>
        </div>
      </div>
    </div>
  )
}
