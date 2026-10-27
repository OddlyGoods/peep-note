import { create } from 'zustand'
import { api, Workspace } from '../lib/api'

const workspaceStorageKey = 'openpeepnote_workspace'

function saveSelectedWorkspace(workspace: Workspace | undefined) {
  if (workspace) localStorage.setItem(workspaceStorageKey, JSON.stringify({ id: workspace.id, name: workspace.name, is_default: workspace.is_default }))
  else localStorage.removeItem(workspaceStorageKey)
}

interface WorkspaceState {
  workspaces: Workspace[]
  selectedId: string | null
  loading: boolean
  fetchWorkspaces: () => Promise<void>
  createWorkspace: (name: string) => Promise<void>
  updateWorkspace: (id: string, name: string) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  setSelectedId: (id: string | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  selectedId: null,
  loading: false,

  fetchWorkspaces: async () => {
    set({ loading: true })
    try {
      const workspaces = await api.workspaces.list()
      set({ workspaces })
      // 선택된 워크스페이스가 없으면 기본(공통) 선택
      if (!get().selectedId && workspaces.length > 0) {
        const def = workspaces.find(w => w.is_default) ?? workspaces[0]
        set({ selectedId: def.id })
        saveSelectedWorkspace(def)
      }
    } catch (e) {
      console.error(e)
    } finally {
      set({ loading: false })
    }
  },

  createWorkspace: async (name) => {
    const ws = await api.workspaces.create(name)
    set(state => ({ workspaces: [...state.workspaces, ws] }))
  },

  updateWorkspace: async (id, name) => {
    const ws = await api.workspaces.update(id, name)
    set(state => ({ workspaces: state.workspaces.map(w => w.id === id ? ws : w) }))
    if (get().selectedId === id) saveSelectedWorkspace(ws)
  },

  deleteWorkspace: async (id) => {
    await api.workspaces.delete(id)
    set(state => {
      const workspaces = state.workspaces.filter(w => w.id !== id)
      const selectedId = state.selectedId === id
        ? (workspaces.find(w => w.is_default)?.id ?? workspaces[0]?.id ?? null)
        : state.selectedId
      return { workspaces, selectedId }
    })
    saveSelectedWorkspace(get().workspaces.find(workspace => workspace.id === get().selectedId))
  },

  setSelectedId: (id) => {
    set({ selectedId: id })
    const ws = get().workspaces.find(w => w.id === id)
    saveSelectedWorkspace(ws)
  }
}))
