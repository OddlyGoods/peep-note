export const TRASH_RETENTION_OPTIONS = [7, 10, 30, 90] as const
export type TrashRetentionDays = typeof TRASH_RETENTION_OPTIONS[number]
export const DEFAULT_TRASH_RETENTION_DAYS: TrashRetentionDays = 10

export function isTrashRetentionDays(value: unknown): value is TrashRetentionDays {
  return TRASH_RETENTION_OPTIONS.some(days => days === value)
}

export function normalizeTrashRetentionDays(value: unknown): TrashRetentionDays {
  return isTrashRetentionDays(value) ? value : DEFAULT_TRASH_RETENTION_DAYS
}
