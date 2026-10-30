import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { serve } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { initDb, getDb, run, queryOne } from '../server/db'
import { createApiApp } from '../server/index'
import { createMcpAccess } from '../server/mcpAccess'
import { restoreTrash } from '../server/trash'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-mcp-test-'))
const access = createMcpAccess(root)
let endpoint: string, client: Client, app: ReturnType<typeof createApiApp>, server: ReturnType<typeof serve>
let changes = 0
function seed(id: string, extra: Record<string, unknown> = {}) {
  const row = { id, user_id: 'local', title: id, content: 'reference content', ...extra }
  const keys = Object.keys(row)
  run(`INSERT INTO logs (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(row))
}
const row = (id: string) => queryOne<any>('SELECT * FROM logs WHERE id = ?', [id])
const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args })
function output(result: any) { assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text) }
const tokenHeader = () => JSON.parse(access.codexConfig(endpoint).match(/Authorization = ("[^"\\]*(?:\\.[^"\\]*)*")/)![1]) as string

before(async () => {
  await initDb(root)
  server = serve({ fetch: request => app.fetch(request), hostname: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  endpoint = `http://127.0.0.1:${port}/mcp`
  app = createApiApp(port, access, () => { changes++ })
  run("INSERT INTO workspaces (id,user_id,name,is_default) VALUES ('general','local','General',1), ('other','local','Research',0), ('foreign-ws','legacy','Foreign',1)")
  run("INSERT INTO settings (user_id,openai_api_key,qwen_api_key,secret_password_hash) VALUES ('local','provider-fixture-only','another-provider-fixture','password-fixture-only')")
  seed('visible', { tags: '["rag"]', attachments: '["/private/path.txt"]', ocr_text: 'searchable OCR' })
  seed('secret', { title: 'secret-title-marker', content: 'secret-content-marker', tags: '["secret-tag-marker"]', is_secret: 1 })
  seed('foreign', { user_id: 'legacy', content: 'foreign-content-marker' })
  seed('deleted', { deleted_at: Math.floor(Date.now() / 1000) })
  run("INSERT INTO comments (id,log_id,user_id,content) VALUES ('secret-comment','secret','local','secret-comment-marker'), ('visible-comment','visible','local','Public comment'), ('foreign-comment','visible','legacy','foreign-comment-marker')")
})
after(async () => {
  await client?.close()
  server?.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  getDb().close()
  fs.rmSync(root, { recursive: true, force: true })
})

test('MCP is opt-in, requires a private token and refuses browser origins and spoofed hosts', async () => {
  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 404)
  assert.deepEqual(await (await fetch(endpoint.replace('/mcp', '/api/mcp'))).json(), { enabled: false, endpoint })
  assert.equal((await fetch(endpoint.replace('/mcp', '/api/mcp/config'))).status, 409)
  const controlUrl = endpoint.replace('/mcp', '/api/mcp')
  assert.equal((await fetch(controlUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: 'yes' }) })).status, 400)
  assert.equal((await fetch(controlUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: JSON.stringify({ enabled: true }) })).status, 403)
  assert.equal((await fetch(controlUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'app://dist' }, body: JSON.stringify({ enabled: true }) })).status, 200)
  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status, 401)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { authorization: tokenHeader(), origin: 'http://localhost:5173' } })).status, 403)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { authorization: tokenHeader(), origin: 'https://unrelated.example' } })).status, 403)
  assert.equal((await app.request(endpoint, { method: 'POST', headers: { authorization: tokenHeader(), host: 'unrelated.example' } })).status, 403)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { authorization: tokenHeader(), 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.equal((await fetch(endpoint, { headers: { authorization: tokenHeader() } })).status, 405)
  const restoredAccess = createMcpAccess(root)
  assert.equal(restoredAccess.enabled, true)
  assert.equal(restoredAccess.accepts(tokenHeader()), true)
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, 'mcp-access.json')).mode & 0o777, 0o600)
  const configResponse = await fetch(endpoint.replace('/mcp', '/api/mcp/config'))
  assert.equal(configResponse.headers.get('cache-control'), 'no-store')
  assert.equal((await configResponse.json()).config.includes('provider-fixture-only'), false)
  client = new Client({ name: 'peepnote-integration-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: tokenHeader() } } }))
})

