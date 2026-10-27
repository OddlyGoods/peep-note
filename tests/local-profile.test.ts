import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApiApp } from '../server/index'
import { initDb, getDb, queryOne } from '../server/db'
import { LOCAL_PROFILE_ID } from '../server/localProfile'
import { api } from '../src/lib/api'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openpeepnote-local-'))
const app = createApiApp(3848)
const call = (route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`http://127.0.0.1:3848${route}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })
async function json(route: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
  const response = await call(route, method, body, headers)
  assert.ok(response.ok, `${route}: ${response.status}`)
  return response.json() as Promise<any>
}
before(async () => { await initDb(root) })
after(() => { getDb().close(); fs.rmSync(root, { recursive: true, force: true }) })

test('notes, workspaces, comments and settings work immediately without a login', async () => {
  assert.equal((await call('/api/auth/me')).status, 404)
  assert.equal(queryOne("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'"), null)
  assert.equal(queryOne("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'"), null)
  const workspaces = await json('/api/workspaces')
  assert.equal(workspaces.length, 1)
  assert.equal(workspaces[0].is_default, true)
  const workspace = await json('/api/workspaces', 'POST', { name: 'Shared local workspace' })
  const first = await json('/api/logs', 'POST', { title: 'Shared record', content: 'Works offline', workspace_id: workspace.id, user_id: 'pretend-account' })
  assert.equal(first.user_id, LOCAL_PROFILE_ID)
  const second = await json('/api/logs', 'POST', { title: 'Second record', workspace_id: workspace.id })
  const group = await json('/api/groups', 'POST', { name: 'Local group', log_ids: [first.id, second.id], workspace_id: workspace.id })
  assert.equal(group.logs.length, 2)
  const comment = await json(`/api/logs/${first.id}/comments`, 'POST', { content: 'No account needed' })
  assert.equal(comment.user_id, LOCAL_PROFILE_ID)
  await json('/api/settings', 'PUT', { language: 'ko', trash_retention_days: 30 })
  assert.equal((await json('/api/settings')).language, 'ko')
  assert.equal((await json('/api/ai/key-status')).has_key, false)
  await json(`/api/logs/${first.id}`, 'DELETE')
  assert.ok((await json('/api/trash')).some((row: any) => row.id === first.id))
  assert.equal((await json('/api/trash/restore', 'POST', { ids: [first.id] })).restored, 1)
})

test('changing or clearing old account headers cannot select a different data space', async () => {
  const noHeader = await json('/api/logs')
  const arbitraryHeader = await json('/api/logs', 'GET', undefined, { Authorization: 'Bearer test-only-placeholder' })
  assert.deepEqual(arbitraryHeader.map((item: any) => item.id), noHeader.map((item: any) => item.id))
  const settings = await json('/api/settings', 'GET', undefined, { Authorization: 'Bearer another-placeholder' })
  assert.equal(settings.language, 'ko')
  assert.equal(settings.trash_retention_days, 30)
  await initDb(root)
  assert.equal((await json('/api/settings')).language, 'ko')
  assert.deepEqual((await json('/api/logs')).map((item: any) => item.id), noHeader.map((item: any) => item.id))
})

test('secret note PIN remains available independently of account login', async () => {
  assert.equal((await json('/api/settings/secret-password/status')).is_set, false)
  await json('/api/settings/secret-password', 'PUT', { password: '1234' })
  assert.equal((await json('/api/settings/secret-password/status')).is_set, true)
  assert.equal((await call('/api/settings/secret-password/verify', 'POST', { password: '0000' })).status, 403)
  assert.equal((await json('/api/settings/secret-password/verify', 'POST', { password: '1234' })).ok, true)
  assert.ok(!('secret_password_hash' in await json('/api/settings')))
})

test('unrelated origins, no-CORS requests and rebinding hosts cannot reach local data', async () => {
  assert.equal((await call('/api/logs', 'GET', undefined, { Origin: 'https://unrelated.example' })).status, 403)
  assert.equal((await call('/api/logs', 'POST', { title: 'Blocked' }, { Origin: 'null' })).status, 403)
  assert.equal((await call('/api/logs', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  assert.equal((await call('/api/logs', 'GET', undefined, { Host: 'unrelated.example:3848' })).status, 403)
  for (const origin of ['app://dist', 'http://localhost:5173', 'http://127.0.0.1:4173']) {
    assert.equal((await call('/api/logs', 'GET', undefined, { Origin: origin })).status, 200)
  }
  assert.equal((await call('/api/logs', 'OPTIONS', undefined, { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' })).status, 204)
})

test('renderer requests only the local API and never reads or sends account tokens', async () => {
  const originalFetch = globalThis.fetch
  ;(globalThis as any).localStorage = { getItem: () => { throw new Error('Account storage must not be read') } }
  let requests = 0
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith('http://127.0.0.1:3848/api/'))
    assert.equal(new Headers(options?.headers).has('Authorization'), false)
    requests++
    return Response.json([])
  }
  try {
    await api.logs.list()
    await api.workspaces.list()
    assert.equal(requests, 2)
  } finally { globalThis.fetch = originalFetch }
})
