import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { initDb, queryOne, queryAll, run, transaction, getDb } from '../server/db'
import { moveToTrash, restoreTrash, purgeExpiredTrash, permanentlyDelete, TRASH_RETENTION_SECONDS, getTrashRetentionDays } from '../server/trash'
import { normalizeOcrText } from '../shared/ocrText'
import { formatOcrText } from '../server/ocrText'
import { getAiSummaryContent, getAiSummaryTitle, normalizeAiSummaryMarkdown, parseAiSummaryResult } from '../shared/aiSummary'
import { processOcrQueue } from '../server/ocr'
import { imageMediaPaths, managedMediaPath } from '../server/media'
import logs from '../server/routes/logs'
import trash from '../server/routes/trash'
import groups from '../server/routes/groups'
import ai from '../server/routes/ai'
import workspaces from '../server/routes/workspaces'
import settings from '../server/routes/settings'
import { AI_MODELS, DEFAULT_AI_MODELS, getAiModelSelection, type AiProvider } from '../shared/aiModels'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peep-note-test-'))
const app = new Hono().route('/api/logs', logs).route('/api/trash', trash).route('/api/groups', groups).route('/api/workspaces', workspaces).route('/api/ai', ai).route('/api/settings', settings)
const now = Math.floor(Date.now() / 1000)
const screenshot = path.join(root, 'screenshots', 'ocr.png')
const row = (id: string) => queryOne<any>('SELECT * FROM logs WHERE id = ?', [id])
function insert(id: string, extra: Record<string, unknown> = {}) {
  const data = { id, user_id: 'local', title: id, created_at: now, ...extra }
  run(`INSERT INTO logs (${Object.keys(data).join(',')}) VALUES (${Object.keys(data).map(() => '?').join(',')})`, Object.values(data))
}
async function request(url: string, method = 'GET', body?: unknown, _unusedProfile?: string) {
  return app.request(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
async function json(url: string, method = 'GET', body?: unknown, _unusedProfile?: string) {
  const response = await request(url, method, body)
  assert.ok(response.ok, `${method} ${url}: ${response.status} ${response.ok ? '' : await response.text()}`)
  return response.json() as Promise<any>
}
before(async () => {
  fs.mkdirSync(path.dirname(screenshot))
  fs.mkdirSync(path.join(root, 'videos'))
  fs.mkdirSync(path.join(root, 'attachments'))
  fs.copyFileSync(path.join(__dirname, 'fixtures/ocr.png'), screenshot)
  await initDb(root)
})
after(async () => {
  await processOcrQueue()
  getDb().close()
  fs.rmSync(root, { recursive: true, force: true })
})

test('custom and older model IDs survive settings save and reload without preset substitution', async () => {
  for (const provider of Object.keys(AI_MODELS) as AiProvider[]) {
    const model = `${provider}-custom-model-snapshot`
    await json('/api/settings', 'PUT', { ai_provider: provider, ai_model: `  ${model}  ` })
    const saved = await json('/api/settings')
    assert.equal(saved.ai_provider, provider)
    assert.equal(saved.ai_model, model)
    assert.deepEqual(getAiModelSelection(provider, saved.ai_model), { model, custom: true })
    const preset = AI_MODELS[provider][0].value
    assert.deepEqual(getAiModelSelection(provider, preset), { model: preset, custom: false })
    assert.equal(getAiModelSelection(provider, null).model, DEFAULT_AI_MODELS[provider])
  }
  await json('/api/settings', 'PUT', { ai_provider: 'openai', ai_model: 'gpt-4o-mini' })
  assert.deepEqual(getAiModelSelection('openai', (await json('/api/settings')).ai_model), { model: 'gpt-4o-mini', custom: true })
  for (const invalid of ['', '  ', null, 42]) {
    assert.equal((await request('/api/settings', 'PUT', { ai_model: invalid })).status, 400)
    assert.equal((await json('/api/settings')).ai_model, 'gpt-4o-mini')
  }
  await json('/api/settings', 'PUT', { ai_provider: 'gemini' })
  assert.equal((await json('/api/settings')).ai_model, DEFAULT_AI_MODELS.gemini)
  run("DELETE FROM settings WHERE user_id = 'local'")
})

test('AI requests forward preset and custom model IDs, using modern OpenAI parameters and visible response text', async () => {
  insert('model-request-one'); insert('model-request-two')
  const group = await json('/api/groups', 'POST', { name: 'Model requests', log_ids: ['model-request-one', 'model-request-two'] })
  const originalFetch = globalThis.fetch
  try {
    for (const provider of Object.keys(AI_MODELS) as AiProvider[]) {
      const models = [AI_MODELS[provider][0].value, `${provider}-custom-model-snapshot`]
      for (const model of models) {
        await json('/api/settings', 'PUT', { ai_provider: provider, ai_model: model, [`${provider}_api_key`]: 'test-only-placeholder' })
        let calls = 0
        globalThis.fetch = async (url, options) => {
          calls++
          const body = JSON.parse(String(options?.body))
          if (provider === 'gemini') assert.ok(String(url).includes(`/models/${model}:generateContent`))
          else assert.equal(body.model, model)
          if (model === 'gpt-6.1-sol') {
            assert.equal(body.max_completion_tokens, 3000)
            assert.equal(body.reasoning_effort, 'low')
            assert.equal('temperature' in body, false)
            assert.equal('max_tokens' in body, false)
          }
          const content = JSON.stringify({ title: 'Model test', summary: 'Visible summary' })
          return Response.json(provider === 'anthropic'
            ? { content: [{ type: 'thinking', thinking: 'Internal reasoning' }, { type: 'text', text: content }] }
            : provider === 'gemini'
              ? { candidates: [{ content: { parts: [{ thought: true, text: 'Internal reasoning' }, { text: content }] } }] }
              : { choices: [{ message: { content } }] })
        }
        const result = await json('/api/ai/summarize', 'POST', { group_id: group.id })
        assert.equal(calls, 1)
        assert.equal(result.summary, 'Visible summary')
      }
    }
  } finally {
    globalThis.fetch = originalFetch
    run("DELETE FROM settings WHERE user_id = 'local'")
    run('DELETE FROM logs WHERE group_id = ?', [group.id])
    run('DELETE FROM log_groups WHERE id = ?', [group.id])
  }
})

test('AI summaries recover structured content from complete and token-truncated JSON', () => {
  const complete = parseAiSummaryResult('```json\n{"title":"운영 현황","summary":"## 개요\\n\\n- 계정 10명"}\n```')
  assert.deepEqual(complete, {
    title: '운영 현황',
    summary: '## 개요\n\n- 계정 10명',
    structured: true
  })

  const truncated = '{"title":"LMS 운영 현황","summary":"## 1. 전체 현황\\n\\n- 계정: 10명\\n\\n## 2. 권장 사항'
  assert.deepEqual(parseAiSummaryResult(truncated), {
    title: 'LMS 운영 현황',
    summary: '## 1. 전체 현황\n\n- 계정: 10명\n\n## 2. 권장 사항',
    structured: true
  })
  assert.equal(getAiSummaryContent(truncated), '## 1. 전체 현황\n\n- 계정: 10명\n\n## 2. 권장 사항')
  assert.equal(getAiSummaryTitle(truncated, '요약'), 'LMS 운영 현황')
})

test('AI summary markdown restores escaped bold markers', () => {
  const escaped = '현재 자료로는 \\*\\*학생들이 실습을 수행했다\\*\\*는 내용을 구성할 수 있습니다.'
  assert.equal(
    normalizeAiSummaryMarkdown(escaped),
    '현재 자료로는 **학생들이 실습을 수행했다**는 내용을 구성할 수 있습니다.'
  )
  assert.equal(getAiSummaryContent(escaped), '현재 자료로는 **학생들이 실습을 수행했다**는 내용을 구성할 수 있습니다.')
})

test('favorites ignore dates, stay separate from pins, and retain ownership and trash rules', async () => {
  const oldDate = Math.floor(new Date('2020-01-02T12:00:00').getTime() / 1000)
  insert('favorite-old', { created_at: oldDate })
  insert('favorite-pin-only', { pinned: 1 })
  insert('favorite-foreign', { user_id: 'bob', favorite: 1 })
  assert.equal(row('favorite-old').favorite, 0)
  await json('/api/logs/favorite-old', 'PUT', { favorite: 1 })
  assert.equal(row('favorite-old').pinned, 0)
  const favorites = await json('/api/logs?favorite=true&date_from=2026-01-01&date_to=2026-01-02')
  assert.deepEqual(favorites.map((log: any) => log.id), ['favorite-old'])
  assert.equal((await json('/api/logs/favorites/count')).count, 1)
  assert.equal((await json('/api/logs?date_from=2026-01-01&date_to=2026-01-02')).some((log: any) => log.id === 'favorite-old'), false)
  assert.equal((await request('/api/logs/favorite-foreign', 'PUT', { favorite: 0 })).status, 404)
  assert.equal((await app.request('/api/logs/favorites/count')).status, 200)
  await json('/api/logs/favorite-old', 'DELETE')
  assert.equal((await json('/api/logs?favorite=true')).length, 0)
  assert.equal((await json('/api/logs/favorites/count')).count, 0)
  await json('/api/trash/restore', 'POST', { ids: ['favorite-old'] })
  assert.equal((await json('/api/logs/favorites/count')).count, 1)
  await json('/api/logs/favorite-old', 'PUT', { title: 'renamed' })
  assert.equal(row('favorite-old').favorite, 1)
  await json('/api/logs/favorite-old', 'PUT', { favorite: 0 })
  assert.equal((await json('/api/logs/favorites/count')).count, 0)
  run("DELETE FROM logs WHERE id LIKE 'favorite-%'")
})

test('favorites paginate across workspaces and do not search secret contents', async () => {
  transaction(() => {
    for (let i = 0; i < 55; i++) insert(`favorite-page-${i}`, { favorite: 1, workspace_id: i % 2 ? 'first' : 'second', created_at: now - i })
    insert('favorite-secret', { favorite: 1, is_secret: 1, content: 'private-favorite-content', created_at: now - 100 })
  })
  const first = await json('/api/logs?favorite=true&limit=50')
  const second = await json('/api/logs?favorite=true&limit=50&page=2')
  assert.equal(first.length, 50)
  assert.equal(second.length, 6)
  assert.equal(new Set([...first, ...second].map((log: any) => log.id)).size, 56)
  assert.equal(new Set(first.map((log: any) => log.workspace_id)).size, 2)
  assert.equal((await json('/api/logs?favorite=true&search=private-favorite-content')).length, 0)
  assert.equal((await json('/api/logs?favorite=true&search=favorite-secret'))[0].is_secret, true)
  run("DELETE FROM logs WHERE id LIKE 'favorite-%'")
})

test('trash retains media/comments, hides normal views, checks ownership, and restores', async () => {
  insert('capture', { log_type: 'screenshot', file_path: screenshot, ocr_status: 'done', ocr_text: 'findable' })
  await json('/api/logs/capture/comments', 'POST', { content: 'keep this comment' })
  await json('/api/logs/capture', 'DELETE')
  assert.ok(row('capture').deleted_at)
  assert.ok(fs.existsSync(screenshot))
  assert.equal((await request('/api/logs/capture')).status, 404)
  assert.equal((await json('/api/logs?search=findable')).length, 0)
  assert.equal((await json('/api/logs/stats/dates')).length, 0)
  assert.equal((await json('/api/logs/stats/types')).length, 0)
  assert.equal((await request('/api/logs/capture/comments')).status, 404)
  const items = await json('/api/trash')
  assert.equal(items.length, 1)
  assert.equal(items[0].expires_at - items[0].deleted_at, TRASH_RETENTION_SECONDS)
  for (const key of ['content', 'file_path', 'attachments', 'ocr_text']) assert.equal(key in items[0], false)
  insert('foreign-trash', { user_id: 'bob', deleted_at: now })
  assert.equal((await json('/api/trash')).some((item: any) => item.id === 'foreign-trash'), false)
  assert.equal((await json('/api/trash/restore', 'POST', { ids: ['foreign-trash'] })).restored, 0)
  assert.equal((await json('/api/trash/purge', 'POST', { ids: ['foreign-trash'] })).deleted, 0)
  assert.equal((await json('/api/trash/restore', 'POST', { ids: ['capture'] })).restored, 1)
  assert.equal((await json('/api/logs/capture/comments'))[0].content, 'keep this comment')
  assert.equal((await json('/api/logs?search=findable'))[0].id, 'capture')
})

test('bulk and group deletion can be restored with group membership', async () => {
  insert('g1'); insert('g2'); insert('foreign', { user_id: 'bob' })
  const group = await json('/api/groups', 'POST', { name: 'Example', log_ids: ['g1', 'g2'] })
  await json(`/api/groups/${group.id}`, 'DELETE')
  assert.equal((await json('/api/groups')).length, 0)
  assert.equal((await json('/api/trash/restore', 'POST', { ids: ['g1', 'g2'] })).restored, 2)
  assert.equal((await json('/api/groups'))[0].logs.length, 2)
  assert.equal(row('g1').group_id, group.id)
  assert.equal((await json('/api/logs/bulk-delete', 'POST', { ids: ['g1', 'g1', 'foreign'] })).deleted, 1)
  assert.equal(row('foreign').deleted_at, null)
  restoreTrash('local', ['g1'])
  insert('summary', { group_id: group.id, log_type: 'summary' })
  await json(`/api/groups/${group.id}/ungroup`, 'POST')
  assert.ok(row('summary').deleted_at)
  assert.equal(row('g1').deleted_at, null)
  assert.equal(row('g1').group_id, null)
  assert.equal(row('summary').group_id, null)
})

test('permanent cleanup protects shared and unmanaged files; expired trash is purged', async () => {
  const shared = path.join(root, 'screenshots/shared.png')
  const outside = path.join(root, 'private.txt')
  fs.writeFileSync(shared, 'shared'); fs.writeFileSync(outside, 'untouched')
  insert('share1', { file_path: shared }); insert('share2', { attachments: JSON.stringify([shared]) })
  moveToTrash('local', ['share1'])
  assert.equal(permanentlyDelete('id = ?', ['share1']), 1)
  assert.ok(fs.existsSync(shared))
  moveToTrash('local', ['share2'])
  await json('/api/trash/purge', 'POST', { ids: ['share2'] })
  assert.equal(fs.existsSync(shared), false)
  insert('outside', { file_path: outside })
  moveToTrash('local', ['outside'])
  permanentlyDelete('id = ?', ['outside'])
  assert.ok(fs.existsSync(outside))
  if (process.platform !== 'win32') {
    const link = path.join(root, 'screenshots/link')
    fs.symlinkSync(outside, link)
    insert('symlink', { file_path: link }); moveToTrash('local', ['symlink'])
    permanentlyDelete('id = ?', ['symlink'])
    assert.ok(fs.existsSync(outside))
  }
  insert('expired', { deleted_at: now - TRASH_RETENTION_SECONDS - 1 })
  assert.equal(restoreTrash('local', ['expired']), 0)
  assert.equal(purgeExpiredTrash(), 1)
  assert.equal(row('expired'), null)
})

test('general file attachments stay managed, skip OCR, and clean up after removal', async () => {
  const attachmentFolder = path.join(root, 'attachments', 'one')
  const document = path.join(attachmentFolder, 'manual.pdf')
  fs.mkdirSync(attachmentFolder)
  fs.writeFileSync(document, 'not an image')
  insert('file-attachment', { attachments: JSON.stringify([document]) })

  assert.equal(managedMediaPath(document), fs.realpathSync(document))
  assert.deepEqual(imageMediaPaths({ attachments: JSON.stringify([document, screenshot]) }), [screenshot])
  assert.equal((await request('/api/logs/file-attachment/ocr', 'POST')).status, 400)

  await json('/api/logs/file-attachment', 'PUT', { attachments: [] })
  assert.equal(fs.existsSync(document), false)
  assert.equal(fs.existsSync(attachmentFolder), false)
  run("DELETE FROM logs WHERE id = 'file-attachment'")
})

test('search finds attachment and media filenames without exposing secret filenames', async () => {
  insert('filename-attachment', { attachments: JSON.stringify(['/managed/files/quarterly-plan-final.pdf']) })
  insert('filename-companion')
  insert('filename-media', { log_type: 'video', file_path: '/managed/videos/product-demo-october.webm' })
  insert('filename-secret', { is_secret: 1, attachments: JSON.stringify(['/managed/files/private-budget.xlsx']) })
  const group = await json('/api/groups', 'POST', { name: 'Filename group', log_ids: ['filename-attachment', 'filename-companion'] })

  assert.deepEqual((await json('/api/logs?search=quarterly-plan')).map((log: any) => log.id), ['filename-attachment'])
  assert.deepEqual((await json('/api/logs?search=product-demo-october')).map((log: any) => log.id), ['filename-media'])
  assert.equal((await json('/api/logs?search=private-budget')).length, 0)
  assert.equal((await json('/api/groups?search=quarterly-plan'))[0].id, group.id)

  run("DELETE FROM logs WHERE id LIKE 'filename-%'")
  run('DELETE FROM log_groups WHERE id = ?', [group.id])
})

test('workspace removal and interrupted indexing restore safely', async () => {
  run("INSERT INTO workspaces (id, user_id, name, is_default) VALUES ('default', 'local', 'General', 1), ('extra', 'local', 'Extra', 0)")
  insert('workspace-record', { workspace_id: 'extra', ocr_status: 'processing' })
  moveToTrash('local', ['workspace-record'])
  await json('/api/workspaces/extra', 'DELETE')
  restoreTrash('local', ['workspace-record'])
  assert.equal(row('workspace-record').workspace_id, 'default')
  assert.equal(row('workspace-record').ocr_status, 'idle')
})

test('records move only to owned workspaces and detach from their previous group', async () => {
  run("INSERT INTO workspaces (id, user_id, name, is_default) VALUES ('move-target', 'local', 'Target', 0), ('foreign-workspace', 'bob', 'Private', 0)")
  run("INSERT INTO log_groups (id, user_id, name, workspace_id) VALUES ('move-group', 'local', 'Move group', 'default')")
  insert('move-record', { workspace_id: 'default', group_id: 'move-group' })

  const moved = await json('/api/logs/move-record/move', 'POST', { workspace_id: 'move-target' })
  assert.equal(moved.workspace_id, 'move-target')
  assert.equal(moved.group_id, null)
  assert.equal(row('move-record').workspace_id, 'move-target')
  assert.equal((await json('/api/logs?workspace_id=move-target')).some((log: any) => log.id === 'move-record'), true)
  assert.equal((await request('/api/logs/move-record/move', 'POST', { workspace_id: 'foreign-workspace' })).status, 404)
  assert.equal((await request('/api/logs/move-record/move', 'POST', { workspace_id: 'missing' })).status, 404)
  assert.equal((await request('/api/logs/move-record/move', 'POST', { workspace_id: 'foreign-workspace' }, 'bob')).status, 404)

  run("DELETE FROM logs WHERE id = 'move-record'")
  run("DELETE FROM log_groups WHERE id = 'move-group'")
  run("DELETE FROM workspaces WHERE id IN ('move-target', 'foreign-workspace')")
})

test('checked records and groups move together while preserving group structure', async () => {
  run("INSERT INTO workspaces (id, user_id, name, is_default) VALUES ('bulk-target', 'local', 'Bulk target', 0), ('bulk-foreign-target', 'bob', 'Private', 0)")
  run("INSERT INTO log_groups (id, user_id, name, workspace_id) VALUES ('bulk-move-group', 'local', 'Bulk group', 'default')")
  insert('bulk-move-log', { workspace_id: 'default' })
  insert('bulk-move-group-one', { workspace_id: 'default', group_id: 'bulk-move-group' })
  insert('bulk-move-group-summary', { workspace_id: 'default', group_id: 'bulk-move-group', log_type: 'summary' })
  insert('bulk-move-foreign', { user_id: 'bob', workspace_id: 'bulk-foreign-target' })

  const moved = await json('/api/logs/bulk-move', 'POST', {
    log_ids: ['bulk-move-log', 'bulk-move-log', 'bulk-move-foreign'],
    group_ids: ['bulk-move-group'],
    workspace_id: 'bulk-target'
  })
  assert.deepEqual(moved, { ok: true, logs: 1, groups: 1 })
  assert.equal(row('bulk-move-log').workspace_id, 'bulk-target')
  assert.equal(row('bulk-move-group-one').workspace_id, 'bulk-target')
  assert.equal(row('bulk-move-group-summary').workspace_id, 'bulk-target')
  assert.equal(row('bulk-move-group-one').group_id, 'bulk-move-group')
  assert.equal(queryOne<any>("SELECT workspace_id FROM log_groups WHERE id = 'bulk-move-group'")!.workspace_id, 'bulk-target')
  assert.equal(row('bulk-move-foreign').workspace_id, 'bulk-foreign-target')
  assert.equal((await request('/api/logs/bulk-move', 'POST', { log_ids: ['bulk-move-log'], group_ids: [], workspace_id: 'bulk-foreign-target' })).status, 404)
  assert.equal((await request('/api/logs/bulk-move', 'POST', { log_ids: [], group_ids: [], workspace_id: 'bulk-target' })).status, 400)

  run("DELETE FROM logs WHERE id LIKE 'bulk-move-%'")
  run("DELETE FROM log_groups WHERE id = 'bulk-move-group'")
  run("DELETE FROM workspaces WHERE id IN ('bulk-target', 'bulk-foreign-target')")
})

test('empty trash affects only current user; transactions roll back', async () => {
  insert('local-trash'); insert('bob-trash', { user_id: 'bob' })
  moveToTrash('local', ['local-trash']); moveToTrash('bob', ['bob-trash'])
  await json('/api/trash', 'DELETE')
  assert.equal(row('local-trash'), null)
  assert.ok(row('bob-trash'))
  assert.throws(() => transaction(() => { insert('rollback'); throw new Error('test rollback') }))
  assert.equal(row('rollback'), null)
  assert.equal((await app.request('/api/trash')).status, 200)
})

test('date filtering precedes pagination and OCR never matches secret content', async () => {
  transaction(() => {
    for (let i = 0; i < 60; i++) insert(`new-${i}`, { created_at: now + 86400 })
    insert('old-match', { created_at: 1704067200, ocr_text: 'needle', ocr_status: 'done' })
    insert('secret', { is_secret: 1, content: 'hidden-word', ocr_text: 'hidden-word', attachments: JSON.stringify([screenshot]) })
  })
  const results = await json('/api/logs?date_from=2023-12-31&date_to=2024-01-02')
  assert.equal(results.length, 1)
  assert.equal(results[0].id, 'old-match')
  assert.equal((await json('/api/logs?search=needle'))[0].id, 'old-match')
  assert.equal((await json('/api/logs?search=hidden-word')).length, 0)
  assert.equal((await request('/api/logs/secret/ocr', 'POST')).status, 404)
  const first = await json('/api/logs?limit=50&page=1&sort=recent')
  const second = await json('/api/logs?limit=50&page=2&sort=recent')
  assert.equal(first.length, 50)
  assert.ok(second.length)
  assert.ok(second.every((r: any) => !first.some((l: any) => l.id === r.id)))
})

test('Korean/English OCR runs only for explicitly requested images', { timeout: 120000 }, async () => {
  insert('ocr-image', { log_type: 'screenshot', file_path: screenshot })
  insert('ocr-attachment', { attachments: JSON.stringify([screenshot]) })
  insert('ocr-trashed', { log_type: 'screenshot', file_path: screenshot, deleted_at: now })
  const created = await json('/api/logs', 'POST', { log_type: 'screenshot', file_path: screenshot })
  await processOcrQueue()
  assert.equal(row(created.id).ocr_status, 'idle')
  assert.equal(row('ocr-image').ocr_status, 'idle')
  assert.equal(row('ocr-attachment').ocr_status, 'idle')
  assert.equal(fs.existsSync(path.join(root, 'ocr-models')), false)
  await json('/api/logs/ocr-image/ocr', 'POST')
  await processOcrQueue()
  assert.equal(row('ocr-attachment').ocr_status, 'idle')
  assert.equal(row(created.id).ocr_status, 'idle')
  await json('/api/logs/ocr-attachment/ocr', 'POST')
  await processOcrQueue()
  for (const id of ['ocr-image', 'ocr-attachment']) {
    assert.equal(row(id).ocr_status, 'done')
    assert.match(row(id).ocr_text, /12345/)
    assert.match(row(id).ocr_text.replace(/\s/g, ''), /검색/)
  }
  assert.equal(row('secret').ocr_status, 'idle')
  assert.equal(row('ocr-trashed').ocr_status, 'idle')
  const results = await json('/api/logs?search=' + encodeURIComponent('검색'))
  assert.equal(results.length, 2)
  const group = await json('/api/groups', 'POST', { name: 'OCR Group', log_ids: ['ocr-image', 'ocr-attachment'] })
  assert.equal((await json('/api/groups?search=12345'))[0].id, group.id)
  // Changing an image clears stale searchable text and supports manual retry.
  await json('/api/logs/ocr-image', 'PUT', { file_path: path.join(root, 'screenshots/missing.png') })
  assert.equal(row('ocr-image').ocr_text, '')
  await processOcrQueue()
  assert.equal(row('ocr-image').ocr_status, 'idle')
  await json('/api/logs/ocr-image/ocr', 'POST')
  await processOcrQueue()
  assert.equal(row('ocr-image').ocr_status, 'error')
  await json('/api/logs/ocr-image', 'PUT', { file_path: screenshot })
  await json('/api/logs/ocr-image/ocr', 'POST')
  await processOcrQueue()
  assert.equal(row('ocr-image').ocr_status, 'done')
  await json('/api/logs/ocr-image', 'PUT', { is_secret: true })
  assert.equal(row('ocr-image').ocr_text, '')
})


test('deleting a group during AI processing does not recreate active records', async () => {
  insert('ai-one'); insert('ai-two')
  const group = await json('/api/groups', 'POST', { name: 'AI test', log_ids: ['ai-one', 'ai-two'] })
  run("INSERT INTO settings (user_id, openai_api_key) VALUES ('local', 'test-only-placeholder')")
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    moveToTrash('local', ['ai-one', 'ai-two'])
    return Response.json({ choices: [{ message: { content: '{"title":"Test","summary":"Test"}' } }] })
  }
  try {
    assert.equal((await request('/api/ai/summarize', 'POST', { group_id: group.id })).status, 409)
    assert.equal(queryAll("SELECT id FROM logs WHERE group_id = ? AND deleted_at IS NULL", [group.id]).length, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('AI summaries stay in their group workspace', async () => {
  run("INSERT INTO workspaces (id, user_id, name, is_default) VALUES ('ai-workspace', 'local', 'AI Workspace', 0)")
  insert('ai-workspace-one', { workspace_id: 'ai-workspace' })
  insert('ai-workspace-two', { workspace_id: 'ai-workspace' })
  const group = await json('/api/groups', 'POST', {
    name: 'Workspace summary',
    log_ids: ['ai-workspace-one', 'ai-workspace-two'],
    workspace_id: 'ai-workspace'
  })
  run("INSERT INTO settings (user_id, ai_provider, openai_api_key) VALUES ('local', 'openai', 'test-only-placeholder') ON CONFLICT(user_id) DO UPDATE SET ai_provider = 'openai', openai_api_key = 'test-only-placeholder'")
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '{"title":"Workspace Test","summary":"Summary"}' } }] })
  try {
    await json('/api/ai/summarize', 'POST', { group_id: group.id })
    const summary = queryOne<any>("SELECT * FROM logs WHERE group_id = ? AND log_type = 'summary'", [group.id])
    assert.equal(summary.workspace_id, 'ai-workspace')
    assert.equal((await json('/api/logs?workspace_id=ai-workspace')).some((log: any) => log.id === summary.id), true)
    assert.equal((await json('/api/logs?workspace_id=default')).some((log: any) => log.id === summary.id), false)
  } finally { globalThis.fetch = originalFetch }
})