test('real MCP client discovers only the intended tools, without settings, provider calls or permanent deletion', async () => {
  const names = (await client.listTools()).tools.map(tool => tool.name).sort()
  assert.deepEqual(names, ['create_group','create_note','create_workspace','get_note','list_groups','list_workspaces','search_notes','set_favorite','trash_group','trash_notes','update_note'].sort())
  assert.ok((await call('purge_trash')).isError)
  assert.ok((await call('get_settings')).isError)
  assert.ok((await call('create_note', { content: 'test', is_secret: true })).isError)
})

test('all read paths exclude secret notes, deleted records, credentials, file paths and foreign data', async () => {
  const result = output(await call('search_notes'))
  assert.deepEqual(result.notes.map((note: any) => note.id), ['visible'])
  const note = output(await call('get_note', { id: 'visible' }))
  assert.equal(note.content, 'reference content')
  assert.deepEqual(note.comments.map((comment: any) => comment.content), ['Public comment'])
  for (const id of ['secret', 'foreign', 'deleted', 'missing']) {
    const result: any = await call('get_note', { id })
    assert.equal(result.isError, true)
    assert.equal(result.content[0].text, 'NOTE_NOT_FOUND')
  }
  for (const query of ['secret', 'secret-tag-marker', 'foreign-content-marker', "%' OR 1=1 --"]) assert.deepEqual(output(await call('search_notes', { query })).notes, [])
  assert.equal(output(await call('search_notes', { query: 'searchable OCR' })).notes[0].id, 'visible')
  const workspaces = output(await call('list_workspaces')).workspaces
  assert.equal(workspaces.find((ws: any) => ws.id === 'general').note_count, 1)
  assert.equal(workspaces.some((ws: any) => ws.id === 'foreign-ws'), false)
  const exported = JSON.stringify([result, note, workspaces])
  for (const marker of ['secret-title-marker','secret-content-marker','secret-tag-marker','secret-comment-marker','foreign-comment-marker','provider-fixture-only','password-fixture-only','/private/path.txt']) assert.equal(exported.includes(marker), false)
})

test('write tools create and edit public notes, append Markdown and retain state after rejected secret writes', async () => {
  const workspace = output(await call('create_workspace', { name: 'MCP workspace' }))
  const note = output(await call('create_note', { title: 'Saved answer', content: '# RAG', workspace_id: workspace.id, tags: ['rag','rag'] }))
  assert.equal(note.content_format, 'markdown')
  assert.deepEqual(note.tags, ['rag'])
  const edited = output(await call('update_note', { id: note.id, content: '## Retrieval', content_mode: 'append', title: 'RAG reference' }))
  assert.equal(edited.content, '# RAG\n## Retrieval')
  output(await call('set_favorite', { id: note.id, favorite: true }))
  assert.equal(output(await call('search_notes', { workspace_id: workspace.id, favorite: true })).notes[0].id, note.id)
  for (const id of ['secret','foreign','deleted']) {
    assert.ok((await call('update_note', { id, content: 'must not overwrite' })).isError)
    assert.ok((await call('set_favorite', { id, favorite: true })).isError)
  }
  assert.equal(row('secret').content, 'secret-content-marker')
  assert.equal(row('foreign').content, 'foreign-content-marker')
  assert.ok((await call('create_note', { content: 'invalid', workspace_id: 'foreign-ws' })).isError)
  assert.ok(changes >= 4)
})

