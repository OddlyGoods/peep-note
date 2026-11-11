import { Hono } from 'hono'
import { getDb, queryAll, queryOne } from '../db'
import { LOCAL_PROFILE_ID } from '../localProfile'
import { emptyMapSnapshot, KNOWLEDGE_MAP_LIMIT, type MapNote } from '../../shared/knowledgeMap'
import { relatedSemanticNotes, semanticConnections, semanticMatches, SEMANTIC_SEARCH_LIMIT } from '../../shared/localEmbeddings'
import { currentEmbeddingVectors, noteMapEnabled, saveNoteMapEnabled, type KnowledgeIndex } from '../knowledgeIndex'
import { MapThumbnails, mapImageVersion, type ThumbnailRenderer } from '../mapThumbnails'

export default function knowledgeMap(index?: KnowledgeIndex, renderThumbnail?: ThumbnailRenderer) {
  const route = new Hono()
  const thumbnails = renderThumbnail ? new MapThumbnails(renderThumbnail) : null
  route.get('/thumbnail/:id', async c => {
    const image = await thumbnails?.get(c.req.param('id'))
    c.header('Cache-Control', 'no-store')
    return image ? c.json({ image: `data:image/png;base64,${Buffer.from(image).toString('base64')}` }) : c.json({ error: 'THUMBNAIL_UNAVAILABLE' }, 404)
  })
  route.get('/related/:id', c => {
    const idle = { stage: 'idle', completed: 0, total: 0 }
    if (!noteMapEnabled()) return c.json({ notes: [], indexing: idle })
    const id = c.req.param('id')
    if (!queryOne('SELECT id FROM logs WHERE id = ? AND user_id = ? AND is_secret = 0 AND deleted_at IS NULL', [id, LOCAL_PROFILE_ID])) return c.json({ notes: [], indexing: idle })
    index?.touch()
    const matches = relatedSemanticNotes(id, currentEmbeddingVectors())
    const notes = matches.flatMap(match => {
      const row = queryOne<any>(`SELECT l.id, l.title, w.id AS workspace_id, w.name AS workspace_name, w.is_default, l.log_type, l.created_at
        FROM logs l LEFT JOIN workspaces w ON w.id = l.workspace_id AND w.user_id = l.user_id
        WHERE l.id = ? AND l.user_id = ? AND l.is_secret = 0 AND l.deleted_at IS NULL`, [match.id, LOCAL_PROFILE_ID])
      return row ? [{ id: row.id, title: row.title || '', workspaceId: row.workspace_id ?? '', workspaceName: row.workspace_name ?? '', workspaceDefault: !!row.is_default, type: row.log_type, createdAt: row.created_at, similarity: Math.min(1, Math.max(0, match.score)) }] : []
    })
    return c.json({ notes, indexing: index?.status() ?? idle })
  })
  route.put('/enabled', async c => {
    const body = await c.req.json().catch(() => null)
    if (typeof body?.enabled !== 'boolean') return c.json({ error: 'INVALID_NOTE_MAP_ENABLED' }, 400)
    if (index) index.setEnabled(body.enabled)
    else saveNoteMapEnabled(body.enabled)
    return c.json({ enabled: noteMapEnabled() })
  })
  route.post('/retry', c => { if (noteMapEnabled()) index?.retry(); return c.json({ ok: true }) })
  route.get('/', async c => {
    if (!noteMapEnabled()) return c.json(emptyMapSnapshot())
    index?.touch()
    const workspace = c.req.query('workspace')?.slice(0, 128)
    const search = c.req.query('search')?.trim().slice(0, 200)
    const database = getDb()
    let queryVector: number[] | undefined
    if (search && currentEmbeddingVectors().size) {
      if (!index) return c.json({ error: 'LOCAL_SEARCH_UNAVAILABLE' }, 503)
      try { queryVector = await index.searchVector(search) }
      catch {
        if (!noteMapEnabled()) return c.json(emptyMapSnapshot())
        return c.json({ error: 'LOCAL_SEARCH_FAILED' }, 503)
      }
      if (getDb() !== database) return c.json({ error: 'LOCAL_SEARCH_CANCELLED' }, 503)
      if (!noteMapEnabled()) return c.json(emptyMapSnapshot())
    }
    const params: unknown[] = [LOCAL_PROFILE_ID]
    let where = 'l.user_id = ? AND l.deleted_at IS NULL AND l.is_secret = 0'
    if (workspace) { where += ' AND l.workspace_id = ?'; params.push(workspace) }
    const from = ' FROM logs l LEFT JOIN workspaces w ON w.id = l.workspace_id AND w.user_id = l.user_id'
    let total = queryOne<{ total: number }>(`SELECT COUNT(*) AS total${from} WHERE ${where}`, params)?.total ?? 0
    let rows = queryAll<any>(`SELECT l.id, l.title, l.file_path, l.attachments, l.updated_at, w.id AS workspace_id, w.name AS workspace_name, w.is_default, l.log_type, l.created_at${from} WHERE ${where} ORDER BY l.created_at DESC, l.id${search ? '' : ' LIMIT ?'}`, search ? params : [...params, KNOWLEDGE_MAP_LIMIT])
    let vectors = currentEmbeddingVectors(search ? undefined : rows.map(row => row.id))
    if (search) {
      const byId = new Map(rows.map(row => [row.id, row]))
      vectors = new Map([...vectors].filter(([id]) => byId.has(id)))
      const matches = queryVector ? semanticMatches(queryVector, vectors) : []
      total = matches.length
      rows = matches.slice(0, SEMANTIC_SEARCH_LIMIT).map(match => byId.get(match.id)!)
      const shown = new Set(rows.map(row => row.id))
      vectors = new Map([...vectors].filter(([id]) => shown.has(id)))
    }
    const notes: MapNote[] = rows.map(row => ({ id: row.id, title: row.title || '', workspaceId: row.workspace_id ?? '', workspaceName: row.workspace_name ?? '', workspaceDefault: !!row.is_default, type: row.log_type, createdAt: row.created_at, imageVersion: mapImageVersion(row) }))
    return c.json({ enabled: true, notes, connections: semanticConnections(vectors), indexing: index?.status() ?? { stage: 'idle', completed: 0, total: 0 }, total, limit: search ? SEMANTIC_SEARCH_LIMIT : KNOWLEDGE_MAP_LIMIT })
  })
  return route
}
