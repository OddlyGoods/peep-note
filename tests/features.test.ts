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
import { imageMediaPaths, managedMediaPath, readableMediaPath } from '../server/media'
import { attachmentReference } from '../shared/attachments'
import logs from '../server/routes/logs'
import trash from '../server/routes/trash'
import groups from '../server/routes/groups'
import ai from '../server/routes/ai'
import workspaces from '../server/routes/workspaces'
import settings from '../server/routes/settings'
import { AI_MODELS, DEFAULT_AI_MODELS, getAiModels, getAiModelSelection, type AiProvider } from '../shared/aiModels'

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
    assert.equal(saved.ai_models[provider], model)
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
  assert.equal((await json('/api/settings')).ai_model, 'gemini-custom-model-snapshot')
  run("DELETE FROM settings WHERE user_id = 'local'")
})

test('provider models survive switches, inactive edits and unrelated settings saves', async () => {
  assert.deepEqual((await json('/api/settings')).ai_models, DEFAULT_AI_MODELS)
  await json('/api/settings', 'PUT', { ai_provider: 'openai', ai_model: 'gpt-6.1-sol' })
  await json('/api/settings', 'PUT', { ai_provider: 'qwen', ai_model: 'qwen3.8-flash' })
  await json('/api/settings', 'PUT', { ai_models: { anthropic: 'custom-claude-snapshot' } })
  await json('/api/settings', 'PUT', { language: 'en' })
  const saved = await json('/api/settings')
  assert.equal(saved.ai_provider, 'qwen')
  assert.equal(saved.ai_model, 'qwen3.8-flash')
  assert.equal(saved.ai_models.openai, 'gpt-6.1-sol')
  assert.equal(saved.ai_models.anthropic, 'custom-claude-snapshot')
  assert.deepEqual(JSON.parse(queryOne<any>("SELECT ai_models FROM settings WHERE user_id = 'local'")!.ai_models), saved.ai_models)
  await json('/api/settings', 'PUT', { ai_provider: 'openai' })
  assert.equal((await json('/api/settings')).ai_model, 'gpt-6.1-sol')
  await json('/api/settings', 'PUT', { ai_provider: 'qwen' })
  assert.equal((await json('/api/settings')).ai_model, 'qwen3.8-flash')
  for (const invalid of [null, [], 'bad', { openai: '' }, { openai: 42 }, { unsupported: 'model' }]) {
    assert.equal((await request('/api/settings', 'PUT', { ai_models: invalid })).status, 400)
    assert.deepEqual((await json('/api/settings')).ai_models, saved.ai_models)
  }
  run("DELETE FROM settings WHERE user_id = 'local'")
})

test('legacy model settings remain usable when per-provider preferences are missing or malformed', () => {
  for (const previous of [null, undefined, '{}', 'broken JSON', { openai: 42, qwen: ' ' }]) {
    assert.deepEqual(getAiModels(previous, 'openai', '  legacy-custom-model  '), { ...DEFAULT_AI_MODELS, openai: 'legacy-custom-model' })
  }
  assert.equal(getAiModels('{"openai":"gpt-6.1-sol"}', 'qwen', 'custom-qwen').openai, 'gpt-6.1-sol')
})

