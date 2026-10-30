import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Search, Star, Trash2, Settings, ChevronLeft, ChevronRight, Power } from 'lucide-react'
import TitleBar from './TitleBar'
import { useI18n } from '../i18n'
import UpdatePanel from './UpdatePanel'
import { api } from '../lib/api'
import { useLogStore } from '../stores/logStore'
import { useMenuMemoryStore } from '../stores/menuMemoryStore'
import type { MenuPath } from '../lib/menuMemory'
import ConfirmModal from './ConfirmModal'

export default function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(true)
  const logs = useLogStore(state => state.logs)
  const remembered = useMenuMemoryStore(state => state.targets)
  const [favoriteCount, setFavoriteCount] = useState(0)
  const [trashCount, setTrashCount] = useState(0)
  const [showQuitConfirm, setShowQuitConfirm] = useState(false)
  const [quitting, setQuitting] = useState(false)
  const [quitFailed, setQuitFailed] = useState(false)
  const exitRequested = useRef(false)
  const quitApp = async () => {
    if (exitRequested.current || !window.electronAPI?.quitApp) return
    exitRequested.current = true
    setQuitting(true)
    setQuitFailed(false)
    try {
      if (!await window.electronAPI.quitApp()) throw new Error('APP_QUIT_FAILED')
      setShowQuitConfirm(false)
    } catch { setQuitFailed(true) }
    finally { exitRequested.current = false; setQuitting(false) }
  }

  useEffect(() => {
    let cancelled = false
    const refreshCounts = () => {
      api.logs.favoriteCount().then(({ count }) => { if (!cancelled) setFavoriteCount(count) }).catch(() => {})
      api.trash.count().then(({ count }) => { if (!cancelled) setTrashCount(count) }).catch(() => {})
    }
    refreshCounts()
    window.electronAPI?.on('log-created', refreshCounts)
    return () => {
      cancelled = true
      window.electronAPI?.off('log-created', refreshCounts)
    }
  }, [logs, location.pathname])

  const nav = [
    { to: '/', icon: LayoutDashboard, label: t('dashboard') },
    { to: '/search', icon: Search, label: t('search') },
    { to: '/favorites', icon: Star, label: t('favorites'), count: favoriteCount },
    { to: '/trash', icon: Trash2, label: t('trash'), count: trashCount },
    { to: '/settings', icon: Settings, label: t('settings') }
  ]

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--app-bg)' }}>
      {/* 커스텀 타이틀바 */}
      <TitleBar />

      {/* 업데이트 배너 */}
      {location.pathname !== '/settings' && <UpdatePanel banner />}

      <div className="flex flex-1 min-h-0">
        {/* 사이드바 */}
        <aside
          className="flex flex-col shrink-0 border-r relative transition-all duration-200"
          style={{
            width: collapsed ? '56px' : '208px',
            background: 'var(--sidebar-bg)',
            borderColor: 'var(--soft-border)'
          }}
        >
          {/* 네비게이션 */}
          <nav className="flex flex-1 flex-col gap-0.5 p-2 pt-4">
            {nav.map(({ to, icon: Icon, label, count }) => {
              const active = location.pathname === to
                || (to === '/' && location.pathname.startsWith('/log/'))
                || (to === '/favorites' && location.pathname.startsWith('/favorites/'))
                || (to === '/search' && location.pathname.startsWith('/search/'))
              return (
                <div key={to} className={`relative group ${to === '/settings' ? 'mt-auto' : ''}`}>
                  <Link
                    to={active ? to : remembered[to as MenuPath] ?? to}
                    aria-label={label}
                    aria-current={active ? 'page' : undefined}
                    className={`app-nav-link flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      collapsed ? 'justify-center gap-0' : 'gap-2.5'
                    } ${
                      active
                        ? 'text-indigo-300 border'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent'
                    }`}
                    style={active ? {
                      background: 'rgba(99, 102, 241, 0.12)',
                      borderColor: 'rgba(99, 102, 241, 0.3)',
                      boxShadow: 'inset 0 0 20px rgba(99,102,241,0.05)'
                    } : {}}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                    <span className={`whitespace-nowrap overflow-hidden transition-all duration-200 ${collapsed ? 'max-w-0 opacity-0' : 'max-w-32 opacity-100'}`}>
                      {label}
                    </span>
                    {!collapsed && count !== undefined && (
                      <span className="ml-auto min-w-5 px-1.5 text-xs rounded-full text-center tabular-nums bg-indigo-500/10 text-indigo-400">
                        {count}
                      </span>
                    )}
                  </Link>
                  {collapsed && (
                    <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded-md text-xs font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50"
                      style={{ background: 'rgba(30,34,60,0.97)', border: '1px solid rgba(99,102,241,0.25)' }}
                    >
                      {label}{count !== undefined && ` (${count})`}
                    </div>
                  )}
                </div>
              )
            })}
            <div className="relative group mt-2 border-t pt-2" style={{ borderColor: 'var(--soft-border)' }}>
              <button type="button" aria-label={t('quitApp')}
                disabled={!window.electronAPI?.quitApp || quitting}
                onClick={() => { setQuitFailed(false); setShowQuitConfirm(true) }}
                className={`app-quit-button flex w-full items-center rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-slate-500 transition-colors disabled:opacity-40 ${collapsed ? 'justify-center gap-0' : 'gap-2.5'}`}>
                <Power className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className={`whitespace-nowrap overflow-hidden transition-all duration-200 ${collapsed ? 'max-w-0 opacity-0' : 'max-w-32 opacity-100'}`}>{t('quitApp')}</span>
              </button>
              {collapsed && <div aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 rounded-md px-2 py-1 text-xs font-medium text-white whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-50"
                style={{ background: 'rgba(30,34,60,0.97)', border: '1px solid rgba(99,102,241,0.25)' }}>{t('quitApp')}</div>}
            </div>
          </nav>

          {/* 접기/펼치기 버튼 */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center transition-colors z-10"
            style={{
              background: 'var(--sidebar-toggle-bg)',
              border: '1px solid var(--sidebar-toggle-border)',
              color: 'var(--sidebar-toggle-text)'
            }}
          >
            {collapsed
              ? <ChevronRight className="w-3.5 h-3.5" />
              : <ChevronLeft className="w-3.5 h-3.5" />
            }
          </button>
        </aside>

        {/* 메인 콘텐츠 */}
        <main className="flex-1 min-w-0 overflow-hidden" style={{ background: 'var(--app-bg)' }}>
          {children}
        </main>
      </div>
      {showQuitConfirm && <ConfirmModal title={t('quitApp')} message={t(quitFailed ? 'quitAppFailed' : 'quitAppConfirm')}
        confirmLabel={t('quitApp')} onConfirm={() => { void quitApp() }}
        onCancel={() => { if (!exitRequested.current) setShowQuitConfirm(false) }} />}
    </div>
  )
}