test('restart cancels old automatic jobs without extracting images', async () => {
  await processOcrQueue()
  insert('legacy-pending', { log_type: 'screenshot', file_path: screenshot, ocr_status: 'pending' })
  insert('interrupted', { log_type: 'screenshot', file_path: screenshot, ocr_status: 'processing' })
  run("INSERT INTO workspaces (id, user_id, name, is_default) VALUES ('summary-migration-workspace', 'local', 'Migrated summaries', 0)")
  run("INSERT INTO log_groups (id, user_id, name, workspace_id) VALUES ('summary-migration-group', 'local', 'Migrated group', 'summary-migration-workspace')")
  insert('summary-migration-log', { log_type: 'summary', group_id: 'summary-migration-group', workspace_id: null })
  getDb().close()
  await initDb(root)
  await processOcrQueue()
  assert.equal(row('legacy-pending').ocr_status, 'idle')
  assert.equal(row('interrupted').ocr_status, 'idle')
  assert.equal(row('legacy-pending').ocr_text, '')
  assert.equal(row('summary-migration-log').workspace_id, 'summary-migration-workspace')
  assert.match(row('ocr-attachment').ocr_text, /12345/)
})


test('OCR removes forced breaks across lines, paragraphs and blocks', () => {
  const blocks = [{ paragraphs: [
    { text: '', lines: [{ text: '이미지 상세화면에서' }, { text: '텍스트 추출 버튼을 누르세요.' }] },
    { text: '', lines: [{ text: '1. 첫 번째 항목' }, { text: '설명입니다.' }, { text: '2. 두 번째 항목' }] }
  ] }]
  assert.equal(formatOcrText('', blocks), '이미지 상세화면에서 텍스트 추출 버튼을 누르세요. 1. 첫 번째 항목 설명입니다. 2. 두 번째 항목')
  assert.equal(formatOcrText('Hello\nworld.\n\nNext paragraph.'), 'Hello world. Next paragraph.')
  assert.equal(formatOcrText('', []), '')
})


