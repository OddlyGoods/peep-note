import { Hono } from 'hono'
import { LOCAL_PROFILE_ID } from '../localProfile'
import { queryAll, queryOne } from '../db'
import { permanentlyDelete, purgeExpiredTrash, restoreTrash, getTrashRetentionDays } from '../trash'

const trash = new Hono<{ Variables: { userId: string } }>()
trash.use('*', async (c, next) => {
  c.set('userId', LOCAL_PROFILE_ID)
  purgeExpiredTrash(LOCAL_PROFILE_ID)
  await next()
})

trash.get('/', c => {
  // Trash returns metadata only; secret content and file paths are never previewed.
  const rows = queryAll(`SELECT id, title, log_type, is_secret, deleted_at,
    deleted_at + ? AS expires_at,
    COALESCE(
      (SELECT name FROM workspaces WHERE id = logs.workspace_id AND user_id = logs.user_id),
      (SELECT name FROM workspaces WHERE user_id = logs.user_id AND is_default = 1 LIMIT 1)
    ) AS workspace_name,
    COALESCE(
      (SELECT is_default FROM workspaces WHERE id = logs.workspace_id AND user_id = logs.user_id),
      1
    ) AS workspace_is_default FROM logs WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id`,
    [getTrashRetentionDays(c.get('userId')) * 86400, c.get('userId')])
  return c.json(rows.map((row: any) => ({ ...row, workspace_is_default: !!row.workspace_is_default })))
})

trash.get('/retention', c => c.json({ days: getTrashRetentionDays(c.get('userId')) }))

trash.get('/count', c => c.json(queryOne<{ count: number }>(
  'SELECT COUNT(*) AS count FROM logs WHERE user_id = ? AND deleted_at IS NOT NULL', [c.get('userId')]
) ?? { count: 0 }))

function parseIds(body: { ids?: unknown }): string[] {
  return [...new Set(Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [])]
}

trash.post('/restore', async c => {
  const ids = parseIds(await c.req.json())
  if (!ids.length || ids.length > 500) return c.json({ error: 'INVALID_IDS' }, 400)
  const restored = restoreTrash(c.get('userId'), ids)
  return c.json({ restored })
})

trash.post('/purge', async c => {
  const ids = parseIds(await c.req.json())
  if (!ids.length || ids.length > 500) return c.json({ error: 'INVALID_IDS' }, 400)
  return c.json({ deleted: permanentlyDelete(`user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [c.get('userId'), ...ids]) })
})

trash.delete('/', c => c.json({ deleted: permanentlyDelete('user_id = ?', [c.get('userId')]) }))
export default trash
