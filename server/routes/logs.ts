import { Hono } from 'hono'
import { generateId, queryOne, queryAll, run, transaction } from '../db'
import { LOCAL_PROFILE_ID } from '../localProfile'
import { moveToTrash } from '../trash'
import { scheduleOcr, ocrStatus } from '../ocr'
import { cleanupUnreferencedMedia, imageMediaPaths, mediaPaths } from '../media'

const logs = new Hono()

const commentCount = (logId: string, userId: string) => queryOne<{ count: number }>(
  'SELECT COUNT(*) as count FROM comments WHERE log_id = ? AND user_id = ?', [logId, userId]
)!.count

const ownedComment = (logId: string, commentId: string, userId: string) => queryOne(
  `SELECT comments.id FROM comments JOIN logs ON logs.id = comments.log_id
   WHERE logs.id = ? AND logs.user_id = ? AND logs.deleted_at IS NULL
   AND comments.id = ? AND comments.user_id = ?`, [logId, userId, commentId, userId]
)


// GET /api/logs
logs.get('/', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const { date, date_from, date_to, type, search, workspace_id, page = '1', limit = '50', sort, favorite } = c.req.query()
  let sql = 'SELECT logs.*, (SELECT COUNT(*) FROM comments WHERE comments.log_id = logs.id AND comments.user_id = logs.user_id) AS comment_count, (SELECT created_at FROM log_groups WHERE log_groups.id = logs.group_id) AS group_created_at FROM logs WHERE deleted_at IS NULL AND user_id = ?'
  const params: unknown[] = [userId]

  if (favorite === 'true') {
    sql += ' AND favorite = 1'
  } else if (date) {
    const start = Math.floor(new Date(date + 'T00:00:00').getTime() / 1000)
    const end   = Math.floor(new Date(date + 'T23:59:59').getTime() / 1000)
    sql += ' AND created_at >= ? AND created_at <= ?'
    params.push(start, end)
  } else if (date_from || date_to) {
    if (date_from) { sql += ' AND created_at >= ?'; params.push(Math.floor(new Date(date_from + 'T00:00:00').getTime() / 1000)) }
    if (date_to) { sql += ' AND created_at <= ?'; params.push(Math.floor(new Date(date_to + 'T23:59:59').getTime() / 1000)) }
  }
  if (type) { sql += ' AND log_type = ?'; params.push(type) }
  if (search) {
    const tag = search.trim().startsWith('#') ? search.trim().slice(1).trim() : ''
    if (tag) {
      // `#` search is a partial match so typing part of a tag is enough.
      sql += ' AND tags LIKE ?'
      params.push(`%${tag}%`)
    } else if (!search.trim().startsWith('#')) {
      sql += ` AND (title LIKE ? OR (is_secret = 0 AND (content LIKE ? OR replace(replace(replace(ocr_text, ' ', ''), char(10), ''), char(13), '') LIKE ? OR attachments LIKE ? OR file_path LIKE ?)))`
      params.push(`%${search}%`, `%${search}%`, `%${search.replace(/\s/g, '')}%`, `%${search}%`, `%${search}%`)
    }
  }
  if (workspace_id) { sql += ' AND (workspace_id = ? OR (workspace_id IS NULL AND ? = (SELECT id FROM workspaces WHERE user_id = ? AND is_default = 1 LIMIT 1)))'; params.push(workspace_id, workspace_id, userId) }

  // Quick List requests a strict newest-first order; normal lists keep pinned logs first.
  const safeLimit = Math.floor(Math.min(Math.max(Number(limit) || 50, 1), 500))
  const safePage = Math.floor(Math.max(Number(page) || 1, 1))
  sql += ` ORDER BY ${sort === 'recent' ? 'created_at DESC' : 'pinned DESC, created_at DESC'}, id DESC LIMIT ${safeLimit} OFFSET ${(safePage - 1) * safeLimit}`

  const rows = queryAll<any>(sql, params)
  return c.json(rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]'), attachments: JSON.parse(r.attachments || '[]'), pinned: !!r.pinned, is_secret: !!r.is_secret })))
})

logs.get('/favorites/count', async c => {
  const userId = LOCAL_PROFILE_ID
  return c.json(queryOne<{ count: number }>('SELECT COUNT(*) as count FROM logs WHERE user_id = ? AND deleted_at IS NULL AND favorite = 1', [userId]))
})

