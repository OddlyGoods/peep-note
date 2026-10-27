export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error' | 'unsupported'

export interface UpdateState {
  revision: number
  status: UpdateStatus
  currentVersion: string
  version: string | null
  percent: number
  downloaded: boolean
  checkedAt: number | null
  error: string | null
  platform: string
}

export const UPDATE_STATE_CHANNEL = 'update-state-changed'