test('AI connection tests use unsaved input without changing saved settings or creating a note', async () => {
  const saved = await json('/api/settings')
  const count = queryAll('SELECT id FROM logs').length
  const original = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions')
    const body = JSON.parse(String(options?.body))
    assert.equal(body.model, 'draft-model')
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply with OK.' }])
    return Response.json({ choices: [{ message: { content: 'OK' } }] })
  }
  try {
    const result = await json('/api/ai/test-connection', 'POST', { provider: 'qwen', model: 'draft-model', apiKey: 'test-key', baseUrl: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' })
    assert.equal(result.ok, true)
    assert.deepEqual(await json('/api/settings'), saved)
    assert.equal(queryAll('SELECT id FROM logs').length, count)
  } finally { globalThis.fetch = original }
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

test('AI summary title and prose follow the active language across all providers with saved/default fallbacks', async () => {
  insert('language-one', { title: 'RAG pipeline', content: 'Retrieve relevant chunks. Keep `source_id` and https://example.com/docs unchanged.' })
  insert('language-two', { title: '원문 메모', content: '문서를 나누고 검색합니다.' })
  const group = await json('/api/groups', 'POST', { name: 'Language test', log_ids: ['language-one', 'language-two'] })
  const originalFetch = globalThis.fetch
  const languages = {
    en: { name: 'English', title: 'RAG notes', summary: '## Overview\nRetrieve relevant chunks.' },
    ko: { name: 'Korean', title: 'RAG 메모', summary: '## 개요\n관련 청크를 검색합니다.' },
    ja: { name: 'Japanese', title: 'RAGメモ', summary: '## 概要\n関連するチャンクを検索します。' },
    zh: { name: 'Simplified Chinese', title: 'RAG 笔记', summary: '## 概述\n检索相关片段。' }
  } as const
  let expectedLanguage: keyof typeof languages = 'en'
  let omitTitle = false
  let calls = 0
  try {
    for (const provider of Object.keys(AI_MODELS) as AiProvider[]) {
      globalThis.fetch = async (_url, options) => {
        calls++
        const body = JSON.parse(String(options?.body))
        const prompt = provider === 'gemini' ? body.system_instruction.parts[0].text
          : provider === 'anthropic' ? body.system : body.messages[0].content
        const parts = provider === 'gemini' ? body.contents[0].parts
          : provider === 'anthropic' ? body.messages[0].content : body.messages[1].content
        assert.ok(prompt.includes(`in ${languages[expectedLanguage].name} (${expectedLanguage}), regardless of the language of the source records`))
        assert.ok(prompt.includes('Keep code, commands, URLs, identifiers, and exact quotations in their original form'))
        assert.ok(prompt.includes('Keep the JSON keys unchanged'))
        assert.ok(parts[0].text.includes('RAG pipeline'))
        assert.ok(parts[0].text.includes('원문 메모'))
        assert.ok(parts[0].text.includes('https://example.com/docs'))
        assert.ok(!parts[0].text.includes('다음 기록들을 정리해줘'))
        const { title, summary } = languages[expectedLanguage]
        const content = JSON.stringify(omitTitle ? { summary } : { title, summary })
        return Response.json(provider === 'anthropic' ? { content: [{ type: 'text', text: content }] }
          : provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: content }] } }] }
            : { choices: [{ message: { content } }] })
      }
      for (const language of Object.keys(languages) as Array<keyof typeof languages>) {
        expectedLanguage = language
        await json('/api/settings', 'PUT', {
          ai_provider: provider, ai_model: DEFAULT_AI_MODELS[provider],
          [`${provider}_api_key`]: 'test-only-placeholder', language: language === 'en' ? 'ko' : 'en'
        })
        const result = await json('/api/ai/summarize', 'POST', { group_id: group.id, language })
        assert.equal(result.title, languages[language].title)
        assert.equal(result.summary, languages[language].summary)
        const saved = queryOne<any>("SELECT title, content FROM logs WHERE group_id = ? AND log_type = 'summary'", [group.id])
        assert.equal(saved.title, languages[language].title)
        assert.equal(saved.content, languages[language].summary)
      }
      await json('/api/settings', 'PUT', { language: 'ja' })
      expectedLanguage = 'ja'
      await json('/api/ai/summarize', 'POST', { group_id: group.id })
      await json('/api/ai/summarize', 'POST', { group_id: group.id, language: 'unsupported' })
      run("UPDATE settings SET language = 'unsupported' WHERE user_id = 'local'")
      expectedLanguage = 'en'
      omitTitle = true
      assert.equal((await json('/api/ai/summarize', 'POST', { group_id: group.id })).title, 'Summary')
      omitTitle = false
    }
    assert.equal(calls, 28)
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
  insert('g1'); insert('g2', { is_secret: 1 }); insert('foreign', { user_id: 'bob' })
  const group = await json('/api/groups', 'POST', { name: 'Example', log_ids: ['g1', 'g2'] })
  assert.equal(group.logs.find((item: any) => item.id === 'g1').is_secret, false)
  assert.equal(group.logs.find((item: any) => item.id === 'g2').is_secret, true)
  await json(`/api/groups/${group.id}`, 'DELETE')
  assert.equal((await json('/api/groups')).length, 0)
  assert.equal((await json('/api/trash/restore', 'POST', { ids: ['g1', 'g2'] })).restored, 2)
  assert.equal((await json('/api/groups'))[0].logs.length, 2)
  assert.equal(row('g1').group_id, group.id)
  assert.equal((await json('/api/logs/bulk-delete', 'POST', { ids: ['g1', 'g1', 'foreign'] })).deleted, 1)
  assert.equal(row('foreign').deleted_at, null)
  restoreTrash('local', ['g1'])
  insert('summary', { group_id: group.id, log_type: 'summary' })
  const groupedLogs = (await json('/api/groups')).find((item: any) => item.id === group.id).logs
  assert.equal(groupedLogs.find((item: any) => item.id === 'summary').is_secret, false)
  await json(`/api/groups/${group.id}/ungroup`, 'POST')
  assert.equal(row('summary'), null)
  assert.equal(row('g1').deleted_at, null)
  assert.equal(row('g1').group_id, null)
})

