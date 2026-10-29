import { useScreenActive } from '../lib/screenActivity'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderInput, FolderOpen, Loader2 } from 'lucide-react'
import type { Log } from '../lib/api'
import { useI18n } from '../i18n'
import { useLogStore } from '../stores/logStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

type Props = {
  log: Log
  variant?: 'compact' | 'detail'
  onMoved?: (log: Log) => void
}

export default function WorkspaceMoveButton({ log, variant = 'compact', onMoved }: Props) {
  const { t } = useI18n()
  const active = useScreenActive()
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const fetchWorkspaces = useWorkspaceStore(state => state.fetchWorkspaces)
  const moveLog = useLogStore(state => state.moveLog)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { if (!active) setOpen(false) }, [active])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (workspaces.length === 0) void fetchWorkspaces()
  }, [fetchWorkspaces, workspaces.length])

  const currentWorkspaceId = log.workspace_id ?? workspaces.find(workspace => workspace.is_default)?.id ?? null
  const destinations = useMemo(
    () => workspaces.filter(workspace => workspace.id !== currentWorkspaceId),
    [currentWorkspaceId, workspaces]
  )
  const disabled = workspaces.length <= 1 || destinations.length === 0 || busyId !== null

  const openMenu = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (disabled || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const width = 224
    const estimatedHeight = Math.min(280, 42 + destinations.length * 38)
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))
    const top = rect.bottom + 6 + estimatedHeight <= window.innerHeight
      ? rect.bottom + 6
      : Math.max(8, rect.top - estimatedHeight - 6)
    setPosition({ top, left })
    setError(false)
    setOpen(value => !value)
  }

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const node = event.target as Node
      if (!buttonRef.current?.contains(node) && !menuRef.current?.contains(node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const closeOnViewportChange = () => setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [open])

  const move = async (workspaceId: string) => {
    if (busyId) return
    setBusyId(workspaceId)
    setError(false)
    try {
      const updated = await moveLog(log.id, workspaceId)
      onMoved?.(updated)
      setOpen(false)
    } catch {
      setError(true)
    } finally {
      setBusyId(null)
    }
  }

  return <>
    <button
      ref={buttonRef}
      type="button"
      title={t('moveWorkspace')}
      aria-label={t('moveWorkspace')}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      onClick={openMenu}
      className={`${variant === 'detail'
        ? 'btn-secondary inline-flex h-[38px] items-center justify-center gap-1.5 px-3 py-0'
        : 'p-1.5 rounded-lg text-gray-400 hover:text-indigo-400 hover:bg-indigo-500/10'
      } transition-colors disabled:cursor-not-allowed disabled:opacity-30`}
    >
      {busyId
        ? <Loader2 className={`${variant === 'detail' ? 'w-4 h-4' : 'w-3.5 h-3.5'} animate-spin`} />
        : <FolderInput className={variant === 'detail' ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
      }
      {variant === 'detail' && t('move')}
    </button>

    {active && open && createPortal(
      <div
        ref={menuRef}
        role="menu"
        aria-label={t('moveToWorkspace')}
        onClick={event => event.stopPropagation()}
        className="fixed z-[80] w-56 overflow-hidden rounded-xl border shadow-2xl"
        style={{ top: position.top, left: position.left, background: 'var(--modal-bg)', borderColor: 'var(--medium-border)', boxShadow: 'var(--modal-shadow)' }}
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
      </div>,
      document.body
    )}
  </>
}
