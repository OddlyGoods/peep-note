import { type AiConnectionInput, type AiConnectionResult, type AiConnectionError, qwenChatEndpoint } from '../shared/aiConnection'

function upstreamError(status: number, data: any, customEndpoint: boolean): AiConnectionError {
  const code = `${data?.error?.code ?? ''} ${data?.error?.type ?? ''} ${data?.error?.message ?? ''}`.toLowerCase()
  if (status === 401 || /invalid.?api.?key|api.?key.*(?:invalid|not valid)|authentication_error/.test(code)) return 'unauthorized'
  if (status === 429 || /insufficient_quota|quota_exceeded|insufficient.*balance|arrearage/.test(code)) return 'rateLimited'
  if (status === 403) return 'forbidden'
  if (/model.*(?:not.?found|not.?exist|invalid)|(?:invalid|unknown).*model/.test(code)) return 'modelNotFound'
  if (status === 404) return customEndpoint ? 'endpointNotFound' : 'modelNotFound'
  return 'providerError'
}

export async function testAiConnection(input: unknown, clientSignal?: AbortSignal): Promise<AiConnectionResult> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'invalidSettings' }
  const data = input as Partial<AiConnectionInput>
  if (!['openai', 'anthropic', 'gemini', 'qwen'].includes(data.provider ?? '')) return { ok: false, error: 'invalidSettings' }
  if (typeof data.apiKey !== 'string' || !data.apiKey.trim()) return { ok: false, error: 'missingKey' }
  if (typeof data.model !== 'string' || !data.model.trim()) return { ok: false, error: 'missingModel' }
  if (data.apiKey.length > 8192 || data.model.length > 200 || (data.baseUrl !== undefined && (typeof data.baseUrl !== 'string' || data.baseUrl.length > 2048))) return { ok: false, error: 'invalidSettings' }
  const { provider } = data
  const model = data.model.trim(), key = data.apiKey.trim()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const messages = [{ role: 'user', content: 'Reply with OK.' }]
  let endpoint: string, body: object
  if (provider === 'anthropic') {
    endpoint = 'https://api.anthropic.com/v1/messages'
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
    body = { model, messages, max_tokens: 64 }
  } else if (provider === 'gemini') {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    headers['x-goog-api-key'] = key
    body = { contents: [{ parts: [{ text: 'Reply with OK.' }] }], generationConfig: { maxOutputTokens: 64 } }
  } else {
    try { endpoint = provider === 'qwen' ? qwenChatEndpoint(data.baseUrl) : 'https://api.openai.com/v1/chat/completions' }
    catch { return { ok: false, error: 'invalidEndpoint' } }
    headers.Authorization = `Bearer ${key}`
    const reasoning = provider === 'openai' && /^(gpt-[56](?:[.-]|$)|o[134](?:-|$))/.test(model)
    body = { model, messages, ...(reasoning ? { max_completion_tokens: 64, reasoning_effort: 'low' } : { max_tokens: 64 }) }
  }
  const started = Date.now()
  const timeout = AbortSignal.timeout(20_000)
  try {
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
      signal: clientSignal ? AbortSignal.any([timeout, clientSignal]) : timeout })
    const result = await response.json().catch(() => null) as any
    if (!response.ok) return { ok: false, error: upstreamError(response.status, result, provider === 'qwen') }
    const valid = provider === 'anthropic' ? Array.isArray(result?.content) && (result.type === 'message' || result.content.some((part: any) => part.type === 'text')) :
      provider === 'gemini' ? Array.isArray(result?.candidates) && result.candidates.some((candidate: any) => candidate.content || candidate.finishReason === 'MAX_TOKENS') :
      Array.isArray(result?.choices) && result.choices.some((choice: any) => choice.message && typeof choice.message === 'object')
    return valid ? { ok: true, latencyMs: Math.max(1, Date.now() - started) } : { ok: false, error: 'invalidResponse' }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return { ok: false, error: timeout.aborted || name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' }
  }
}