test('previously saved OCR results display without forced line breaks or re-extraction', () => {
  const saved = '  이미지 상세화면의 텍스트 추출\r\n\r\n버튼을 눌렀을 때만\n추출하도록\n\n수정했습니다.\u2028자동 추출은 제거했습니다.  '
  assert.equal(normalizeOcrText(saved), '이미지 상세화면의 텍스트 추출 버튼을 눌렀을 때만 추출하도록 수정했습니다. 자동 추출은 제거했습니다.')
  assert.equal(normalizeOcrText(''), '')
  assert.equal(formatOcrText('', [
    { paragraphs: [{ text: '서로 다른 블록도' }] },
    { paragraphs: [{ text: '하나의 흐름으로 표시합니다.' }] }
  ]), '서로 다른 블록도 하나의 흐름으로 표시합니다.')
})


test('deleting OCR text removes search matches and preserves the original image', async () => {
  insert('clear-ocr', { log_type: 'screenshot', file_path: screenshot, content: 'keep description', ocr_status: 'done', ocr_text: 'unique-extracted-phrase' })
  assert.equal((await json('/api/logs?search=unique-extracted-phrase')).length, 1)
  assert.equal((await request('/api/logs/unknown-ocr/ocr', 'DELETE')).status, 404)
  assert.equal(row('clear-ocr').ocr_status, 'done')
  await json('/api/logs/clear-ocr/ocr', 'DELETE')
  assert.equal(row('clear-ocr').ocr_text, '')
  assert.equal(row('clear-ocr').ocr_status, 'idle')
  assert.equal(row('clear-ocr').deleted_at, null)
  assert.equal(row('clear-ocr').content, 'keep description')
  assert.equal(row('clear-ocr').file_path, screenshot)
  assert.ok(fs.existsSync(screenshot))
  assert.equal((await json('/api/logs?search=unique-extracted-phrase')).length, 0)
  await processOcrQueue()
  assert.equal(row('clear-ocr').ocr_status, 'idle')
  await json('/api/logs/clear-ocr/ocr', 'POST')
  assert.equal((await request('/api/logs/clear-ocr/ocr', 'DELETE')).status, 409)
  await processOcrQueue()
  assert.equal(row('clear-ocr').ocr_status, 'done')
})


