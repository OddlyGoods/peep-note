import { Hono } from 'hono'
import { generateId, queryOne, queryAll, run, transaction } from '../db'
import { LOCAL_PROFILE_ID } from '../localProfile'
import { moveToTrash } from '../trash'

const groups = new Hono()


function parseLog(r: any) {
  return {
    ...r,
    tags: JSON.parse(r.tags || '[]'),
    attachments: JSON.parse(r.attachments || '[]'),
    pinned: !!r.pinned,
    is_secret: !!r.is_secret
  }
}

// GET /api/groups?date=&workspace_id=
groups.get('/', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const { date, date_from, date_to, workspace_id, type, search } = c.req.query()

  let groupSql = "SELECT DISTINCT g.* FROM log_groups g JOIN logs l ON l.group_id = g.id WHERE g.user_id = ? AND l.deleted_at IS NULL AND l.log_type != 'summary'"
  const groupParams: unknown[] = [userId]

  if (date) {
    const start = Math.floor(new Date(date + 'T00:00:00').getTime() / 1000)
    const end   = Math.floor(new Date(date + 'T23:59:59').getTime() / 1000)
    groupSql += ' AND l.created_at >= ? AND l.created_at <= ?'
    groupParams.push(start, end)
  } else if (date_from || date_to) {
    // Groups belong to the date on which the group itself was created.
    if (date_from) { groupSql += ' AND g.created_at >= ?'; groupParams.push(Math.floor(new Date(date_from + 'T00:00:00').getTime() / 1000)) }
    if (date_to) { groupSql += ' AND g.created_at <= ?'; groupParams.push(Math.floor(new Date(date_to + 'T23:59:59').getTime() / 1000)) }
  }
  if (workspace_id) {
    groupSql += ' AND (g.workspace_id = ? OR g.workspace_id IS NULL)'
    groupParams.push(workspace_id)
  }
  if (type) {
    groupSql += ' AND l.log_type = ?'
    groupParams.push(type)
  }
  if (search) {
    const tag = search.trim().startsWith('#') ? search.trim().slice(1).trim() : ''
    if (tag) {
      groupSql += ' AND l.tags LIKE ?'
      groupParams.push(`%${tag}%`)
    } else if (!search.trim().startsWith('#')) {
      groupSql += ` AND (l.title LIKE ? OR (l.is_secret = 0 AND (l.content LIKE ? OR replace(replace(replace(l.ocr_text, ' ', ''), char(10), ''), char(13), '') LIKE ? OR l.attachments LIKE ? OR l.file_path LIKE ?)))`
      groupParams.push(`%${search}%`, `%${search}%`, `%${search.replace(/\s/g, '')}%`, `%${search}%`, `%${search}%`)
    }
  }

  groupSql += ' ORDER BY g.created_at DESC'
  const groupRows = queryAll<any>(groupSql, groupParams)

  const result = groupRows.map(g => {
    let logSql = "SELECT logs.*, (SELECT COUNT(*) FROM comments WHERE comments.log_id = logs.id AND comments.user_id = logs.user_id) AS comment_count FROM logs WHERE deleted_at IS NULL AND group_id = ? AND user_id = ?"
    const logParams: unknown[] = [g.id, userId]
    if (date) {
      const start = Math.floor(new Date(date + 'T00:00:00').getTime() / 1000)
      const end   = Math.floor(new Date(date + 'T23:59:59').getTime() / 1000)
      logSql += " AND (created_at >= ? AND created_at <= ? OR log_type = 'summary')"
      logParams.push(start, end)
    }
    if (type) { logSql += " AND (log_type = ? OR log_type = 'summary')"; logParams.push(type) }
    if (search) {
      const tag = search.trim().startsWith('#') ? search.trim().slice(1).trim() : ''
      if (tag) {
        logSql += " AND (tags LIKE ? OR log_type = 'summary')"
        logParams.push(`%${tag}%`)
      } else if (!search.trim().startsWith('#')) {
        logSql += " AND (title LIKE ? OR (is_secret = 0 AND (content LIKE ? OR replace(replace(replace(ocr_text, ' ', ''), char(10), ''), char(13), '') LIKE ? OR attachments LIKE ? OR file_path LIKE ?)) OR log_type = 'summary')"
        logParams.push(`%${search}%`, `%${search}%`, `%${search.replace(/\s/g, '')}%`, `%${search}%`, `%${search}%`)
      }
    }
    logSql += ' ORDER BY pinned DESC, created_at DESC'
    const logs = queryAll<any>(logSql, logParams).map(parseLog)
    return { ...g, logs }
  })

  return c.json(result)
})

