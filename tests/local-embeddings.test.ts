import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initDb, queryOne, run } from '../server/db'
import { LocalKnowledgeIndex, currentEmbeddingVectors } from '../server/knowledgeIndex'
import { embeddingText } from '../server/embeddingText'
import { EMBEDDING_DIMENSIONS } from '../shared/localEmbeddings'
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
