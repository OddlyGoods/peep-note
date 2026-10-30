import { useScreenActive } from '../lib/screenActivity'
import { useEffect, useState, useRef, useId } from 'react'
import { X, Camera, Video, FileText, Text as TextIcon, Code2, Globe, StopCircle, Hash, SlidersHorizontal, Lock } from 'lucide-react'
import { useLogStore } from '../stores/logStore'
import { useI18n } from '../i18n'
import { startRegionRecording } from '../lib/regionRecording'
import TagInput from './TagInput'
import ModalLayer from './ModalLayer'
import { useAttachmentPicker } from '../lib/useAttachmentPicker'
import FileDropZone from './FileDropZone'
import AttachmentFileRow from './AttachmentFileRow'
import { attachmentFilename, type AttachmentMode, type ImportedAttachment } from '../../shared/attachments'

type LogType = 'note' | 'screenshot' | 'video'
type ContentFormat = 'text' | 'markdown' | 'code' | 'html'
type Attachment = { path: string; url?: string; name?: string; size?: number }

const TYPES = [
  { value: 'note' as LogType,       label: 'note',     icon: FileText, color: 'text-violet-400' },
  { value: 'screenshot' as LogType, label: 'screenshot', icon: Camera,   color: 'text-blue-400' },
  { value: 'video' as LogType,      label: 'video',    icon: Video,    color: 'text-orange-400' }
]

const FORMATS: { value: ContentFormat; label: string; icon: React.ElementType }[] = [
  { value: 'text', label: 'text', icon: TextIcon },
  { value: 'markdown', label: 'markdown', icon: Hash },
  { value: 'code', label: 'code',   icon: Code2 },
  { value: 'html', label: 'HTML',   icon: Globe }
]

