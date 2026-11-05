import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleCaptureAnalysisShortcut } from '../electron/captureAnalysisShortcut'

function windowFixture(calls: string[], destroyed = false, minimized = false) {
  return { isDestroyed: () => destroyed, isMinimized: () => minimized,
    restore: () => { calls.push('restore') }, show: () => { calls.push('show') }, focus: () => { calls.push('focus') } }
}

test('Magic Pen shortcut opens a new capture only when no response window or initial selection is active', async () => {
  const calls: string[] = []
  const start = async () => { calls.push('start') }
  const cancelSelection = () => { calls.push('cancel selection') }
  await handleCaptureAnalysisShortcut({ session: null, preparing: false, start, cancelSelection })
  assert.deepEqual(calls, ['start'])
  calls.length = 0
  await handleCaptureAnalysisShortcut({ session: { window: windowFixture(calls, true) }, preparing: false, start, cancelSelection })
  assert.deepEqual(calls, ['start'], 'a closed window allows the next shortcut to start area selection')
})

test('pressing Magic Pen again shows and focuses its existing conversation, including a hidden follow-up selection', async () => {
  for (const preparing of [false, true]) {
    const calls: string[] = []
    await handleCaptureAnalysisShortcut({ preparing, session: { window: windowFixture(calls) },
      cancelSelection: () => { calls.push('cancel selection') }, start: async () => { calls.push('start') } })
    assert.deepEqual(calls, ['cancel selection', 'show', 'focus'])
  }
})

test('Magic Pen restores a minimized response before bringing it to the foreground', async () => {
  const calls: string[] = []
  await handleCaptureAnalysisShortcut({ preparing: false, session: { window: windowFixture(calls, false, true) },
    cancelSelection: () => { calls.push('cancel selection') }, start: async () => { calls.push('start') } })
  assert.deepEqual(calls, ['cancel selection', 'restore', 'show', 'focus'])
})

test('pressing Magic Pen during its initial selection cancels that selection without opening another', async () => {
  const calls: string[] = []
  await handleCaptureAnalysisShortcut({ session: null, preparing: true,
    cancelSelection: () => { calls.push('cancel selection') }, start: async () => { calls.push('start') } })
  assert.deepEqual(calls, ['cancel selection'])
})
