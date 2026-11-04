import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { createMultiMonitorLasso, lassoWindowOptions } from '../electron/multiMonitorLasso'

const displays = [
  { id: 21, bounds: { x: -1920, y: -200, width: 1920, height: 1080 } },
  { id: 42, bounds: { x: 0, y: 0, width: 1280, height: 800 } },
]
const png = 'data:image/png;base64,cG5n'
const selection = (index: number) => ({ points: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 10, y: 70 }],
  width: displays[index].bounds.width, height: displays[index].bounds.height })
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function fixture(overrides: Partial<Parameters<typeof createMultiMonitorLasso>[0]> = {}) {
  const ipc = new EventEmitter(), screen = new EventEmitter(), windows: any[] = [], captured: number[] = [], errors: unknown[] = []
  const session = createMultiMonitorLasso({
    displays, preferredDisplayId: 42, language: 'ko', ipc: ipc as any, screen: screen as any,
    createWindow(display) {
      const window: any = new EventEmitter(), webContents: any = new EventEmitter(), messages: any[] = []
      Object.assign(webContents, { messages, send: (...args: any[]) => messages.push(args) })
      Object.assign(window, { webContents, destroyed: false, visible: false, focused: false,
        isDestroyed: () => window.destroyed, isVisible: () => window.visible, getContentBounds: () => ({ ...display.bounds }),
        showInactive: () => { window.visible = true }, focus: () => { window.focused = true }, hide: () => { window.visible = false },
        close: () => { window.destroyed = true; window.visible = false; window.emit('closed') } })
      windows.push(window)
      return window
    },
    load: async () => {}, wait: async () => {}, capture: async id => { captured.push(id); return png },
    onError: error => { errors.push(error) }, ...overrides,
  })
  const send = (index: number, channel: string, value?: unknown) => ipc.emit(channel, { sender: windows[index].webContents }, value)
  return { ipc, screen, windows, captured, errors, session, send }
}

test('Linux selectors use overlay window placement while Windows keeps its native window type', () => {
  for (const display of displays) {
    const linux = lassoWindowOptions(display, 'linux'), windows = lassoWindowOptions(display, 'win32')
    assert.equal(linux.type, 'dock')
    assert.equal(windows.type, undefined)
    for (const options of [linux, windows]) {
      assert.equal(options.x, display.bounds.x)
      assert.equal(options.y, display.bounds.y)
      assert.equal(options.alwaysOnTop, true)
      assert.equal(options.transparent, true)
      assert.equal(options.frame, false)
    }
  }
})

test('monitor hints stay below a top desktop panel, including displays with negative origins', async () => {
  const f = fixture({ displays: displays.map((display, index) => ({ ...display,
    workArea: { ...display.bounds, y: display.bounds.y + (index === 0 ? 27 : 0) } })) })
  await flush()
  assert.deepEqual(f.windows.map(window => window.webContents.messages[0][1].hintTop), [41, 14])
  f.session.close()
  assert.equal(await f.session.result, null)
})

for (const index of [0, 1]) {
  test(`Magic Pen selects monitor ${index + 1} directly and hides every overlay before capture`, async () => {
    const f = fixture()
    await flush()
    assert.equal(f.windows.length, 2)
    assert.ok(f.windows.every(window => window.visible))
    assert.equal(f.windows[0].focused, false)
    assert.equal(f.windows[1].focused, true)
    assert.ok(f.windows.every(window => window.webContents.messages[0][1].canChangeMonitor === false))
    f.send(index, 'snipping-capture-lasso', selection(index))
    assert.ok(f.windows.every(window => !window.visible), 'hide all markers before reading the desktop')
    f.send(1 - index, 'snipping-capture-lasso', selection(1 - index))
    await flush()
    assert.deepEqual(f.captured, [displays[index].id])
    assert.ok(f.windows[index].webContents.messages.some((message: any[]) => message[0] === 'lasso-source'))
    assert.ok(!f.windows[1 - index].webContents.messages.some((message: any[]) => message[0] === 'lasso-source'))
    f.send(1 - index, 'snipping-done', png) // cannot spoof the selected window
    assert.equal(f.windows[0].destroyed, false)
    f.send(index, 'snipping-done', png)
    assert.deepEqual(await f.session.result, { dataUrl: png, bounds: {
      x: displays[index].bounds.x + 10, y: displays[index].bounds.y + 10, width: 80, height: 60,
    } })
    assert.ok(f.windows.every(window => window.destroyed))
    assert.deepEqual(f.ipc.eventNames(), [])
    assert.deepEqual(f.screen.eventNames(), [])
  })
}

test('Escape on either monitor closes every overlay; unrelated renderers cannot cancel', async () => {
  for (const index of [0, 1]) {
    const f = fixture()
    await flush()
    f.ipc.emit('snipping-cancel', { sender: {} })
    assert.ok(f.windows.every(window => window.visible))
    f.send(index, 'snipping-cancel')
    assert.equal(await f.session.result, null)
    assert.ok(f.windows.every(window => window.destroyed))
    assert.deepEqual(f.captured, [])
  }
})

test('a failed capture restores both monitors and can retry on a different monitor', async () => {
  let attempts = 0
  const f = fixture({ capture: async () => { if (++attempts === 1) throw new Error('display unavailable'); return png } })
  await flush()
  f.send(0, 'snipping-capture-lasso', selection(0))
  await flush()
  assert.equal(f.errors.length, 1)
  assert.ok(f.windows.every(window => window.visible && window.webContents.messages.some((message: any[]) => message[0] === 'snipping-error')))
  f.send(1, 'snipping-capture-lasso', selection(1))
  await flush()
  f.send(1, 'snipping-done', png)
  assert.ok(await f.session.result)
  assert.equal(attempts, 2)
})

test('disconnect or DPI/layout changes cancel safely while a screenshot is in flight', async () => {
  for (const event of ['display-removed', 'display-metrics-changed']) {
    let release!: (value: string) => void
    const f = fixture({ capture: () => new Promise(resolve => { release = resolve }) })
    await flush()
    f.send(1, 'snipping-capture-lasso', selection(1))
    await flush()
    f.screen.emit(event)
    assert.equal(await f.session.result, null)
    release(png)
    await flush()
    assert.ok(f.windows.every(window => window.destroyed && !window.webContents.messages.some((message: any[]) => message[0] === 'lasso-source')))
    assert.deepEqual(f.ipc.eventNames(), [])
  }
})

test('invalid viewport data is rejected, and renderer/load failures clean up all selectors', async () => {
  const f = fixture()
  await flush()
  f.send(0, 'snipping-capture-lasso', selection(1))
  await flush()
  assert.deepEqual(f.captured, [])
  assert.ok(f.windows.every(window => window.visible))
  f.windows[1].webContents.emit('render-process-gone')
  assert.equal(await f.session.result, null)
  const failure = fixture({ load: async () => { throw new Error('load failed') } })
  assert.equal(await failure.session.result, null)
  assert.ok(failure.windows.every(window => window.destroyed))
  assert.deepEqual(failure.ipc.eventNames(), [])
})

test('closing an already destroyed native window never accesses its webContents during cleanup', async () => {
  const f = fixture()
  await flush()
  const window = f.windows[0]
  window.destroyed = true
  Object.defineProperty(window, 'webContents', { get() { throw new Error('Object has been destroyed') } })
  assert.doesNotThrow(() => window.emit('closed'))
  assert.equal(await f.session.result, null)
  assert.ok(f.windows[1].destroyed)
  assert.deepEqual(f.ipc.eventNames(), [])
})