export default function NewLogModal({ onClose, workspaceId, workspaceName }: { onClose: () => void; workspaceId?: string | null; workspaceName?: string }) {
  const fieldId = useId()
  const active = useScreenActive()
  const { t } = useI18n()
  const { createLog } = useLogStore()
  const [type, setType] = useState<LogType>('note')
  const [format, setFormat] = useState<ContentFormat>('text')
  const [isSecret, setIsSecret] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [filePath, setFilePath] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [importingFiles, setImportingFiles] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [attachmentError, setAttachmentError] = useState(false)
  const attachmentsRef = useRef<Attachment[]>([])
  const attachmentsSaved = useRef(false)
  const closed = useRef(false)
  const importing = useRef(false)
  const savePending = useRef(false)
  const dragDepth = useRef(0)
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState(false)
  useEffect(() => {
    void window.electronAPI?.setRecordingActive?.(recording)
    return () => { void window.electronAPI?.setRecordingActive?.(false) }
  }, [recording])
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)
  const recordedVideoPathRef = useRef<string | null>(null)
  const discardRecordedVideoRef = useRef(false)
  const savedVideoLogRef = useRef(false)

  const updateAttachments = (next: Attachment[]) => {
    attachmentsRef.current = next
    setAttachments(next)
  }
  const discardAttachments = () => {
    if (attachmentsSaved.current) return
    for (const file of attachmentsRef.current) void window.electronAPI?.deleteAttachmentFile(file.path)
    attachmentsRef.current = []
  }
  const importFiles = async (files: File[], mode: AttachmentMode) => {
    if (!files.length || importing.current || savePending.current || closed.current) return
    importing.current = true
    setImportingFiles(true); setAttachmentError(false)
    let imported: ImportedAttachment[] = []
    try {
      imported = await window.electronAPI?.importAttachments(files, mode) ?? []
      const prepared = await Promise.all(imported.map(async file => {
        const base64 = file.isImage && file.mimeType ? await window.electronAPI?.readFileAsBase64(file.path).catch(() => null) : null
        return { ...file, url: base64 ? `data:${file.mimeType};base64,${base64}` : undefined }
      }))
      if (closed.current) {
        imported.forEach(file => void window.electronAPI?.deleteAttachmentFile(file.path))
        return
      }
      updateAttachments([...attachmentsRef.current, ...prepared])
      setAttachmentError(imported.length !== files.length)
    } catch {
      imported.forEach(file => void window.electronAPI?.deleteAttachmentFile(file.path))
      if (!closed.current) setAttachmentError(true)
    } finally {
      importing.current = false
      if (!closed.current) setImportingFiles(false)
    }
  }
  const attachmentPicker = useAttachmentPicker(importFiles, importingFiles || saving)
  const handleDragEnter = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault(); event.stopPropagation()
    dragDepth.current++
    setDraggingFiles(true)
  }
  const handleDragLeave = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault(); event.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setDraggingFiles(false)
  }
  const handleDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault(); event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }
  const handleDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault(); event.stopPropagation()
    dragDepth.current = 0
    setDraggingFiles(false)
    attachmentPicker.dropFiles(Array.from(event.dataTransfer.files))
  }

  const discardUnsavedVideo = () => {
    if (savedVideoLogRef.current) return
    discardRecordedVideoRef.current = true
    const videoPath = recordedVideoPathRef.current
    recordedVideoPathRef.current = null
    if (videoPath) void window.electronAPI?.deleteVideo(videoPath)
  }

  const handleScreenshot = async (forceChoose = false) => {
    // 메인 Add 모달을 유지하되, 전역 Alt+2와 동일한 영역 캡처를 사용한다.
    const path = await window.electronAPI?.startSnipping(forceChoose)
    if (!path) return
    setFilePath(path)
    const b64 = await window.electronAPI?.readFileAsBase64(path)
    if (b64) setPreviewUrl(`data:image/png;base64,${b64}`)
  }
  const handleSnip = async () => {
    if (savePending.current || closed.current) return
    const path = await window.electronAPI?.startSnipping()
    if (!path) return
    const b64 = await window.electronAPI?.readFileAsBase64(path)
    if (!b64 || closed.current || savePending.current) { void window.electronAPI?.deleteAttachmentFile(path); return }
    updateAttachments([...attachmentsRef.current, { path, name: attachmentFilename(path), url: `data:image/png;base64,${b64}` }])
  }

  const removeAttachment = (i: number) => {
    if (savePending.current) return
    const file = attachmentsRef.current[i]
    updateAttachments(attachmentsRef.current.filter((_, index) => index !== i))
    if (file) void window.electronAPI?.deleteAttachmentFile(file.path)
  }

  const startRecording = async (forceChoose = false) => {
    if (mediaRecorderRef.current?.state === 'recording') return
    discardRecordedVideoRef.current = false
    savedVideoLogRef.current = false

    const region = await window.electronAPI?.selectRecordingRegion(forceChoose)
    if (!region) return
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
      setRecording(true)
      setRecordingTime(0)
      recordingStartedAtRef.current = Date.now()
      timerRef.current = window.setInterval(() => {
        if (recordingStartedAtRef.current) setRecordingTime(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000))
      }, 250)
    } catch (error) {
      console.error('Region recording error:', error)
    }
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

  const handleClose = () => {
    if (savePending.current) return
    closed.current = true
    discardAttachments()
    discardUnsavedVideo()
    stopRecording()
    onClose()
  }

  useEffect(() => {
    if (!active) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
      event.preventDefault()
      handleClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [active, handleClose])

  useEffect(() => {
    if (!active) stopRecording()
  }, [active])

  useEffect(() => {
    closed.current = false
    return () => {
      closed.current = true
      discardAttachments()
      discardUnsavedVideo()
      stopRecording()
    }
  }, [])

  const handleSave = async () => {
    if (recording || importing.current || savePending.current || closed.current) return
    if (!title.trim() && !content.trim() && !filePath && attachments.length === 0) return
    savePending.current = true
    setSaving(true)
    try {
      await createLog({
        title: title || ({ note: t('note'), screenshot: t('screenshot'), video: t('video') }[type]),
        content,
        log_type: type,
        content_format: type === 'note' ? format : 'text',
        file_path: filePath,
        tags,
        attachments: attachmentsRef.current.map(a => a.path),
        workspace_id: workspaceId ?? null,
        is_secret: type === 'note' && isSecret
      })
      if (type === 'video') savedVideoLogRef.current = true
      attachmentsSaved.current = true
      savePending.current = false
      handleClose()
    } catch (e) {
      console.error(e)
    } finally {
      savePending.current = false
      setSaving(false)
    }
  }

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <ModalLayer className="new-log-overlay p-4" onClose={handleClose}>
      <div role="dialog" aria-modal="true" aria-label={t('newRecord')} className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-white">{t('newRecord')}</h2>
            {workspaceName && (
              <span
                className="max-w-48 truncate text-[10px] leading-none px-1.5 py-0.5 rounded"
                style={{ background: 'var(--workspace-badge-bg)', color: 'var(--workspace-badge-text)', border: '1px solid var(--workspace-badge-border)' }}
              >
                {workspaceName}
              </span>
            )}
          </div>
          <button onClick={handleClose} aria-label={t('cancel')} className="new-log-close-button btn-ghost p-1.5"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto flex-1 [&>*]:shrink-0"
          onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <div className="flex flex-col gap-2 pb-1">
            {/* 타입 선택 */}
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map(({ value, label, icon: Icon, color }) => (
                <button key={value} onClick={() => handleTypeChange(value)} aria-pressed={type === value}
                  className={`new-log-type-tab flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                    type === value
                      ? 'bg-gray-800 border-violet-500/50 text-white'
                      : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                  }`}>
                  <Icon className={`w-4 h-4 ${type === value ? color : ''}`} />
                  {t(label as 'note' | 'screenshot' | 'video')}
                </button>
              ))}
            </div>

            {/* 포맷 토글 (노트) */}
            {type === 'note' && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                {FORMATS.map(({ value, label, icon: Icon }) => (
                  <button key={value} onClick={() => setFormat(value)} aria-pressed={format === value}
                    className={`new-log-format-tab flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      format === value
                        ? 'text-violet-300 bg-violet-500/15 border border-violet-500/30'
                        : 'text-gray-400 hover:text-gray-400 border border-transparent'
                    }`}>
                    <Icon className="w-3.5 h-3.5" />
                    {value === 'html' ? label : t(label as 'text' | 'markdown' | 'code')}
                  </button>
                ))}
                </div>
                <button type="button" onClick={() => setIsSecret(value => !value)} aria-pressed={isSecret}
                  className={`new-log-secret-button flex shrink-0 items-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-all ${isSecret ? 'border-violet-500/50 bg-violet-500/15 text-violet-300' : 'text-gray-400 hover:text-gray-200'}`}>
                  <Lock className="h-3.5 w-3.5" />
                  {t('secret')}
                </button>
              </div>
            )}

          </div>

          {/* 제목 */}
          <div className="bordered-field flex">
            <label className="bordered-field-label" htmlFor={`${fieldId}-title`}>{t('fieldTitle')}</label>
            <input id={`${fieldId}-title`} type="text" className="input" placeholder={t('fieldOptional')}
              value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          {/* 내용 */}
          <div className="bordered-field flex">
            <label className="bordered-field-label" htmlFor={`${fieldId}-content`}>{t('fieldContent')}</label>
            <textarea id={`${fieldId}-content`}
              className={`input resize-none h-28 ${
                format === 'code' && type === 'note' ? 'code-input font-mono text-emerald-400 bg-gray-950' :
                format === 'html' && type === 'note' ? 'code-input font-mono text-sky-300 bg-gray-950' : ''
              }`}
              placeholder=""
              value={content} onChange={e => setContent(e.target.value)} />
          </div>

          {/* 스크린샷 */}
          {type === 'screenshot' && (
            <div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleScreenshot()} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-bold text-blue-500 transition-colors hover:bg-blue-500/20 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300">
                  <Camera className="w-4 h-4" />{t('captureScreen')}
                </button>
                <button onClick={() => handleScreenshot(true)} title={t('edit')} aria-label={t('edit')} className="shrink-0 rounded-lg border border-blue-500/40 bg-blue-500/10 p-2.5 text-blue-500 transition-colors hover:bg-blue-500/20 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300">
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
              </div>
              {previewUrl && <img src={previewUrl} alt="preview" className="mt-2 rounded-lg border border-gray-700 w-full object-cover max-h-40" />}
            </div>
          )}

          {/* 동영상 */}
          {type === 'video' && (
            <div>
              {!recording ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => startRecording()} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-sm font-bold text-orange-600 transition-colors hover:bg-orange-500/20 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300">
                    <Video className="w-4 h-4" />{t('startRecording')}
                  </button>
                  <button onClick={() => startRecording(true)} title={t('edit')} aria-label={t('edit')} className="shrink-0 rounded-lg border border-orange-500/40 bg-orange-500/10 p-2.5 text-orange-600 transition-colors hover:bg-orange-500/20 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300">
                    <SlidersHorizontal className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button onClick={stopRecording} className="btn-danger flex items-center gap-2 w-full justify-center">
                  <StopCircle className="w-4 h-4" />{t('stopRecording')} ({fmt(recordingTime)})
                </button>
              )}
              {previewUrl && !recording && <video src={previewUrl} controls className="mt-2 rounded-lg border border-gray-700 w-full max-h-40" />}
            </div>
          )}

          {/* 태그 */}
          {attachmentPicker.input}
          {attachmentPicker.dialog}
          <div className="space-y-4">
            <div className="bordered-field">
              <label className="bordered-field-label" htmlFor={`${fieldId}-tags`}>{t('fieldTag')}</label>
              <TagInput inputId={`${fieldId}-tags`} placeholder={t('fieldTagHint')} value={tags} onChange={setTags} disabled={saving} />
            </div>
            {attachments.length > 0 && <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
              {attachments.map((file, index) => <AttachmentFileRow key={`${file.path}-${index}`} reference={file.path}
                url={file.url} name={file.name} size={file.size} compact disabled={saving}
                onRemove={() => removeAttachment(index)} />)}
            </div>}
            <FileDropZone onSelect={attachmentPicker.selectFiles} busy={importingFiles || saving} dragging={draggingFiles} compact borderLabel={t('fieldFiles')} />
            {attachmentError && <p role="alert" className="text-xs text-red-400">{t('fileImportFailed')}</p>}
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-800 shrink-0">
          <div>
            {type === 'note' && (
              <button onClick={handleSnip} title={t('regionCapture')}
                className="new-log-camera-button p-2 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 transition-all">
                <Camera className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleClose} className="new-log-cancel-button btn-secondary">{t('cancel')}</button>
            <button onClick={handleSave} disabled={saving || recording || importingFiles} className="btn-primary flex items-center gap-2">
              {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {t('save')}
            </button>
          </div>
        </div>
      </div>
    </ModalLayer>
  )
}