test('trash shows owned workspace names and live counts with a ten-day expiry', async () => {
  assert.equal(TRASH_RETENTION_SECONDS, 10 * 86400)
  run("INSERT INTO workspaces (id, user_id, name, is_default) VALUES ('trash-project', 'local', '프로젝트', 0), ('bob-private', 'bob', 'Private workspace', 0)")
  insert('badge-project', { workspace_id: 'trash-project' })
  insert('badge-general')
  insert('badge-foreign', { workspace_id: 'bob-private' })
  const before = (await json('/api/trash/count')).count
  moveToTrash('local', ['badge-project', 'badge-general', 'badge-foreign'])
  let entries = await json('/api/trash')
  assert.equal(entries.find((item: any) => item.id === 'badge-project').workspace_name, '프로젝트')
  assert.equal(entries.find((item: any) => item.id === 'badge-project').workspace_is_default, false)
  assert.equal(entries.find((item: any) => item.id === 'badge-general').workspace_name, 'General')
  assert.equal(entries.find((item: any) => item.id === 'badge-general').workspace_is_default, true)
  assert.equal(entries.find((item: any) => item.id === 'badge-foreign').workspace_name, 'General')
  assert.equal(entries.find((item: any) => item.id === 'badge-foreign').workspace_is_default, true)
  assert.equal((await json('/api/trash/count')).count, before + 3)
  await json('/api/trash/restore', 'POST', { ids: ['badge-project'] })
  assert.equal((await json('/api/trash/count')).count, before + 2)
  insert('ten-days-expired', { deleted_at: now - 10 * 86400 })
  insert('ten-days-valid', { deleted_at: now - 10 * 86400 + 120 })
  entries = await json('/api/trash')
  assert.ok(!entries.some((item: any) => item.id === 'ten-days-expired'))
  assert.ok(entries.some((item: any) => item.id === 'ten-days-valid'))
  assert.equal((await json('/api/trash/count')).count, before + 3)
  assert.equal((await app.request('/api/trash/count')).status, 200)
})

