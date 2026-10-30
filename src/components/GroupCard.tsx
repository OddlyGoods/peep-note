import { useState, useEffect } from 'react'
import { Layers, Pencil, Unlink, Trash2, Check, X, ChevronDown, ChevronUp, Sparkles, Key, Loader2 } from 'lucide-react'
import { LogGroup, api } from '../lib/api'
import LogCard from './LogCard'
import ConfirmModal from './ConfirmModal'
import { useI18n } from '../i18n'
import { useCardViewStore } from '../stores/cardViewStore'

interface Props {
  group: LogGroup
  onRefresh: () => void
  startEditing?: boolean
  onStartEditingHandled?: () => void
  showCheckbox?: boolean
  checked?: boolean
  onCheck?: (checked: boolean) => void
  isDeleting?: boolean
  isCollapsing?: boolean
  revealLogId?: string
}

export default function GroupCard({ group, onRefresh, startEditing = false, onStartEditingHandled, showCheckbox = false, checked = false, onCheck, isDeleting = false, isCollapsing = false, revealLogId }: Props) {
  const { t, language } = useI18n()
  const expanded = useCardViewStore(state => state.collapsedGroups[group.id] !== true)
  const logsExpanded = useCardViewStore(state => state.expandedGroupRecords[group.id] === true)
  const setGroupExpanded = useCardViewStore(state => state.setGroupExpanded)
  const setGroupRecordsExpanded = useCardViewStore(state => state.setGroupRecordsExpanded)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(group.name)
  const [confirmAction, setConfirmAction] = useState<'ungroup' | 'delete' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [collapsing, setCollapsing] = useState(false)
  const deletingVisual = deleting || isDeleting
  const collapsingVisual = collapsing || isCollapsing

  // AI
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [showVideoSummaryNotice, setShowVideoSummaryNotice] = useState(false)

  useEffect(() => {
    if (!startEditing) return
    setEditName(group.name)
    setEditing(true)
    onStartEditingHandled?.()
  }, [startEditing, group.id])

  useEffect(() => {
    api.ai.keyStatus().then(r => setHasKey(r.has_key)).catch(() => setHasKey(false))
  }, [])

  const handleRename = async () => {
    if (!editName.trim()) return
    await api.groups.rename(group.id, editName.trim())
    setEditing(false)
    onRefresh()
  }

  const handleUngroup = async () => {
    await api.groups.ungroup(group.id)
    onRefresh()
  }

  const handleDelete = async () => {
    setConfirmAction(null)
    setDeleting(true)
    await new Promise(resolve => window.setTimeout(resolve, 700))
    setCollapsing(true)
    await new Promise(resolve => window.setTimeout(resolve, 280))
    try {
      await api.groups.delete(group.id)
      onRefresh()
    } catch {
      setCollapsing(false)
      setDeleting(false)
    }
  }

  const handleSaveKey = async () => {
    if (!keyInput.trim()) return
    const settings = await api.settings.get()
    const keyField = {
      openai: 'openai_api_key', anthropic: 'anthropic_api_key',
      gemini: 'gemini_api_key', qwen: 'qwen_api_key'
    } as const
    await api.settings.update({ [keyField[settings.ai_provider]]: keyInput.trim() })
    setHasKey(true)
    setShowKeyInput(false)
    setKeyInput('')
  }

  const handleAiSummarize = async () => {
    if (!hasKey) { setShowKeyInput(true); return }
    setAiLoading(true)
    setAiError(null)
    try {
      await api.ai.summarize(group.id, language)
      onRefresh()
    } catch (e: any) {
      if (e.message === 'NO_API_KEY') {
        setHasKey(false)
        setShowKeyInput(true)
      } else {
        setAiError(e.message ?? 'AI 오류가 발생했습니다')
      }
    }
    setAiLoading(false)
  }

  const handleAiSummaryClick = () => {
    if (!hasKey) {
      setShowKeyInput(true)
      return
    }
    if (group.logs.some(log => log.log_type === 'video')) {
      setShowVideoSummaryNotice(true)
      return
    }
    handleAiSummarize()
  }

  const nonSummaryLogs = group.logs.filter(l => l.log_type !== 'summary')
  const summaryLog = group.logs.find(l => l.log_type === 'summary')
  const recordCount = (count: number) => language === 'en' ? `${count} ${t('records')}` : language === 'ko' ? `${count}개` : `${count}${t('records')}`
  const [revealedInGroup, setRevealedInGroup] = useState(false)

  useEffect(() => {
    if (!revealLogId || !group.logs.some(log => log.id === revealLogId)) return
    setGroupExpanded(group.id, true)
    setGroupRecordsExpanded(group.id, true)
    setRevealedInGroup(true)
  }, [revealLogId, group.logs, group.id])

  return (
    <div data-group-id={group.id} className={`group relative overflow-hidden rounded-xl border-2 bg-violet-500/5 transition-all duration-300 ease-in-out ${
      collapsingVisual ? 'max-h-0 opacity-0 scale-[0.98] border-transparent' : revealedInGroup ? 'max-h-none' : 'max-h-[5000px]'
    } ${deletingVisual ? 'pointer-events-none opacity-45' : ''} ${checked ? 'border-violet-400/70 ring-1 ring-violet-400/25' : 'border-violet-500/30'}`}>
      {/* 그룹 헤더 */}
      <div
        onClick={showCheckbox && !editing ? () => onCheck?.(!checked) : undefined}
        className={`flex items-center gap-2 px-4 py-[0.425rem] bg-violet-500/10 border-b border-violet-500/20 ${showCheckbox && !editing ? 'cursor-pointer' : ''}`}
      >
        {showCheckbox && !editing && (
          <button
            type="button"
            onClick={event => { event.stopPropagation(); onCheck?.(!checked) }}
            className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
              checked ? 'bg-violet-600 border-violet-500' : 'border-violet-400/70 hover:border-violet-300'
            }`}
          >
            {checked && <Check className="w-2.5 h-2.5 text-white" />}
          </button>
        )}
        <Layers className="w-4 h-4 text-violet-400 shrink-0" />

        {editing ? (
          <div
            className="flex items-center gap-1.5 flex-1 min-w-0 rounded-lg border p-1"
            style={{ background: 'var(--app-bg)', borderColor: 'var(--medium-border)' }}
          >
            <input
              autoFocus
              value={editName}
              onFocus={e => e.currentTarget.select()}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleRename()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditing(false)
                  setEditName(group.name)
                }
              }}
              className="min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-sm font-medium outline-none transition-colors"
              style={{ background: 'var(--side-panel-bg)', color: 'var(--title-text)', borderColor: 'var(--soft-border)' }}
            />
            <button type="button" onClick={handleRename} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => { setEditing(false); setEditName(group.name) }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-500/15 hover:text-gray-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : showCheckbox ? (
          <>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <span className="text-sm font-medium text-violet-200 truncate">{group.name}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <span className="text-sm font-medium text-violet-200 truncate">{group.name}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* AI 요약 버튼 */}
              <button
                onClick={handleAiSummaryClick}
                disabled={aiLoading || nonSummaryLogs.length === 0}
                className="p-1.5 rounded-lg text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                title={t('summary')}
                aria-label={t('summary')}
                aria-busy={aiLoading}
              >
                {aiLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Sparkles className="w-3.5 h-3.5" />
                }
              </button>
              <div className="w-px h-3.5 bg-violet-500/30 mx-0.5" />
              <button
                onClick={() => setConfirmAction('ungroup')}
                className="p-1.5 rounded-lg text-violet-400/60 hover:text-violet-300 hover:bg-violet-500/20 transition-colors"
                title={t('ungroup')}
              >
                <Unlink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setEditing(true); setEditName(group.name) }}
                className="p-1.5 rounded-lg text-violet-400/60 hover:text-violet-300 hover:bg-violet-500/20 transition-colors"
                title={t('rename')}
                aria-label={t('rename')}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setConfirmAction('delete')}
                className="p-1.5 rounded-lg text-violet-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title={t('deleteGroup')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setGroupExpanded(group.id, !expanded)}
                title={t(expanded ? 'collapseContent' : 'expandContent')}
                aria-label={t(expanded ? 'collapseContent' : 'expandContent')}
                aria-expanded={expanded}
                className="p-1.5 rounded-lg text-violet-400/60 hover:text-violet-300 hover:bg-violet-500/20 transition-colors"
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </>
        )}
      </div>

      {/* API 키 입력 영역 */}
      {showKeyInput && (
        <div className="px-4 py-3 bg-amber-500/5 border-b border-amber-500/20 flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <input
            autoFocus
            type="password"
            placeholder={t('aiSettings')}
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveKey(); if (e.key === 'Escape') setShowKeyInput(false) }}
            className="flex-1 bg-gray-800 border border-amber-500/30 rounded px-2 py-1 text-xs text-white outline-none placeholder-gray-600"
          />
          <button onClick={handleSaveKey} className="text-xs text-green-400 hover:text-green-300 px-2 py-1 rounded hover:bg-green-500/10">저장</button>
          <button onClick={() => setShowKeyInput(false)} className="text-gray-500 hover:text-gray-300"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* AI 오류 */}
      {aiError && (
        <div className="px-4 py-2 bg-red-500/5 border-b border-red-500/20 flex items-center justify-between gap-2">
          <span className="text-xs text-red-400">{aiError}</span>
          <button onClick={() => setAiError(null)}><X className="w-3 h-3 text-gray-500" /></button>
        </div>
      )}

      {/* 그룹 내 로그 목록 */}
      {expanded && (
        <div className="p-3 space-y-2">
          {summaryLog ? (
            <>
              {/* AI 요약 — 항상 표시 */}
              <LogCard key={summaryLog.id} log={summaryLog} summaryAccent inGroup={showCheckbox} onCardClick={showCheckbox ? () => onCheck?.(!checked) : undefined} onMoved={onRefresh} />

              {/* 일반 기록 토글 */}
              <button
                onClick={() => setGroupRecordsExpanded(group.id, !logsExpanded)}
                aria-expanded={logsExpanded}
                className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-lg text-xs text-violet-500 hover:text-violet-600 hover:bg-violet-500/10 transition-colors"
              >
                {logsExpanded
                  ? <ChevronUp className="w-3.5 h-3.5" />
                  : <ChevronDown className="w-3.5 h-3.5" />
                }
                {recordCount(nonSummaryLogs.length)}
              </button>

              {logsExpanded && nonSummaryLogs.map(log => (
                <LogCard key={log.id} log={log} inGroup onCardClick={showCheckbox ? () => onCheck?.(!checked) : undefined} onMoved={onRefresh} />
              ))}
            </>
          ) : (
            /* 요약 없으면 기존대로 전체 표시 */
            nonSummaryLogs.map(log => (
              <LogCard key={log.id} log={log} inGroup onCardClick={showCheckbox ? () => onCheck?.(!checked) : undefined} onMoved={onRefresh} />
            ))
          )}
        </div>
      )}

      {confirmAction === 'ungroup' && (
        <ConfirmModal
          title={t('ungroup')}
          message={`${t('ungroupMessage', { name: group.name })}${summaryLog ? `\n\n${t('ungroupSummaryWarning')}` : ''}`}
          confirmLabel={t('ungroup')}
          onConfirm={handleUngroup}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {showVideoSummaryNotice && (
        <ConfirmModal
          title={t('videoSummaryNoticeTitle')}
          message={t('videoSummaryNoticeMessage')}
          confirmLabel={t('summary')}
          danger={false}
          confirmTone="amber"
          onConfirm={() => {
            setShowVideoSummaryNotice(false)
            handleAiSummarize()
          }}
          onCancel={() => setShowVideoSummaryNotice(false)}
        />
      )}
      {confirmAction === 'delete' && (
        <ConfirmModal
          title={t('deleteGroup')}
          message={t('deleteGroupMessage', { name: group.name, count: group.logs.length })}
          confirmLabel={t('delete')}
          onConfirm={handleDelete}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {deletingVisual && (
        <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'rgba(15,18,45,0.28)', backdropFilter: 'blur(1px)' }}>
          <Loader2 className="w-5 h-5 text-violet-300 animate-spin" />
        </div>
      )}
    </div>
  )
}