test('group tools omit secret members and reject mixed groups or secret IDs without partial mutation', async () => {
  const a = output(await call('create_note', { content: 'a' })), b = output(await call('create_note', { content: 'b' }))
  assert.ok((await call('create_group', { name: 'Rejected', note_ids: [a.id, 'secret'] })).isError)
  assert.equal(row(a.id).group_id, null)
  const group = output(await call('create_group', { name: 'MCP group', note_ids: [a.id, b.id] }))
  run('UPDATE logs SET group_id = ? WHERE id = ?', [group.id, 'secret'])
  const exported = JSON.stringify(output(await call('list_groups')))
  assert.equal(exported.includes('secret'), false)
  assert.ok((await call('trash_group', { id: group.id })).isError)
  assert.equal(row(a.id).deleted_at, null)
  assert.equal(row('secret').deleted_at, null)
  run('UPDATE logs SET group_id = NULL WHERE id = ?', ['secret'])
  seed('group-summary', { group_id: group.id, log_type: 'summary' })
  assert.equal(output(await call('trash_group', { id: group.id })).trashed, 3)
  assert.ok(row('group-summary').deleted_at)
  assert.equal(restoreTrash('local', [a.id]), 3)
  assert.equal(row('group-summary').group_id, group.id)
  assert.equal(row('group-summary').deleted_at, null)
})

test('MCP deletes only to Trash, including individual summaries, and does not remove comment or attachment files', async () => {
  const file = path.join(root, 'retained.txt')
  fs.writeFileSync(file, 'test attachment')
  seed('summary', { log_type: 'summary', attachments: JSON.stringify([file]) })
  run("INSERT INTO comments (id,log_id,user_id,content) VALUES ('retained-comment','summary','local','keep me')")
  assert.ok((await call('trash_notes', { note_ids: ['summary', 'secret'] })).isError)
  assert.equal(row('summary').deleted_at, null)
  assert.equal(output(await call('trash_notes', { note_ids: ['summary','summary'] })).trashed, 1)
  assert.ok(row('summary').deleted_at)
  assert.ok(fs.existsSync(file))
  assert.ok(queryOne('SELECT id FROM comments WHERE id = ?', ['retained-comment']))
  assert.equal(restoreTrash('local', ['summary']), 1)
  assert.equal(row('summary').deleted_at, null)
  assert.ok((await call('trash_notes', { note_ids: ['secret'] })).isError)
})

test('pagination, invalid arguments, request limits and disabled/re-enabled credentials are enforced', async () => {
  assert.equal(output(await call('search_notes', { limit: 1 })).has_more, true)
  assert.equal(output(await call('search_notes', { limit: 1, offset: 1 })).notes.length, 1)
  assert.ok((await call('search_notes', { limit: 1000 })).isError)
  assert.ok((await call('create_note', { content: 'a'.repeat(200_001) })).isError)
  assert.equal((await app.request(endpoint, { method: 'POST', headers: { Authorization: tokenHeader(), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: 'x'.repeat(1_048_577) })).status, 413)
  const oldHeader = tokenHeader()
  access.setEnabled(false)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: oldHeader } })).status, 404)
  assert.equal(createMcpAccess(root).enabled, false)
  access.setEnabled(true)
  assert.notEqual(tokenHeader(), oldHeader)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: oldHeader } })).status, 401)
})

test('turning MCP off also stops a previously authorized request whose body is still arriving', async () => {
  let bodyStarted!: () => void, releaseBody!: () => void
  const started = new Promise<void>(resolve => { bodyStarted = resolve })
  const released = new Promise<void>(resolve => { releaseBody = resolve })
  const body = new ReadableStream({ async pull(controller) {
    bodyStarted()
    await released
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/call', params: { name: 'update_note', arguments: { id: 'visible', content: 'must never run' } } })))
    controller.close()
  } }, { highWaterMark: 0 })
  const pending = app.fetch(new Request(endpoint, {
    method: 'POST', headers: { Authorization: tokenHeader(), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body, duplex: 'half'
  } as RequestInit))
  await started
  access.setEnabled(false)
  releaseBody()
  const response = await (await pending).json()
  assert.equal(response.result.isError, true)
  assert.equal(response.result.content[0].text, 'MCP_UNAUTHORIZED')
  assert.equal(row('visible').content, 'reference content')
})
