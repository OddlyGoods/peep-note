export interface McpSavedNote {
  id: string
  title: string
  preview: string
  savedAt: number
}

export interface McpChange {
  noteSaved?: McpSavedNote
}

export type McpChangeListener = (change?: McpChange) => void