test('whole groups retain summaries, secret metadata, files and comments in Trash and restore as one unit', async () => {
  const ids = ['whole-group-a', 'whole-group-secret', 'whole-group-summary']
  const earlier = 'whole-group-earlier'
  const file = path.join(root, 'attachments', 'whole-group-summary.txt')
  fs.writeFileSync(file, 'retained summary attachment')
  insert(ids[0]); insert(ids[1], { is_secret: 1, content: 'never return this secret' }); insert(earlier)
  const group = await json('/api/groups', 'POST', { name: 'Whole group', log_ids: [ids[0], ids[1], earlier] })
  insert(ids[2], { group_id: group.id, log_type: 'summary', attachments: JSON.stringify([file]), summary_provider: 'qwen', summary_model: 'custom-model', summary_duration_ms: 1234 })
  await json(`/api/logs/${ids[2]}/comments`, 'POST', { content: 'summary comment' })
  await json(`/api/logs/${earlier}`, 'DELETE')
  await json(`/api/groups/${group.id}`, 'DELETE')
  assert.equal((await json('/api/groups')).some((g: any) => g.id === group.id), false)
  const batch = (await json('/api/trash')).filter((item: any) => item.trash_group_id === group.id)
  assert.deepEqual(batch.map((item: any) => item.id).sort(), [...ids].sort())
  for (const item of batch) {
    assert.equal(item.trash_group_name, 'Whole group')
    assert.equal('content' in item, false)
    assert.equal('attachments' in item, false)
    assert.equal('file_path' in item, false)
  }
  assert.equal(new Set(batch.map((item: any) => item.deleted_at)).size, 1)
  assert.equal(row(earlier).trash_group_id, null)
  assert.ok(fs.existsSync(file))
  assert.equal((await request(`/api/logs/${ids[2]}`)).status, 404)
  assert.equal((await json('/api/trash/restore', 'POST', { ids: [ids[1]] })).restored, 3)
  for (const id of ids) {
    assert.equal(row(id).deleted_at, null)
    assert.equal(row(id).group_id, group.id)
    assert.equal(row(id).trash_group_id, null)
  }
  assert.ok(row(earlier).deleted_at)
  const restored = await json(`/api/groups/${group.id}`)
  assert.deepEqual(restored.logs.map((item: any) => item.id).sort(), [...ids].sort())
  assert.equal(row(ids[2]).summary_model, 'custom-model')
  assert.equal(row(ids[2]).summary_duration_ms, 1234)
  assert.equal((await json(`/api/logs/${ids[2]}/comments`))[0].content, 'summary comment')
  // An individually deleted summary still bypasses Trash after group restore.
  await json(`/api/logs/${ids[2]}`, 'DELETE')
  assert.equal(row(ids[2]), null)
  assert.equal(fs.existsSync(file), false)
  await json(`/api/groups/${group.id}`, 'DELETE')
  assert.equal((await json('/api/trash/purge', 'POST', { ids: [ids[0]] })).deleted, 2)
  assert.equal(row(ids[0]), null)
  assert.equal(row(ids[1]), null)
  assert.ok(row(earlier))
  await json('/api/trash/purge', 'POST', { ids: [earlier] })
})

