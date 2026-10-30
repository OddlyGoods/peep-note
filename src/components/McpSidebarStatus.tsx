import { useEffect } from 'react'
import { Plug } from 'lucide-react'
import { useI18n } from '../i18n'
import { useMcpStatusStore } from '../stores/mcpStatusStore'

export default function McpSidebarStatus({ collapsed }: { collapsed: boolean }) {
  const { t } = useI18n()
  const status = useMcpStatusStore(state => state.status)
  const refresh = useMcpStatusStore(state => state.refresh)
  const enabled = status?.enabled === true
  const label = t(enabled ? 'mcpSidebarEnabled' : 'mcpSidebarDisabled')
  const dotColor = enabled ? '#34d399' : '#64748b'
  const iconColor = enabled ? 'var(--workspace-badge-text)' : '#64748b'
  let address = ''
  try { if (status?.endpoint) address = new URL(status.endpoint).host } catch {}

  useEffect(() => {
    const update = () => { if (!document.hidden) void refresh().catch(() => {}) }
    update()
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [refresh])

  if (collapsed) return <div className="relative group">
    <div role="status" aria-label={label} tabIndex={0}
      className="flex h-9 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/30">
      <span className="relative flex h-4 w-4 items-center justify-center">
        <Plug className="h-4 w-4" style={{ color: iconColor }} aria-hidden="true" />
        <span data-mcp-dot className="absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full"
          style={{ background: dotColor, boxShadow: '0 0 0 2px var(--app-bg)' }} />
      </span>
    </div>
    <div aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      style={{ background: 'rgba(30,34,60,.97)', border: '1px solid rgba(99,102,241,.25)' }}>{label}</div>
  </div>

  return <section role="status" aria-label={label} className="mcp-status-card rounded-xl p-3">
    <div className="flex items-center gap-2">
      <span data-mcp-dot className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />
      <span className="text-xs font-semibold" style={{ color: 'var(--title-text)' }}>MCP</span>
      <Plug className="ml-auto h-3.5 w-3.5" style={{ color: iconColor }} aria-hidden="true" />
    </div>
    <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--title-text)' }}>
      {t(enabled ? 'mcpSidebarActiveHint' : 'mcpSidebarInactiveHint')}
    </p>
    <p className="mt-1 truncate text-[11px] leading-relaxed text-slate-400">
      {enabled && address ? address : 'Codex · Claude · Gemini'}
    </p>
  </section>
}