test('trash retention defaults to ten days, persists supported options, and rejects invalid settings', async () => {
  run("DELETE FROM settings WHERE user_id IN ('local', 'bob')")
  assert.equal((await json('/api/settings')).trash_retention_days, 10)
  assert.equal((await json('/api/trash/retention')).days, 10)
  for (const days of [7, 10, 30, 90]) {
    assert.equal((await json('/api/settings', 'PUT', { trash_retention_days: days })).trash_retention_days, days)
    assert.equal((await json('/api/settings')).trash_retention_days, days)
    assert.equal((await json('/api/trash/retention')).days, days)
  }
  await json('/api/settings', 'PUT', { language: 'ko' })
  assert.equal((await json('/api/settings')).trash_retention_days, 90)
  for (const invalid of [0, -1, 1, 365, 7.5, '30', null]) {
    assert.equal((await request('/api/settings', 'PUT', { trash_retention_days: invalid, language: 'en' })).status, 400)
    const saved = await json('/api/settings')
    assert.equal(saved.trash_retention_days, 90)
    assert.equal(saved.language, 'ko')
  }
  assert.equal(getTrashRetentionDays('bob'), 10)
  assert.equal((await app.request('/api/trash/retention')).status, 200)
  await initDb(root)
  assert.equal((await json('/api/settings')).trash_retention_days, 90)
  await json('/api/settings', 'PUT', { trash_retention_days: 10 })
})

