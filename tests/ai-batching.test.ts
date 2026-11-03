import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_AI_CONTEXT_LENGTH, isAiContextLength, normalizeAiContextLength } from '../shared/aiContext'
import { estimateSummaryTokens, packSummarySources, splitSummaryText, summaryBatchCost, summaryBudget, summarizeInBatches, SummaryBatchError } from '../server/aiBatching'

const prompt = 'Summarize the records in English as JSON.'
const answer = (title: string, summary: string) => JSON.stringify({ title, summary })

test('context preferences accept bounded integers and normalize missing legacy values', () => {
  for (const value of [2048, 4096, 32768, 2097152]) assert.equal(isAiContextLength(value), true)
  for (const value of [null, undefined, '', '4096', 2047, 2097153, 8192.5, NaN, Infinity]) {
    assert.equal(isAiContextLength(value), false)
    assert.equal(normalizeAiContextLength(value), DEFAULT_AI_CONTEXT_LENGTH)
  }
})

test('splitting preserves Unicode, whitespace and all source text inside the reserved request budget', () => {
  const text = '제목\n🙂 한글 日本語 中文\n\nconst x = 42;\n'.repeat(400)
  const parts = splitSummaryText(text, 301)
  assert.equal(parts.join(''), text)
  assert.ok(parts.every(part => estimateSummaryTokens(part) <= 301 && !part.includes('\ufffd')))
  const contextLength = 4096
  const { inputTokens, maxOutputTokens } = summaryBudget(contextLength, prompt)
  const batches = packSummarySources([{ text }], inputTokens)
  assert.ok(batches.length > 1)
  for (const batch of batches) {
    assert.ok(summaryBatchCost(batch) <= inputTokens)
    assert.ok(summaryBatchCost(batch) + estimateSummaryTokens(prompt) + maxOutputTokens + 256 + 32 <= contextLength)
  }
  assert.equal(batches.map(batch => batch.text.replace(/\[Source \d+, part \d+\]\n/g, '')).join(''), text)
})

test('captures are budgeted and kept across batches rather than silently capped at ten overall', () => {
  const batches = packSummarySources(Array.from({ length: 15 }, (_, i) => ({ text: `capture ${i}`, image: `image-${i}` })), 12000)
  assert.deepEqual(batches.flatMap(batch => batch.images), Array.from({ length: 15 }, (_, i) => `image-${i}`))
  assert.ok(batches.every(batch => summaryBatchCost(batch) <= 12000 && batch.images.length <= 10))
  assert.throws(() => packSummarySources([{ text: 'capture', image: 'image' }], 1024), SummaryBatchError)
})

test('small input uses one call and large input is sequentially summarized and merged', async () => {
  let active = 0, calls = 0
  const fragments: string[] = []
  const result = await summarizeInBatches([{ text: 'start ' + 'detail '.repeat(2500) + ' end' }], {
    contextLength: 4096, systemPrompt: prompt,
    request: async (batch, outputTokens) => {
      assert.equal(active++, 0)
      calls++
      assert.ok(outputTokens > 0 && outputTokens <= 512)
      assert.ok(summaryBatchCost(batch) <= summaryBudget(4096, prompt).inputTokens)
      fragments.push(batch.text)
      await Promise.resolve()
      active--
      return answer('Summary', batch.text.includes('Summary\n') ? 'Merged result' : `Part ${calls}`)
    },
  })
  assert.ok(calls > 2)
  assert.ok(fragments[0].includes('start '))
  assert.ok(fragments.some(text => text.includes(' end')))
  assert.equal(result.summary, 'Merged result')
  calls = 0
  await summarizeInBatches([{ text: 'one small note' }], { contextLength: 4096, systemPrompt: prompt,
    request: async () => { calls++; return answer('Small', 'Done') } })
  assert.equal(calls, 1)
})

test('verbose intermediate output retains every part without a non-terminating merge loop', async () => {
  let calls = 0
  const result = await summarizeInBatches([{ text: 'x'.repeat(10000) }], { contextLength: 2048, systemPrompt: prompt,
    request: async () => { calls++; return answer(`Part ${calls}`, `result-${calls}:` + 'z'.repeat(1600)) } })
  assert.ok(calls > 1 && calls < 20)
  for (let i = 1; i <= calls; i++) assert.ok(result.summary.includes(`result-${i}:`))
})

test('local context errors reduce later requests while other errors are not retried', async () => {
  let failed = false, calls = 0
  const result = await summarizeInBatches([{ text: 'x'.repeat(9000) }], { contextLength: 4096, systemPrompt: prompt,
    request: async batch => {
      calls++
      if (!failed) { failed = true; throw new Error('maximum context length exceeded') }
      assert.ok(summaryBatchCost(batch) < 2000)
      return answer('Short', 'Complete')
    } })
  assert.ok(calls > 2)
  assert.equal(result.summary, 'Complete')
  calls = 0
  await assert.rejects(summarizeInBatches([{ text: 'x'.repeat(9000) }], { contextLength: 4096, systemPrompt: prompt,
    request: async () => { calls++; throw new Error('invalid API key') } }), /invalid API key/)
  assert.equal(calls, 1)
})

test('cancellation and empty output stop subsequent calls', async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(summarizeInBatches([{ text: 'x'.repeat(9000) }], { contextLength: 4096, systemPrompt: prompt, signal: controller.signal,
    request: async () => { calls++; controller.abort(); return answer('First', 'First part') } }))
  assert.equal(calls, 1)
  await assert.rejects(summarizeInBatches([{ text: 'small' }], { contextLength: 4096, systemPrompt: prompt,
    request: async () => answer('Empty', '') }), error => error instanceof SummaryBatchError && error.code === 'EMPTY_RESPONSE')
})
