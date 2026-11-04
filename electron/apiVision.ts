import fs from 'node:fs/promises'
import { capturePrompt, type CaptureAnalysisError } from '../shared/captureAnalysis'
import { qwenChatEndpoint } from '../shared/aiConnection'
import type { AiProvider } from '../shared/aiModels'
import type { CodexVisionInput } from './codexVision'

export class ApiVisionError extends Error {
  constructor(readonly code: CaptureAnalysisError) { super(code); this.name = 'ApiVisionError' }
}
export interface ApiVisionConfig { provider: AiProvider; apiKey: string; baseUrl?: string | null }

// Provider credentials are captured here in main, never published to the response window.
// Payloads follow the providers' vision APIs; no tools or remote image URLs are sent.
export async function runApiVision(input: CodexVisionInput, config: ApiVisionConfig, request: typeof fetch = fetch): Promise<string> {
  input.signal.throwIfAborted()
  if (!config.apiKey?.trim()) throw new ApiVisionError('api_missing_key')
  const prompt = capturePrompt(input.language, input.turns, input.question, input.responseLanguage)
  let bytes = 0
  const images: string[] = []
  for (const image of input.images) {
    const stat = await fs.stat(image)
    bytes += stat.size
    // Keep inline requests below providers' request limits, including base64 overhead.
    if (bytes > 12 * 1024 * 1024) throw new ApiVisionError('image_limit')
    images.push((await fs.readFile(image)).toString('base64'))
  }
  input.signal.throwIfAborted()
  const { provider } = config, model = input.model, key = config.apiKey.trim()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let endpoint: string, body: object
  if (provider === 'anthropic') {
    endpoint = 'https://api.anthropic.com/v1/messages'
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
    body = { model, max_tokens: 4096, messages: [{ role: 'user', content: [
      ...images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })),
      { type: 'text', text: prompt },
    ] }] }
  } else if (provider === 'gemini') {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    headers['x-goog-api-key'] = key
    body = { contents: [{ role: 'user', parts: [
      ...images.map(data => ({ inline_data: { mime_type: 'image/png', data } })), { text: prompt },
    ] }], generationConfig: { maxOutputTokens: 8192 } }
  } else {
    try { endpoint = provider === 'qwen' ? qwenChatEndpoint(config.baseUrl) : 'https://api.openai.com/v1/chat/completions' }
    catch { throw new ApiVisionError('api_endpoint') }
    headers.Authorization = `Bearer ${key}`
    const reasoning = provider === 'openai' && /^(gpt-[56](?:[.-]|$)|o[134](?:-|$))/.test(model)
    body = { model, messages: [{ role: 'user', content: [
      ...images.map(data => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } })),
      { type: 'text', text: prompt },
    ] }], ...(reasoning ? { max_completion_tokens: 8192, reasoning_effort: 'low' } : { max_tokens: 4096 }) }
  }
  const timeout = AbortSignal.timeout(180_000)
  try {
    const response = await request(endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
      signal: AbortSignal.any([input.signal, timeout]) })
    const data = await response.json().catch(() => null) as any
    if (!response.ok) {
      const message = `${data?.error?.code ?? ''} ${data?.error?.message ?? ''}`.toLowerCase()
      // Never display an upstream error body: it can contain request details or credentials.
      throw new ApiVisionError(response.status === 401 || response.status === 403 ? 'api_auth'
        : response.status === 429 ? 'api_limit'
        : response.status === 404 || /model|vision|image|multimodal/.test(message) ? 'api_model'
        : 'api_failed')
    }
    const answer = provider === 'anthropic' ? data?.content?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
      : provider === 'gemini' ? data?.candidates?.[0]?.content?.parts?.filter((p: any) => !p.thought && typeof p.text === 'string').map((p: any) => p.text).join('')
      : data?.choices?.[0]?.message?.content
    if (typeof answer !== 'string' || !answer.trim()) throw new ApiVisionError('api_failed')
    return answer.trim()
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason
    if (timeout.aborted) throw new ApiVisionError('timeout')
    if (error instanceof ApiVisionError) throw error
    throw new ApiVisionError('api_network')
  }
}