logs.get('/ocr-status', async c => {
  const userId = LOCAL_PROFILE_ID
  return c.json(ocrStatus(userId))
})

// GET /api/logs/:id/comments
logs.get('/:id/comments', async (c) => {
  const userId = LOCAL_PROFILE_ID
  const logId = c.req.param('id')
  if (!queryOne('SELECT id FROM logs WHERE deleted_at IS NULL AND id = ? AND user_id = ?', [logId, userId])) return c.json({ error: '로그를 찾을 수 없습니다.' }, 404)
  return c.json(queryAll('SELECT id, log_id, user_id, content, created_at FROM comments WHERE log_id = ? AND user_id = ? ORDER BY created_at ASC', [logId, userId]))
})

// POST /api/logs/:id/comments
logs.post('/:id/comments', async (c) => {
  const userId = LOCAL_PROFILE_ID
  const logId = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  if (!queryOne('SELECT id FROM logs WHERE deleted_at IS NULL AND id = ? AND user_id = ?', [logId, userId])) return c.json({ error: '로그를 찾을 수 없습니다.' }, 404)
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!content) return c.json({ error: '댓글 내용을 입력하세요.' }, 400)
  if (content.length > 2000) return c.json({ error: '댓글은 2,000자까지 입력할 수 있습니다.' }, 400)
  const comment = { id: generateId(), log_id: logId, user_id: userId, content, created_at: Math.floor(Date.now() / 1000) }
  run('INSERT INTO comments (id, log_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)', [comment.id, comment.log_id, comment.user_id, comment.content, comment.created_at])
  return c.json({ ...comment, comment_count: commentCount(logId, userId) }, 201)
})

logs.put('/:id/comments/:commentId', async c => {
  const userId = LOCAL_PROFILE_ID
  const logId = c.req.param('id')
  const commentId = c.req.param('commentId')
  const body = await c.req.json().catch(() => null)
  if (!ownedComment(logId, commentId, userId)) return c.json({ error: '댓글을 찾을 수 없습니다.' }, 404)
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!content) return c.json({ error: '댓글 내용을 입력하세요.' }, 400)
  if (content.length > 2000) return c.json({ error: '댓글은 2,000자까지 입력할 수 있습니다.' }, 400)
  run('UPDATE comments SET content = ? WHERE id = ? AND log_id = ? AND user_id = ?', [content, commentId, logId, userId])
  const comment = queryOne('SELECT id, log_id, user_id, content, created_at FROM comments WHERE id = ?', [commentId])!
  return c.json({ ...comment, comment_count: commentCount(logId, userId) })
})

logs.delete('/:id/comments/:commentId', c => {
  const userId = LOCAL_PROFILE_ID
  const logId = c.req.param('id')
  const commentId = c.req.param('commentId')
  if (!ownedComment(logId, commentId, userId)) return c.json({ error: '댓글을 찾을 수 없습니다.' }, 404)
  run('DELETE FROM comments WHERE id = ? AND log_id = ? AND user_id = ?', [commentId, logId, userId])
  return c.json({ ok: true, comment_count: commentCount(logId, userId) })
})

// GET /api/logs/stats/dates
logs.get('/stats/dates', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const rows = queryAll<any>(
    "SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') as date, COUNT(*) as count FROM logs WHERE deleted_at IS NULL AND user_id = ? GROUP BY date ORDER BY date DESC",
    [userId]
  )
  return c.json(rows)
})

// GET /api/logs/stats/types?date_from=&date_to=&workspace_id=
logs.get('/stats/types', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const { date_from, date_to, workspace_id } = c.req.query()
  let sql = 'SELECT log_type, COUNT(*) as count FROM logs WHERE deleted_at IS NULL AND user_id = ?'
  const params: unknown[] = [userId]
  if (date_from) { sql += ' AND created_at >= ?'; params.push(Math.floor(new Date(date_from + 'T00:00:00').getTime() / 1000)) }
  if (date_to) { sql += ' AND created_at <= ?'; params.push(Math.floor(new Date(date_to + 'T23:59:59').getTime() / 1000)) }
  if (workspace_id) {
    sql += ' AND (workspace_id = ? OR (workspace_id IS NULL AND ? = (SELECT id FROM workspaces WHERE user_id = ? AND is_default = 1 LIMIT 1)))'
    params.push(workspace_id, workspace_id, userId)
  }
  return c.json(queryAll<{ log_type: string; count: number }>(`${sql} GROUP BY log_type`, params))
})