test('trash expiry, metadata, and restore follow the local retention setting and isolated legacy rows', async () => {
  const current = Math.floor(Date.now() / 1000)
  await json('/api/settings', 'PUT', { trash_retention_days: 30 })
  run("INSERT INTO settings (user_id, trash_retention_days) VALUES ('bob', 7) ON CONFLICT(user_id) DO UPDATE SET trash_retention_days = 7")
  insert('retention-local', { deleted_at: current - 15 * 86400 })
  insert('retention-local-expired', { deleted_at: current - 30 * 86400 })
  insert('retention-bob-expired', { user_id: 'bob', deleted_at: current - 8 * 86400 })
  insert('retention-bob-valid', { user_id: 'bob', deleted_at: current - 7 * 86400 + 120 })
  const entries = await json('/api/trash')
  const item = entries.find((entry: any) => entry.id === 'retention-local')
  assert.equal(item.expires_at - item.deleted_at, 30 * 86400)
  assert.equal(row('retention-local-expired'), null)
  // Viewing one user's trash must not run another user's cleanup.
  assert.ok(row('retention-bob-expired'))
  assert.equal(restoreTrash('bob', ['retention-bob-expired']), 0)
  assert.equal(restoreTrash('bob', ['retention-local']), 0)
  assert.equal(restoreTrash('local', ['retention-local']), 1)
  purgeExpiredTrash()
  assert.equal(row('retention-bob-expired'), null)
  assert.ok(row('retention-bob-valid').deleted_at)
  assert.equal(restoreTrash('bob', ['retention-bob-valid']), 1)
  await json('/api/settings', 'PUT', { trash_retention_days: 10 })
  run("UPDATE settings SET trash_retention_days = 10 WHERE user_id = 'bob'")
})

test('changing retention recalculates existing trash from its original deletion date', async () => {
  const current = Math.floor(Date.now() / 1000)
  await json('/api/settings', 'PUT', { trash_retention_days: 30 })
  insert('retention-change', { deleted_at: current - 20 * 86400 })
  const original = row('retention-change').deleted_at
  await json('/api/settings', 'PUT', { trash_retention_days: 90 })
  let entries = await json('/api/trash')
  assert.equal(entries.find((entry: any) => entry.id === 'retention-change').expires_at, original + 90 * 86400)
  await json('/api/settings', 'PUT', { trash_retention_days: 7 })
  assert.equal(row('retention-change').deleted_at, original)
  entries = await json('/api/trash')
  assert.ok(!entries.some((entry: any) => entry.id === 'retention-change'))
  assert.equal(row('retention-change'), null)
  assert.equal(restoreTrash('local', ['retention-change']), 0)
  await json('/api/settings', 'PUT', { trash_retention_days: 10 })
})
