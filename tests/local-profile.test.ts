import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApiApp } from '../server/index'
import { initDb, getDb, queryOne } from '../server/db'
import { LOCAL_PROFILE_ID } from '../server/localProfile'
import { api } from '../src/lib/api'
import { DEFAULT_HOTKEYS, getActiveHotkeys, type HotkeyAction } from '../shared/hotkeys'

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
  const defaults = await json('/api/settings')
  assert.equal(defaults.fixed_start_date, true)
  assert.equal(defaults.auto_advance_date_range, true)
  assert.equal(defaults.hotkeys.openMain, 'Alt+W')
  assert.equal(defaults.hotkeys.openFavorites, 'Alt+F')
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
  const groupedRows = await json('/api/logs')
  assert.equal(groupedRows.find((item: any) => item.id === first.id).group_created_at, group.created_at)
  const comment = await json(`/api/logs/${first.id}/comments`, 'POST', { content: 'No account needed' })
  assert.equal(comment.user_id, LOCAL_PROFILE_ID)
  const savedDefaults = await json('/api/settings', 'PUT', { language: 'ko', trash_retention_days: 30 })
  assert.equal(savedDefaults.fixed_start_date, true)
  assert.equal(savedDefaults.auto_advance_date_range, true)
  assert.equal((await json('/api/settings')).language, 'ko')
  assert.equal((await json('/api/ai/key-status')).has_key, false)
  await json(`/api/logs/${first.id}`, 'DELETE')
  assert.ok((await json('/api/trash')).some((row: any) => row.id === first.id))
  assert.equal((await json('/api/trash/restore', 'POST', { ids: [first.id] })).restored, 1)
})

test('new global shortcuts fill older settings without replacing saved custom shortcuts', async () => {
  const previous = await json('/api/settings')
  try {
    const saved = await json('/api/settings', 'PUT', { hotkeys: { openMain: 'Ctrl+Alt+W' } })
    assert.equal(saved.hotkeys.openMain, 'Ctrl+Alt+W')
    assert.equal(saved.hotkeys.openFavorites, 'Alt+F')
    await initDb(root)
    const reloaded = await json('/api/settings')
    assert.equal(reloaded.hotkeys.openMain, 'Ctrl+Alt+W')
    assert.equal(reloaded.hotkeys.openFavorites, 'Alt+F')
    await json('/api/settings', 'PUT', { hotkeys: { ...reloaded.hotkeys, openFavorites: 'Ctrl+Alt+F' } })
    const updated = await json('/api/settings', 'PUT', { language: 'ko' })
    assert.equal(updated.hotkeys.openMain, 'Ctrl+Alt+W')
    assert.equal(updated.hotkeys.openFavorites, 'Ctrl+Alt+F')
  } finally {
    await json('/api/settings', 'PUT', { hotkeys: previous.hotkeys })
  }
})

test('disabled shortcuts survive reload, are not registered, and restore their saved combinations', async () => {
  const previous = await json('/api/settings')
  const actions = Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[]
  try {
    await json('/api/settings', 'PUT', { hotkeys: {
      ...previous.hotkeys,
      openMain: 'Ctrl+Alt+W',
      disabled: Object.fromEntries(actions.map(action => [action, true]))
    } })
    await initDb(root)
    const reloaded = await json('/api/settings')
    const active = getActiveHotkeys(reloaded.hotkeys)
    for (const action of actions) assert.equal(active[action], '', action)
    assert.equal(reloaded.hotkeys.openMain, 'Ctrl+Alt+W')
    const restored = await json('/api/settings', 'PUT', { hotkeys: {
      ...reloaded.hotkeys,
      disabled: { ...reloaded.hotkeys.disabled, openMain: false }
    } })
    assert.equal(getActiveHotkeys(restored.hotkeys).openMain, 'Ctrl+Alt+W')
    assert.equal(getActiveHotkeys(restored.hotkeys).quickSwitch, '')
    assert.equal(getActiveHotkeys(restored.hotkeys).quickSwitchPrevious, '')
    await initDb(root)
    const persisted = await json('/api/settings')
    assert.equal(getActiveHotkeys(persisted.hotkeys).openMain, 'Ctrl+Alt+W')
    assert.equal(getActiveHotkeys(persisted.hotkeys).openFavorites, '')
    assert.deepEqual(getActiveHotkeys(), DEFAULT_HOTKEYS)
  } finally {
    await json('/api/settings', 'PUT', { hotkeys: previous.hotkeys })
  }
})