// Group detail is independent of Explore's current filters and other groups.
groups.get('/:id', c => {
  const userId = LOCAL_PROFILE_ID
  const group = queryOne<any>('SELECT * FROM log_groups WHERE id = ? AND user_id = ?', [c.req.param('id'), userId])
  if (!group) return c.json({ error: '그룹을 찾을 수 없습니다' }, 404)
  const logs = queryAll<any>(
    `SELECT logs.*, (SELECT COUNT(*) FROM comments WHERE comments.log_id = logs.id AND comments.user_id = logs.user_id) AS comment_count
     FROM logs WHERE group_id = ? AND user_id = ? AND deleted_at IS NULL
     ORDER BY pinned DESC, created_at DESC, id DESC`, [group.id, userId]
  ).map(parseLog)
  return c.json({ ...group, logs })
})

// POST /api/groups — { name, log_ids, workspace_id }
groups.post('/', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const { name, log_ids, workspace_id = null, language = 'ko' } = await c.req.json()
  if (!Array.isArray(log_ids) || log_ids.length < 2) {
    return c.json({ error: '2개 이상 선택하세요' }, 400)
  }

  const id  = generateId()
  const now = Math.floor(Date.now() / 1000)

  let groupName = name?.trim()
  if (!groupName) {
    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
    const todayEnd   = Math.floor(new Date().setHours(23, 59, 59, 999) / 1000)
    const row = queryOne<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM log_groups WHERE user_id = ? AND created_at >= ? AND created_at <= ?',
      [userId, todayStart, todayEnd]
    )
    const groupNumber = (row?.cnt ?? 0) + 1
    const defaultNames: Record<string, string> = {
      en: 'New Group ',
      ko: '새 그룹',
      ja: '新しいグループ',
      zh: '新建分组'
    }
    groupName = `${defaultNames[language] ?? defaultNames.ko}${groupNumber}`
  }

  run(
    'INSERT INTO log_groups (id, user_id, name, workspace_id, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, userId, groupName, workspace_id, now]
  )
  for (const logId of log_ids) {
    run('UPDATE logs SET group_id = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, logId, userId])
  }

  const group = queryOne<any>('SELECT * FROM log_groups WHERE id = ?', [id])!
  const logs = queryAll<any>('SELECT logs.*, (SELECT COUNT(*) FROM comments WHERE comments.log_id = logs.id AND comments.user_id = logs.user_id) AS comment_count FROM logs WHERE deleted_at IS NULL AND group_id = ? ORDER BY created_at DESC', [id]).map(parseLog)
  return c.json({ ...group, logs }, 201)
})

// PUT /api/groups/:id — rename
groups.put('/:id', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const g = queryOne<any>('SELECT * FROM log_groups WHERE id = ? AND user_id = ?', [c.req.param('id'), userId])
  if (!g) return c.json({ error: '그룹을 찾을 수 없습니다' }, 404)

  const { name } = await c.req.json()
  if (!name?.trim()) return c.json({ error: '이름을 입력하세요' }, 400)

  run('UPDATE log_groups SET name = ? WHERE id = ?', [name.trim(), c.req.param('id')])
  return c.json({ ...g, name: name.trim() })
})

// POST /api/groups/:id/ungroup
groups.post('/:id/ungroup', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const g = queryOne<any>('SELECT * FROM log_groups WHERE id = ? AND user_id = ?', [c.req.param('id'), userId])
  if (!g) return c.json({ error: '그룹을 찾을 수 없습니다' }, 404)

  transaction(() => {
    const summaries = queryAll<{ id: string }>("SELECT id FROM logs WHERE group_id = ? AND user_id = ? AND log_type = 'summary' AND deleted_at IS NULL", [g.id, userId])
    moveToTrash(userId, summaries.map(row => row.id))
    run('UPDATE logs SET group_id = NULL WHERE group_id = ? AND user_id = ?', [g.id, userId])
    run('DELETE FROM log_groups WHERE id = ?', [g.id])
  })
  return c.json({ ok: true })
})

// DELETE /api/groups/:id
groups.delete('/:id', async (c) => {
  const userId = LOCAL_PROFILE_ID

  const g = queryOne<any>('SELECT * FROM log_groups WHERE id = ? AND user_id = ?', [c.req.param('id'), userId])
  if (!g) return c.json({ error: '그룹을 찾을 수 없습니다' }, 404)

  const rows = queryAll<{ id: string }>('SELECT id FROM logs WHERE group_id = ? AND user_id = ? AND deleted_at IS NULL', [g.id, userId])
  moveToTrash(userId, rows.map(row => row.id), { id: g.id, name: g.name })
  return c.json({ ok: true })
})

export default groups
