import { useScreenActive } from '../lib/screenActivity'
import { menuForPath } from '../lib/menuMemory'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { format } from 'date-fns'
import { ko, ja, zhCN } from 'date-fns/locale'
import {
  ArrowLeft, Save, Trash2, Pin, X, Camera,
  Video, FileText, Text as TextIcon, BookOpen, Code2, Globe, Eye, Hash, Clock, Tag, Maximize2, Sparkles, Layers, Pencil, SquarePen, Copy, Check, ArrowUp, Lock, Play, MessageCircle, Paperclip
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, Log, LogComment } from '../lib/api'
import { useLogStore } from '../stores/logStore'
import OcrText from '../components/OcrText'
import FavoriteButton from '../components/FavoriteButton'
import WorkspaceMoveButton from '../components/WorkspaceMoveButton'
import MarkdownCodeBlock from '../components/MarkdownCodeBlock'
import TagInput from '../components/TagInput'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import TagBadge from '../components/TagBadge'
import AttachmentFileRow from '../components/AttachmentFileRow'
import FileDropZone from '../components/FileDropZone'
import { useAttachmentPicker } from '../lib/useAttachmentPicker'
import type { AttachmentMode } from '../../shared/attachments'
import ConfirmModal from '../components/ConfirmModal'
import CommentCard from '../components/CommentCard'
import CommentComposer from '../components/CommentComposer'
import { hasNoteChanges, noteForm } from '../lib/noteEdit'
import { discardDraftFiles } from '../lib/draftFiles'
import SecretPasswordModal from '../components/SecretPasswordModal'
import { useI18n } from '../i18n'
import { useTheme } from '../theme'
import { getAiSummaryContent, getAiSummaryTitle } from '../lib/aiSummary'
import { useOpenLog } from '../components/LogNavigationProvider'
import { hasActiveSecretUnlock, rememberSecretUnlock } from '../lib/secretUnlock'
import { attachmentMimeType, isImageAttachment } from '../../shared/attachments'

const TYPE_CONFIG = {
  screenshot: { icon: Camera,   label: 'screenshot', color: 'text-blue-400',   border: 'border-blue-500/30' },
  video:      { icon: Video,    label: 'video',    color: 'text-orange-400', border: 'border-orange-500/30' },
  note:       { icon: FileText, label: 'note',     color: 'text-violet-400', border: 'border-violet-500/30' },
  summary:    { icon: Sparkles, label: 'summary', color: 'text-amber-400', border: 'border-amber-500/30' }
}

const FORMAT_CONFIG = {
  text: { icon: TextIcon, label: 'text' },
  markdown: { icon: Hash, label: 'markdown' },
  code: { icon: Code2,    label: 'code' },
  html: { icon: Globe,    label: 'HTML' }
}

