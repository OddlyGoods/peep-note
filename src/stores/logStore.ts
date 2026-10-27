import { create } from 'zustand'
import { api, Log } from '../lib/api'
import { format, subDays } from 'date-fns'

type RangeTarget = 'start' | 'end'
type SavedRange = { dateFrom: string; dateTo: string }

const storageKey = 'openpeepnote_dashboard_date_range'
const today = () => format(new Date(), 'yyyy-MM-dd')
const defaultRange = (): SavedRange => ({ dateFrom: format(subDays(new Date(), 6), 'yyyy-MM-dd'), dateTo: today() })

function initialRange(): SavedRange {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '') as SavedRange
    if (saved.dateFrom && saved.dateTo && saved.dateFrom <= saved.dateTo) return saved
  } catch {}
  return defaultRange()
}

function saveRange(range: SavedRange) {
  localStorage.setItem(storageKey, JSON.stringify(range))
}

interface LogState {
  logs: Log[]
  dateFrom: string
  dateTo: string
  rangeTarget: RangeTarget
  followToday: boolean
  autoAdvanceDateRange: boolean
  filterType: string
  searchQuery: string
  loading: boolean
  activeDates: string[]
  recentlyCreatedIds: string[]
  fetchLogs: () => Promise<void>
  fetchActiveDates: () => Promise<void>
  markRecentlyCreated: (id: string) => void
  createLog: (data: Partial<Log>) => Promise<Log>
  updateLog: (id: string, data: Partial<Log>) => Promise<Log>
  moveLog: (id: string, workspaceId: string) => Promise<Log>
  deleteLog: (id: string) => Promise<void>
  deleteLogs: (ids: string[]) => Promise<void>
  setDateRange: (dateFrom: string, dateTo: string) => void
  setRangeTarget: (target: RangeTarget) => void
  setAutoAdvanceDateRange: (enabled: boolean) => void
  setFilterType: (type: string) => void
  setSearchQuery: (q: string) => void
  syncToday: () => void
}

const savedRange = initialRange()

export const useLogStore = create<LogState>((set, get) => ({
  logs: [],
  dateFrom: savedRange.dateFrom,
  dateTo: savedRange.dateTo,
  rangeTarget: 'end',
  followToday: savedRange.dateTo === today(),
  // 서버 설정을 불러오기 전에는 날짜를 임의로 바꾸지 않는다.
  autoAdvanceDateRange: false,
  filterType: '',
  searchQuery: '',
  loading: false,
  activeDates: [],
  recentlyCreatedIds: [],

  fetchLogs: async () => {
    const hasData = get().logs.length > 0
    if (!hasData) set({ loading: true })
    try {
      const { dateFrom, dateTo, filterType, searchQuery } = get()
      const { useWorkspaceStore } = await import('./workspaceStore')
      const selectedWorkspaceId = useWorkspaceStore.getState().selectedId
      const logs = await api.logs.list({
        date_from: dateFrom,
        date_to: dateTo,
        type: filterType || undefined,
        search: searchQuery || undefined,
        workspace_id: selectedWorkspaceId || undefined,
        limit: 500
      })
      set({ logs })
    } catch (e) {
      console.error(e)
    } finally {
      set({ loading: false })
    }
  },

  fetchActiveDates: async () => {
    try {
      const dates = await api.logs.statsDates()
      set({ activeDates: dates.map(d => d.date) })
    } catch {}
  },

  markRecentlyCreated: (id) => {
    set(state => ({ recentlyCreatedIds: [id, ...state.recentlyCreatedIds.filter(existingId => existingId !== id)] }))
    window.setTimeout(() => {
      set(state => ({ recentlyCreatedIds: state.recentlyCreatedIds.filter(existingId => existingId !== id) }))
    }, 500)
  },

  createLog: async (data) => {
    const log = await api.logs.create(data)
    const { dateFrom, dateTo } = get()
    const createdDate = format(new Date(log.created_at * 1000), 'yyyy-MM-dd')
    if (createdDate >= dateFrom && createdDate <= dateTo) {
      set(state => ({ logs: [log, ...state.logs] }))
      get().markRecentlyCreated(log.id)
    }
    get().fetchActiveDates()
    return log
  },

  updateLog: async (id, data) => {
    const updated = await api.logs.update(id, data)
    set(state => ({ logs: state.logs.map(l => l.id === id ? updated : l) }))
    return updated
  },

  moveLog: async (id, workspaceId) => {
    const updated = await api.logs.move(id, workspaceId)
    const { useWorkspaceStore } = await import('./workspaceStore')
    const selectedWorkspaceId = useWorkspaceStore.getState().selectedId
    set(state => ({
      logs: selectedWorkspaceId && selectedWorkspaceId !== updated.workspace_id
        ? state.logs.filter(log => log.id !== id)
        : state.logs.map(log => log.id === id ? updated : log)
    }))
    return updated
  },

  deleteLog: async (id) => {
    await api.logs.delete(id)
    set(state => ({ logs: state.logs.filter(l => l.id !== id) }))
    get().fetchActiveDates()
  },

  deleteLogs: async (ids) => {
    if (ids.length === 0) return
    await api.logs.bulkDelete(ids)
    const idSet = new Set(ids)
    set(state => ({ logs: state.logs.filter(log => !idSet.has(log.id)) }))
    get().fetchActiveDates()
  },

  setDateRange: (dateFrom, dateTo) => {
    if (dateFrom > dateTo) return
    const range = { dateFrom, dateTo }
    saveRange(range)
    set({ ...range, followToday: dateTo === today() })
    get().fetchLogs()
  },

  setRangeTarget: (rangeTarget) => set({ rangeTarget }),

  setAutoAdvanceDateRange: (autoAdvanceDateRange) => {
    set({ autoAdvanceDateRange })
    if (autoAdvanceDateRange) get().syncToday()
  },

  setFilterType: (type) => {
    set({ filterType: type })
    get().fetchLogs()
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q })
    get().fetchLogs()
  },

  syncToday: () => {
    const currentToday = today()
    const { dateFrom, dateTo, autoAdvanceDateRange } = get()
    // 자동 넘김이 켜져 있으면 저장된 기간도 앱 재실행 시 오늘을 종료일로 맞춘다.
    if (!autoAdvanceDateRange || dateTo === currentToday) return
    const length = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000)
    const range = { dateFrom: format(subDays(new Date(), length), 'yyyy-MM-dd'), dateTo: currentToday }
    saveRange(range)
    set({ ...range, followToday: true })
    get().fetchLogs()
  }
}))
