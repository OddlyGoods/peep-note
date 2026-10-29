import { useScreenActive } from '../lib/screenActivity'
import { useEffect, useState, useRef } from 'react'
import { X, Camera, Video, FileText, Text as TextIcon, Code2, Globe, StopCircle, Hash, SlidersHorizontal, Lock } from 'lucide-react'
import { useLogStore } from '../stores/logStore'
import { useI18n } from '../i18n'
import { startRegionRecording } from '../lib/regionRecording'
import TagInput from './TagInput'

type LogType = 'note' | 'screenshot' | 'video'
type ContentFormat = 'text' | 'markdown' | 'code' | 'html'
type Attachment = { path: string; url: string }

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
    const path = await window.electronAPI?.startSnipping()
    if (!path) return
    const b64 = await window.electronAPI?.readFileAsBase64(path)
    if (!b64) return
    setAttachments(prev => [...prev, { path, url: `data:image/png;base64,${b64}` }])
  }

  const removeAttachment = (i: number) => setAttachments(prev => prev.filter((_, idx) => idx !== i))

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

  useEffect(() => () => {
    discardUnsavedVideo()
    stopRecording()
  }, [])

  const handleSave = async () => {
    if (recording) return
    if (!title.trim() && !content.trim() && !filePath && attachments.length === 0) return
    setSaving(true)
    try {
      await createLog({
        title: title || ({ note: t('note'), screenshot: t('screenshot'), video: t('video') }[type]),
        content,
        log_type: type,
        content_format: type === 'note' ? format : 'text',
        file_path: filePath,
        tags,
        attachments: attachments.map(a => a.path),
        workspace_id: workspaceId ?? null,
        is_secret: type === 'note' && isSecret
      })
      if (type === 'video') savedVideoLogRef.current = true
      handleClose()
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
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

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
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
                className={`new-log-secret-button flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-all ${isSecret ? 'border-violet-500/50 bg-violet-500/15 text-violet-300' : 'text-gray-400 hover:text-gray-200'}`}>
                <Lock className="h-3.5 w-3.5" />
                {t('secret')}
              </button>
            </div>
          )}

          {/* 제목 */}
          <input type="text" className="input" placeholder={t('titleOptional')}
            value={title} onChange={e => setTitle(e.target.value)} />

          {/* 내용 */}
          <textarea
            className={`input resize-none h-28 ${
              format === 'code' && type === 'note' ? 'font-mono text-emerald-400 bg-gray-950' :
              format === 'html' && type === 'note' ? 'font-mono text-sky-300 bg-gray-950' : ''
            }`}
            placeholder={
              format === 'code' ? t('codeInput') :
              format === 'html' ? t('htmlInput') :
              type === 'note' ? t('enterContent') : t('descriptionOptional')
            }
            value={content} onChange={e => setContent(e.target.value)} />

          {/* 첨부 이미지 (노트) */}
          {attachments.length > 0 && (
            <div className="flex flex-col gap-2">
              {attachments.map((att, i) => (
                <div key={i} className="relative group rounded-lg overflow-hidden border border-gray-700">
                  <img src={att.url} alt={`attachment-${i}`} className="w-full object-cover max-h-40" />
                  <button onClick={() => removeAttachment(i)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 border border-white/20">
                    <X className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

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
          <TagInput value={tags} onChange={setTags} disabled={saving} />
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
            <button onClick={handleSave} disabled={saving || recording} className="btn-primary flex items-center gap-2">
              {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