const FORMATS = ['text', 'markdown', 'code', 'html'] as const
const MARKDOWN_COMPONENTS = {
  pre: MarkdownCodeBlock,
  table: ({ node: _node, ...props }: any) => (
    <div className="markdown-table-wrap"><table {...props} /></div>
  )
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-content p-4 rounded-xl border border-violet-500/20 bg-gray-800/50 text-sm text-gray-200 max-w-none
      [&_p]:leading-relaxed [&_p]:text-gray-200 [&_p+p]:mt-3
      [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-white [&_h1]:mb-3
      [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mb-2 [&_h2]:mt-5
      [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-100 [&_h3]:mb-2 [&_h3]:mt-4
      [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mt-3 [&_ul]:space-y-1
      [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mt-3 [&_ol]:space-y-1
      [&_li]:text-gray-300 [&_strong]:font-semibold [&_strong]:text-white
      [&_a]:text-violet-300 [&_a]:underline [&_a]:underline-offset-2
      [&_blockquote]:border-l-2 [&_blockquote]:border-violet-400/60 [&_blockquote]:pl-3 [&_blockquote]:text-gray-400 [&_blockquote]:my-3
      [&_code]:font-mono [&_code]:text-emerald-300 [&_code]:text-xs [&_code]:bg-gray-900 [&_code]:px-1 [&_code]:rounded">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
    </div>
  )
}

export default function LogDetail() {
  const active = useScreenActive()
  const activeRef = useRef(active)
  activeRef.current = active
  const { language, t } = useI18n()
  const { theme } = useTheme()
  const { id } = useParams<{ id: string }>()
  const recordIdRef = useRef(id)
  recordIdRef.current = id
  const navigate = useNavigate()
  const openLog = useOpenLog()
  const location = useLocation()
  const { updateLog, deleteLog, setCommentCount } = useLogStore()
  const [log, setLog] = useState<Log | null>(null)
  const [editing, setEditing] = useState(false)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const [form, setForm] = useState({ title: '', content: '', tags: [] as string[], content_format: 'text' as Log['content_format'], is_secret: false })
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [attachmentUrls, setAttachmentUrls] = useState<Array<string | null>>([])
  const [removedAttachments, setRemovedAttachments] = useState<number[]>([])
  const [addedNoteFiles, setAddedNoteFiles] = useState<string[]>([])
  const noteFilesRef = useRef<string[]>([])
  const newCommentFilesRef = useRef<string[]>([])
  const editorFilesRef = useRef<string[]>([])
  const pendingNoteSave = useRef<Promise<unknown> | null>(null)
  const pendingCommentSave = useRef<Promise<unknown> | null>(null)
  const [noteFileToDelete, setNoteFileToDelete] = useState<string | null>(null)
  const [noteFileDeleteFailed, setNoteFileDeleteFailed] = useState(false)
  const [pendingEditExit, setPendingEditExit] = useState<'back' | 'cancel' | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showConfirm, setShowConfirm] = useState(false)
  const [htmlPreview, setHtmlPreview] = useState(false)
  const [groupLogs, setGroupLogs] = useState<Log[]>([])
  const [copied, setCopied] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [secretGate, setSecretGate] = useState<'loading' | 'unlock' | 'missing' | 'open'>('loading')
  const [comments, setComments] = useState<LogComment[]>([])
  const [commentDraft, setCommentDraft] = useState('')
  const [addingComment, setAddingComment] = useState(false)
  const [newCommentFiles, setNewCommentFiles] = useState<string[]>([])
  const [commentFileToDelete, setCommentFileToDelete] = useState<{ comment: LogComment; index: number } | null>(null)
  const [commentEditor, setCommentEditor] = useState<{ id: string; content: string; attachments: string[]; added: string[] } | null>(null)
  const [commentToDelete, setCommentToDelete] = useState<LogComment | null>(null)
  const [commentBusyId, setCommentBusyId] = useState<string | null>(null)
  const [commentErrorId, setCommentErrorId] = useState<string | null>(null)
  const commentsRequest = useRef(0)
  const [addingFiles, setAddingFiles] = useState(false)
  const [fileAddFailed, setFileAddFailed] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const dragDepthRef = useRef(0)
  const [videoPlaying, setVideoPlaying] = useState(false)

  const playVideo = () => {
    const video = videoRef.current
    if (!video) return
    void video.play().catch(error => console.error('Video playback failed:', error))
  }

  useEffect(() => () => {
    discardDraftFiles(noteFilesRef.current, pendingNoteSave.current)
    discardDraftFiles(newCommentFilesRef.current, pendingCommentSave.current)
    discardDraftFiles(editorFilesRef.current, pendingCommentSave.current)
    noteFilesRef.current = []; newCommentFilesRef.current = []; editorFilesRef.current = []
  }, [id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setSecretGate('loading')
    setEditing(false)
    setMediaUrl(null)
    setAttachmentUrls([])
    setRemovedAttachments([])
    setAddedNoteFiles([])
    setPendingEditExit(null)
    setNoteFileToDelete(null)
    setNoteFileDeleteFailed(false)
    setSaving(false)
    setNewCommentFiles([])
    setCommentFileToDelete(null)
    setGroupLogs([])
    setComments([])
    setCommentDraft('')
    setCommentEditor(null)
    setCommentToDelete(null)
    setCommentBusyId(null)
    setCommentErrorId(null)
    setAddingComment(false)
    ++commentsRequest.current
    setFileAddFailed(false)
    setDraggingFiles(false)
    dragDepthRef.current = 0
    api.logs.get(id).then(async data => {
      let gate: 'open' | 'unlock' | 'missing' = 'open'
      if (data.is_secret && !hasActiveSecretUnlock()) {
        const status = await api.settings.secretPasswordStatus()
        gate = status.is_set ? 'unlock' : 'missing'
      }
      if (cancelled) return
      setLog(data)
      setSecretGate(gate)
      setForm({ title: data.title, content: data.content, tags: data.tags, content_format: data.content_format ?? 'text', is_secret: !!data.is_secret })
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setLoading(false)
      if (activeRef.current) navigate(menuForPath(location.pathname) ?? '/')
    })
    return () => { cancelled = true }
  }, [id, navigate])

  // Restoring a cached screen must not bypass an expired secret-note unlock.
  useLayoutEffect(() => {
    if (!active || loading || log?.id !== id || !log?.is_secret) return
    if (hasActiveSecretUnlock()) { if (secretGate !== 'open') setSecretGate('open'); return }
    if (secretGate === 'unlock' || secretGate === 'missing') return
    let cancelled = false
    setSecretGate('loading')
    api.settings.secretPasswordStatus().then(status => {
      if (!cancelled) setSecretGate(status.is_set ? 'unlock' : 'missing')
    }).catch(() => { if (!cancelled) setSecretGate('unlock') })
    return () => { cancelled = true }
  }, [active, loading, id, log?.id, log?.is_secret])

  const wasActive = useRef(active)
  useEffect(() => {
    const resuming = active && !wasActive.current
    wasActive.current = active
    if (!resuming || !id || editing) return
    let cancelled = false
    api.logs.get(id).then(data => {
      if (cancelled || editingRef.current) return
      setLog(data)
      setForm({ title: data.title, content: data.content, tags: data.tags, content_format: data.content_format ?? 'text', is_secret: !!data.is_secret })
    }).catch(error => {
      if (!cancelled && error.status === 404) navigate(menuForPath(location.pathname) ?? '/')
    })
    return () => { cancelled = true }
  }, [active, id])

  // Direct URLs and browser history must also wait for the PIN before loading
  // attachments, media, comments, or other detail-only data.
  useEffect(() => {
    if (loading || !log || log.id !== id || secretGate !== 'open') return
    let cancelled = false
    if (log.file_path) {
      void window.electronAPI?.readFileAsBase64(log.file_path).then(b64 => {
        if (!cancelled && b64) setMediaUrl(`data:${log.log_type === 'video' ? 'video/webm' : 'image/png'};base64,${b64}`)
      }).catch(() => {})
    }
    if (log.attachments?.length || addedNoteFiles.length) {
      const files = [...log.attachments, ...addedNoteFiles]
      setAttachmentUrls(new Array(files.length).fill(null))
      void Promise.all(files.map(async path => {
        if (!isImageAttachment(path)) return null
        const b64 = await window.electronAPI?.readFileAsBase64(path)
        const mimeType = attachmentMimeType(path)
        return b64 && mimeType ? `data:${mimeType};base64,${b64}` : null
      })).then(urls => {
        if (!cancelled) setAttachmentUrls(urls)
      }).catch(() => {})
    } else setAttachmentUrls([])
    if (log.group_id) {
      void api.groups.list({}).then(groups => {
        if (cancelled) return
        const group = groups.find(group => group.id === log.group_id)
        setGroupLogs(group?.logs.filter(item =>
          item.log_type !== 'summary' && (log.log_type === 'summary' || item.id !== log.id)
        ) ?? [])
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [id, log?.id, log?.file_path, log?.attachments, log?.group_id, log?.log_type, secretGate, loading, addedNoteFiles])

  const resetNoteEditor = () => {
    discardDraftFiles(noteFilesRef.current, pendingNoteSave.current)
    noteFilesRef.current = []
    setAddedNoteFiles([])
    setRemovedAttachments([])
    setEditing(false)
    if (log) setForm(noteForm(log))
  }

  const leaveNoteEditor = (action: 'back' | 'cancel') => {
    if (saving || addingFiles) return
    const files = [...(log?.attachments ?? []), ...addedNoteFiles].filter((_, index) => !removedAttachments.includes(index))
    if (editing && log && hasNoteChanges(log, form, files)) { setPendingEditExit(action); return }
    resetNoteEditor()
    if (action === 'back') navigate(menuForPath(location.pathname) ?? '/')
  }

  const discardNoteChanges = () => {
    const action = pendingEditExit
    setPendingEditExit(null)
    resetNoteEditor()
    if (action === 'back') navigate(menuForPath(location.pathname) ?? '/')
  }

  const handleSave = async () => {
    if (!log || saving || addingFiles) return
    const logId = log.id
    const imported = [...noteFilesRef.current]
    const attachments = [...log.attachments, ...addedNoteFiles].filter((_, index) => !removedAttachments.includes(index))
    setSaving(true)
    const pending = updateLog(logId, { ...form, attachments })
    pendingNoteSave.current = pending
    try {
      const updated = await pending
      if (recordIdRef.current === logId) {
        setLog(updated)
        setForm(noteForm(updated))
        noteFilesRef.current = []
        setAddedNoteFiles([])
        setRemovedAttachments([])
        setEditing(false)
      }
      discardDraftFiles(imported)
    } catch {}
    finally {
      if (pendingNoteSave.current === pending) pendingNoteSave.current = null
      if (recordIdRef.current === logId) setSaving(false)
    }
  }

  const handleDelete = () => { if (log) setShowConfirm(true) }

  const confirmDelete = async () => {
    if (!log) return
    setShowConfirm(false)
    try {
      await deleteLog(log.id)
      if (activeRef.current && recordIdRef.current === log.id) navigate(menuForPath(location.pathname) ?? '/', { state: { deletionTransition: true } })
    } catch {}
  }

  const handlePin = async () => {
    if (!log) return
    await updateLog(log.id, { pinned: log.pinned ? 0 : 1 } as any)
    setLog(prev => prev ? { ...prev, pinned: prev.pinned ? 0 : 1 } : prev)
  }

  const handleBack = () => {
    leaveNoteEditor('back')
  }

  const handleCopyContent = async () => {
    if (!log?.content) return
    try {
      await navigator.clipboard.writeText(log.log_type === 'summary' ? getAiSummaryContent(log.content) : log.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const syncCommentCount = (logId: string, count: number) => {
    setCommentCount(logId, count)
    if (recordIdRef.current === logId) setLog(previous => previous?.id === logId ? { ...previous, comment_count: count } : previous)
  }

  const reloadComments = async (logId: string) => {
    const request = ++commentsRequest.current
    const rows = await api.logs.comments(logId)
    if (request !== commentsRequest.current || recordIdRef.current !== logId) return
    setComments(rows)
    syncCommentCount(logId, rows.length)
  }

  useEffect(() => {
    if (!active || loading || !log || log.id !== id || secretGate !== 'open') return
    void reloadComments(log.id).catch(() => {})
    return () => { ++commentsRequest.current }
  }, [active, loading, id, log?.id, secretGate])

  const refreshChangedComments = (logId: string) => {
    if (recordIdRef.current !== logId) return
    ++commentsRequest.current
    if (recordIdRef.current === logId && activeRef.current) void reloadComments(logId).catch(() => {})
  }

  const handleAddComment = async () => {
    if (!log || (!commentDraft.trim() && !newCommentFiles.length) || addingComment) return
    const logId = log.id
    setAddingComment(true)
    setCommentErrorId(null)
    try {
      const files = [...newCommentFilesRef.current]
      const pending = api.logs.addComment(logId, commentDraft, files)
      pendingCommentSave.current = pending
      const comment = await pending
      if (pendingCommentSave.current === pending) pendingCommentSave.current = null
      if (recordIdRef.current === logId) {
        setComments(previous => [...previous, comment])
        setCommentDraft(current => current === commentDraft ? '' : current)
        newCommentFilesRef.current = []
        setNewCommentFiles([])
      }
      syncCommentCount(logId, comment.comment_count)
      refreshChangedComments(logId)
    } catch {
      if (recordIdRef.current === logId) setCommentErrorId('new')
    } finally {
      if (recordIdRef.current === logId) setAddingComment(false)
    }
  }

  const handleSaveComment = async () => {
    if (!log || !commentEditor || commentBusyId || addingComment) return
    const original = comments.find(comment => comment.id === commentEditor.id)
    const removingOnlyFiles = !!original && !original.content.trim() && (original.attachments?.length ?? 0) > 0
      && !commentEditor.content.trim() && !commentEditor.attachments.length
    if (!commentEditor.content.trim() && !commentEditor.attachments.length && !removingOnlyFiles) return
    const logId = log.id
    const editor = commentEditor
    setCommentBusyId(editor.id)
    setCommentErrorId(null)
    try {
      const pending = removingOnlyFiles ? api.logs.updateCommentFiles(logId, editor.id, [])
        : api.logs.updateComment(logId, editor.id, editor.content, editor.attachments)
      pendingCommentSave.current = pending
      const updated = await pending
      if (pendingCommentSave.current === pending) pendingCommentSave.current = null
      discardDraftFiles(editor.added)
      if (recordIdRef.current === logId) {
        setComments(previous => previous.map(comment => comment.id === updated.id ? updated : comment))
        setCommentEditor(current => current?.id === editor.id ? null : current)
        editorFilesRef.current = []
      }
      syncCommentCount(logId, updated.comment_count)
      refreshChangedComments(logId)
    } catch {
      if (recordIdRef.current === logId) setCommentErrorId(editor.id)
    } finally {
      if (recordIdRef.current === logId) setCommentBusyId(null)
    }
  }

  const handleDeleteComment = async () => {
    if (!log || !commentToDelete || commentBusyId) return
    const logId = log.id
    const commentId = commentToDelete.id
    setCommentBusyId(commentId)
    setCommentToDelete(null)
    setCommentErrorId(null)
    try {
      const result = await api.logs.deleteComment(logId, commentId)
      if (recordIdRef.current === logId) {
        setComments(previous => previous.filter(comment => comment.id !== commentId))
        setCommentEditor(current => current?.id === commentId ? null : current)
      }
      syncCommentCount(logId, result.comment_count)
      refreshChangedComments(logId)
    } catch {
      if (recordIdRef.current === logId) setCommentErrorId(commentId)
    } finally {
      if (recordIdRef.current === logId) setCommentBusyId(null)
    }
  }

  const cancelCommentEditor = () => {
    discardDraftFiles(editorFilesRef.current, pendingCommentSave.current)
    editorFilesRef.current = []
    setCommentEditor(null)
    setCommentErrorId(null)
  }

  const addCommentFiles = async (comment: LogComment | null, files: File[], mode: AttachmentMode) => {
    if (!log || !files.length || commentBusyId || addingComment) return
    const logId = log.id
    const editor = comment && commentEditor?.id === comment.id ? commentEditor : null
    if (comment) setCommentBusyId(comment.id)
    else setAddingComment(true)
    setCommentErrorId(null)
    let imported: string[] = []
    try {
      const result = await window.electronAPI?.importAttachments(files, mode) ?? []
      imported = result.map(file => file.path)
      if (!imported.length) throw new Error('No files imported')
      if (recordIdRef.current !== logId) { discardDraftFiles(imported); return }
      if (!comment) {
        newCommentFilesRef.current = [...newCommentFilesRef.current, ...imported]
        setNewCommentFiles(newCommentFilesRef.current)
      } else if (editor) {
        editorFilesRef.current = [...editorFilesRef.current, ...imported]
        setCommentEditor(current => current?.id === editor.id ? { ...current, attachments: [...current.attachments, ...imported], added: [...current.added, ...imported] } : current)
      } else {
        const pending = api.logs.updateCommentFiles(logId, comment.id, [...(comment.attachments ?? []), ...imported])
        pendingCommentSave.current = pending
        const updated = await pending
        if (pendingCommentSave.current === pending) pendingCommentSave.current = null
        if (recordIdRef.current === logId) setComments(previous => previous.map(item => item.id === updated.id ? updated : item))
        syncCommentCount(logId, updated.comment_count)
        refreshChangedComments(logId)
      }
      if (imported.length !== files.length && recordIdRef.current === logId) setCommentErrorId(comment?.id ?? 'new')
    } catch {
      discardDraftFiles(imported, pendingCommentSave.current)
      if (recordIdRef.current === logId) setCommentErrorId(comment?.id ?? 'new')
    } finally {
      if (recordIdRef.current === logId) { setCommentBusyId(null); setAddingComment(false) }
    }
  }

  const removeNewCommentFile = (index: number) => {
    const reference = newCommentFilesRef.current[index]
    newCommentFilesRef.current = newCommentFilesRef.current.filter((_, position) => position !== index)
    setNewCommentFiles(newCommentFilesRef.current)
    if (reference) discardDraftFiles([reference])
  }

  const removeCommentFile = (comment: LogComment, index: number) => {
    if (commentEditor?.id === comment.id) {
      setCommentEditor(current => current ? { ...current, attachments: current.attachments.filter((_, position) => position !== index) } : current)
    } else setCommentFileToDelete({ comment, index })
  }

  const confirmRemoveCommentFile = async () => {
    if (!log || !commentFileToDelete || commentBusyId) return
    const { comment, index } = commentFileToDelete
    const logId = log.id
    setCommentFileToDelete(null)
    setCommentBusyId(comment.id)
    setCommentErrorId(null)
    try {
      const updated = await api.logs.updateCommentFiles(logId, comment.id, comment.attachments.filter((_, position) => position !== index))
      if (recordIdRef.current === logId) setComments(previous => previous.map(item => item.id === updated.id ? updated : item))
      syncCommentCount(logId, updated.comment_count)
      refreshChangedComments(logId)
    } catch { if (recordIdRef.current === logId) setCommentErrorId(comment.id) }
    finally { if (recordIdRef.current === logId) setCommentBusyId(null) }
  }

  const addFiles = async (files: File[], mode: AttachmentMode) => {
    if (!log || log.log_type === 'summary' || files.length === 0 || addingFiles) return
    setAddingFiles(true)
    setFileAddFailed(false)
    let imported: Array<{ path: string }> = []
    try {
      imported = await window.electronAPI?.importAttachments(files, mode) ?? []
      if (imported.length === 0) {
        setFileAddFailed(true)
        return
      }
      if (editing) {
        if (recordIdRef.current !== log.id) { discardDraftFiles(imported.map(file => file.path)); return }
        noteFilesRef.current = [...noteFilesRef.current, ...imported.map(file => file.path)]
        setAddedNoteFiles(noteFilesRef.current)
        setFileAddFailed(imported.length !== files.length)
        return
      }
      const updated = await updateLog(log.id, {
        attachments: [...log.attachments, ...imported.map(file => file.path)]
      })
      if (recordIdRef.current === log.id) {
        setLog(updated)
        setFileAddFailed(imported.length !== files.length)
      }
    } catch (error) {
      imported.forEach(file => void window.electronAPI?.deleteAttachmentFile(file.path))
      setFileAddFailed(true)
      console.error('Failed to add attachments:', error)
    } finally {
      setAddingFiles(false)
    }
  }

  const confirmRemoveNoteFile = async () => {
    if (!log || !noteFileToDelete || addingFiles || saving) return
    const logId = log.id
    const index = log.attachments.indexOf(noteFileToDelete)
    setNoteFileToDelete(null)
    if (index < 0) return
    setAddingFiles(true)
    setNoteFileDeleteFailed(false)
    try {
      const updated = await updateLog(logId, { attachments: log.attachments.filter((_, position) => position !== index) })
      if (recordIdRef.current === logId) setLog(updated)
    } catch { if (recordIdRef.current === logId) setNoteFileDeleteFailed(true) }
    finally { if (recordIdRef.current === logId) setAddingFiles(false) }
  }

  const attachmentPicker = useAttachmentPicker(addFiles, addingFiles, { topInset: 40 })

  const handleDragEnter = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files') || log?.log_type === 'summary') return
    event.preventDefault()
    dragDepthRef.current += 1
    setDraggingFiles(true)
  }

  const handleDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files') || log?.log_type === 'summary') return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDraggingFiles(false)
  }

  const handleDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files') || log?.log_type === 'summary') return
    event.preventDefault()
    dragDepthRef.current = 0
    setDraggingFiles(false)
    attachmentPicker.dropFiles(Array.from(event.dataTransfer.files))
  }

  if (loading || log?.id !== id) return (
    <div className="flex h-full items-center justify-center">
      <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!log) return null

  if (log.is_secret && secretGate !== 'open') {
    if (pendingEditExit) return <ConfirmModal title={t('unsavedChanges')} message={t('discardChangesMessage')}
      danger={false} confirmLabel={t('discardChanges')} cancelLabel={t('keepEditing')}
      onConfirm={discardNoteChanges} onCancel={() => setPendingEditExit(null)} />
    if (secretGate === 'unlock') return (
      <SecretPasswordModal key={log.id} mode="unlock" onSuccess={() => {
        rememberSecretUnlock()
        setSecretGate('open')
      }} onCancel={handleBack} />
    )
    if (secretGate === 'missing') return (
      <ConfirmModal title={t('secretPassword')} message={t('secretPasswordNotSet')} danger={false}
        confirmLabel={t('goToSettings')} onCancel={handleBack} onConfirm={() => navigate('/settings')} />
    )
    return null
  }

  const cfg = TYPE_CONFIG[log.log_type] ?? TYPE_CONFIG.note
  const Icon = cfg.icon
  const fmtCfg = FORMAT_CONFIG[log.content_format ?? 'text']
  const isNote = log.log_type === 'note'
  const isAiSummary = log.log_type === 'summary'
  const displayContent = log.is_secret && secretGate !== 'open' ? '' : (isAiSummary ? getAiSummaryContent(log.content) : log.content)
  const displayTitle = isAiSummary ? getAiSummaryTitle(log.content, log.title) : log.title
  const dateLocale = language === 'ko' ? ko : language === 'ja' ? ja : language === 'zh' ? zhCN : undefined
  const detailDateFormat = language === 'ko' ? 'yyyy년 M월 d일 HH:mm' : language === 'ja' || language === 'zh' ? 'yyyy年M月d日 HH:mm' : 'MMM d, yyyy HH:mm'

  return (
    <div className="relative flex flex-col flex-1 min-w-0 h-full">
      {/* 상단 바 */}
      <div className="flex h-20 shrink-0 items-center gap-3 px-6 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
        <button onClick={handleBack} disabled={saving || addingFiles} className="btn-ghost flex items-center gap-1.5 -ml-1">
          <ArrowLeft className="w-4 h-4" />
          {t('back')}
        </button>
        <div className="flex-1" />
        {!editing && <FavoriteButton variant="detail" log={log} onChange={favorite => setLog(current => current?.id === log.id ? { ...current, favorite } : current)} />}
        {!editing && <WorkspaceMoveButton variant="detail" log={log} onMoved={updated => setLog(current => current?.id === updated.id ? updated : current)} />}
        {isAiSummary ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">{t('summary')}</span>
          </div>
        ) : (
          <>
            {editing ? (
              <>
                <button onClick={() => leaveNoteEditor('cancel')} disabled={saving || addingFiles} className="btn-secondary flex items-center gap-1.5">
                  <X className="w-4 h-4" />
                  {t('cancel')}
                </button>
                <button onClick={handleSave} disabled={saving || addingFiles} className="btn-primary flex items-center gap-1.5">
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  <Save className="w-4 h-4" />
                  {t('save')}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => { setForm(noteForm(log)); setEditing(true) }} className="btn-secondary flex items-center gap-1.5">
                  <SquarePen className="w-4 h-4" />
                  {t('edit')}
                </button>
                <button onClick={handleDelete} className="detail-delete-button btn-secondary flex items-center gap-1.5 text-rose-300 hover:text-rose-300 hover:border-rose-500/30">
                  <Trash2 className="w-4 h-4" />
                  {t('delete')}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* 콘텐츠 */}
      <div
        ref={contentScrollRef}
        data-screen-scroll="main" data-screen-scroll-key={id}
        className="detail-scroll-area relative flex-1 overflow-y-auto"
        onScroll={event => setShowScrollTop(event.currentTarget.scrollTop > 240)}
        onDragEnterCapture={event => {
          if (event.dataTransfer.types.includes('Files') && (event.target as Element).closest('[data-comment-drop]')) {
            dragDepthRef.current = 0; setDraggingFiles(false)
          }
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="w-full px-[84px] pt-6 pb-40 space-y-6">

          {/* 메타 정보 */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
            {isAiSummary ? (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg border bg-amber-500/10 border-amber-500/30">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-medium text-amber-400">{t('summary')}</span>
              </div>
            ) : (
              <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border bg-gray-800/50 ${cfg.border}`}>
                <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                <span className={`text-xs font-medium ${cfg.color}`}>{t(cfg.label as 'note' | 'screenshot' | 'video')}</span>
              </div>
            )}
            {isNote && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg border bg-gray-800/50 border-gray-700">
                <fmtCfg.icon className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs font-medium text-gray-400">{fmtCfg.label === 'html' ? 'HTML' : t(fmtCfg.label as 'text' | 'markdown' | 'code')}</span>
              </div>
            )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2 pt-1 text-right text-xs text-gray-400">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                {format(new Date(log.created_at * 1000), detailDateFormat, dateLocale ? { locale: dateLocale } : undefined)}
              </div>
              {log.updated_at !== log.created_at && (
                <span className="whitespace-nowrap">
                  ({t('updated')} {format(new Date(log.updated_at * 1000), 'HH:mm')})
                </span>
              )}
            </div>
          </div>

          {/* 제목 */}
          {editing ? (
            <input
              type="text"
              className="input text-lg font-semibold"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder={t('title')}
            />
          ) : (
            <div className="flex items-center gap-2"><h1 className="text-xl font-semibold text-white break-words">{displayTitle || t('untitled')}</h1>{!!log.is_secret && <span className="secret-label-badge flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"><Lock className="h-3 w-3" />{t('secret')}</span>}</div>
          )}

          {/* 미디어 */}
          {mediaUrl && (
            <div className="relative group rounded-xl overflow-hidden border border-gray-700">
              {log.log_type === 'video'
                ? <>
                    <video
                      ref={videoRef}
                      src={mediaUrl}
                      controls
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={() => setVideoPlaying(false)}
                      onPlay={() => setVideoPlaying(true)}
                      onPause={() => setVideoPlaying(false)}
                      onEnded={() => setVideoPlaying(false)}
                      className="block w-full max-h-96 bg-black"
                    />
                    {!videoPlaying && (
                      <button
                        type="button"
                        onClick={playVideo}
                        className="absolute left-1/2 top-1/2 grid h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/35 bg-violet-600/90 text-white shadow-lg shadow-black/35 transition-all duration-200 hover:scale-110 hover:bg-violet-500 hover:shadow-xl hover:shadow-violet-500/35 focus:outline-none focus:ring-2 focus:ring-violet-300"
                        title="Play"
                        aria-label="Play video"
                      >
                        <Play className="ml-1 h-7 w-7 fill-current" strokeWidth={2.5} />
                      </button>
                    )}
                  </>
                : <img src={mediaUrl} alt={t('screenshot')} className="w-full object-contain max-h-96 bg-black" />
              }
              {log.log_type !== 'video' && log.file_path && (
                <button
                  onClick={() => window.electronAPI?.openImageViewer(log.file_path!, theme)}
                  className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.15)' }}
                  title={t('enlarge')}
                >
                  <Maximize2 className="w-3.5 h-3.5 text-white" />
                </button>
              )}
            </div>
          )}

          {!editing && !log.is_secret && log.log_type === 'screenshot' && <OcrText key={log.id} log={log} />}

          {/* 내용 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                {t('content')}
              </label>
              <div className="detail-content-actions ml-auto flex items-center gap-2">
                {/* 편집 모드 + 노트일 때 포맷 토글 */}
                {editing && isNote && (
                  <div className="flex items-center gap-1">
                    {FORMATS.map(f => {
                      const fc = FORMAT_CONFIG[f]
                      return (
                        <button
                          key={f}
                          onClick={() => setForm(prev => ({ ...prev, content_format: f }))}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-all ${
                            form.content_format === f
                              ? 'text-violet-300 bg-violet-500/15 border border-violet-500/30'
                              : 'text-gray-400 hover:text-gray-400 border border-transparent'
                          }`}
                        >
                          <fc.icon className="w-3 h-3" />
                          {fc.label === 'html' ? 'HTML' : t(fc.label as 'text' | 'markdown' | 'code')}
                        </button>
                      )
                    })}
                    <button type="button" onClick={() => setForm(prev => ({ ...prev, is_secret: !prev.is_secret }))} aria-pressed={form.is_secret}
                      className={`ml-2 flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors ${form.is_secret ? 'border-violet-500/50 bg-violet-500/15 text-violet-300' : 'text-gray-400 hover:text-gray-200'}`}
                      style={!form.is_secret ? { borderColor: 'var(--soft-border)', background: 'var(--side-panel-bg)', color: 'var(--title-text)' } : undefined}>
                      <Lock className="h-3.5 w-3.5" />{t('secret')}
                    </button>
                  </div>
                )}
                {/* 뷰 모드 + HTML일 때 편집/미리보기 토글 */}
                {!editing && isNote && log.content_format === 'html' && (
                  <button
                    onClick={() => setHtmlPreview(v => !v)}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-gray-400 hover:text-violet-300 hover:bg-violet-500/10 transition-colors"
                  >
                    {htmlPreview ? <Code2 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {htmlPreview ? t('viewSource') : t('preview')}
                  </button>
                )}
                {!editing && log.content && (!log.is_secret || secretGate === 'open') && (
                  <button
                    onClick={handleCopyContent}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-gray-400 hover:text-violet-300 hover:bg-violet-500/10 transition-colors"
                    title={t('copy')}
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? t('copied') : t('copy')}
                  </button>
                )}
              </div>
            </div>

            {editing ? (
              <AutoGrowTextarea
                aria-label={t('content')}
                className={`input detail-content-editor ${form.content_format === 'code' || form.content_format === 'html' ? 'code-input' : ''} ${
                  form.content_format === 'code' ? 'font-mono text-emerald-400 bg-gray-950' :
                  form.content_format === 'html' ? 'font-mono text-sky-300 bg-gray-950' : ''
                }`}
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder={
                  form.content_format === 'code' ? t('codeInput') :
                  form.content_format === 'html' ? t('htmlInput') : t('enterContent')
                }
              />
            ) : log.is_secret && secretGate !== 'open' ? (
              <div className="detail-content flex items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-sm text-gray-400"><Lock className="h-4 w-4 text-violet-400" /><span>••••••••••••</span></div>
            ) : displayContent ? (
              isAiSummary ? (
                <div className="ai-summary-content break-words p-4 rounded-xl border border-amber-500/25 bg-amber-400/10 text-sm text-gray-200 prose prose-invert prose-sm max-w-none
                  [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1
                  [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1
                  [&_li]:text-gray-300
                  [&_strong]:text-white [&_strong]:font-semibold
                  [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-white [&_h1]:mb-2
                  [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mb-1.5
                  [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-gray-200
                  [&_code]:text-emerald-400 [&_code]:bg-gray-900 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs
                  [&_p]:text-gray-300 [&_p]:leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{displayContent}</ReactMarkdown>
                </div>
              ) : log.content_format === 'markdown' ? (
                <MarkdownContent content={log.content} />
              ) : log.content_format === 'html' && htmlPreview ? (
                <iframe
                  srcDoc={`<!DOCTYPE html><html><head><style>body{margin:0;padding:12px;background:#111827;color:#e5e7eb;font-family:sans-serif;font-size:14px;}*{box-sizing:border-box;}</style></head><body>${log.content}</body></html>`}
                  className="w-full rounded-xl border border-gray-700 bg-gray-900"
                  style={{ minHeight: '200px', height: '400px' }}
                  sandbox="allow-scripts"
                />
              ) : (
                <div className={`detail-content break-words p-4 rounded-xl border border-gray-700 text-sm whitespace-pre-wrap ${
                  log.content_format === 'code' ? 'font-mono text-emerald-400 bg-gray-950' :
                  log.content_format === 'html' ? 'font-mono text-sky-300 bg-gray-950' :
                  'bg-gray-800/50 text-gray-200'
                }`}>
                  {log.content}
                </div>
              )
            ) : (
              <p className="text-gray-400 text-sm italic">{t('noContent')}</p>
            )}
          </div>

          {/* 첨부 파일 */}
          {secretGate === 'open' && (!isAiSummary || log.attachments.length > 0) && (
            <section className="space-y-2" aria-label={t('attachmentFiles')}>
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400"><Paperclip className="h-3.5 w-3.5" /><span>{t('attachmentFiles')}</span></div>
              <div className="flex flex-col gap-2">
                {[...log.attachments, ...addedNoteFiles].map((reference, index) => removedAttachments.includes(index) ? null : (
                  <AttachmentFileRow key={`${reference}-${index}`} reference={reference} url={attachmentUrls[index]}
                    actionsOnHover allowOpen={!editing} disabled={saving || addingFiles} removeStyle="hover"
                    onRemove={editing ? () => setRemovedAttachments(previous => [...previous, index]) : () => setNoteFileToDelete(reference)} />
                ))}
              </div>
              {noteFileDeleteFailed && <p role="alert" className="text-xs text-red-400">{t('operationFailed')}</p>}
              {!isAiSummary && <>
                {attachmentPicker.input}
                {attachmentPicker.dialog}
                <FileDropZone onSelect={attachmentPicker.selectFiles} busy={addingFiles} dragging={draggingFiles} />
                {fileAddFailed && <p className="text-xs text-red-400">{t('fileImportFailed')}</p>}
                {!editing && !log.is_secret && log.log_type !== 'screenshot' && !!log.attachments.length && <OcrText key={log.id} log={log} />}
              </>}
            </section>
          )}

          {/* 같은 그룹의 다른 기록 */}
          {groupLogs.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Layers className="w-3.5 h-3.5 text-violet-400" />
                <label className="text-xs font-medium text-gray-400">{t('includedRecords', { count: groupLogs.length })}</label>
              </div>
              <div className="space-y-1.5">
                {groupLogs.map(l => {
                  const typeCfg = TYPE_CONFIG[l.log_type as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG.note
                  const TypeIcon = typeCfg.icon
                  return (
                    <div
                      key={l.id}
                      onClick={() => openLog(l.id)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-800 bg-gray-800/30 hover:bg-gray-800/60 cursor-pointer transition-colors"
                    >
                      <div className={`shrink-0 w-6 h-6 rounded-md border flex items-center justify-center ${
                        l.log_type === 'screenshot' ? 'bg-blue-500/10 border-blue-500/20' :
                        l.log_type === 'video'      ? 'bg-orange-500/10 border-orange-500/20' :
                                                      'bg-violet-500/10 border-violet-500/20'
                      }`}>
                        <TypeIcon className={`w-3 h-3 ${typeCfg.color}`} />
                      </div>
                      <span className="flex-1 text-sm text-gray-300 truncate">{l.title || t('untitled')}</span>
                      <span className="text-xs text-gray-500 shrink-0">
                        {format(new Date(l.created_at * 1000), 'HH:mm', { locale: ko })}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 태그 */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Tag className="w-3.5 h-3.5 text-gray-400" />
              <label className="text-xs font-medium text-gray-400">{t('tags')}</label>
            </div>
            {editing ? (
              <TagInput
                value={form.tags}
                onChange={tags => setForm(f => ({ ...f, tags }))}
                disabled={saving}
              />
            ) : log.tags?.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {log.tags.map(tag => (
                  <TagBadge key={tag} tag={tag} className="px-2.5 py-1" />
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">{t('noTags')}</p>
            )}
          </div>

          {/* 댓글 */}
          <div className="border-t pt-5" style={{ borderColor: 'var(--soft-border)' }}>
            <div className="mb-2 flex items-center gap-1.5">
              <MessageCircle className="h-3.5 w-3.5 text-violet-400" />
              <label className="text-xs font-medium text-gray-400">{t('comments')}</label>
              <span className="text-xs text-gray-500">{comments.length}</span>
            </div>
            {comments.length > 0 && (
              <div className="mb-3 space-y-2">
                {comments.map(comment => (
                  <CommentCard key={comment.id} comment={comment}
                    date={format(new Date(comment.created_at * 1000), detailDateFormat, dateLocale ? { locale: dateLocale } : undefined)}
                    draft={commentEditor?.id === comment.id ? commentEditor.content : null}
                    files={commentEditor?.id === comment.id ? commentEditor.attachments : (comment.attachments ?? [])}
                    busy={commentBusyId !== null || addingComment} error={commentErrorId === comment.id}
                    onEdit={() => { cancelCommentEditor(); setCommentEditor({ id: comment.id, content: comment.content, attachments: [...(comment.attachments ?? [])], added: [] }); setCommentErrorId(null) }}
                    onChange={content => setCommentEditor(current => current?.id === comment.id ? { ...current, content } : current)}
                    onSave={() => void handleSaveComment()}
                    onCancel={cancelCommentEditor}
                    onFiles={(files, mode) => addCommentFiles(comment, files, mode)}
                    onRemoveFile={index => removeCommentFile(comment, index)}
                    onDelete={() => { setCommentToDelete(comment); setCommentErrorId(null) }} />
                ))}
              </div>
            )}
            <CommentComposer content={commentDraft} files={newCommentFiles} busy={addingComment || commentBusyId !== null} error={commentErrorId === 'new'}
              onChange={setCommentDraft} onFiles={(files, mode) => addCommentFiles(null, files, mode)}
              onRemove={removeNewCommentFile} onSubmit={() => void handleAddComment()} />
          </div>
        </div>
      </div>

      {pendingEditExit && <ConfirmModal title={t('unsavedChanges')} message={t('discardChangesMessage')}
        danger={false} confirmLabel={t('discardChanges')} cancelLabel={t('keepEditing')}
        onConfirm={discardNoteChanges} onCancel={() => setPendingEditExit(null)} />}
      {commentFileToDelete && <ConfirmModal title={t('delete')} message={t('deleteCommentFileMessage')}
        onConfirm={() => void confirmRemoveCommentFile()} onCancel={() => setCommentFileToDelete(null)} />}

      {commentToDelete && <ConfirmModal title={t('deleteComment')} message={t('deleteCommentMessage')}
        onConfirm={() => void handleDeleteComment()} onCancel={() => setCommentToDelete(null)} />}

      {showScrollTop && (
        <button
          type="button"
          onClick={() => contentScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="dashboard-scroll-top absolute right-7 bottom-7 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-purple-400/65 bg-gray-800 text-purple-300 shadow-lg transition-all hover:scale-105 hover:border-purple-300 hover:bg-purple-400/65 hover:text-white"
          title={t('backToTop')}
        >
          <ArrowUp className="w-4 h-4" strokeWidth={2.8} />
        </button>
      )}

      {noteFileToDelete && <ConfirmModal title={t('delete')} message={t('deleteNoteFileMessage')}
        onConfirm={confirmRemoveNoteFile} onCancel={() => setNoteFileToDelete(null)} />}
      {showConfirm && (
        <ConfirmModal
          title={t('deleteLog')}
          message={t('deleteRecordMessage')}
          onConfirm={confirmDelete}
          onCancel={() => setShowConfirm(false)}
        />
      )}

    </div>
  )
}
