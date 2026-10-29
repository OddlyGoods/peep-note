import { useEffect, useRef, useState } from 'react'
import { useOpenLog } from './LogNavigationProvider'
import { format, isToday } from 'date-fns'
import { ko, ja, zhCN } from 'date-fns/locale'
import {
  Image as ImageIcon, Video, Text as TextIcon, Code2, Globe, Hash,
  Pin, Trash2, ChevronRight, Clock, Check, Sparkles, Loader2, MessageCircle, LocateFixed, File as FileIcon
} from 'lucide-react'
import { Log } from '../lib/api'
import { useLogStore } from '../stores/logStore'
import ConfirmModal from './ConfirmModal'
import FavoriteButton from './FavoriteButton'
import WorkspaceMoveButton from './WorkspaceMoveButton'
import { useI18n } from '../i18n'
import { getAiSummaryContent, getAiSummaryTitle } from '../lib/aiSummary'
import NoteExcerpt from './NoteExcerpt'
import SecretIconBadge from './SecretIconBadge'

const TYPE_CONFIG = {
  note:       { icon: TextIcon, label: 'note',     color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
  screenshot: { icon: ImageIcon,   label: 'screenshot', color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20' },
  video:      { icon: Video,    label: 'video',    color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  summary:    { icon: Sparkles, label: 'summary', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' }
}

const FORMAT_BADGE: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  markdown: { icon: Hash, label: 'markdown', color: 'text-violet-300' },
  code: { icon: Code2, label: 'code', color: 'text-emerald-400' },
  html: { icon: Globe, label: 'HTML', color: 'text-sky-400' }
}

interface LogCardProps {
  log: Log
  basePath?: string
  showCheckbox?: boolean
  checked?: boolean
  onCheck?: (checked: boolean) => void
  onCardClick?: () => void
  inGroup?: boolean
  isDeleting?: boolean
  isCollapsing?: boolean
  onMoved?: (log: Log) => void
  onReveal?: () => void
}

function MediaThumbnail({ log }: { log: Log }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [source, setSource] = useState<string | null>(null)
  const isVideo = log.log_type === 'video'

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '160px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !log.file_path) return
    let cancelled = false
    window.electronAPI?.readFileAsBase64(log.file_path).then(data => {
      if (!cancelled && data) setSource(`data:${isVideo ? 'video/webm' : 'image/png'};base64,${data}`)
    })
    return () => { cancelled = true }
  }, [visible, log.file_path, isVideo])

  const Icon = isVideo ? Video : ImageIcon
  return (
    <div ref={containerRef} className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-gray-700 bg-gray-800/70">
      {source ? (
        isVideo ? (
          <video
            src={source}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
            onLoadedMetadata={event => {
              const video = event.currentTarget
              if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.1, video.duration)
            }}
          />
        ) : (
          <img src={source} alt="" className="h-full w-full object-cover" />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Icon className={`h-4 w-4 ${isVideo ? 'text-orange-400/60' : 'text-blue-400/60'}`} />
        </div>
      )}
    </div>
  )
}

export default function LogCard({ log, basePath = '/log', showCheckbox = false, checked = false, onCheck, onCardClick, inGroup = false, isDeleting = false, isCollapsing = false, onMoved, onReveal }: LogCardProps) {
  const { language, t } = useI18n()
  const openLog = useOpenLog()
  const { deleteLog, updateLog, recentlyCreatedIds } = useLogStore()
  const [deleting, setDeleting] = useState(false)
  const [collapsing, setCollapsing] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const deletingVisual = deleting || isDeleting
  const collapsingVisual = collapsing || isCollapsing

  const isAiSummary = log.log_type === 'summary'
  const entering = recentlyCreatedIds.includes(log.id)
  const displayContent = log.is_secret ? '' : (isAiSummary ? getAiSummaryContent(log.content) : log.content)
  const displayTitle = isAiSummary ? getAiSummaryTitle(log.content, log.title) : log.title
  const cfg = TYPE_CONFIG[log.log_type] ?? TYPE_CONFIG.note
  const Icon = cfg.icon
  const fmtBadge = log.content_format && log.content_format !== 'text' ? FORMAT_BADGE[log.content_format] : null
  const displayDate = new Date((isAiSummary ? log.updated_at : log.created_at) * 1000)
  const dateLocale = language === 'ko' ? ko : language === 'ja' ? ja : language === 'zh' ? zhCN : undefined
  const listDateFormat = language === 'ko' ? 'M월 d일 HH:mm' : language === 'ja' || language === 'zh' ? 'M月d日 HH:mm' : 'MMM d, HH:mm'

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowConfirm(true)
  }

  const confirmDelete = async () => {
    setShowConfirm(false)
    setDeleting(true)
    await new Promise(resolve => window.setTimeout(resolve, 700))
    setCollapsing(true)
    await new Promise(resolve => window.setTimeout(resolve, 280))
    try {
      await deleteLog(log.id)
    } catch {
      setCollapsing(false)
      setDeleting(false)
    }
  }

  const handlePin = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await updateLog(log.id, { pinned: log.pinned ? 0 : 1 } as any)
  }

  return (
    <div
      data-log-id={log.id}
      onClick={() => {
        if (showCheckbox) { onCheck?.(!checked); return }
        if (onCardClick) { onCardClick(); return }
        openLog(log.id, basePath)
      }}
      className={`log-card ${entering ? 'log-card-enter' : ''} group card relative overflow-hidden cursor-pointer hover:border-gray-700 hover:bg-gray-800/50 transition-all duration-300 ease-in-out ${
        collapsingVisual ? 'max-h-0 !p-0 opacity-0 scale-[0.98] border-transparent' : 'max-h-[700px] p-4'
      } ${deletingVisual ? 'pointer-events-none opacity-45' : ''} ${
        log.pinned ? 'border-violet-500/30' : ''
      } ${showCheckbox && checked ? 'border-violet-500/50 bg-violet-500/5' : ''}`}
    >
      <div className="flex items-start gap-3">
        {/* 체크박스 */}
        {showCheckbox && (
          <div
            onClick={e => { e.stopPropagation(); onCheck?.(!checked) }}
            className={`shrink-0 w-4 h-4 mt-2 rounded border-2 flex items-center justify-center transition-colors cursor-pointer ${
              checked ? 'bg-violet-600 border-violet-600' : 'border-gray-600 hover:border-violet-500'
            }`}
          >
            {checked && <Check className="w-2.5 h-2.5 text-white" />}
          </div>
        )}
        {/* 타입 아이콘 */}
        <div className={`relative shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center ${
          isAiSummary ? 'bg-amber-500/10 border-amber-500/20' : cfg.bg
        }`}>
          {isAiSummary
            ? <Sparkles className="w-4 h-4 text-amber-400" />
            : fmtBadge
              ? <fmtBadge.icon className={`w-4 h-4 ${fmtBadge.color}`} />
              : <Icon className={`w-4 h-4 ${cfg.color}`} />
          }
          {log.is_secret && <SecretIconBadge />}
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="min-w-0 flex-1 text-sm font-medium text-gray-100 truncate">{displayTitle || t('untitled')}</h3>
          </div>
          {(log.log_type === 'screenshot' || log.log_type === 'video') && log.file_path && (
            <div className="mt-2">
              <MediaThumbnail log={log} />
            </div>
          )}
          {log.is_secret ? (
            <div className="mt-1 text-xs text-gray-500">••••••••••••</div>
          ) : displayContent && (log.log_type === 'note' ? (
            <NoteExcerpt content={displayContent} code={log.content_format === 'code'} markdown={log.content_format === 'markdown'} />
          ) : (
            <NoteExcerpt content={displayContent} code={log.content_format === 'code'} markdown={isAiSummary || log.content_format === 'markdown'} maxLines={2} />
          ))}
          {/* 태그 */}
          {log.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {log.tags.map(tag => (
                <span key={tag} className="tag bg-gray-800 text-gray-400 border border-gray-700">{tag}</span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {isToday(displayDate)
                ? format(displayDate, 'HH:mm', dateLocale ? { locale: dateLocale } : undefined)
                : format(displayDate, listDateFormat, dateLocale ? { locale: dateLocale } : undefined)}
            </span>
            {isAiSummary
              ? <span className="ai-summary-badge tag border bg-amber-500/10 border-amber-500/20 text-amber-400">AI</span>
              : <span className={`tag border ${cfg.bg} ${cfg.color}`}>{t(cfg.label as 'note' | 'screenshot' | 'video')}</span>
            }
            {(log.attachments?.length ?? 0) > 0 && (
              <span className="tag flex items-center gap-1 border border-gray-700 bg-gray-800 text-gray-400" title={t('attachmentFiles')}>
                <FileIcon className="h-3 w-3" />
                {log.attachments.length}
              </span>
            )}
            {!isAiSummary && fmtBadge && (
              <span className={`format-badge tag border bg-gray-800 border-gray-700 ${fmtBadge.color}`}>{fmtBadge.label === 'html' ? 'HTML' : t(fmtBadge.label as 'markdown' | 'code')}</span>
            )}
            {(log.comment_count ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-gray-400" title={t('comments')}>
                <MessageCircle className="h-3 w-3" />
                {log.comment_count}
              </span>
            )}
            {log.pinned ? <Pin className="w-3 h-3 text-violet-400" /> : null}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${log.is_secret ? '-mt-0.5' : ''}`}>
          <FavoriteButton log={log} />
          {!showCheckbox && (onReveal ? (
            <button type="button" title={t('showInDashboard')} aria-label={t('showInDashboard')}
              onClick={event => { event.stopPropagation(); onReveal() }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-violet-400 hover:bg-violet-500/10 transition-colors">
              <LocateFixed className="w-3.5 h-3.5" />
            </button>
          ) : <WorkspaceMoveButton log={log} onMoved={onMoved} />)}
          {!inGroup && (
              <button
                onClick={handlePin}
                className={`p-1.5 rounded-lg transition-colors ${
                  log.pinned ? 'text-violet-400 bg-violet-500/10' : 'text-gray-400 hover:text-violet-400 hover:bg-violet-500/10'
                }`}
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
          )}
          {!inGroup && (
            <>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </div>
      </div>

      {deletingVisual && (
        <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: 'rgba(15,18,45,0.28)', backdropFilter: 'blur(1px)' }}>
          <Loader2 className="w-5 h-5 text-violet-300 animate-spin" />
        </div>
      )}

      {showConfirm && (
        <ConfirmModal
          title={t('deleteLog')}
          message={t('deleteLogMessage', { title: displayTitle || t('untitled') })}
          confirmLabel={t('delete')}
          onConfirm={confirmDelete}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}