test('the fixed start option persists independently of automatic dates and survives partial updates', async () => {
  try {
    for (const autoAdvance of [false, true]) {
      for (const fixedStart of [false, true]) {
        const saved = await json('/api/settings', 'PUT', { auto_advance_date_range: autoAdvance, fixed_start_date: fixedStart })
        assert.equal(saved.auto_advance_date_range, autoAdvance)
        assert.equal(saved.fixed_start_date, fixedStart)
        await initDb(root)
        const reloaded = await json('/api/settings')
        assert.equal(reloaded.auto_advance_date_range, autoAdvance)
        assert.equal(reloaded.fixed_start_date, fixedStart)
        const unrelatedUpdate = await json('/api/settings', 'PUT', { trash_retention_days: 30 })
        assert.equal(unrelatedUpdate.fixed_start_date, fixedStart)
      }
    }
    assert.equal((await call('/api/settings', 'PUT', { fixed_start_date: 'false' })).status, 400)
  } finally {
    await json('/api/settings', 'PUT', { auto_advance_date_range: true, fixed_start_date: false })
  }
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

test('revealing a favorite includes its group date, clears filters and loads pages through its position', async () => {
  const values = new Map<string, string>()
  const previousStorage = (globalThis as any).localStorage
  ;(globalThis as any).localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
  const { useLogStore } = await import('../src/stores/logStore')
  const { useWorkspaceStore } = await import('../src/stores/workspaceStore')
  const list = api.logs.list
  const target = { id: 'favorite-target', created_at: new Date('2020-02-02T12:00:00').getTime() / 1000, group_created_at: new Date('2019-01-02T12:00:00').getTime() / 1000, workspace_id: 'research' } as any
  try {
    useWorkspaceStore.setState({ selectedId: 'research' })
    useLogStore.setState({ dateFrom: '2026-10-01', dateTo: '2026-10-27', filterType: 'video', searchQuery: 'hidden by search' })
    useLogStore.getState().revealLog(target, 'research')
    const prepared = useLogStore.getState()
    assert.equal(prepared.dateFrom, '2019-01-02')
    assert.equal(prepared.dateTo, '2026-10-27')
    assert.equal(prepared.filterType, '')
    assert.equal(prepared.searchQuery, '')
    assert.deepEqual(JSON.parse(values.get('openpeepnote_dashboard_date_range')!), { dateFrom: '2019-01-02', dateTo: '2026-10-27' })
    const pages: number[] = []
    api.logs.list = async params => {
      assert.equal(params?.workspace_id, 'research')
      assert.equal(params?.search, undefined)
      pages.push(params?.page ?? 1)
      return params?.page === 2 ? [target] : Array.from({ length: 500 }, (_, index) => ({ ...target, id: `newer-${index}` }))
    }
    await useLogStore.getState().fetchLogs()
    assert.deepEqual(pages, [1, 2])
    assert.equal(useLogStore.getState().logs.at(-1)?.id, target.id)
    assert.equal(useLogStore.getState().loading, false)
  } finally {
    api.logs.list = list
    ;(globalThis as any).localStorage = previousStorage
  }
})

test('an older dashboard response cannot overwrite the latest navigation result', async () => {
  const { useLogStore } = await import('../src/stores/logStore')
  const list = api.logs.list
  const groupList = api.groups.list
  const previous = useLogStore.getState()
  const { invalidateExploreCache } = await import('../src/lib/exploreCache')
  invalidateExploreCache()
  const responses: Array<(value: any[]) => void> = []
  try {
    useLogStore.setState({ revealTarget: null, logs: [], groups: [], queryKey: null })
    api.groups.list = async () => []
    api.logs.list = () => new Promise(resolve => responses.push(resolve))
    const oldRequest = useLogStore.getState().fetchLogs()
    await new Promise(resolve => setImmediate(resolve))
    useLogStore.setState({ searchQuery: 'a different query' })
    const newRequest = useLogStore.getState().fetchLogs()
    await new Promise(resolve => setImmediate(resolve))
    responses[1]([{ id: 'current-record' }])
    await newRequest
    responses[0]([{ id: 'outdated-record' }])
    await oldRequest
    assert.equal(useLogStore.getState().logs[0].id, 'current-record')
  } finally { api.logs.list = list; api.groups.list = groupList; useLogStore.setState(previous); invalidateExploreCache() }
})

test('renderer includes the current UI language in AI summary requests', async () => {
  const originalFetch = globalThis.fetch
  const requests: unknown[] = []
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:3848/api/ai/summarize')
    requests.push(JSON.parse(String(options?.body)))
    return Response.json({ ok: true, title: 'Title', summary: 'Summary' })
  }
  try {
    for (const language of ['en', 'ko', 'ja', 'zh'] as const) await api.ai.summarize('selected-group', language)
    assert.deepEqual(requests, ['en', 'ko', 'ja', 'zh'].map(language => ({ group_id: 'selected-group', language })))
  } finally { globalThis.fetch = originalFetch }
})
