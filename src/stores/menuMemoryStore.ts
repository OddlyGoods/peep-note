import { create } from 'zustand'
import { menuForPath, type MenuPath } from '../lib/menuMemory'

type Target = { pathname: string; search: string; hash: string }

// Keep navigation and drafts within this renderer session; never write note
// contents, PINs, or unsaved API keys to browser storage.
export const useMenuMemoryStore = create<{
  targets: Partial<Record<MenuPath, Target>>
  remember: (location: Target) => void
}>((set) => ({
  targets: {},
  remember: ({ pathname, search, hash }) => {
    const menu = menuForPath(pathname)
    if (menu) set(state => ({ targets: { ...state.targets, [menu]: { pathname, search, hash } } }))
  },
}))
