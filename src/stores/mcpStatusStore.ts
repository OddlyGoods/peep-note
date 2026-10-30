import { create } from 'zustand'
import { api } from '../lib/api'

type McpStatus = Awaited<ReturnType<typeof api.mcp.status>>
interface McpStatusStore {
  status: McpStatus | null
  refresh: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
}

let revision = 0
let pending: Promise<void> | null = null

export const useMcpStatusStore = create<McpStatusStore>(set => ({
  status: null,
  refresh: () => {
    if (pending) return pending
    const current = revision
    pending = api.mcp.status().then(status => {
      if (current === revision) set({ status })
    }).catch(error => {
      if (current === revision) set({ status: null })
      throw error
    }).finally(() => { pending = null })
    return pending
  },
  setEnabled: async enabled => {
    revision++
    const status = await api.mcp.setEnabled(enabled)
    revision++
    set({ status })
  }
}))
