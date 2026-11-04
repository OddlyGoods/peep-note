import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProgressiveText } from '../electron/progressiveText'

test('buffered CLI answers reveal progressively and finish with the exact original Markdown', async () => {
  const answer = '## 답변\n\n설명 🙂\n\n```sh\nexample command\n```', updates: string[] = []
  const stream = new ProgressiveText(new AbortController().signal, text => updates.push(text))
  try {
    await stream.finish(answer)
    assert.ok(updates.length > 2)
    assert.ok(updates[0].length < answer.length)
    assert.equal(updates.at(-1), answer)
    for (const text of updates) {
      assert.ok(answer.startsWith(text))
      assert.doesNotMatch(text, /[\uD800-\uDBFF]$/)
    }
  } finally { stream.dispose() }
})

test('closing a progressive answer cancels pending display and cannot leak into the next answer', async () => {
  const controller = new AbortController(), updates: string[] = []
  const stream = new ProgressiveText(controller.signal, text => updates.push(text))
  const pending = stream.finish('unfinished answer '.repeat(100))
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  stream.update('stale callback')
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.deepEqual(updates, [])
})
