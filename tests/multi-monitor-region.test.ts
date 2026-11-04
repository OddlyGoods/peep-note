import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { createMultiMonitorRegion, parseRectangleSelection } from '../electron/multiMonitorRegion'

const displays = [
  { id: 21, bounds: { x: -1920, y: -200, width: 1920, height: 1080 }, workArea: { x: -1920, y: -160, width: 1920, height: 1040 } },
  { id: 42, bounds: { x: 0, y: 0, width: 1280, height: 800 }, workArea: { x: 0, y: 0, width: 1280, height: 800 } },
]
const png = 'data:image/png;base64,cG5n'
const region = (index: number) => ({ x: 10, y: 20, width: 80, height: 60,
  canvasWidth: displays[index].bounds.width, canvasHeight: displays[index].bounds.height })
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function fixture(mode: 'screenshot' | 'recording-region', overrides: Partial<Parameters<typeof createMultiMonitorRegion>[0]> = {}) {
  const ipc = new EventEmitter(), screen = new EventEmitter(), windows: any[] = [], errors: unknown[] = []
  const session = createMultiMonitorRegion({ mode, displays, preferredDisplayId: 42, language: 'ko',
    snapshots: mode === 'screenshot' ? new Map([[21, png], [42, 'data:image/png;base64,b3RoZXI=']]) : undefined,
    ipc: ipc as any, screen: screen as any,
    createWindow(display) {
      const window: any = new EventEmitter(), webContents: any = new EventEmitter(), messages: any[] = []
      Object.assign(webContents, { messages, send: (...args: any[]) => messages.push(args) })
      Object.assign(window, { webContents, destroyed: false, visible: false, focused: false,
        isDestroyed: () => window.destroyed, isVisible: () => window.visible, getContentBounds: () => ({ ...display.bounds }),
        showInactive: () => { window.visible = true }, focus: () => { window.focused = true },
        close: () => { window.destroyed = true; window.visible = false; window.emit('closed') } })
      windows.push(window); return window
    }, load: async () => {}, onError: error => { errors.push(error) }, ...overrides,
  })
  const send = (index: number, channel: string, value?: unknown) => ipc.emit(channel, { sender: windows[index].webContents }, value)
  const ready = () => { send(0, 'snipping-ready'); send(1, 'snipping-ready') }
  return { ipc, screen, windows, errors, session, send, ready }
}
for (const mode of ['screenshot', 'recording-region'] as const) {
  for (const index of [0, 1]) test(`${mode} waits for both rendered viewports and selects monitor ${index + 1} directly`, async () => {
    const f = fixture(mode)
    await flush()
    assert.ok(f.windows.every(window => !window.visible))
    f.send(index, 'snipping-ready')
    assert.ok(f.windows.every(window => !window.visible), 'do not reveal partially ready selectors')
    f.ready()
    assert.ok(f.windows.every(window => window.visible))
    assert.equal(f.windows[1].focused, true)
    for (const [n, window] of f.windows.entries()) {
      const init = window.webContents.messages[0][1]
      assert.equal(init.live, mode === 'recording-region')
      assert.equal(init.canChangeMonitor, false)
      assert.equal(init.hintTop, n ? 48 : 60)
      assert.equal(Boolean(init.dataUrl), mode === 'screenshot')
    }
    f.ipc.emit('snipping-cancel', { sender: {} })
    f.send(index, mode === 'screenshot' ? 'recording-region-done' : 'snipping-done', mode === 'screenshot' ? region(index) : png)
    assert.ok(f.windows.every(window => window.visible), 'other renderer and wrong-mode messages cannot finish a selection')
    f.send(index, mode === 'screenshot' ? 'snipping-done' : 'recording-region-done', mode === 'screenshot' ? png : region(index))
    assert.deepEqual(await f.session.result, mode === 'screenshot' ? { mode, displayId: displays[index].id, dataUrl: png }
      : { mode, displayId: displays[index].id, region: region(index) })
    assert.ok(f.windows.every(window => window.destroyed))
    assert.deepEqual(f.ipc.eventNames(), [])
    assert.deepEqual(f.screen.eventNames(), [])
    assert.deepEqual(f.errors, [])
  })
}

test('invalid recording coordinates stay open for retry and cannot escape the selected monitor', async () => {
  const f = fixture('recording-region'); await flush(); f.ready()
  f.send(0, 'recording-region-done', region(1))
  assert.ok(f.windows.every(window => window.visible))
  assert.equal(f.windows[0].webContents.messages.at(-1)[0], 'snipping-error')
  f.send(0, 'recording-region-done', region(0))
  assert.equal((await f.session.result)?.displayId, 21)
  for (const invalid of [null, {}, { ...region(0), x: -1 }, { ...region(0), width: 9000 }, { ...region(0), height: Infinity }]) {
    assert.equal(parseRectangleSelection(invalid, 1920, 1080), null)
  }
})

test('Escape, monitor changes, load failures and destroyed windows close all selectors and listeners', async () => {
  for (const cause of ['Escape', 'display-added', 'display-removed', 'display-metrics-changed', 'closed', 'render-process-gone']) {
    const f = fixture('screenshot'); await flush(); f.ready()
    if (cause === 'Escape') f.windows[1].webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'Escape' })
    else if (cause === 'closed') {
      const window = f.windows[0]; window.destroyed = true
      Object.defineProperty(window, 'webContents', { get() { throw new Error('Object has been destroyed') } })
      window.emit('closed')
    } else if (cause === 'render-process-gone') f.windows[0].webContents.emit(cause)
    else f.screen.emit(cause)
    assert.equal(await f.session.result, null)
    assert.ok(f.windows.every(window => window.destroyed))
    assert.deepEqual(f.ipc.eventNames(), [])
    assert.deepEqual(f.screen.eventNames(), [])
  }
  for (const overrides of [{ snapshots: new Map<number, string>() }, { load: async () => { throw new Error('load failed') } }]) {
    const f = fixture('screenshot', overrides)
    assert.equal(await f.session.result, null)
    assert.equal(f.errors.length, 1)
    assert.ok(f.windows.every(window => window.destroyed))
    assert.deepEqual(f.ipc.eventNames(), [])
  }
})
