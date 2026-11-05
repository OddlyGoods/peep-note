import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleCaptureAnalysisShortcut } from '../electron/captureAnalysisShortcut'

test('Magic Pen shortcut opens a new capture only when no response window or initial selection is active', async () => {
  const calls: string[] = []
  const start = async () => { calls.push('start') }
  const cancelSelection = () => { calls.push('cancel selection') }
  await handleCaptureAnalysisShortcut({ session: null, preparing: false, start, cancelSelection })
  assert.deepEqual(calls, ['start'])
  calls.length = 0
  await handleCaptureAnalysisShortcut({ session: { window: { isDestroyed: () => true }, close: () => { calls.push('close') } },
    preparing: false, start, cancelSelection })
  assert.deepEqual(calls, ['start'], 'a stale destroyed window cannot block the next capture')
})

test('pressing Magic Pen again closes ready or running responses, including a hidden follow-up selection', async () => {
  for (const preparing of [false, true]) {
    const calls: string[] = []
    await handleCaptureAnalysisShortcut({ preparing,
      session: { window: { isDestroyed: () => false }, close: () => { calls.push('close response') } },
      cancelSelection: () => { calls.push('cancel selection') }, start: async () => { calls.push('start') } })
    assert.deepEqual(calls, ['cancel selection', 'close response'])
  }
})

test('pressing Magic Pen during its initial selection cancels that selection without opening another', async () => {
  const calls: string[] = []
  await handleCaptureAnalysisShortcut({ session: null, preparing: true,
    cancelSelection: () => { calls.push('cancel selection') }, start: async () => { calls.push('start') } })
  assert.deepEqual(calls, ['cancel selection'])
})
