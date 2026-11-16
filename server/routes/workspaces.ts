import { Hono } from 'hono'
import { generateId, queryOne, run, transaction } from '../db'
import { LOCAL_PROFILE_ID } from '../localProfile'
import { ensureDefaultWorkspace, nextWorkspacePosition, orderedWorkspaces } from '../workspaceOrder'

const workspaces = new Hono()


// GET /api/workspaces
workspaces.get('/', async (c) => {
  const userId = LOCAL_PROFILE_ID
  ensureDefaultWorkspace(userId)
  return c.json(orderedWorkspaces(userId))
})

// POST /api/workspaces
workspaces.post('/', async (c) => {
  const userId = LOCAL_PROFILE_ID
  const { name } = await c.req.json()
  if (!name?.trim()) return c.json({ error: '이름을 입력하세요' }, 400)
  const id = generateId()
  ensureDefaultWorkspace(userId)
  run('INSERT INTO workspaces (id, user_id, name, is_default, sort_order) VALUES (?, ?, ?, 0, ?)', [id, userId, name.trim(), nextWorkspacePosition(userId)])
  const row = queryOne<any>('SELECT * FROM workspaces WHERE id = ?', [id])!
  return c.json({ ...row, is_default: !!row.is_default }, 201)
})

// Move relative to the current server order, so an older selector cannot
// overwrite a newly added workspace or another completed move.
workspaces.put('/:id/order', async c => {
  const input = await c.req.json().catch(() => null)
  if (input?.direction !== 'up' && input?.direction !== 'down') return c.json({ error: 'INVALID_DIRECTION' }, 400)
  const rows = orderedWorkspaces()
  const index = rows.findIndex(row => row.id === c.req.param('id'))
  if (index < 0) return c.json({ error: 'WORKSPACE_NOT_FOUND' }, 404)
  const target = index + (input.direction === 'up' ? -1 : 1)
  if (target >= 0 && target < rows.length) {
    ;[rows[index], rows[target]] = [rows[target], rows[index]]
    transaction(() => rows.forEach((row, position) => run('UPDATE workspaces SET sort_order = ? WHERE id = ? AND user_id = ?', [position, row.id, LOCAL_PROFILE_ID])))
  }
  return c.json(orderedWorkspaces())
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