test('group Trash purge and expiry remove the whole batch including summary media without crossing ownership', async () => {
  for (const mode of ['purge', 'expiry']) {
    const first = `batch-${mode}-first`, second = `batch-${mode}-second`, summary = `batch-${mode}-summary`
    const file = path.join(root, 'attachments', `${summary}.txt`)
    fs.writeFileSync(file, 'retained until group purge')
    insert(first); insert(second)
    const group = await json('/api/groups', 'POST', { name: `Batch ${mode}`, log_ids: [first, second] })
    insert(summary, { log_type: 'summary', group_id: group.id, attachments: JSON.stringify([file]) })
    await json(`/api/groups/${group.id}`, 'DELETE')
    insert(`foreign-${mode}`, { user_id: 'bob', deleted_at: now, trash_group_id: group.id })
    assert.equal((await json('/api/trash/restore', 'POST', { ids: [`foreign-${mode}`] })).restored, 0)
    assert.equal((await json('/api/trash/purge', 'POST', { ids: [`foreign-${mode}`] })).deleted, 0)
    if (mode === 'purge') {
      assert.equal((await json('/api/trash/purge', 'POST', { ids: [summary] })).deleted, 3)
    } else {
      run('UPDATE logs SET deleted_at = ? WHERE user_id = ? AND trash_group_id = ?', [now - TRASH_RETENTION_SECONDS - 1, 'local', group.id])
      await json('/api/trash')
      assert.equal((await json('/api/trash/restore', 'POST', { ids: [first] })).restored, 0)
    }
    for (const id of [first, second, summary]) assert.equal(row(id), null)
    assert.equal(fs.existsSync(file), false)
    assert.ok(row(`foreign-${mode}`))
  }
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

test('linked attachments survive removal and trash cleanup without deleting their originals', async () => {
  const original = path.join(root, 'attachments', 'linked-original.txt')
  fs.writeFileSync(original, 'original content')
  const external = path.join(root, 'linked-external.txt')
  fs.writeFileSync(external, 'external original')
  const reference = attachmentReference(original, 'link')
  const externalReference = attachmentReference(external, 'link')
  assert.equal(managedMediaPath(reference), null)
  assert.equal(readableMediaPath(reference), original)
  assert.equal(managedMediaPath(external), null)
  assert.equal(readableMediaPath(externalReference), external)
  assert.equal(readableMediaPath('peepnote-link:relative.txt'), null)
  insert('linked-original-owner', { attachments: JSON.stringify([original]) })
  const linked = await json('/api/logs', 'POST', { title: 'Linked file', attachments: [reference, externalReference] })
  assert.deepEqual(linked.attachments, [reference, externalReference])
  moveToTrash('local', ['linked-original-owner'])
  permanentlyDelete('id = ?', ['linked-original-owner'])
  assert.equal(fs.existsSync(original), true, 'a remaining link protects the shared file')
  await json(`/api/logs/${linked.id}`, 'PUT', { attachments: [] })
  assert.equal(fs.existsSync(original), true, 'removing a link must not delete the original')
  await json(`/api/logs/${linked.id}`, 'PUT', { attachments: [reference, externalReference] })
  moveToTrash('local', [linked.id])
  permanentlyDelete('id = ?', [linked.id])
  assert.equal(fs.readFileSync(original, 'utf8'), 'original content')
  assert.equal(fs.readFileSync(external, 'utf8'), 'external original')
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
  insert('ocr-attachment', { attachments: JSON.stringify([attachmentReference(screenshot, 'link')]) })
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

test('group detail includes its AI summary and only active records owned by the same group and profile', async () => {
  for (const id of ['related-a-one', 'related-a-two', 'related-b-one', 'related-b-two']) insert(id)
  const first = await json('/api/groups', 'POST', { name: 'Related group A', log_ids: ['related-a-one', 'related-a-two'] })
  const second = await json('/api/groups', 'POST', { name: 'Related group B', log_ids: ['related-b-one', 'related-b-two'] })
  insert('related-summary-a', { log_type: 'summary', group_id: first.id, summary_provider: 'qwen', summary_model: 'custom-model', summary_duration_ms: 1200 })
  insert('related-summary-b', { log_type: 'summary', group_id: second.id })
  insert('related-trashed', { group_id: first.id, deleted_at: now })
  insert('related-foreign-record', { group_id: first.id, user_id: 'bob' })
  run("INSERT INTO log_groups (id, user_id, name) VALUES ('related-foreign-group', 'bob', 'Legacy group')")
  await json('/api/logs/related-a-one/comments', 'POST', { content: 'Test comment' })
  const result = await json(`/api/groups/${first.id}?search=unmatched&type=video&workspace_id=another-workspace`)
  assert.equal(result.id, first.id)
  assert.deepEqual(result.logs.map((log: any) => log.id).sort(), ['related-a-one', 'related-a-two', 'related-summary-a'])
  assert.ok(result.logs.every((log: any) => log.group_id === first.id && log.user_id === 'local'))
  assert.equal(result.logs.find((log: any) => log.id === 'related-a-one').comment_count, 1)
  assert.deepEqual(result.logs[0].attachments, [])
  assert.deepEqual(result.logs[0].tags, [])
  assert.equal(result.logs.find((log: any) => log.id === 'related-summary-a').summary_model, 'custom-model')
  assert.equal((await request('/api/groups/related-foreign-group')).status, 404)
  assert.equal((await request('/api/groups/missing-group')).status, 404)
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


test('summary provenance follows the actual request and is preserved after failed regeneration', async () => {
  insert('summary-info-one')
  insert('summary-info-two')
  const group = await json('/api/groups', 'POST', { name: 'Summary info', log_ids: ['summary-info-one', 'summary-info-two'] })
  await json('/api/settings', 'PUT', { ai_provider: 'qwen', ai_model: 'qwen3.7-plus', qwen_api_key: 'test-only-placeholder', qwen_base_url: 'https://example.test/compatible-mode/v1' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, 'qwen3.7-plus')
    // Changing settings during a pending request must not relabel its result.
    await json('/api/settings', 'PUT', { ai_provider: 'openai', ai_model: 'gpt-6.1-sol' })
    await new Promise(resolve => setTimeout(resolve, 20))
    return Response.json({ choices: [{ message: { content: '{"title":"First summary","summary":"Original result"}' } }] })
  }
  try {
    await json('/api/ai/summarize', 'POST', { group_id: group.id })
    const first = queryOne<any>("SELECT * FROM logs WHERE group_id = ? AND log_type = 'summary'", [group.id])
    assert.equal(first.summary_provider, 'qwen')
    assert.equal(first.summary_model, 'qwen3.7-plus')
    assert.ok(Number.isInteger(first.summary_duration_ms) && first.summary_duration_ms >= 10)
    assert.equal((await json(`/api/logs/${first.id}`)).summary_duration_ms, first.summary_duration_ms)

    run('UPDATE logs SET summary_duration_ms = 999999 WHERE id = ?', [first.id])
    globalThis.fetch = async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).model, 'gpt-6.1-sol')
      return Response.json({ choices: [{ message: { content: '{"title":"New summary","summary":"Updated result"}' } }] })
    }
    await json('/api/ai/summarize', 'POST', { group_id: group.id })
    const updated = await json(`/api/logs/${first.id}`)
    assert.equal(updated.summary_provider, 'openai')
    assert.equal(updated.summary_model, 'gpt-6.1-sol')
    assert.ok(Number.isInteger(updated.summary_duration_ms) && updated.summary_duration_ms >= 0 && updated.summary_duration_ms < 999999)
    assert.equal(updated.content, 'Updated result')
    assert.equal(queryAll("SELECT id FROM logs WHERE group_id = ? AND log_type = 'summary'", [group.id]).length, 1)

    globalThis.fetch = async () => Response.json({ error: { message: 'test-only failure' } }, { status: 500 })
    assert.equal((await request('/api/ai/summarize', 'POST', { group_id: group.id })).status, 502)
    assert.deepEqual(await json(`/api/logs/${first.id}`), updated)

    await json(`/api/logs/${first.id}`, 'DELETE')
    assert.equal(row(first.id), null)
    assert.equal(row('summary-info-one').deleted_at, null)
    assert.equal(row('summary-info-two').deleted_at, null)
    assert.ok(queryOne('SELECT id FROM log_groups WHERE id = ?', [group.id]))
    assert.equal(restoreTrash('local', [first.id]), 0)
    assert.equal((await request(`/api/logs/${first.id}`)).status, 404)
  } finally { globalThis.fetch = originalFetch }
})

test('individual deletion and ungrouping remove AI summaries immediately while preserving original records and shared files', async () => {
  for (const mode of ['single', 'bulk', 'ungroup']) {
    const first = `delete-summary-original-a-${mode}`
    const second = `delete-summary-original-b-${mode}`
    const summary = `delete-summary-${mode}`
    const foreign = `foreign-summary-${mode}`
    const privateFile = path.join(root, 'attachments', `${summary}-private.txt`)
    const sharedFile = path.join(root, 'attachments', `${summary}-shared.txt`)
    const linkedFile = path.join(root, 'attachments', `${summary}-linked.txt`)
    const commentFile = path.join(root, 'attachments', `${summary}-comment.txt`)
    for (const file of [privateFile, sharedFile, linkedFile, commentFile]) fs.writeFileSync(file, 'test-only file')
    insert(first, { attachments: JSON.stringify([sharedFile]) })
    insert(second)
    insert(foreign, { user_id: 'bob', log_type: 'summary' })
    const group = await json('/api/groups', 'POST', { name: summary, log_ids: [first, second] })
    insert(summary, { log_type: 'summary', group_id: group.id, attachments: JSON.stringify([privateFile, sharedFile, attachmentReference(linkedFile, 'link')]) })
    run('INSERT INTO comments (id, log_id, user_id, content, attachments) VALUES (?, ?, ?, ?, ?)', [`${summary}-comment`, summary, 'local', 'test comment', JSON.stringify([commentFile])])

    if (mode === 'single') await json(`/api/logs/${summary}`, 'DELETE')
    if (mode === 'bulk') {
      assert.equal((await json('/api/logs/bulk-delete', 'POST', { ids: [summary, summary, first, foreign] })).deleted, 2)
      assert.ok(row(first).deleted_at)
      assert.equal(restoreTrash('local', [first]), 1)
    }
    if (mode === 'ungroup') await json(`/api/groups/${group.id}/ungroup`, 'POST')

    assert.equal(row(summary), null)
    assert.equal((await request(`/api/logs/${summary}`)).status, 404)
    assert.equal((await json('/api/trash')).some((item: any) => item.id === summary), false)
    assert.equal((await json('/api/trash/restore', 'POST', { ids: [summary] })).restored, 0)
    assert.equal(row(first).deleted_at, null)
    assert.equal(row(second).deleted_at, null)
    assert.equal(row(first).group_id, mode === 'ungroup' ? null : group.id)
    assert.equal(row(second).group_id, mode === 'ungroup' ? null : group.id)
    assert.ok(row(foreign))
    assert.equal(row(foreign).deleted_at, null)
    assert.equal(queryAll('SELECT id FROM comments WHERE log_id = ?', [summary]).length, 0)
    assert.equal(fs.existsSync(privateFile), false)
    assert.equal(fs.existsSync(commentFile), false)
    assert.equal(fs.existsSync(sharedFile), true)
    assert.equal(fs.existsSync(linkedFile), true)
  }
})

test('rolling back summary deletion preserves its comment files', async () => {
  const file = path.join(root, 'attachments', 'summary-rollback-comment.txt')
  fs.writeFileSync(file, 'test-only rollback file')
  insert('summary-rollback', { log_type: 'summary' })
  run('INSERT INTO comments (id, log_id, user_id, content, attachments) VALUES (?, ?, ?, ?, ?)', ['summary-rollback-comment', 'summary-rollback', 'local', 'keep', JSON.stringify([file])])
  assert.throws(() => transaction(() => {
    moveToTrash('local', ['summary-rollback'])
    throw new Error('test-only rollback')
  }), /test-only rollback/)
  await Promise.resolve()
  assert.ok(row('summary-rollback'))
  assert.equal(row('summary-rollback').deleted_at, null)
  assert.equal(queryAll('SELECT id FROM comments WHERE log_id = ?', ['summary-rollback']).length, 1)
  assert.equal(fs.existsSync(file), true)
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
  insert('badge-project', { workspace_id: 'trash-project', content_format: 'markdown', is_secret: 1, content: 'private trash content', file_path: path.join(root, 'attachments', 'private.txt') })
  insert('badge-general', { content_format: 'text' })
  insert('badge-foreign', { workspace_id: 'bob-private' })
  const before = (await json('/api/trash/count')).count
  moveToTrash('local', ['badge-project', 'badge-general', 'badge-foreign'])
  let entries = await json('/api/trash')
  const secretMetadata = entries.find((item: any) => item.id === 'badge-project')
  assert.equal(secretMetadata.content_format, 'markdown')
  assert.equal(entries.find((item: any) => item.id === 'badge-general').content_format, 'text')
  assert.equal('content' in secretMetadata, false)
  assert.equal('file_path' in secretMetadata, false)
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

test('comments can be edited and deleted without changing their date or the note; counts stay consistent', async () => {
  insert('comment-crud', { favorite: 1 }); insert('comment-group-peer')
  const first = await json('/api/logs/comment-crud/comments', 'POST', { content: 'First comment' })
  const second = await json('/api/logs/comment-crud/comments', 'POST', { content: 'Second comment' })
  assert.equal(first.comment_count, 1)
  assert.equal(second.comment_count, 2)
  const group = await json('/api/groups', 'POST', { name: 'Comment counts', log_ids: ['comment-crud', 'comment-group-peer'] })
  assert.equal(group.logs.find((log: any) => log.id === 'comment-crud').comment_count, 2)
  const noteDate = row('comment-crud').updated_at
  const edited = await json(`/api/logs/comment-crud/comments/${first.id}`, 'PUT', { content: '  Revised comment\nwith a second line.  ' })
  assert.equal(edited.content, 'Revised comment\nwith a second line.')
  assert.equal(edited.created_at, first.created_at)
  assert.equal(edited.comment_count, 2)
  assert.equal(row('comment-crud').updated_at, noteDate)
  assert.equal((await json('/api/logs/comment-crud/comments')).find((comment: any) => comment.id === first.id).content, edited.content)
  assert.equal((await json(`/api/logs/comment-crud/comments/${first.id}`, 'DELETE')).comment_count, 1)
  assert.equal((await json('/api/logs/comment-crud')).comment_count, 1)
  assert.equal((await json('/api/logs?favorite=true')).find((log: any) => log.id === 'comment-crud').comment_count, 1)
  assert.equal((await json('/api/groups')).find((item: any) => item.id === group.id).logs.find((log: any) => log.id === 'comment-crud').comment_count, 1)
  assert.equal((await json(`/api/logs/comment-crud/comments/${second.id}`, 'DELETE')).comment_count, 0)
  assert.deepEqual(await json('/api/logs/comment-crud/comments'), [])
  assert.equal((await request(`/api/logs/comment-crud/comments/${second.id}`, 'DELETE')).status, 404)
})

test('comment edits reject empty, oversized and malformed content without overwriting the original', async () => {
  insert('comment-validation')
  const comment = await json('/api/logs/comment-validation/comments', 'POST', { content: 'Keep this comment' })
  const url = `/api/logs/comment-validation/comments/${comment.id}`
  for (const content of ['', ' \n ', null, 14, {}, 'x'.repeat(2001)]) {
    assert.equal((await request(url, 'PUT', { content })).status, 400)
  }
  assert.equal((await app.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400)
  assert.equal((await json('/api/logs/comment-validation/comments'))[0].content, 'Keep this comment')
  assert.equal((await json(url, 'PUT', { content: 'x'.repeat(2000) })).content.length, 2000)
  assert.equal((await request('/api/logs/comment-validation/comments', 'POST', { content: null })).status, 400)
})

test('comment mutations cannot address another note, a legacy profile or an incorrectly owned comment', async () => {
  insert('comment-scope'); insert('comment-other-note'); insert('comment-other-profile', { user_id: 'legacy-profile' })
  const comment = await json('/api/logs/comment-scope/comments', 'POST', { content: 'Scoped comment' })
  run('INSERT INTO comments (id, log_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)', ['comment-legacy', 'comment-other-profile', 'legacy-profile', 'Legacy comment', now])
  run('INSERT INTO comments (id, log_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)', ['comment-misowned', 'comment-scope', 'legacy-profile', 'Not local', now])
  for (const method of ['PUT', 'DELETE']) {
    for (const [logId, commentId] of [
      ['comment-other-note', comment.id], ['missing-note', comment.id], ['comment-scope', 'missing-comment'],
      ['comment-other-profile', 'comment-legacy'], ['comment-scope', 'comment-misowned']
    ]) {
      assert.equal((await request(`/api/logs/${logId}/comments/${commentId}`, method, { content: 'Unauthorized edit' })).status, 404)
    }
  }
  assert.equal((await json('/api/logs/comment-scope/comments'))[0].content, 'Scoped comment')
  assert.equal((await json('/api/logs/comment-scope')).comment_count, 1)
  assert.equal(queryOne<any>('SELECT content FROM comments WHERE id = ?', ['comment-legacy']).content, 'Legacy comment')
  assert.equal(queryOne<any>('SELECT content FROM comments WHERE id = ?', ['comment-misowned']).content, 'Not local')
})

test('comments in Trash cannot be changed and remain intact after restoring their note', async () => {
  insert('comment-trash')
  const comment = await json('/api/logs/comment-trash/comments', 'POST', { content: 'Restore me' })
  const url = `/api/logs/comment-trash/comments/${comment.id}`
  await json('/api/logs/comment-trash', 'DELETE')
  assert.equal((await request(url, 'PUT', { content: 'Changed in Trash' })).status, 404)
  assert.equal((await request(url, 'DELETE')).status, 404)
  await json('/api/trash/restore', 'POST', { ids: ['comment-trash'] })
  assert.equal((await json('/api/logs/comment-trash/comments'))[0].content, 'Restore me')
  assert.equal((await json(url, 'PUT', { content: 'After restore' })).content, 'After restore')
})

test('comments support file-only posts, file edits and attachment-only removal without changing their date', async () => {
  insert('comment-files')
  const file = path.join(root, 'attachments', 'comment-only.txt')
  fs.writeFileSync(file, 'saved comment attachment')
  const comment = await json('/api/logs/comment-files/comments', 'POST', { attachments: [file] })
  assert.equal(comment.content, '')
  assert.deepEqual(comment.attachments, [file])
  assert.deepEqual((await json('/api/logs/comment-files/comments'))[0].attachments, [file])
  const edited = await json(`/api/logs/comment-files/comments/${comment.id}`, 'PUT', { content: 'Now with text' })
  assert.deepEqual(edited.attachments, [file])
  assert.equal(edited.created_at, comment.created_at)
  const empty = await json(`/api/logs/comment-files/comments/${comment.id}`, 'PUT', { attachments: [] })
  assert.deepEqual(empty.attachments, [])
  assert.equal(empty.content, 'Now with text')
  assert.equal(fs.existsSync(file), false)
  const filesOnly = await json('/api/logs/comment-files/comments', 'POST', { attachments: [attachmentReference(path.join(root, 'original.txt'), 'link')] })
  const cleared = await json(`/api/logs/comment-files/comments/${filesOnly.id}`, 'PUT', { attachments: [] })
  assert.equal(cleared.content, '')
  assert.deepEqual(cleared.attachments, [])
})

test('comment files protect shared note copies and linked originals during deletion', async () => {
  const shared = path.join(root, 'attachments', 'shared-comment.txt')
  const original = path.join(root, 'comment-original.txt')
  fs.writeFileSync(shared, 'shared'); fs.writeFileSync(original, 'original')
  insert('comment-shared-note', { attachments: JSON.stringify([shared]) }); insert('comment-shared-owner')
  const comment = await json('/api/logs/comment-shared-owner/comments', 'POST', { content: 'Shared', attachments: [shared, attachmentReference(original, 'link')] })
  await json('/api/logs/comment-shared-note', 'PUT', { attachments: [] })
  assert.ok(fs.existsSync(shared), 'a comment reference keeps a detached note copy alive')
  await json(`/api/logs/comment-shared-owner/comments/${comment.id}`, 'DELETE')
  assert.equal(fs.existsSync(shared), false)
  assert.ok(fs.existsSync(original), 'removing linked attachments never deletes the original')
})

test('Trash preserves comment files until purge and protects copies still referenced by other comments', async () => {
  const shared = path.join(root, 'attachments', 'comment-trash-shared.txt')
  const unique = path.join(root, 'attachments', 'comment-trash-unique.txt')
  fs.writeFileSync(shared, 'shared'); fs.writeFileSync(unique, 'unique')
  insert('comment-file-trash'); insert('comment-file-keeper')
  const first = await json('/api/logs/comment-file-trash/comments', 'POST', { attachments: [shared, unique] })
  const keeper = await json('/api/logs/comment-file-keeper/comments', 'POST', { attachments: [shared] })
  await json('/api/logs/comment-file-trash', 'DELETE')
  assert.ok(fs.existsSync(unique))
  await json('/api/trash/restore', 'POST', { ids: ['comment-file-trash'] })
  assert.deepEqual((await json('/api/logs/comment-file-trash/comments'))[0].attachments, first.attachments)
  await json('/api/logs/comment-file-trash', 'DELETE')
  await json('/api/trash/purge', 'POST', { ids: ['comment-file-trash'] })
  assert.equal(fs.existsSync(unique), false)
  assert.ok(fs.existsSync(shared))
  await json(`/api/logs/comment-file-keeper/comments/${keeper.id}`, 'DELETE')
  assert.equal(fs.existsSync(shared), false)
})

test('invalid comment attachments cannot overwrite saved data', async () => {
  insert('comment-file-validation')
  const comment = await json('/api/logs/comment-file-validation/comments', 'POST', { content: 'Keep this' })
  for (const attachments of [null, 'file', [false], [''], Array(101).fill('file.txt')]) {
    assert.equal((await request(`/api/logs/comment-file-validation/comments/${comment.id}`, 'PUT', { attachments })).status, 400)
    assert.equal((await request('/api/logs/comment-file-validation/comments', 'POST', { content: 'Bad files', attachments })).status, 400)
  }
  const saved = (await json('/api/logs/comment-file-validation/comments'))[0]
  assert.equal(saved.content, 'Keep this')
  assert.deepEqual(saved.attachments, [])
})
