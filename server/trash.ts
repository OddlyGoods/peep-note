import fs from 'fs'
import { queryAll, queryOne, run, transaction } from './db'
import { managedMediaPath, mediaPaths } from './media'
import { DEFAULT_TRASH_RETENTION_DAYS, normalizeTrashRetentionDays } from '../shared/trashRetention'

export const TRASH_RETENTION_SECONDS = DEFAULT_TRASH_RETENTION_DAYS * 86400

export function getTrashRetentionDays(userId: string) {
  const settings = queryOne<{ trash_retention_days: number }>('SELECT trash_retention_days FROM settings WHERE user_id = ?', [userId])
  return normalizeTrashRetentionDays(settings?.trash_retention_days)
}

export function moveToTrash(userId: string, ids: string[]) {
  if (!ids.length) return 0
  const placeholders = ids.map(() => '?').join(',')
  const rows = queryAll<{ id: string }>(`SELECT id FROM logs WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`, [userId, ...ids])
  run(`UPDATE logs SET deleted_at = ?, ocr_status = CASE WHEN ocr_status IN ('pending', 'processing') THEN 'idle' ELSE ocr_status END WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`, [Math.floor(Date.now() / 1000), userId, ...ids])
  return rows.length
}

export function permanentlyDelete(where: string, params: unknown[]) {
  const rows = queryAll<{ id: string; file_path: string | null; attachments: string }>(
    `SELECT id, file_path, attachments FROM logs WHERE deleted_at IS NOT NULL AND (${where})`, params
  )
  if (!rows.length) return 0
  transaction(() => {
    for (const row of rows) {
      run('DELETE FROM comments WHERE log_id = ?', [row.id])
      run('DELETE FROM logs WHERE id = ?', [row.id])
    }
    run('DELETE FROM log_groups WHERE NOT EXISTS (SELECT 1 FROM logs WHERE logs.group_id = log_groups.id)')
  })
  const references = new Set(queryAll<{ file_path: string | null; attachments: string }>('SELECT file_path, attachments FROM logs')
    .flatMap(mediaPaths).map(managedMediaPath).filter(Boolean))
  for (const file of new Set(rows.flatMap(mediaPaths))) {
    const resolved = managedMediaPath(file)
    if (resolved && !references.has(resolved)) {
      try { fs.unlinkSync(resolved) } catch (error) { console.warn('Trash media cleanup failed:', error) }
    }
  }
  return rows.length
}

export function purgeExpiredTrash(userId?: string) {
  const users = userId ? [{ user_id: userId }] : queryAll<{ user_id: string }>('SELECT DISTINCT user_id FROM logs WHERE deleted_at IS NOT NULL')
  const now = Math.floor(Date.now() / 1000)
  return users.reduce((deleted, user) => deleted + permanentlyDelete('user_id = ? AND deleted_at <= ?',
    [user.user_id, now - getTrashRetentionDays(user.user_id) * 86400]), 0)
}

export function restoreTrash(userId: string, ids: string[]) {
  if (!ids.length) return 0
  const placeholders = ids.map(() => '?').join(',')
  const rows = queryAll<{ id: string }>(`SELECT id FROM logs WHERE user_id = ? AND deleted_at > ? AND id IN (${placeholders})`,
    [userId, Math.floor(Date.now() / 1000) - getTrashRetentionDays(userId) * 86400, ...ids])
  transaction(() => {
    for (const { id } of rows) {
      run(`UPDATE logs SET deleted_at = NULL, ocr_status = CASE WHEN ocr_status IN ('pending', 'processing') THEN 'idle' ELSE ocr_status END,
        workspace_id = CASE WHEN workspace_id IN (SELECT id FROM workspaces WHERE user_id = ?) THEN workspace_id ELSE NULL END,
        group_id = CASE WHEN group_id IN (SELECT id FROM log_groups WHERE user_id = ?) THEN group_id ELSE NULL END
        WHERE id = ? AND user_id = ?`, [userId, userId, id, userId])
    }
  })
  return rows.length
}
