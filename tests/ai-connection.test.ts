import assert from 'node:assert/strict'
import test from 'node:test'
import { testAiConnection } from '../server/aiConnection'
import { qwenChatEndpoint, type AiConnectionInput } from '../shared/aiConnection'

const input: AiConnectionInput = { provider: 'qwen', model: 'custom-model', apiKey: 'test-key', baseUrl: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' }

test('AI connection validates missing settings and invalid endpoints without making a request', async context => {
  const original = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected request') }
  context.after(() => { globalThis.fetch = original })
  for (const [patch, error] of [[null, 'invalidSettings'], [{ ...input, provider: 'unsupported' }, 'invalidSettings'],
    [{ ...input, apiKey: ' ' }, 'missingKey'], [{ ...input, model: '' }, 'missingModel'],
    [{ ...input, baseUrl: 'http://remote.example/v1' }, 'invalidEndpoint'],
    [{ ...input, baseUrl: 'https://user:password@example.com/v1' }, 'invalidEndpoint']] as const) {
    assert.deepEqual(await testAiConnection(patch), { ok: false, error })
  }
  assert.equal(requests, 0)
})

test('all four AI providers probe the current model with a small fixed message and private auth headers', async context => {
  const original = globalThis.fetch
  context.after(() => { globalThis.fetch = original })
  for (const provider of ['openai', 'anthropic', 'gemini', 'qwen'] as const) {
    globalThis.fetch = async (url, options) => {
      const endpoint = new URL(String(url)), headers = options?.headers as Record<string, string>
      const body = JSON.parse(String(options?.body))
      assert.equal(options?.method, 'POST')
      assert.equal(options?.redirect, 'error')
      assert.ok(options?.signal instanceof AbortSignal)
      assert.equal(endpoint.searchParams.has('key'), false)
      if (provider === 'gemini') {
        assert.equal(headers['x-goog-api-key'], 'test-key')
        assert.match(endpoint.pathname, /custom-model:generateContent$/)
        assert.equal(body.generationConfig.maxOutputTokens, 64)
        assert.deepEqual(body.contents, [{ parts: [{ text: 'Reply with OK.' }] }])
        return Response.json({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] })
      }
      assert.equal(body.model, provider === 'openai' ? 'gpt-5.5' : 'custom-model')
      assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply with OK.' }])
      if (provider === 'anthropic') {
        assert.equal(headers['x-api-key'], 'test-key')
        assert.equal(body.max_tokens, 64)
        return Response.json({ content: [{ type: 'text', text: 'OK' }] })
      }
      assert.equal(headers.Authorization, 'Bearer test-key')
      if (provider === 'openai') { assert.equal(body.max_completion_tokens, 64); assert.equal(body.max_tokens, undefined) }
      else { assert.equal(endpoint.href, input.baseUrl + '/chat/completions'); assert.equal(body.max_tokens, 64) }
      return Response.json({ choices: [{ message: { content: 'OK' } }] })
    }
    const result = await testAiConnection({ ...input, provider, model: provider === 'openai' ? 'gpt-5.5' : 'custom-model' })
    assert.equal(result.ok, true)
    if (result.ok) assert.ok(result.latencyMs >= 1)
  }
})

test('AI connection classifies provider failures without echoing keys or raw error messages', async context => {
  const original = globalThis.fetch
  context.after(() => { globalThis.fetch = original })
  for (const [status, code, expected] of [[401, 'InvalidApiKey', 'unauthorized'], [403, '', 'forbidden'],
    [404, 'model_not_found', 'modelNotFound'], [404, '', 'endpointNotFound'], [403, 'Arrearage', 'rateLimited'], [429, '', 'rateLimited'], [500, '', 'providerError']] as const) {
    globalThis.fetch = async () => Response.json({ error: { code, message: 'Private server error with test-key' } }, { status })
    assert.deepEqual(await testAiConnection(input), { ok: false, error: expected })
  }
  globalThis.fetch = async () => Response.json({ error: { message: 'model: unknown-name' } }, { status: 404 })
  assert.deepEqual(await testAiConnection({ ...input, provider: 'anthropic' }), { ok: false, error: 'modelNotFound' })
  globalThis.fetch = async () => Response.json({ arbitrary: 'not a model response' })
  assert.deepEqual(await testAiConnection(input), { ok: false, error: 'invalidResponse' })
  globalThis.fetch = async () => { throw new TypeError('Private network failure') }
  assert.deepEqual(await testAiConnection(input), { ok: false, error: 'network' })
  globalThis.fetch = async () => { throw new DOMException('Private timeout detail', 'TimeoutError') }
  assert.deepEqual(await testAiConnection(input), { ok: false, error: 'timeout' })
})

test('AI connection forwards cancellation to the provider request', async context => {
  const original = globalThis.fetch
  context.after(() => { globalThis.fetch = original })
  const controller = new AbortController()
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
  })
  const request = testAiConnection(input, controller.signal)
  controller.abort()
  assert.deepEqual(await request, { ok: false, error: 'timeout' })
})

test('Qwen uses the same normalized endpoint for connection tests and summaries', () => {
  assert.equal(qwenChatEndpoint(input.baseUrl + '/'), input.baseUrl + '/chat/completions')
  assert.equal(qwenChatEndpoint(input.baseUrl + '/chat/completions'), input.baseUrl + '/chat/completions')
  assert.match(qwenChatEndpoint(), /^https:\/\/dashscope-intl\.aliyuncs\.com\//)
  assert.equal(qwenChatEndpoint('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1/chat/completions')
  assert.throws(() => qwenChatEndpoint('https://example.com/v1?key=private'))
})
