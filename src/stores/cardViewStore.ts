import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

type Flags = Record<string, true>
type SavedCardViews = {
  collapsedRecords: Flags
  collapsedGroups: Flags
  expandedGroupRecords: Flags
}
type CardViewState = SavedCardViews & {
  setRecordExpanded: (id: string, expanded: boolean) => void
  setGroupExpanded: (id: string, expanded: boolean) => void
  setGroupRecordsExpanded: (id: string, expanded: boolean) => void
}

const browserStorage: StateStorage = {
  getItem: key => { try { return localStorage.getItem(key) } catch { return null } },
  setItem: (key, value) => { try { localStorage.setItem(key, value) } catch {} },
  removeItem: key => { try { localStorage.removeItem(key) } catch {} }
}

function updateFlag(flags: Flags, id: string, active: boolean): Flags {
  if (!id || (flags[id] === true) === active) return flags
  const next = { ...flags }
  if (active) next[id] = true
  else delete next[id]
  return next
}

function readFlags(value: unknown): Flags {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([id, flag]) => id.length > 0 && flag === true)) as Flags
}

// Store only view preferences and record IDs, never note contents or credentials.
export function createCardViewStore(storage: StateStorage = browserStorage) {
  return create<CardViewState>()(persist((set) => ({
    collapsedRecords: {},
    collapsedGroups: {},
    expandedGroupRecords: {},
    setRecordExpanded: (id, expanded) => set(state => ({ collapsedRecords: updateFlag(state.collapsedRecords, id, !expanded) })),
    setGroupExpanded: (id, expanded) => set(state => ({ collapsedGroups: updateFlag(state.collapsedGroups, id, !expanded) })),
    setGroupRecordsExpanded: (id, expanded) => set(state => ({ expandedGroupRecords: updateFlag(state.expandedGroupRecords, id, expanded) }))
  }), {
    name: 'openpeepnote_card_views',
    version: 1,
    storage: createJSONStorage(() => storage),
    partialize: state => ({ collapsedRecords: state.collapsedRecords, collapsedGroups: state.collapsedGroups, expandedGroupRecords: state.expandedGroupRecords }),
    merge: (saved, current) => {
      const views = saved && typeof saved === 'object' ? saved as Partial<SavedCardViews> : {}
      return { ...current, collapsedRecords: readFlags(views.collapsedRecords), collapsedGroups: readFlags(views.collapsedGroups), expandedGroupRecords: readFlags(views.expandedGroupRecords) }
    }
  }))
}

export const useCardViewStore = createCardViewStore()
