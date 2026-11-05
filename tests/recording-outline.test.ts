import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { createRecordingOutline, recordingOutlineBounds, recordingOutlineWindowOptions } from '../electron/recordingOutline'

const display = { x: -1920, y: -200, width: 1920, height: 1080 }
const region = { x: 100.5, y: 100.5, width: 600.25, height: 400.25, canvasWidth: 1920, canvasHeight: 1080 }
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

test('recording outlines stay outside fractional crops on negative-origin and mixed-DPI displays', () => {
  for (const canvasWidth of [1920, 1919, 1922]) {
    const selection = { ...region, canvasWidth }
    const bounds = recordingOutlineBounds(display, selection)
    assert.equal(bounds.length, 4)
    const crop = { x: display.x + selection.x * display.width / canvasWidth, y: display.y + selection.y,
      width: selection.width * display.width / canvasWidth, height: selection.height }
    for (const strip of bounds) {
      assert.equal(overlaps(strip, crop), false)
      assert.ok(Number.isInteger(strip.x) && Number.isInteger(strip.y))
      assert.ok(strip.x >= display.x && strip.y >= display.y)
      assert.ok(strip.x + strip.width <= display.x + display.width)
      assert.ok(strip.y + strip.height <= display.y + display.height)
    }
  }
  assert.deepEqual(recordingOutlineBounds(display, { ...region, x: -1 }), [])
  assert.equal(recordingOutlineBounds(display, { x: 0, y: 0, width: 1920, height: 1080, canvasWidth: 1920, canvasHeight: 1080 }).length, 0)
})

function fixture(delayed = false, failLoad = false) {
  const screen = new EventEmitter(), windows: any[] = [], loads: (() => void)[] = [], rejects: ((error: Error) => void)[] = [], errors: unknown[] = []
  const outline = createRecordingOutline({ screen: screen as any, onError: error => errors.push(error),
    createWindow(bounds) {
      const window: any = new EventEmitter()
      Object.assign(window, { bounds, webContents: new EventEmitter(), visible: false, destroyed: false,
        setIgnoreMouseEvents: (value: boolean) => { window.clickThrough = value },
        setAlwaysOnTop: (value: boolean) => { window.onTop = value }, setVisibleOnAllWorkspaces: () => {}, setContentProtection: () => {},
        isDestroyed: () => window.destroyed,
        showInactive: () => { window.visible = true },
        destroy: () => { window.destroyed = true; window.visible = false; window.emit('closed') },
      })
      windows.push(window); return window
    },
    load: () => failLoad ? Promise.reject(new Error('Fixture load failed')) : delayed ? new Promise((resolve, reject) => { loads.push(() => resolve(undefined)); rejects.push(reject) }) : Promise.resolve(),
  })
  return { outline, screen, windows, loads, rejects, errors }
}

test('recording boundaries are click-through, only appear after recording starts and disappear on stop', async () => {
  const f = fixture()
  f.outline.prepare(1, display, region)
  assert.equal(f.windows.length, 0, 'selecting a region must not paint anything before capture is ready')
  await f.outline.start(1)
  assert.equal(f.windows.length, 4)
  assert.ok(f.windows.every(win => win.visible && win.clickThrough && win.onTop))
  await f.outline.start(1)
  assert.equal(f.windows.length, 4, 'duplicate active events do not create extra outlines')
  f.outline.stop(1)
  assert.ok(f.windows.every(win => win.destroyed))
  // React's recording-state effect cleanup sends false before sending true.
  await f.outline.start(1)
  assert.equal(f.windows.length, 8)
  f.outline.dispose()
  assert.ok(f.windows.every(win => win.destroyed))
  assert.equal(f.screen.eventNames().length, 0)
})

test('closing while the outline is loading cannot leave orphan windows or show late frames', async () => {
  const f = fixture(true)
  f.outline.prepare(1, display, region)
  const pending = f.outline.start(1)
  f.outline.stop(1)
  f.loads.forEach(resolve => resolve())
  await pending
  assert.ok(f.windows.every(win => win.destroyed && !win.visible))
  f.outline.dispose()
})

test('owner and display cleanup removes recording outlines without stopping another owner', async () => {
  const f = fixture()
  f.outline.prepare(1, display, region); f.outline.prepare(2, display, region)
  await f.outline.start(1); await f.outline.start(2)
  f.outline.forget(1)
  assert.ok(f.windows.slice(0, 4).every(win => win.destroyed))
  assert.ok(f.windows.slice(4).every(win => win.visible))
  await f.outline.start(1)
  assert.equal(f.windows.length, 8)
  f.screen.emit('display-removed')
  assert.ok(f.windows.every(win => win.destroyed))
  f.outline.dispose()
})

test('recording outlines use noninteractive dock surfaces on Linux and close every edge if one is closed', async () => {
  const options = recordingOutlineWindowOptions({ x: 20, y: 30, width: 50, height: 2 }, 'linux')
  assert.equal(options.type, 'dock')
  assert.equal(options.focusable, false)
  assert.equal(options.webPreferences?.javascript, false)
  const f = fixture(true)
  f.outline.prepare(1, display, region)
  const pending = f.outline.start(1)
  f.windows[0].destroy()
  f.loads.forEach(resolve => resolve())
  await pending
  assert.ok(f.windows.every(win => win.destroyed))
  f.outline.dispose()
})

test('a failed outline load removes all edge windows while recording can continue', async () => {
  const f = fixture(false, true)
  f.outline.prepare(1, display, region)
  await f.outline.start(1)
  assert.equal(f.errors.length, 1)
  assert.ok(f.windows.every(win => win.destroyed))
  f.outline.dispose()
})

test('a late failure from a cancelled outline cannot close its replacement', async () => {
  const f = fixture(true)
  f.outline.prepare(1, display, region)
  const old = f.outline.start(1)
  f.outline.prepare(1, display, region)
  const replacement = f.outline.start(1)
  f.rejects[0](new Error('ERR_ABORTED'))
  f.loads.forEach(resolve => resolve())
  await old; await replacement
  assert.ok(f.windows.slice(0, 4).every(win => win.destroyed))
  assert.ok(f.windows.slice(4).every(win => win.visible && !win.destroyed))
  assert.deepEqual(f.errors, [])
  f.outline.dispose()
})
