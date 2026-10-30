import type { AiProvider } from './aiModels'

export interface AiConnectionInput {
  provider: AiProvider
  model: string
  apiKey: string
  baseUrl?: string
}
export type AiConnectionError = 'invalidSettings' | 'missingKey' | 'missingModel' | 'invalidEndpoint' |
  'unauthorized' | 'forbidden' | 'modelNotFound' | 'endpointNotFound' | 'rateLimited' |
  'timeout' | 'network' | 'providerError' | 'invalidResponse'
export type AiConnectionResult = { ok: true; latencyMs: number } | { ok: false; error: AiConnectionError }

export function qwenChatEndpoint(baseUrl?: string | null) {
  const url = new URL(baseUrl?.trim() || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid Qwen API endpoint')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions'
  return url.toString()
}
