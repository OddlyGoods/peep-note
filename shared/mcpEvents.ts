export interface McpSavedNote {
  id: string
  title: string
  preview: string
  savedAt: number
}

export interface McpChange {
  noteSaved?: McpSavedNote
  notificationsEnabled?: boolean
}

export type McpChangeListener = (change?: McpChange) => void
