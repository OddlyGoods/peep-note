import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initDb, queryOne, run } from '../server/db'
import { LocalKnowledgeIndex, currentEmbeddingVectors } from '../server/knowledgeIndex'
import { embeddingHash, embeddingText } from '../server/embeddingText'
import { EMBEDDING_CACHE_KEY, EMBEDDING_DIMENSIONS, normalizedVector } from '../shared/localEmbeddings'
import type { LocalEmbedder } from '../server/embeddingWorker'
import { createApiApp } from '../server/index'

const vector = () => [1, ...new Array(EMBEDDING_DIMENSIONS - 1).fill(0)]
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await wait(10) } throw new Error('Embedding index did not settle') }
const seed = (id: string, content: string, secret = 0, deleted: number | null = null, user = 'local') => run('INSERT INTO logs (id,user_id,title,content,is_secret,deleted_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [id, user, '', content, secret, deleted, 1, 1])
async function store(check: (root: string) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-embeddings-'))
  try { await initDb(root); await check(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('embedding preparation uses title/body/manual OCR, excluding markup and link destinations', () => {
  assert.equal(embeddingText({ id: 'a', title: 'Title', content: '<style>hidden</style><h1>Body &amp; text</h1><script>secret()</script>', content_format: 'html', log_type: 'note', ocr_text: 'Extracted words' }), 'Title Body & text Extracted words')
  const result = embeddingText({ id: 'b', title: '', content: '# Heading\n**Body** [source](https://example.test/private-path)', content_format: 'markdown', log_type: 'note', ocr_text: '' })
  assert.equal(result, 'Heading Body source'); assert.equal(result.includes('private-path'), false)
})
test('note map is opt-in, persists its switch, and does no inference while disabled', async () => store(async root => {
  let calls = 0
  const fake: LocalEmbedder = { embed: async () => { calls++; return vector() }, dispose() {} }
  let index = new LocalKnowledgeIndex(fake)
  const api = () => createApiApp(3848, undefined, undefined, index)
  const toggle = (enabled: unknown) => api().request('http://127.0.0.1:3848/api/knowledge-map/enabled', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
  try {
    seed('opt-in', 'Only process after enabling')
    const initial = await (await api().request('http://127.0.0.1:3848/api/knowledge-map')).json() as any
    assert.equal(initial.enabled, false); assert.deepEqual(initial.notes, [])
    index.touch(); index.retry()
    await api().request('http://127.0.0.1:3848/api/knowledge-map/retry', { method: 'POST' })
    await wait(200); assert.equal(calls, 0)
    assert.equal((await toggle('true')).status, 400)
    assert.equal((await toggle(true)).status, 200)
    await until(() => index.status().stage === 'ready'); assert.equal(calls, 1)
    index.dispose(); await initDb(root); index = new LocalKnowledgeIndex(fake)
    await until(() => index.status().stage === 'ready'); assert.equal(calls, 1, 'saved enabled state resumes with cached vectors')
    await toggle(false)
    run('UPDATE logs SET content = ? WHERE id = ?', ['Do not embed this change', 'opt-in'])
    await wait(200); assert.equal(calls, 1); assert.equal(index.status().stage, 'idle')
    index.dispose(); await initDb(root); index = new LocalKnowledgeIndex(fake)
    index.touch(); await wait(200); assert.equal(calls, 1, 'saved disabled state survives restart')
  } finally { index.dispose() }
}))
test('disabling cancels in-flight work and rejects late progress/results, including a quick re-enable', async () => store(async () => {
  let finish: ((value: number[]) => void) | undefined
  let lateProgress: (() => void) | undefined
  let calls = 0, stops = 0
  const index = new LocalKnowledgeIndex({
    embed: (_text, progress) => {
      calls++
      if (calls > 1) return Promise.resolve(vector())
      lateProgress = () => progress({ stage: 'downloading', progress: 99 })
      return new Promise(resolve => { finish = resolve })
    }, dispose() { stops++ },
  })
  try {
    seed('cancel', 'Indexing can be stopped')
    index.setEnabled(true); await until(() => !!finish)
    const before = stops; index.setEnabled(false)
    assert.equal(stops, before + 1)
    lateProgress!(); assert.equal(index.status().stage, 'idle')
    index.setEnabled(true)
    lateProgress!(); assert.notEqual(index.status().stage, 'downloading')
    finish!(vector())
    await until(() => index.status().stage === 'ready')
    assert.equal(calls, 2, 'late first-generation result was discarded')
    assert.equal(currentEmbeddingVectors(['cancel']).size, 1)
  } finally { index.dispose() }
}))
test('local index caches vectors across restarts, ignores metadata edits, and re-embeds changed content', async () => store(async root => {
  const calls: string[] = []
  const fake: LocalEmbedder = { embed: async text => { calls.push(text); return vector() }, dispose() {} }
  let index = new LocalKnowledgeIndex(fake)
  try {
    seed('public', 'Public text'); seed('private', 'private-excluded', 1); seed('trash', 'trash-excluded', 0, 1); seed('foreign', 'foreign-excluded', 0, null, 'foreign')
    index.setEnabled(true); await until(() => index.status().stage === 'ready')
    assert.deepEqual(calls, ['Public text'])
    assert.equal(currentEmbeddingVectors(['public', 'private', 'trash', 'foreign']).size, 1)
    run('UPDATE logs SET tags = ? WHERE id = ?', ['["new-tag"]', 'public'])
    await until(() => index.status().stage === 'ready'); assert.equal(calls.length, 1)
    run('UPDATE logs SET content = ? WHERE id = ?', ['Changed text', 'public'])
    assert.equal(queryOne('SELECT * FROM note_embeddings WHERE note_id = ?', ['public']), null)
    await until(() => index.status().stage === 'ready'); assert.deepEqual(calls, ['Public text', 'Changed text'])
    index.dispose(); await initDb(root); index = new LocalKnowledgeIndex(fake)
    index.setEnabled(true); await until(() => index.status().stage === 'ready'); assert.equal(calls.length, 2)
    run('UPDATE logs SET is_secret = 1 WHERE id = ?', ['public'])
    assert.equal(queryOne('SELECT * FROM note_embeddings WHERE note_id = ?', ['public']), null)
    await until(() => index.status().stage === 'ready'); assert.equal(currentEmbeddingVectors(['public']).size, 0)
  } finally { index.dispose() }
}))
for (const change of ['secret', 'delete', 'edit'] as const) test(`an in-flight embedding cannot restore stale data after ${change}`, async () => store(async () => {
  let finish: ((value: number[]) => void) | null = null
  const calls: string[] = []
  const index = new LocalKnowledgeIndex({ embed: text => { calls.push(text); return calls.length === 1 ? new Promise(resolve => { finish = resolve }) : Promise.resolve(vector()) }, dispose() {} })
  try {
    seed('changing', 'Originally public'); index.setEnabled(true); await until(() => !!finish)
    if (change === 'secret') run('UPDATE logs SET is_secret = 1 WHERE id = ?', ['changing'])
    else if (change === 'delete') run('UPDATE logs SET deleted_at = 1 WHERE id = ?', ['changing'])
    else run('UPDATE logs SET content = ? WHERE id = ?', ['Latest text', 'changing'])
    finish!(vector()); await until(() => index.status().stage === 'ready')
    if (change === 'edit') {
      assert.deepEqual(calls, ['Originally public', 'Latest text']); assert.equal(currentEmbeddingVectors(['changing']).size, 1)
    } else {
      assert.equal(queryOne('SELECT * FROM note_embeddings WHERE note_id = ?', ['changing']), null)
      assert.equal(index.status().total, 0)
    }
  } finally { index.dispose() }
}))
test('switching data folders cannot write a previous folder’s in-flight result into the new database', async () => store(async root => {
  let finish: ((value: number[]) => void) | null = null
  const index = new LocalKnowledgeIndex({ embed: () => new Promise(resolve => { finish = resolve }), dispose() {} })
  try {
    seed('same-id', 'Previous profile text'); index.setEnabled(true); await until(() => !!finish)
    const destination = path.join(root, 'other-profile'); fs.mkdirSync(destination)
    await initDb(destination); seed('same-id', 'New profile text')
    finish!(vector()); await wait(30)
    assert.equal(queryOne('SELECT * FROM note_embeddings'), null)
  } finally { index.dispose() }
}))
test('failed local inference waits for explicit retry and a valid cache never exposes vectors over the API', async () => store(async () => {
  let failed = false, calls = 0
  const index = new LocalKnowledgeIndex({ embed: async (_text, progress) => { calls++; progress({ stage: 'downloading', progress: 50 }); if (!failed) { failed = true; throw new Error('Synthetic failure') }; return vector() }, dispose() {} })
  try {
    seed('one', 'Document retrieval for grounded answers'); seed('two', 'Search documents before answering')
    index.setEnabled(true); await until(() => index.status().stage === 'error')
    index.touch(); await wait(200); assert.equal(calls, 1)
    index.retry(); await until(() => index.status().stage === 'ready'); assert.equal(calls, 3)
    const app = createApiApp(3848, undefined, undefined, index)
    const result = await (await app.request('http://127.0.0.1:3848/api/knowledge-map')).json() as any
    assert.equal(result.connections.length, 1); assert.equal(result.connections[0].similarity, 1)
    assert.equal(result.notes[0].vector, undefined); assert.equal(result.notes[0].content, undefined)
    assert.equal(result.indexing.stage, 'ready')
    run('UPDATE logs SET deleted_at = 1 WHERE id = ?', ['one'])
    assert.equal(queryOne('SELECT * FROM note_embeddings WHERE note_id = ?', ['one']), null)
    const fresh = await (await app.request('http://127.0.0.1:3848/api/knowledge-map')).json() as any
    assert.equal(fresh.connections.length, 0)
  } finally { index.dispose() }
}))

// These tests exercise retrieval through the API, without network/model downloads.
function cacheNote(id: string, values: number[]) {
  const note = queryOne<any>('SELECT * FROM logs WHERE id = ?', [id])!
  run('INSERT OR REPLACE INTO note_embeddings (note_id, content_hash, model_id, vector, dimensions, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, embeddingHash(embeddingText(note)), EMBEDDING_CACHE_KEY, new Uint8Array(new Float32Array(values).buffer), EMBEDDING_DIMENSIONS, 1])
}
const direction = (x: number) => normalizedVector([x, Math.sqrt(1 - x * x), ...new Array(EMBEDDING_DIMENSIONS - 2).fill(0)])!

test('map semantic search retrieves older related notes beyond the visible 400 and reuses local query vectors', async () => store(async () => {
  let calls = 0
  const index = new LocalKnowledgeIndex({ embed: async () => { calls++; return vector() }, dispose() {} })
  try {
    run("INSERT INTO workspaces (id,user_id,name) VALUES ('semantic-a','local','A'), ('semantic-b','local','B')")
    for (let i = 0; i < 405; i++) {
      const id = `recent-${i}`
      seed(id, 'Garden planting and composting')
      run("UPDATE logs SET workspace_id = 'semantic-a', created_at = ? WHERE id = ?", [100 + i, id])
      cacheNote(id, direction(.1))
    }
    seed('old-server', 'SSH tunnels and remote shell commands')
    run("UPDATE logs SET workspace_id = 'semantic-a' WHERE id = 'old-server'")
    cacheNote('old-server', vector())
    seed('second', 'Secure terminal access'); cacheNote('second', direction(.98))
    run("UPDATE logs SET workspace_id = 'semantic-b' WHERE id = 'second'")
    seed('literal-only', 'How can I connect to a remote machine?'); cacheNote('literal-only', direction(.2))
    seed('private-match', 'Private shell details', 1); cacheNote('private-match', vector())
    seed('trash-match', 'Deleted shell details', 0, 1); cacheNote('trash-match', vector())
    seed('foreign-match', 'Other profile shell details', 0, null, 'foreign'); cacheNote('foreign-match', vector())
    index.setEnabled(true); await until(() => index.status().stage === 'ready')
    assert.equal(calls, 0, 'existing note embeddings are reused')
    const app = createApiApp(3848, undefined, undefined, index)
    const get = async (suffix = '') => (await app.request('http://127.0.0.1:3848/api/knowledge-map' + suffix)).json() as Promise<any>
    assert.equal((await get()).notes.some((note: any) => note.id === 'old-server'), false, 'older match is outside the unfiltered map')
    const query = '?search=' + encodeURIComponent('How can I connect to a remote machine?')
    const found = await get(query)
    assert.deepEqual(found.notes.map((note: any) => note.id), ['old-server', 'second'])
    assert.equal(found.limit, 50); assert.equal(found.total, 2)
    assert.equal(JSON.stringify(found).includes('SSH tunnels'), false, 'bodies and vectors stay private to the server')
    assert.deepEqual((await get(query + '&workspace=semantic-a')).notes.map((note: any) => note.id), ['old-server'])
    assert.equal(calls, 1, 'polling and workspace changes reuse the query embedding')
    assert.equal((await get('?search=%25')).notes.length, 2, 'query text is embedded, never interpreted as SQL wildcards')
    assert.equal(calls, 2)
    assert.equal((await get()).notes.length, 400, 'clearing search restores the normal map')
  } finally { index.dispose() }
}))

test('search and background indexing serialize inference and search failures can be retried', async () => store(async () => {
  let active = 0, maximum = 0, queryCalls = 0
  const calls: string[] = []
  const index = new LocalKnowledgeIndex({ embed: async text => {
    active++; maximum = Math.max(maximum, active); calls.push(text)
    try {
      await wait(25)
      if (text === 'query' && ++queryCalls === 1) throw new Error('Synthetic query error')
      return vector()
    } finally { active-- }
  }, dispose() {} })
  try {
    seed('serial-a', 'First note'); seed('serial-b', 'Second note')
    index.setEnabled(true); await until(() => active === 1)
    await assert.rejects(index.searchVector('query'))
    assert.deepEqual(await index.searchVector('query'), vector())
    await until(() => index.status().stage === 'ready')
    assert.equal(maximum, 1); assert.equal(queryCalls, 2)
    assert.deepEqual(await index.searchVector('query'), vector()); assert.equal(queryCalls, 2)
    assert.ok(calls.includes('Second note'))
  } finally { index.dispose() }
}))

test('search rechecks privacy after inference and cancels when the map is disabled', async () => store(async () => {
  let finish: ((value: number[]) => void) | undefined
  const index = new LocalKnowledgeIndex({ embed: () => new Promise(resolve => { finish = resolve }), dispose() {} })
  try {
    seed('late-private', 'Public before query'); cacheNote('late-private', vector())
    index.setEnabled(true); await until(() => index.status().stage === 'ready')
    const app = createApiApp(3848, undefined, undefined, index)
    const search = () => app.request('http://127.0.0.1:3848/api/knowledge-map?search=question')
    const pending = search(); await until(() => !!finish)
    run("UPDATE logs SET is_secret = 1 WHERE id = 'late-private'")
    finish!(vector())
    const result = await (await pending).json() as any
    assert.deepEqual(result.notes, []); assert.deepEqual(result.connections, [])
    finish = undefined
    const cancelled = index.searchVector('another question'); await until(() => !!finish)
    index.setEnabled(false); finish!(vector())
    await assert.rejects(cancelled, /CANCELLED/)
    assert.equal((await (await search()).json() as any).enabled, false)
  } finally { index.dispose() }
}))

test('detail related notes use the map links, enforce privacy, and never activate a disabled model', async () => store(async () => {
  let calls = 0
  const index = new LocalKnowledgeIndex({ embed: async () => { calls++; return vector() }, dispose() {} })
  try {
    seed('source', 'Original document'); cacheNote('source', vector())
    for (const [id, score] of [['best', .99], ['second-best', .98], ['third-best', .97], ['unrelated', .1]] as const) {
      seed(id, 'Related document ' + id); cacheNote(id, direction(score))
    }
    seed('hidden-related', 'Hidden document', 1); cacheNote('hidden-related', vector())
    seed('deleted-related', 'Deleted document', 0, 1); cacheNote('deleted-related', vector())
    seed('foreign-related', 'Other profile document', 0, null, 'foreign'); cacheNote('foreign-related', vector())
    const app = createApiApp(3848, undefined, undefined, index)
    const get = async (id = 'source') => (await app.request('http://127.0.0.1:3848/api/knowledge-map/related/' + id)).json() as Promise<any>
    assert.deepEqual((await get()).notes, []); assert.equal(calls, 0)
    index.setEnabled(true); await until(() => index.status().stage === 'ready')
    const result = await get()
    assert.deepEqual(result.notes.map((note: any) => note.id), ['best', 'second-best', 'third-best'])
    assert.ok(result.notes[0].similarity > result.notes[1].similarity && result.notes[1].similarity > result.notes[2].similarity)
    assert.equal(result.notes[0].content, undefined); assert.equal(result.notes[0].vector, undefined)
    assert.equal(calls, 0, 'detail recommendations only reuse valid stored vectors')
    for (const id of ['hidden-related', 'deleted-related', 'foreign-related', 'missing']) assert.deepEqual((await get(id)).notes, [])
    run("UPDATE logs SET is_secret = 1 WHERE id = 'best'")
    assert.equal((await get()).notes.some((note: any) => note.id === 'best'), false)
    run("UPDATE logs SET content = 'Updated content' WHERE id = 'source'")
    assert.deepEqual((await get()).notes, [], 'stale source vectors cannot produce recommendations')
    index.setEnabled(false); assert.deepEqual((await get()).notes, [])
  } finally { index.dispose() }
}))

test('image-only notes stay visible and empty text is skipped without breaking the embedding index', async () => store(async () => {
  const calls: string[] = []
  const index = new LocalKnowledgeIndex({ embed: async text => { calls.push(text); return vector() }, dispose() {} })
  try {
    seed('only-image', ''); seed('named-image', '')
    run("UPDATE logs SET log_type = 'screenshot', file_path = 'diagram.png' WHERE id IN ('only-image','named-image')")
    run("UPDATE logs SET title = 'RAG architecture diagram' WHERE id = 'named-image'")
    index.setEnabled(true); await until(() => index.status().stage === 'ready')
    assert.deepEqual(calls, ['RAG architecture diagram'])
    assert.equal(index.status().total, 1)
    const result = await (await createApiApp(3848, undefined, undefined, index).request('http://127.0.0.1:3848/api/knowledge-map')).json() as any
    assert.equal(result.notes.length, 2); assert.equal(result.indexing.stage, 'ready')
    assert.ok(result.notes.every((note: any) => typeof note.imageVersion === 'string'))
    assert.ok(result.notes.every((note: any) => note.file_path === undefined && note.attachments === undefined))
  } finally { index.dispose() }
}))

test('index diagnostics preserve safe failure codes and clear them after retry', async () => store(async () => {
  let fail = true
  const index = new LocalKnowledgeIndex({ embed: async () => {
    if (fail) throw new Error('LOCAL_EMBEDDING_NATIVE_MODULE_LOAD_FAILED')
    return vector()
  }, dispose() {} })
  try {
    seed('diagnostic', 'Local fixture content')
    index.setEnabled(true); await until(() => index.status().stage === 'error')
    assert.equal(index.status().errorCode, 'LOCAL_EMBEDDING_NATIVE_MODULE_LOAD_FAILED')
    fail = false; index.retry(); await until(() => index.status().stage === 'ready')
    assert.equal(index.status().errorCode, undefined)
  } finally { index.dispose() }
}))
