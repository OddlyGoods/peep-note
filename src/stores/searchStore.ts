import { create } from 'zustand'
import { format, subMonths } from 'date-fns'

function monthRange(months = 1) {
  const today = new Date()
  return { dateFrom: format(subMonths(today, months), 'yyyy-MM-dd'), dateTo: format(today, 'yyyy-MM-dd') }
}

interface SearchState {
  query: string
  typeFilter: string
  workspaceFilter: string
  dateFrom: string
  dateTo: string
  setQuery: (v: string) => void
  searchTag: (tag: string) => void
  setTypeFilter: (v: string) => void
  setWorkspaceFilter: (v: string) => void
  setDateFrom: (v: string) => void
  setDateTo: (v: string) => void
  setMonthRange: (months: number) => void
  clearFilters: () => void
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  typeFilter: '',
  workspaceFilter: '',
  ...monthRange(),
  setQuery: (v) => set({ query: v }),
  searchTag: (tag) => set({ query: `#${tag}`, typeFilter: '', workspaceFilter: '', dateFrom: '', dateTo: '' }),
  setTypeFilter: (v) => set({ typeFilter: v }),
  setWorkspaceFilter: (v) => set({ workspaceFilter: v }),
  setDateFrom: (v) => set({ dateFrom: v }),
  setDateTo: (v) => set({ dateTo: v }),
  setMonthRange: (months) => set(monthRange(months)),
  clearFilters: () => set({ typeFilter: '', workspaceFilter: '', ...monthRange() }),
}))
