import { create } from 'zustand'
import type { UpdateState } from '../../shared/updates'
import { UPDATE_STATE_CHANNEL } from '../../shared/updates'

interface UpdateStore {
  state: UpdateState | null
  dismissedVersion: string | null
  dismiss: () => void
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  state: null,
  dismissedVersion: null,
  dismiss: () => set({ dismissedVersion: get().state?.version ?? null })
}))

function receive(state: UpdateState) {
  useUpdateStore.setState(previous => !previous.state || state.revision >= previous.state.revision
    ? { state } : {})
}

async function invoke(action: 'getUpdateInfo' | 'checkForUpdates' | 'downloadUpdate' | 'installUpdate') {
  try {
    const state = await window.electronAPI?.[action]()
    if (state) receive(state)
  } catch {
    // IPC can fail independently of the updater; always leave the busy UI.
    useUpdateStore.setState(previous => previous.state ? {
      state: { ...previous.state, status: 'error', error: 'IPC_UNAVAILABLE' }
    } : {})
  }
}

export const checkForUpdates = () => invoke('checkForUpdates')
export const downloadUpdate = () => invoke('downloadUpdate')
export const installUpdate = () => invoke('installUpdate')

export function subscribeToUpdates() {
  const listener = (state: unknown) => receive(state as UpdateState)
  window.electronAPI?.on(UPDATE_STATE_CHANNEL, listener)
  void invoke('getUpdateInfo')
  return () => window.electronAPI?.off(UPDATE_STATE_CHANNEL, listener)
}
