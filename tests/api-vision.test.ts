import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runApiVision, ApiVisionError } from '../electron/apiVision'
import type { CodexVisionInput } from '../electron/codexVision'
import { getMagicPenSettings, resolveMagicPen, magicPenDraft } from '../shared/magicPen'
import type { AiProvider } from '../shared/aiModels'

const fixture = path.join(__dirname, 'fixtures/ocr.png')
const input = (signal = new AbortController().signal): CodexVisionInput => ({ model: 'fixture-vision-model', language: 'ko',
  turns: [{ question: 'First question', answer: 'First answer', elapsedMs: 1, imageCount: 1 }], question: 'Follow-up question',
  images: [fixture, fixture], directory: os.tmpdir(), signal, onText() {} })
const returns: Record<AiProvider, object> = {
  openai: { choices: [{ message: { content: 'OpenAI answer' } }] },
  qwen: { choices: [{ message: { content: 'Qwen answer' } }] },
  anthropic: { content: [{ type: 'text', text: 'Claude answer' }] },
  gemini: { candidates: [{ content: { parts: [{ thought: true, text: 'Hidden reasoning' }, { text: 'Gemini answer' }] } }] },
}
for (const provider of ['openai', 'anthropic', 'gemini', 'qwen'] as const) {
  test(`Magic Pen ${provider} sends chronological images, previous conversation and selected model without tools`, async () => {
    let calls = 0
    const answer = await runApiVision(input(), { provider, apiKey: 'fixture-key', baseUrl: 'http://127.0.0.1:7777/v1' }, (async (url, options) => {
      calls++
      const body = JSON.parse(options!.body as string), headers = options!.headers as Record<string, string>
      assert.equal(options!.redirect, 'error')
      assert.ok(options!.signal)
      if (provider !== 'gemini') assert.equal(body.model, 'fixture-vision-model')
      assert.equal(body.tools, undefined)
      assert.equal(body.response_format, undefined) // answer is Markdown, not summary JSON
      assert.equal(body.generationConfig?.responseMimeType, undefined)
      assert.match(JSON.stringify(body), /First question/)
      assert.match(JSON.stringify(body), /First answer/)
      assert.match(JSON.stringify(body), /Follow-up question/)
      assert.match(JSON.stringify(body), /Reply in Korean/)
      assert.ok(!JSON.stringify(body).includes('fixture-key'))
      const base64 = fs.readFileSync(fixture).toString('base64')
      if (provider === 'gemini') {
        assert.match(String(url), /fixture-vision-model:generateContent$/)
        assert.equal(headers['x-goog-api-key'], 'fixture-key')
        assert.deepEqual(body.contents[0].parts.slice(0, 2), [0, 1].map(() => ({ inline_data: { mime_type: 'image/png', data: base64 } })))
      } else if (provider === 'anthropic') {
        assert.equal(headers['x-api-key'], 'fixture-key')
        assert.deepEqual(body.messages[0].content.slice(0, 2), [0, 1].map(() => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } })))
      } else {
        assert.equal(headers.Authorization, 'Bearer fixture-key')
        if (provider === 'qwen') assert.equal(String(url), 'http://127.0.0.1:7777/v1/chat/completions')
        else assert.equal(String(url), 'https://api.openai.com/v1/chat/completions')
        assert.deepEqual(body.messages[0].content.slice(0, 2), [0, 1].map(() => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } })))
      }
      return Response.json(returns[provider])
    }) as typeof fetch)
    assert.equal(calls, 1)
    assert.equal(answer, `${provider === 'anthropic' ? 'Claude' : provider === 'gemini' ? 'Gemini' : provider === 'qwen' ? 'Qwen' : 'OpenAI'} answer`)
  })
}

test('Magic Pen API errors are safe, actionable and never fall back to another provider', async () => {
  for (const [status, data, code] of [
    [401, { error: { message: 'private server content' } }, 'api_auth'],
    [429, {}, 'api_limit'], [404, {}, 'api_model'],
    [400, { error: { message: 'image input unsupported' } }, 'api_model'], [500, {}, 'api_failed'], [200, {}, 'api_failed'],
  ] as const) {
    let calls = 0
    await assert.rejects(runApiVision(input(), { provider: 'qwen', apiKey: 'fixture-key' }, (async () => {
      calls++; return Response.json(data, { status })
    }) as typeof fetch), (error: any) => error instanceof ApiVisionError && error.code === code && !error.message.includes('private'))
    assert.equal(calls, 1)
  }
  const noFetch = (async () => { throw new Error('must not call') }) as typeof fetch
  await assert.rejects(runApiVision(input(), { provider: 'openai', apiKey: '' }, noFetch), { code: 'api_missing_key' })
  await assert.rejects(runApiVision(input(), { provider: 'qwen', apiKey: 'fixture-key', baseUrl: 'file:///tmp/invalid' }, noFetch), { code: 'api_endpoint' })
  await assert.rejects(runApiVision(input(), { provider: 'openai', apiKey: 'fixture-key' }, (async () => { throw new Error('private detail') }) as typeof fetch), { code: 'api_network' })
})

test('Magic Pen API cancellation stops the provider request', async () => {
  const controller = new AbortController()
  let started!: () => void
  const requestStarted = new Promise<void>(resolve => { started = resolve })
  const pending = runApiVision(input(controller.signal), { provider: 'openai', apiKey: 'fixture-key' }, ((_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true })
    started()
  })) as typeof fetch)
  await requestStarted
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('Magic Pen rejects oversized inline images before reading or sending them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-api-vision-'))
  const file = path.join(dir, 'large.png')
  try {
    fs.closeSync(fs.openSync(file, 'w'))
    fs.truncateSync(file, 13 * 1024 * 1024)
    await assert.rejects(runApiVision({ ...input(), images: [file] }, { provider: 'openai', apiKey: 'fixture-key' }, (async () => { throw new Error('must not send') }) as typeof fetch), { code: 'image_limit' })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('Magic Pen defaults preserve Codex and API routing follows only the active AI provider', () => {
  const legacy = getMagicPenSettings(null, 'codex-custom', 'codex-custom')
  assert.equal(legacy.mode, 'tool')
  assert.equal(legacy.models.codex, 'codex-custom')
  assert.equal(legacy.customModels.codex, 'codex-custom')
  assert.deepEqual(resolveMagicPen({ magic_pen: legacy, ai_provider: 'qwen' }), { mode: 'tool', provider: 'codex', model: 'codex-custom', label: 'Codex' })
  legacy.mode = 'api'; legacy.models.qwen = 'my-vision-model'
  assert.deepEqual(resolveMagicPen({ magic_pen: JSON.stringify(legacy), ai_provider: 'qwen', qwen_api_key: 'fixture-key' }), { mode: 'api', provider: 'qwen', model: 'my-vision-model', label: 'Qwen' })
  assert.equal(resolveMagicPen({ magic_pen: legacy, ai_provider: 'gemini' }).model, legacy.models.gemini)
})


test('an unfinished API model does not block switching back to a valid tool or another provider', () => {
  const config = getMagicPenSettings()
  config.mode = 'api'; config.models.qwen = ''; config.customModels.qwen = 'last-qwen-custom'
  assert.equal(magicPenDraft(config, 'qwen'), undefined)
  const otherProvider = magicPenDraft(config, 'openai')!
  assert.equal(otherProvider.models.qwen, 'last-qwen-custom')
  assert.equal(otherProvider.mode, 'api')
  config.mode = 'tool'
  assert.equal(magicPenDraft(config, 'qwen')?.mode, 'tool')
})
