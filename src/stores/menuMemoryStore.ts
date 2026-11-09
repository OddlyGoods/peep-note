import { create } from 'zustand'
import { menuForPath, type MenuPath } from '../lib/menuMemory'
import { savedNoteReturnTarget, type NoteReturnTarget } from '../lib/noteNavigation'

type Target = { pathname: string; search: string; hash: string; state?: unknown }
type RememberedTarget = Omit<Target, 'state'> & { state?: { noteReturnTo: NoteReturnTarget } }

// Keep navigation and drafts within this renderer session; never write note
// contents, PINs, or unsaved API keys to browser storage.
export const useMenuMemoryStore = create<{
  targets: Partial<Record<MenuPath, RememberedTarget>>
  remember: (location: Target) => void
}>((set) => ({
  targets: {},
  remember: ({ pathname, search, hash, state }) => {
    const menu = menuForPath(pathname)
    const noteReturnTo = savedNoteReturnTarget(state)
    if (menu) set(previous => ({ targets: { ...previous.targets, [menu]: { pathname, search, hash, ...(noteReturnTo ? { state: { noteReturnTo } } : {}) } } }))
  },
}))