// GET /api/logs/stats/workspaces?date_from=&date_to=
logs.get('/stats/workspaces', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const { date_from, date_to } = c.req.query()
  let sql = `SELECT COALESCE(workspace_id, (SELECT id FROM workspaces WHERE user_id = ? AND is_default = 1 LIMIT 1)) as workspace_id, COUNT(*) as count FROM logs WHERE deleted_at IS NULL AND user_id = ?`
  const params: unknown[] = [userId, userId]
  if (date_from) { sql += ' AND created_at >= ?'; params.push(Math.floor(new Date(date_from + 'T00:00:00').getTime() / 1000)) }
  if (date_to) { sql += ' AND created_at <= ?'; params.push(Math.floor(new Date(date_to + 'T23:59:59').getTime() / 1000)) }
  return c.json(queryAll<{ workspace_id: string | null; count: number }>(`${sql} GROUP BY workspace_id`, params))
})

// GET /api/logs/stats/tags?date_from=&date_to=&workspace_id=
logs.get('/stats/tags', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const { date_from, date_to, workspace_id } = c.req.query()
  let sql = 'SELECT tags FROM logs WHERE deleted_at IS NULL AND user_id = ?'
  const params: unknown[] = [userId]
  if (date_from) { sql += ' AND created_at >= ?'; params.push(Math.floor(new Date(date_from + 'T00:00:00').getTime() / 1000)) }
  if (date_to) { sql += ' AND created_at <= ?'; params.push(Math.floor(new Date(date_to + 'T23:59:59').getTime() / 1000)) }
  if (workspace_id) {
    sql += ' AND (workspace_id = ? OR (workspace_id IS NULL AND ? = (SELECT id FROM workspaces WHERE user_id = ? AND is_default = 1 LIMIT 1)))'
    params.push(workspace_id, workspace_id, userId)
  }

  const counts = new Map<string, number>()
  for (const row of queryAll<{ tags: string }>(sql, params)) {
    try {
      for (const value of JSON.parse(row.tags || '[]')) {
        const tag = typeof value === 'string' ? value.trim() : ''
        if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    } catch {}
  }
  return c.json([...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)))
})

// POST /api/logs/bulk-delete  { ids: string[] }
logs.post('/bulk-delete', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const body: { ids?: unknown } = await c.req.json()
  const ids = [...new Set(Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0) : [])]
  if (ids.length === 0) return c.json({ error: '삭제할 로그가 없습니다.' }, 400)

  if (ids.length > 500) return c.json({ error: 'INVALID_IDS' }, 400)
  return c.json({ ok: true, deleted: moveToTrash(userId, ids) })
})

// POST /api/logs/bulk-move — move checked records and whole groups together.
logs.post('/bulk-move', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const body = await c.req.json()
  const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id : ''
  const requestedLogIds = [...new Set(Array.isArray(body.log_ids) ? body.log_ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0) : [])]
  const requestedGroupIds = [...new Set(Array.isArray(body.group_ids) ? body.group_ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0) : [])]
  if (requestedLogIds.length + requestedGroupIds.length === 0) return c.json({ error: '이동할 기록이 없습니다.' }, 400)
  if (requestedLogIds.length + requestedGroupIds.length > 500) return c.json({ error: 'INVALID_IDS' }, 400)

  const workspace = queryOne('SELECT id FROM workspaces WHERE id = ? AND user_id = ?', [workspaceId, userId])
  if (!workspace) return c.json({ error: '워크스페이스를 찾을 수 없습니다.' }, 404)

  const logIds = requestedLogIds.length > 0
    ? queryAll<{ id: string }>(`SELECT id FROM logs WHERE id IN (${requestedLogIds.map(() => '?').join(',')}) AND user_id = ? AND deleted_at IS NULL AND group_id IS NULL`, [...requestedLogIds, userId]).map(row => row.id)
    : []
  const groupIds = requestedGroupIds.length > 0
    ? queryAll<{ id: string }>(`SELECT id FROM log_groups WHERE id IN (${requestedGroupIds.map(() => '?').join(',')}) AND user_id = ?`, [...requestedGroupIds, userId]).map(row => row.id)
    : []
  const now = Math.floor(Date.now() / 1000)

  transaction(() => {
    if (logIds.length > 0) {
      run(`UPDATE logs SET workspace_id = ?, updated_at = ? WHERE id IN (${logIds.map(() => '?').join(',')}) AND user_id = ?`, [workspaceId, now, ...logIds, userId])
    }
    if (groupIds.length > 0) {
      run(`UPDATE log_groups SET workspace_id = ? WHERE id IN (${groupIds.map(() => '?').join(',')}) AND user_id = ?`, [workspaceId, ...groupIds, userId])
      run(`UPDATE logs SET workspace_id = ?, updated_at = ? WHERE group_id IN (${groupIds.map(() => '?').join(',')}) AND user_id = ? AND deleted_at IS NULL`, [workspaceId, now, ...groupIds, userId])
    }
  })

  return c.json({ ok: true, logs: logIds.length, groups: groupIds.length })
})

