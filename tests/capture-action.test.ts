import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCaptureAction } from '../electron/captureAction'

function fixture() {
  const calls: unknown[] = [], errors: unknown[] = []
  const window = {
    isDestroyed: () => false,
    show: () => { calls.push('show') }, focus: () => { calls.push('focus') },
    webContents: { send: (channel: string, file: unknown) => { calls.push([channel, file]) } }
  }
  return { window, calls, errors, onError: (error: unknown) => { errors.push(error) } }
}

test('capture opens and focuses the composer and delivers the selected image, while cancellation stays closed', async () => {
  const f = fixture()
  let next: string | null = '/example/captured.png'
  const capture = createCaptureAction(async () => next, () => f.window, f.onError)
  await capture()
  assert.deepEqual(f.calls, ['show', 'focus', ['screenshot-captured', next]])
  next = null
  f.calls.length = 0
  await capture()
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.errors, [])
})

test('repeated tray or shortcut activation cannot open duplicate captures and works again after completion', async () => {
  const f = fixture()
  let finish!: (file: string | null) => void, captures = 0
  const action = createCaptureAction(() => { captures++; return new Promise(resolve => { finish = resolve }) }, () => f.window, f.onError)
  const first = action()
  await action()
  assert.equal(captures, 1)
  assert.deepEqual(f.calls, [])
  finish('/example/captured.png')
  await first
  assert.equal(f.calls.length, 3)
  const again = action()
  assert.equal(captures, 2)
  finish(null)
  await again
})

test('capture errors release the guard and do not deliver images to closed or missing composers', async () => {
  const f = fixture()
  let fail = true
  const action = createCaptureAction(async () => {
    if (fail) throw new Error('capture failed')
    return '/example/captured.png'
  }, () => f.window, f.onError)
  await action()
  assert.equal(f.errors.length, 1)
  assert.deepEqual(f.calls, [])
  fail = false
  await action()
  assert.equal(f.calls.length, 3)
  f.calls.length = 0
  for (const window of [null, { ...f.window, isDestroyed: () => true }]) {
    await createCaptureAction(async () => '/example/captured.png', () => window, f.onError)()
  }
  assert.deepEqual(f.calls, [])
})
