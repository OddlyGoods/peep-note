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
test('local index caches vectors across restarts, ignores metadata edits, and re-embeds changed content', async () => store(async root => {
  const calls: string[] = []
  const fake: LocalEmbedder = { embed: async text => { calls.push(text); return vector() }, dispose() {} }
  let index = new LocalKnowledgeIndex(fake)
  try {
    seed('public', 'Public text'); seed('private', 'private-excluded', 1); seed('trash', 'trash-excluded', 0, 1); seed('foreign', 'foreign-excluded', 0, null, 'foreign')
    index.touch(); await until(() => index.status().stage === 'ready')
    assert.deepEqual(calls, ['Public text'])
    assert.equal(currentEmbeddingVectors(['public', 'private', 'trash', 'foreign']).size, 1)
    run('UPDATE logs SET tags = ? WHERE id = ?', ['["new-tag"]', 'public'])
    await until(() => index.status().stage === 'ready'); assert.equal(calls.length, 1)
    run('UPDATE logs SET content = ? WHERE id = ?', ['Changed text', 'public'])
    assert.equal(queryOne('SELECT * FROM note_embeddings WHERE note_id = ?', ['public']), null)
    await until(() => index.status().stage === 'ready'); assert.deepEqual(calls, ['Public text', 'Changed text'])
    index.dispose(); await initDb(root); index = new LocalKnowledgeIndex(fake)
    index.touch(); await until(() => index.status().stage === 'ready'); assert.equal(calls.length, 2)
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
    seed('changing', 'Originally public'); index.touch(); await until(() => !!finish)
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
    seed('same-id', 'Previous profile text'); index.touch(); await until(() => !!finish)
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
    index.touch(); await until(() => index.status().stage === 'error')
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