// POST /api/logs/:id/move — move one record to another owned workspace.
// Group membership is cleared so the moved record can appear independently in
// the destination workspace instead of remaining attached to its old group.
logs.post('/:id/move', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const logId = c.req.param('id')
  const existing = queryOne('SELECT id FROM logs WHERE deleted_at IS NULL AND id = ? AND user_id = ?', [logId, userId])
  if (!existing) return c.json({ error: '로그를 찾을 수 없습니다.' }, 404)

  const body = await c.req.json()
  const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id : ''
  const workspace = queryOne('SELECT id FROM workspaces WHERE id = ? AND user_id = ?', [workspaceId, userId])
  if (!workspace) return c.json({ error: '워크스페이스를 찾을 수 없습니다.' }, 404)

  run('UPDATE logs SET workspace_id = ?, group_id = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [workspaceId, Math.floor(Date.now() / 1000), logId, userId])
  const updated = queryOne<any>('SELECT logs.*, (SELECT COUNT(*) FROM comments WHERE comments.log_id = logs.id AND comments.user_id = logs.user_id) AS comment_count FROM logs WHERE logs.id = ?', [logId])!
  return c.json({ ...updated, tags: JSON.parse(updated.tags || '[]'), attachments: JSON.parse(updated.attachments || '[]'), pinned: !!updated.pinned, is_secret: !!updated.is_secret })
})

// GET /api/logs/:id
logs.get('/:id', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const row = queryOne<any>('SELECT logs.*, (SELECT COUNT(*) FROM comments WHERE comments.log_id = logs.id AND comments.user_id = logs.user_id) AS comment_count FROM logs WHERE logs.deleted_at IS NULL AND logs.id = ? AND logs.user_id = ?', [c.req.param('id'), userId])
  if (!row) return c.json({ error: '로그를 찾을 수 없습니다.' }, 404)
  return c.json({ ...row, tags: JSON.parse(row.tags || '[]'), attachments: JSON.parse(row.attachments || '[]'), pinned: !!row.pinned, is_secret: !!row.is_secret })
})

// POST /api/logs
logs.post('/', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const { title = '', content = '', log_type = 'note', content_format = 'text', file_path = null, tags = [], attachments = [], workspace_id = null, is_secret = false } = await c.req.json()
  const id  = generateId()
  const now = Math.floor(Date.now() / 1000)

  run(
    'INSERT INTO logs (id, user_id, title, content, log_type, content_format, file_path, tags, attachments, workspace_id, is_secret, created_at, updated_at, ocr_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, userId, title, content, log_type, content_format, file_path, JSON.stringify(tags), JSON.stringify(attachments), workspace_id, log_type === 'note' && is_secret ? 1 : 0, now, now, 'idle']
  )

  const row = queryOne<any>('SELECT logs.*, (SELECT COUNT(*) FROM comments WHERE comments.log_id = logs.id AND comments.user_id = logs.user_id) AS comment_count FROM logs WHERE logs.id = ?', [id])!
  return c.json({ ...row, tags: JSON.parse(row.tags || '[]'), attachments: JSON.parse(row.attachments || '[]'), pinned: !!row.pinned, is_secret: !!row.is_secret }, 201)
})

