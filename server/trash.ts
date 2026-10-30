import { queryAll, queryOne, run, transaction } from './db'
import { cleanupUnreferencedMedia, mediaPaths } from './media'
import { DEFAULT_TRASH_RETENTION_DAYS, normalizeTrashRetentionDays } from '../shared/trashRetention'

export const TRASH_RETENTION_SECONDS = DEFAULT_TRASH_RETENTION_DAYS * 86400

export function getTrashRetentionDays(userId: string) {
  const settings = queryOne<{ trash_retention_days: number }>('SELECT trash_retention_days FROM settings WHERE user_id = ?', [userId])
  return normalizeTrashRetentionDays(settings?.trash_retention_days)
}

export function moveToTrash(userId: string, ids: string[], group?: { id: string; name: string }) {
  if (!ids.length) return 0
  const placeholders = ids.map(() => '?').join(',')
  const rows = queryAll<DeletableLog & { log_type: string }>(`SELECT id, log_type, file_path, attachments FROM logs WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`, [userId, ...ids])
  const files = transaction(() => {
    run(`UPDATE logs SET deleted_at = ?, trash_group_id = ?, trash_group_name = ?, ocr_status = CASE WHEN ocr_status IN ('pending', 'processing') THEN 'idle' ELSE ocr_status END WHERE user_id = ? AND deleted_at IS NULL ${group ? '' : "AND log_type != 'summary'"} AND id IN (${placeholders})`, [Math.floor(Date.now() / 1000), group?.id ?? null, group?.name ?? null, userId, ...ids])
    return group ? [] : deleteRows(rows.filter(row => row.log_type === 'summary'))
  })
  // Ungrouping can wrap this operation in a transaction. Check file references
  // after that transaction completes so rollback never removes restored files.
  if (files.length) queueMicrotask(() => cleanupUnreferencedMedia(files))
  return rows.length
}

type DeletableLog = { id: string; file_path: string | null; attachments: string }

export function permanentlyDelete(where: string, params: unknown[]) {
  const rows = queryAll<DeletableLog>(
    `SELECT id, file_path, attachments FROM logs WHERE deleted_at IS NOT NULL AND (${where})`, params
  )
  if (!rows.length) return 0
  cleanupUnreferencedMedia(deleteRows(rows))
  return rows.length
}

function deleteRows(rows: DeletableLog[]): string[] {
  if (!rows.length) return []
  const files = rows.flatMap(row => [
    ...mediaPaths(row),
    ...queryAll<{ attachments: string }>('SELECT attachments FROM comments WHERE log_id = ?', [row.id]).flatMap(mediaPaths)
  ])
  transaction(() => {
    for (const row of rows) {
      run('DELETE FROM comments WHERE log_id = ?', [row.id])
      run('DELETE FROM logs WHERE id = ?', [row.id])
    }
    run('DELETE FROM log_groups WHERE NOT EXISTS (SELECT 1 FROM logs WHERE logs.group_id = log_groups.id)')
  })
  return files
}

export function purgeExpiredTrash(userId?: string) {
  const users = userId ? [{ user_id: userId }] : queryAll<{ user_id: string }>('SELECT DISTINCT user_id FROM logs WHERE deleted_at IS NOT NULL')
  const now = Math.floor(Date.now() / 1000)
  return users.reduce((deleted, user) => deleted + permanentlyDelete('user_id = ? AND deleted_at <= ?',
    [user.user_id, now - getTrashRetentionDays(user.user_id) * 86400]), 0)
}

// A deleted group is one trash item: selecting any member acts on the whole
// batch, including its summary, but never on independently deleted siblings.
export function expandTrashGroupIds(userId: string, ids: string[]) {
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  return queryAll<{ id: string }>(`SELECT id FROM logs WHERE user_id = ? AND deleted_at IS NOT NULL AND (
    id IN (${placeholders}) OR trash_group_id IN (
      SELECT trash_group_id FROM logs WHERE user_id = ? AND deleted_at IS NOT NULL AND id IN (${placeholders})
    ))`, [userId, ...ids, userId, ...ids]).map(row => row.id)
}

export function restoreTrash(userId: string, ids: string[]) {
  ids = expandTrashGroupIds(userId, ids)
  if (!ids.length) return 0
  const placeholders = ids.map(() => '?').join(',')
  const rows = queryAll<{ id: string }>(`SELECT id FROM logs WHERE user_id = ? AND deleted_at > ? AND id IN (${placeholders})`,
    [userId, Math.floor(Date.now() / 1000) - getTrashRetentionDays(userId) * 86400, ...ids])
  transaction(() => {
    for (const { id } of rows) {
      run(`UPDATE logs SET deleted_at = NULL, trash_group_id = NULL, trash_group_name = NULL, ocr_status = CASE WHEN ocr_status IN ('pending', 'processing') THEN 'idle' ELSE ocr_status END,
        workspace_id = CASE WHEN workspace_id IN (SELECT id FROM workspaces WHERE user_id = ?) THEN workspace_id ELSE NULL END,
        group_id = CASE WHEN group_id IN (SELECT id FROM log_groups WHERE user_id = ?) THEN group_id ELSE NULL END
        WHERE id = ? AND user_id = ?`, [userId, userId, id, userId])
    }
  })
  return rows.length
}
