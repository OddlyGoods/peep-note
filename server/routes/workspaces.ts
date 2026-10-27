import { Hono } from 'hono'
import { generateId, queryOne, queryAll, run } from '../db'
import { LOCAL_PROFILE_ID } from '../localProfile'

const workspaces = new Hono()


function ensureDefault(userId: string) {
  const existing = queryOne<any>(
    'SELECT id FROM workspaces WHERE user_id = ? AND is_default = 1',
    [userId]
  )
  if (!existing) {
    run(
      'INSERT INTO workspaces (id, user_id, name, is_default) VALUES (?, ?, ?, 1)',
      [generateId(), userId, '공통']
    )
  }
}

// GET /api/workspaces
workspaces.get('/', async (c) => {
  const userId = LOCAL_PROFILE_ID
  ensureDefault(userId)
  const rows = queryAll<any>(
    'SELECT * FROM workspaces WHERE user_id = ? ORDER BY is_default DESC, created_at ASC',
    [userId]
  )
  return c.json(rows.map(r => ({ ...r, is_default: !!r.is_default })))
})

// POST /api/workspaces
workspaces.post('/', async (c) => {
  const userId = LOCAL_PROFILE_ID
  const { name } = await c.req.json()
  if (!name?.trim()) return c.json({ error: '이름을 입력하세요' }, 400)
  const id = generateId()
  run('INSERT INTO workspaces (id, user_id, name, is_default) VALUES (?, ?, ?, 0)', [id, userId, name.trim()])
  const row = queryOne<any>('SELECT * FROM workspaces WHERE id = ?', [id])!
  return c.json({ ...row, is_default: !!row.is_default }, 201)
})

// PUT /api/workspaces/:id
workspaces.put('/:id', async (c) => {
  const userId = LOCAL_PROFILE_ID
  const ws = queryOne<any>('SELECT * FROM workspaces WHERE id = ? AND user_id = ?', [c.req.param('id'), userId])
  if (!ws) return c.json({ error: '워크스페이스를 찾을 수 없습니다' }, 404)
  if (ws.is_default) return c.json({ error: '기본 워크스페이스는 수정할 수 없습니다' }, 400)
  const { name } = await c.req.json()
  if (!name?.trim()) return c.json({ error: '이름을 입력하세요' }, 400)
  run('UPDATE workspaces SET name = ? WHERE id = ?', [name.trim(), c.req.param('id')])
  const row = queryOne<any>('SELECT * FROM workspaces WHERE id = ?', [c.req.param('id')])!
  return c.json({ ...row, is_default: !!row.is_default })
})

// DELETE /api/workspaces/:id
workspaces.delete('/:id', async (c) => {
  const userId = LOCAL_PROFILE_ID
  const ws = queryOne<any>('SELECT * FROM workspaces WHERE id = ? AND user_id = ?', [c.req.param('id'), userId])
  if (!ws) return c.json({ error: '워크스페이스를 찾을 수 없습니다' }, 404)
  if (ws.is_default) return c.json({ error: '기본 워크스페이스는 삭제할 수 없습니다' }, 400)
  const defaultWs = queryOne<any>('SELECT id FROM workspaces WHERE user_id = ? AND is_default = 1', [userId])
  if (defaultWs) {
    run('UPDATE logs SET workspace_id = ? WHERE workspace_id = ? AND user_id = ?', [defaultWs.id, c.req.param('id'), userId])
  }
  run('DELETE FROM workspaces WHERE id = ?', [c.req.param('id')])
  return c.json({ ok: true })
})

export default workspaces
