import { useEffect, useRef, useState } from 'react'
import { FolderInput, FolderOpen, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../i18n'
import { useWorkspaceStore } from '../stores/workspaceStore'

type Props = {
  logIds: string[]
  groupIds: string[]
  currentWorkspaceId: string | null
  onMoved: () => void | Promise<void>
}

export default function BulkWorkspaceMoveButton({ logIds, groupIds, currentWorkspaceId, onMoved }: Props) {
  const { t } = useI18n()
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const destinations = workspaces.filter(workspace => workspace.id !== currentWorkspaceId)
  const selectionCount = logIds.length + groupIds.length
  const disabled = selectionCount === 0 || destinations.length === 0 || busyId !== null

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const move = async (workspaceId: string) => {
    if (busyId) return
    setBusyId(workspaceId)
    setError(false)
    try {
      await api.logs.bulkMove(logIds, groupIds, workspaceId)
      await onMoved()
      setOpen(false)
    } catch {
      setError(true)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setError(false); setOpen(value => !value) }}
        className="btn-secondary flex h-9 items-center gap-1.5 py-0 disabled:cursor-not-allowed disabled:opacity-40"
        title={t('moveWorkspace')}
      >
        {busyId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
        {t('move')}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('moveToWorkspace')}
          className="absolute right-0 top-full z-40 mt-1.5 w-56 overflow-hidden rounded-xl border shadow-2xl"
          style={{ background: 'var(--modal-bg)', borderColor: 'var(--medium-border)', boxShadow: 'var(--modal-shadow)' }}
        >
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium" style={{ color: 'var(--title-text)', borderColor: 'var(--soft-border)' }}>
            <FolderInput className="h-3.5 w-3.5 text-indigo-400" />
            {t('moveToWorkspace')}
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5">
            {destinations.map(workspace => (
              <button
                key={workspace.id}
                type="button"
                role="menuitem"
                disabled={busyId !== null}
                onClick={() => void move(workspace.id)}
                className="workspace-move-option flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors disabled:opacity-50"
                style={{ color: 'var(--title-text)' }}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                <span className="min-w-0 flex-1 truncate">{workspace.is_default ? t('defaultWorkspace') : workspace.name}</span>
                {busyId === workspace.id && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-400" />}
              </button>
            ))}
          </div>
          {error && <p role="alert" className="border-t px-3 py-2 text-xs text-red-400" style={{ borderColor: 'var(--soft-border)' }}>{t('operationFailed')}</p>}
        </div>
      )}
    </div>
  )
}
