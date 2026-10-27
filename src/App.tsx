import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Trash from './pages/Trash'
import Favorites from './pages/Favorites'
import LogDetail from './pages/LogDetail'
import Settings from './pages/Settings'
import Search from './pages/Search'
import Layout from './components/Layout'
import DashboardSidebar from './components/DashboardSidebar'
import { useLogStore } from './stores/logStore'
import { api } from './lib/api'
import { useI18n } from './i18n'
import { useTheme } from './theme'
import LogNavigationProvider, { useOpenLog } from './components/LogNavigationProvider'
import { useSearchStore } from './stores/searchStore'
import { saveQuickListRange } from './lib/quickListRange'
import { useWorkspaceStore } from './stores/workspaceStore'
import { subscribeToUpdates } from './stores/updateStore'

function ElectronNavigation() {
  const openLog = useOpenLog()
  const { pathname } = useLocation()
  const dateFrom = useLogStore(state => state.dateFrom)
  const dateTo = useLogStore(state => state.dateTo)
  const searchDateFrom = useSearchStore(state => state.dateFrom)
  const searchDateTo = useSearchStore(state => state.dateTo)
  const syncToday = useLogStore(s => s.syncToday)
  useEffect(() => {
    const isSearch = pathname === '/search' || pathname.startsWith('/search/')
    saveQuickListRange({ dateFrom: isSearch ? searchDateFrom : dateFrom, dateTo: isSearch ? searchDateTo : dateTo })
  }, [pathname, dateFrom, dateTo, searchDateFrom, searchDateTo])
  useEffect(() => {
    const handleOpenLog = (payload: unknown) => {
      const data = typeof payload === 'object' && payload !== null ? payload as { id?: string; fromQuickSwitch?: boolean } : { id: payload as string }
      if (data.id) openLog(data.id, '/log', { state: { fromQuickSwitch: !!data.fromQuickSwitch } })
    }
    window.electronAPI?.on('open-log', handleOpenLog)
    const syncWhenVisible = () => {
      if (!document.hidden) syncToday()
    }
    syncToday()
    window.addEventListener('focus', syncToday)
    document.addEventListener('visibilitychange', syncWhenVisible)
    return () => {
      window.electronAPI?.off('open-log', handleOpenLog)
      window.removeEventListener('focus', syncToday)
      document.removeEventListener('visibilitychange', syncWhenVisible)
    }
  }, [openLog, syncToday])
  return null
}

export default function App() {
  useEffect(subscribeToUpdates, [])
  const { setLanguage } = useI18n()
  const { setTheme } = useTheme()
  const setAutoAdvanceDateRange = useLogStore(s => s.setAutoAdvanceDateRange)

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'openpeepnote_workspace' || event.key === null) {
        try {
          const saved = JSON.parse(localStorage.getItem('openpeepnote_workspace') ?? 'null') as { id?: string } | null
          const state = useWorkspaceStore.getState()
          const savedId = typeof saved?.id === 'string' ? saved.id : null
          const selectedId = state.workspaces.some(workspace => workspace.id === savedId) ? savedId : null
          useWorkspaceStore.setState({ selectedId })
        } catch {
          useWorkspaceStore.setState({ selectedId: null })
        }
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  useEffect(() => {
    api.settings.get().then(settings => {
      setLanguage(settings.language ?? 'en')
      setTheme(settings.theme === 'dark' ? 'dark' : 'light')
      setAutoAdvanceDateRange(settings.auto_advance_date_range ?? true)
    }).catch(() => {})
  }, [setLanguage, setTheme, setAutoAdvanceDateRange])

  return (
    <BrowserRouter>
      <LogNavigationProvider>
      <ElectronNavigation />
      <Routes>
        <Route path="/" element={

            <Layout>
              <div className="flex h-full">
                <DashboardSidebar />
                <Dashboard />
              </div>
            </Layout>

        } />
        <Route path="/favorites" element={<Layout><Favorites /></Layout>} />
        <Route path="/favorites/log/:id" element={<Layout><LogDetail /></Layout>} />
        <Route path="/trash" element={<Layout><Trash /></Layout>} />
        <Route path="/log/:id" element={

            <Layout>
              <div className="flex h-full">
                <DashboardSidebar />
                <LogDetail />
              </div>
            </Layout>

        } />
        <Route path="/search" element={

            <Layout>
              <Search />
            </Layout>

        } />
        <Route path="/search/log/:id" element={

            <Layout>
              <div className="flex h-full">
                <Search sidebarOnly />
                <LogDetail />
              </div>
            </Layout>

        } />
        <Route path="/settings" element={

            <Layout>
              <Settings />
            </Layout>

        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </LogNavigationProvider>
    </BrowserRouter>
  )
}