// PUT /api/logs/:id
logs.put('/:id', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const existing = queryOne('SELECT id FROM logs WHERE deleted_at IS NULL AND id = ? AND user_id = ?', [c.req.param('id'), userId])
  if (!existing) return c.json({ error: '로그를 찾을 수 없습니다.' }, 404)

  const body = await c.req.json()
  const now  = Math.floor(Date.now() / 1000)
  const row  = queryOne<any>('SELECT * FROM logs WHERE id = ?', [c.req.param('id')])!

  run(
    'UPDATE logs SET title=?, content=?, log_type=?, content_format=?, file_path=?, tags=?, attachments=?, pinned=?, is_secret=?, favorite=?, updated_at=? WHERE id=? AND user_id=?',
    [
      body.title          ?? row.title,
      body.content        ?? row.content,
      body.log_type       ?? row.log_type,
      body.content_format ?? row.content_format,
      body.file_path !== undefined ? body.file_path : row.file_path,
      body.tags        !== undefined ? JSON.stringify(body.tags) : row.tags,
      body.attachments !== undefined ? JSON.stringify(body.attachments) : row.attachments,
      body.pinned      !== undefined ? (body.pinned ? 1 : 0) : row.pinned,
      body.is_secret   !== undefined ? (body.is_secret ? 1 : 0) : row.is_secret,
      body.favorite    !== undefined ? (body.favorite ? 1 : 0) : row.favorite,
      now,
      c.req.param('id'),
      userId
    ]
  )

  const imageChanged = (body.file_path !== undefined && body.file_path !== row.file_path)
    || (body.attachments !== undefined && JSON.stringify(body.attachments) !== row.attachments)
    || (body.is_secret !== undefined && !!body.is_secret !== !!row.is_secret)
    || (body.log_type !== undefined && body.log_type !== row.log_type)
  if (imageChanged) {
    run("UPDATE logs SET ocr_text = '', ocr_status = 'idle' WHERE id = ?", [c.req.param('id')])
  }

  const updated = queryOne<any>('SELECT logs.*, (SELECT COUNT(*) FROM comments WHERE comments.log_id = logs.id AND comments.user_id = logs.user_id) AS comment_count FROM logs WHERE logs.id = ?', [c.req.param('id')])!
  const updatedMedia = new Set(mediaPaths(updated))
  cleanupUnreferencedMedia(mediaPaths(row).filter(filePath => !updatedMedia.has(filePath)))
  return c.json({ ...updated, tags: JSON.parse(updated.tags || '[]'), attachments: JSON.parse(updated.attachments || '[]'), pinned: !!updated.pinned, is_secret: !!updated.is_secret })
})

logs.post('/:id/ocr', async c => {
  const userId = LOCAL_PROFILE_ID
  const row = queryOne<any>('SELECT * FROM logs WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND is_secret = 0', [c.req.param('id'), userId])
  if (!row) return c.json({ error: '로그를 찾을 수 없습니다.' }, 404)
  const images = imageMediaPaths({ ...row, file_path: row.log_type === 'screenshot' ? row.file_path : null })
  if (images.length === 0) return c.json({ error: '이미지가 없습니다.' }, 400)
  if (row.ocr_status === 'pending' || row.ocr_status === 'processing') return c.json({ ok: true })
  run("UPDATE logs SET ocr_text = '', ocr_status = 'pending' WHERE id = ?", [row.id])
  scheduleOcr()
  return c.json({ ok: true })
})

// Remove extracted text without deleting the record or its images.
logs.delete('/:id/ocr', async c => {
  const userId = LOCAL_PROFILE_ID
  const row = queryOne<{ id: string; ocr_status: string }>('SELECT id, ocr_status FROM logs WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [c.req.param('id'), userId])
  if (!row) return c.json({ error: '로그를 찾을 수 없습니다.' }, 404)
  if (row.ocr_status === 'pending' || row.ocr_status === 'processing') return c.json({ error: '텍스트 추출이 끝난 뒤 삭제해 주세요.' }, 409)
  run("UPDATE logs SET ocr_text = '', ocr_status = 'idle' WHERE id = ? AND user_id = ?", [row.id, userId])
  return c.json({ ok: true })
})

// DELETE /api/logs/:id
logs.delete('/:id', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const row = queryOne<any>('SELECT * FROM logs WHERE deleted_at IS NULL AND id = ? AND user_id = ?', [c.req.param('id'), userId])
  if (!row) return c.json({ error: '로그를 찾을 수 없습니다.' }, 404)

  moveToTrash(userId, [c.req.param('id')])
  return c.json({ ok: true })
})

export default logs
