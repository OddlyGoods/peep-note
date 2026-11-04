import type { AiProvider } from '../shared/aiModels'

export class VisionStreamError extends Error {}

// Decode incrementally: a network chunk may split an SSE record or a UTF-8 character.
async function* events(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader(), decoder = new TextDecoder()
  let pending = '', bytes = 0, data: string[] = []
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      bytes += value?.byteLength ?? 0
      if (bytes > 4_000_000) throw new VisionStreamError('stream_limit')
      pending += decoder.decode(value, { stream: !done })
      if (done) pending += '\n\n'
      let index: number
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index).replace(/\r$/, '')
        pending = pending.slice(index + 1)
        if (!line) {
          if (data.length) { yield data.join('\n'); data = [] }
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (done) break
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function readVisionStream(body: ReadableStream<Uint8Array>, provider: AiProvider,
  signal: AbortSignal, onText: (text: string) => void): Promise<string> {
  let answer = '', finished = false, done = false
  const append = (text: unknown) => {
    if (typeof text !== 'string' || !text) return
    answer += text
    if (answer.length > 100_000) throw new VisionStreamError('stream_limit')
    onText(answer)
  }
  for await (const raw of events(body, signal)) {
    if (raw === '[DONE]') { done = true; break }
    let event: any
    try { event = JSON.parse(raw) } catch { throw new VisionStreamError('invalid_stream') }
    if (event.error || event.type === 'error') throw new VisionStreamError('upstream_error')
    if (provider === 'anthropic') {
      if (event.type === 'content_block_start' && event.content_block?.type === 'text') append(event.content_block.text)
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') append(event.delta.text)
      if (event.type === 'message_delta' && event.delta?.stop_reason) {
        finished = ['end_turn', 'stop_sequence'].includes(event.delta.stop_reason)
      }
      if (event.type === 'message_stop') { done = true; break }
    } else if (provider === 'gemini') {
      const candidate = event.candidates?.[0]
      for (const part of candidate?.content?.parts ?? []) if (!part.thought) append(part.text)
      if (candidate?.finishReason) {
        finished = candidate.finishReason === 'STOP'
        if (!finished) throw new VisionStreamError('incomplete_stream')
        done = true
      }
    } else {
      const choice = event.choices?.find((item: any) => item.index === 0) ?? event.choices?.[0]
      append(choice?.delta?.content)
      if (choice?.finish_reason) {
        finished = choice.finish_reason === 'stop'
        if (!finished) throw new VisionStreamError('incomplete_stream')
      }
    }
  }
  if (!finished || !done || !answer.trim()) throw new VisionStreamError('incomplete_stream')
  return answer.trim()
}
