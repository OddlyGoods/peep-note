import { Hono } from 'hono'
import { queryAll, queryOne } from '../db'
import { LOCAL_PROFILE_ID } from '../localProfile'
import { KNOWLEDGE_MAP_LIMIT, normalizedMapTags, type MapNote } from '../../shared/knowledgeMap'

const knowledgeMap = new Hono()
knowledgeMap.get('/', c => {
  const workspace = c.req.query('workspace')?.slice(0, 128)
  const search = c.req.query('search')?.trim().slice(0, 200)
  const params: unknown[] = [LOCAL_PROFILE_ID]
  let where = 'l.user_id = ? AND l.deleted_at IS NULL AND l.is_secret = 0'
  if (workspace) { where += ' AND l.workspace_id = ?'; params.push(workspace) }
  if (search) {
    where += " AND (l.title LIKE ? ESCAPE '\\' OR l.content LIKE ? ESCAPE '\\' OR l.tags LIKE ? ESCAPE '\\' OR g.name LIKE ? ESCAPE '\\')"
    const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`
    params.push(term, term, term, term)
  }
  const from = ' FROM logs l LEFT JOIN log_groups g ON g.id = l.group_id AND g.user_id = l.user_id LEFT JOIN workspaces w ON w.id = l.workspace_id AND w.user_id = l.user_id'
  const total = queryOne<{ total: number }>(`SELECT COUNT(*) AS total${from} WHERE ${where}`, params)?.total ?? 0
  const rows = queryAll<any>(`SELECT l.id, l.title, l.tags, g.id AS group_id, g.name AS group_name, w.id AS workspace_id, w.name AS workspace_name, w.is_default, l.log_type, l.created_at${from} WHERE ${where} ORDER BY l.created_at DESC, l.id LIMIT ?`, [...params, KNOWLEDGE_MAP_LIMIT])
  const notes: MapNote[] = rows.map(row => {
    let tags: unknown = []
    try { tags = JSON.parse(row.tags || '[]') } catch { /* Ignore legacy malformed tags. */ }
    return { id: row.id, title: row.title || '', tags: normalizedMapTags(tags), groupId: row.group_id ?? null, groupName: row.group_name ?? null, workspaceId: row.workspace_id ?? '', workspaceName: row.workspace_name ?? '', workspaceDefault: !!row.is_default, type: row.log_type, createdAt: row.created_at }
  })
  return c.json({ notes, total, limit: KNOWLEDGE_MAP_LIMIT })
})
export default knowledgeMap
