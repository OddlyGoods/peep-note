import { useEffect } from 'react'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Trash from './pages/Trash'
import Favorites from './pages/Favorites'
import LogDetail from './pages/LogDetail'
import Settings from './pages/Settings'
import Search from './pages/Search'
import Layout from './components/Layout'
import ScreenCache from './components/ScreenCache'
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
  const navigate = useNavigate()
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
    const handleHotkey = (action: unknown) => {
      if (action === 'openFavorites') navigate('/favorites')
    }
    window.electronAPI?.on('hotkey-triggered', handleHotkey)
    return () => window.electronAPI?.off('hotkey-triggered', handleHotkey)
  }, [navigate])
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
  const setDateNavigation = useLogStore(s => s.setDateNavigation)

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
      setDateNavigation({ autoAdvanceDateRange: settings.auto_advance_date_range ?? true, fixedStartDate: settings.fixed_start_date ?? true })
    }).catch(() => {})
  }, [setLanguage, setTheme, setDateNavigation])

  return (
    <BrowserRouter>
      <LogNavigationProvider>
      <ElectronNavigation />
      <Layout>
        <ScreenCache screens={[
          { key: 'explore-list', path: '/', element: <div className="flex h-full"><DashboardSidebar /><Dashboard /></div> },
          { key: 'explore-detail', path: '/log/:id', element: <div className="flex h-full"><DashboardSidebar /><LogDetail /></div> },
          { key: 'search-list', path: '/search', element: <Search /> },
          { key: 'search-detail', path: '/search/log/:id', element: <div className="flex h-full"><Search sidebarOnly /><LogDetail /></div> },
          { key: 'favorites-list', path: '/favorites', element: <Favorites /> },
          { key: 'favorites-detail', path: '/favorites/log/:id', element: <LogDetail /> },
          { key: 'trash', path: '/trash', element: <Trash /> },
          { key: 'settings', path: '/settings', element: <Settings /> },
        ]} />
      </Layout>
      </LogNavigationProvider>
    </BrowserRouter>
  )
}
