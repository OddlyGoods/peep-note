import { create } from 'zustand'
import { menuForPath, type MenuPath } from '../lib/menuMemory'

type Target = { pathname: string; search: string; hash: string }

// Keep navigation and drafts within this renderer session; never write note
// contents, PINs, or unsaved API keys to browser storage.
export const useMenuMemoryStore = create<{
  targets: Partial<Record<MenuPath, Target>>
  remember: (location: Target & { state?: unknown }) => void
}>((set) => ({
  targets: {},
  remember: ({ pathname, search, hash }) => {
    const menu = menuForPath(pathname)
    // A sidebar menu starts a new visit. Restore the screen, not the previous
    // visit's cross-menu Back destination.
    if (menu) set(previous => ({ targets: { ...previous.targets, [menu]: { pathname, search, hash } } }))
  },
}))
