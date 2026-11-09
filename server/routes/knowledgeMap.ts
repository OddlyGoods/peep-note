import { Hono } from 'hono'
import { queryAll, queryOne } from '../db'
import { LOCAL_PROFILE_ID } from '../localProfile'
import { emptyMapSnapshot, KNOWLEDGE_MAP_LIMIT, type MapNote } from '../../shared/knowledgeMap'
import { semanticConnections } from '../../shared/localEmbeddings'
import { currentEmbeddingVectors, noteMapEnabled, saveNoteMapEnabled, type KnowledgeIndex } from '../knowledgeIndex'

export default function knowledgeMap(index?: KnowledgeIndex) {
  const route = new Hono()
  route.put('/enabled', async c => {
    const body = await c.req.json().catch(() => null)
    if (typeof body?.enabled !== 'boolean') return c.json({ error: 'INVALID_NOTE_MAP_ENABLED' }, 400)
    if (index) index.setEnabled(body.enabled)
    else saveNoteMapEnabled(body.enabled)
    return c.json({ enabled: noteMapEnabled() })
  })
  route.post('/retry', c => { if (noteMapEnabled()) index?.retry(); return c.json({ ok: true }) })
  route.get('/', c => {
    if (!noteMapEnabled()) return c.json(emptyMapSnapshot())
    index?.touch()
    const workspace = c.req.query('workspace')?.slice(0, 128)
    const search = c.req.query('search')?.trim().slice(0, 200)
    const params: unknown[] = [LOCAL_PROFILE_ID]
    let where = 'l.user_id = ? AND l.deleted_at IS NULL AND l.is_secret = 0'
    if (workspace) { where += ' AND l.workspace_id = ?'; params.push(workspace) }
    if (search) {
      where += " AND (l.title LIKE ? ESCAPE '\\' OR l.content LIKE ? ESCAPE '\\' OR l.ocr_text LIKE ? ESCAPE '\\')"
      const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`
      params.push(term, term, term)
    }
    const from = ' FROM logs l LEFT JOIN workspaces w ON w.id = l.workspace_id AND w.user_id = l.user_id'
    const total = queryOne<{ total: number }>(`SELECT COUNT(*) AS total${from} WHERE ${where}`, params)?.total ?? 0
    const rows = queryAll<any>(`SELECT l.id, l.title, w.id AS workspace_id, w.name AS workspace_name, w.is_default, l.log_type, l.created_at${from} WHERE ${where} ORDER BY l.created_at DESC, l.id LIMIT ?`, [...params, KNOWLEDGE_MAP_LIMIT])
    const notes: MapNote[] = rows.map(row => ({ id: row.id, title: row.title || '', workspaceId: row.workspace_id ?? '', workspaceName: row.workspace_name ?? '', workspaceDefault: !!row.is_default, type: row.log_type, createdAt: row.created_at }))
    return c.json({ enabled: true, notes, connections: semanticConnections(currentEmbeddingVectors(notes.map(note => note.id))), indexing: index?.status() ?? { stage: 'idle', completed: 0, total: 0 }, total, limit: KNOWLEDGE_MAP_LIMIT })
  })
  return route
}
