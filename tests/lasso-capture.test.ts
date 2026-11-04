import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { DEFAULT_HOTKEYS, getActiveHotkeys, resolveHotkeys } from '../shared/hotkeys'
import { createLiveCapture } from '../electron/liveCapture'
import { parseLassoCapture } from '../shared/lassoCapture'

const lasso = require('../public/lasso.js')
const triangle = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 10, y: 70 }]
function canvasFixture() {
  const operations: any[] = []
  const context: any = {}
  for (const method of ['fillRect', 'save', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'clip', 'drawImage', 'restore', 'clearRect', 'setLineDash', 'stroke', 'strokeRect', 'scale', 'fill']) {
    context[method] = (...args: any[]) => operations.push([method, ...args])
  }
  const canvas = { width: 200, height: 120, style: {}, getContext: () => context, toDataURL: () => 'data:image/png;base64,cG5n' }
  return { canvas, context, operations }
}

test('lasso closes an open outline, clamps it to the screen and rejects tiny or invalid paths', () => {
  assert.deepEqual(lasso.selection(triangle, 200, 120).bounds, { x: 10, y: 10, width: 80, height: 60 })
  assert.deepEqual(lasso.selection([...triangle].reverse(), 200, 120).bounds, lasso.selection(triangle, 200, 120).bounds)
  assert.deepEqual(lasso.selection([{ x: -10, y: -10 }, { x: 250, y: 0 }, { x: 0, y: 150 }], 200, 120).bounds, { x: 0, y: 0, width: 200, height: 120 })
  for (const points of [[], [{ x: 3, y: 4 }], [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }], [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 }], [...triangle, { x: NaN, y: 0 }]]) {
    assert.equal(lasso.selection(points, 200, 120), null)
  }
})

test('crop includes a scaled screen-pixel margin, clamps it at screen edges and masks everything beyond it', () => {
  const layers: ReturnType<typeof canvasFixture>[] = []
  const makeCanvas = () => { const layer = canvasFixture(); layers.push(layer); return layer.canvas }
  const image = { naturalWidth: 400, naturalHeight: 240 }
  const result = lasso.crop(image, triangle, 200, 120, makeCanvas)
  assert.equal(result.width, 212)
  assert.equal(result.height, 172)
  const [output, mask] = layers
  assert.equal(output.context.fillStyle, '#ffffff')
  assert.deepEqual(output.operations[0], ['fillRect', 0, 0, 212, 172])
  assert.deepEqual(mask.operations.find(item => item[0] === 'scale'), ['scale', 2, 2])
  assert.deepEqual(mask.operations.find(item => item[0] === 'moveTo'), ['moveTo', 10, 10])
  assert.equal(mask.context.lineWidth, 32)
  assert.equal(mask.context.lineJoin, 'round')
  assert.equal(mask.context.globalCompositeOperation, 'source-in')
  const close = mask.operations.findIndex(item => item[0] === 'closePath')
  const fill = mask.operations.findIndex(item => item[0] === 'fill')
  const stroke = mask.operations.findIndex(item => item[0] === 'stroke')
  const draw = mask.operations.findIndex(item => item[0] === 'drawImage')
  assert.ok(close < fill && fill < stroke && stroke < draw)
  assert.deepEqual(mask.operations[fill], ['fill', 'evenodd'])
  assert.deepEqual(output.operations.at(-1), ['drawImage', mask.canvas, 0, 0])
  assert.equal(lasso.crop(image, [], 200, 120, () => { throw new Error('must not allocate for an invalid path') }), null)
  const fullScreen = lasso.crop(image, [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 120 }], 200, 120, makeCanvas)
  assert.equal(fullScreen.width, image.naturalWidth)
  assert.equal(fullScreen.height, image.naturalHeight)
})

function rendererFixture() {
  const frame = canvasFixture()
  const elements: Record<string, any> = { c: frame.canvas }
  const events: Record<string, Record<string, Function>> = {}
  const ipc: Record<string, Function> = {}
  const captured: string[] = [], regions: any[] = [], liveRequests: any[] = []
  const outputCanvases: ReturnType<typeof canvasFixture>[] = []
  let renderFrame: Function | undefined
  let cancellations = 0, monitorChanges = 0, imageLoads = 0
  for (const id of ['c', 'size-badge', 'hint', 'hint-text', 'change-monitor']) {
    elements[id] ??= { style: {}, textContent: '' }
    events[id] = {}
    elements[id].addEventListener = (name: string, listener: Function) => { events[id][name] = listener }
  }
  const held = new Set<number>()
  Object.assign(frame.canvas, { getBoundingClientRect: () => ({ left: 0, top: 0, width: frame.canvas.width, height: frame.canvas.height }),
    setPointerCapture: (id: number) => held.add(id), hasPointerCapture: (id: number) => held.has(id), releasePointerCapture: (id: number) => held.delete(id) })
  const documentEvents: Record<string, Function> = {}
  const bridge = { on: (name: string, listener: Function) => { ipc[name] = listener }, snippingDone: (value: string) => captured.push(value),
    snippingCancel: () => cancellations++, requestLassoCapture: (value: any) => liveRequests.push(value), recordingRegionDone: (value: any) => regions.push(value), changeSnippingMonitor: () => monitorChanges++ }
  const context = { window: { electronAPI: bridge, PeepNoteLasso: lasso, innerWidth: 200, innerHeight: 120, addEventListener() {} },
    document: { documentElement: { lang: '', classList: { toggle() {} } }, getElementById: (id: string) => elements[id], addEventListener: (name: string, listener: Function) => { documentEvents[name] = listener },
      createElement: () => { const output = canvasFixture(); outputCanvases.push(output); return output.canvas } },
    Image: class { naturalWidth = 400; naturalHeight = 240; onload: any; set src(_value: string) { imageLoads++; this.onload() } },
    requestAnimationFrame: (callback: Function) => { renderFrame = callback; return 1 } }
  // The production crop helper uses document only to create the output canvas.
  const nativeCrop = lasso.crop
  context.window.PeepNoteLasso = { ...lasso, crop: (...args: any[]) => nativeCrop(...args, () => context.document.createElement()) }
  const html = fs.readFileSync(path.join(__dirname, '../public/snipping.html'), 'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
  vm.runInNewContext(script, context)
  const init = (mode = 'lasso', language = 'ko', live = false, canChangeMonitor = true) => ipc['snipping-init']({ mode, language, live, canChangeMonitor, dataUrl: live ? undefined : 'test-image', width: 200, height: 120 })
  const pointer = (name: string, x: number, y: number) => events.c[name]({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {} })
  return { init, pointer, captured, regions, liveRequests, outputCanvases, held, events, ipc, elements, documentEvents, frame,
    render: () => { const callback = renderFrame; renderFrame = undefined; callback?.() },
    get imageLoads() { return imageLoads },
    get cancellations() { return cancellations }, get monitorChanges() { return monitorChanges } }
}

test('live preview draws an open yellow marker while the resulting capture still closes its clipping area', () => {
  const fixture = rendererFixture()
  fixture.init('lasso', 'ko', true)
  fixture.pointer('pointerdown', 10, 10)
  fixture.pointer('pointermove', 90, 10)
  fixture.pointer('pointermove', 10, 70)
  fixture.frame.operations.length = 0
  fixture.render()
  assert.ok(fixture.frame.operations.some(item => item[0] === 'stroke'))
  assert.equal(fixture.frame.operations.some(item => item[0] === 'closePath'), false)
  assert.equal(fixture.frame.context.strokeStyle, 'rgba(250, 204, 21, 0.65)')
  assert.equal(fixture.frame.context.lineWidth, 8)
  assert.equal(fixture.frame.context.lineCap, 'round')
  assert.equal(fixture.frame.operations.find(item => item[0] === 'setLineDash')?.[1].length, 0)
  fixture.pointer('pointerup', 10, 70)
  fixture.ipc['lasso-source']('captured-source')
  assert.equal(fixture.captured.length, 1)
  const operations = fixture.outputCanvases[1].operations
  assert.ok(operations.findIndex(item => item[0] === 'closePath') < operations.findIndex(item => item[0] === 'fill'))
})

test('renderer auto-closes a freehand drag, allows retry after a tiny selection, and supports cancel and monitor reset', () => {
  const fixture = rendererFixture()
  fixture.init()
  assert.equal(fixture.elements['hint-text'].textContent, '드래그로 영역지정 · Esc 취소')
  fixture.pointer('pointerdown', 10, 10)
  assert.equal(fixture.held.size, 1)
  fixture.pointer('pointerup', 11, 11)
  assert.equal(fixture.captured.length, 0)
  assert.equal(fixture.cancellations, 0)
  assert.ok(fixture.elements['hint-text'].textContent.includes('더 넓은'))
  fixture.pointer('pointerdown', 10, 10)
  fixture.pointer('pointermove', 90, 10)
  fixture.pointer('pointerup', 10, 70)
  assert.equal(fixture.captured.length, 1)
  assert.equal(fixture.held.size, 0)
  assert.equal(fixture.outputCanvases[0].canvas.width, 212)
  fixture.pointer('pointerdown', 50, 50)
  fixture.events['change-monitor'].click()
  assert.equal(fixture.monitorChanges, 1)
  assert.equal(fixture.held.size, 0)
  fixture.init('lasso', 'en')
  assert.ok(fixture.elements['hint-text'].textContent.includes('Drag to select'))
  fixture.pointer('pointerup', 100, 100)
  assert.equal(fixture.captured.length, 1)
  fixture.documentEvents.keydown({ key: 'Escape' })
  assert.equal(fixture.cancellations, 1)
})

test('rectangle capture and rectangular recording selection retain their original behavior', () => {
  const fixture = rendererFixture()
  fixture.init('screenshot', 'en')
  fixture.pointer('pointerdown', 80, 70)
  fixture.pointer('pointerup', 10, 20)
  assert.equal(fixture.captured.length, 1)
  assert.equal(fixture.outputCanvases[0].canvas.width, 70)
  assert.equal(fixture.outputCanvases[0].canvas.height, 50)
  fixture.init('recording-region', 'ja')
  fixture.pointer('pointerdown', 10, 20)
  fixture.pointer('pointerup', 90, 70)
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.regions[0])), { x: 10, y: 20, width: 80, height: 50, canvasWidth: 200, canvasHeight: 120 })
  assert.equal(fixture.captured.length, 1)
  fixture.init('lasso', 'zh')
  fixture.pointer('pointerdown', 20, 20)
  fixture.events.c.pointercancel()
  fixture.pointer('pointerup', 90, 90)
  assert.equal(fixture.captured.length, 1)
})

test('Alt+S is a distinct, backward-compatible and disableable default shortcut', () => {
  assert.equal(DEFAULT_HOTKEYS.captureFreeform, 'Alt+S')
  assert.equal(new Set(Object.values(DEFAULT_HOTKEYS)).size, Object.keys(DEFAULT_HOTKEYS).length)
  assert.equal(resolveHotkeys({ takeScreenshot: 'Ctrl+Alt+2' }).captureFreeform, 'Alt+S')
  assert.equal(resolveHotkeys({ openOverlay: 'Alt+S' }).captureFreeform, 'Alt+Shift+S')
  assert.equal(resolveHotkeys({ openOverlay: 'S+Alt', takeScreenshot: 'Shift+Alt+S' }).captureFreeform, 'Control+Alt+S')
  assert.equal(resolveHotkeys({ captureFreeform: 'Control+Shift+5' }).captureFreeform, 'Control+Shift+5')
  const migrated = resolveHotkeys({ captureFreeform: 'Alt+5', disabled: { captureFreeform: true } })
  assert.equal(migrated.captureFreeform, 'Alt+S')
  assert.equal(migrated.disabled?.captureFreeform, true)
  assert.equal(resolveHotkeys({ ...migrated, captureFreeform: 'Alt+5' }).captureFreeform, 'Alt+5')
  assert.equal(getActiveHotkeys({ disabled: { captureFreeform: true } }).captureFreeform, '')
  assert.equal(getActiveHotkeys({ disabled: { captureFreeform: true } }).takeScreenshot, 'Alt+2')
})

test('live drawing starts without loading a screenshot and only requests an image after a valid drag', () => {
  const fixture = rendererFixture()
  fixture.init('lasso', 'ko', true)
  assert.equal(fixture.imageLoads, 0)
  fixture.pointer('pointerdown', 10, 10)
  fixture.pointer('pointerup', 11, 11)
  assert.equal(fixture.liveRequests.length, 0)
  fixture.pointer('pointerdown', 10, 10)
  fixture.pointer('pointermove', 90, 10)
  fixture.pointer('pointerup', 10, 70)
  assert.equal(fixture.imageLoads, 0)
  assert.equal(fixture.captured.length, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.liveRequests)), [{ points: triangle, width: 200, height: 120 }])
  fixture.ipc['lasso-source']('fresh-screenshot-after-pointer-release')
  assert.equal(fixture.imageLoads, 1)
  assert.equal(fixture.captured.length, 1)
  assert.equal(fixture.outputCanvases[0].canvas.width, 212)
  fixture.ipc['lasso-source']('duplicate-source')
  assert.equal(fixture.captured.length, 1)
})

test('all-monitor Magic Pen hides the monitor picker while rectangle capture retains it', () => {
  const fixture = rendererFixture()
  fixture.init('lasso', 'en', true, false)
  assert.equal(fixture.elements['change-monitor'].style.display, 'none')
  fixture.init('screenshot', 'en')
  assert.equal(fixture.elements['change-monitor'].style.display, '')
})

test('live capture hides the selector before taking the first screenshot and rejects duplicate requests', async () => {
  const calls: string[] = []
  let release!: () => void
  const capture = createLiveCapture({ hide: () => calls.push('hide'), wait: () => new Promise(resolve => { release = resolve }),
    capture: async () => { calls.push('capture'); return 'fresh-source' }, deliver: source => calls.push(source), onError: () => calls.push('error') })
  assert.deepEqual(calls, [])
  const running = capture.start()
  assert.deepEqual(calls, ['hide'])
  await capture.start()
  release()
  await running
  assert.deepEqual(calls, ['hide', 'capture', 'fresh-source'])
  assert.equal(capture.pending, true)
})

test('cancelling live capture during compositor wait or source acquisition prevents late delivery', async () => {
  for (const cancelDuringCapture of [false, true]) {
    let release!: () => void
    let calls = 0, delivered = false
    const pause = () => new Promise<void>(resolve => { release = resolve })
    const capture = createLiveCapture({ hide() {}, wait: cancelDuringCapture ? async () => {} : pause,
      capture: async () => { calls++; if (cancelDuringCapture) await pause(); return 'source' }, deliver: () => { delivered = true }, onError() {} })
    const running = capture.start()
    if (cancelDuringCapture) await Promise.resolve()
    capture.dispose()
    release()
    await running
    assert.equal(calls, cancelDuringCapture ? 1 : 0)
    assert.equal(delivered, false)
  }
})

test('live selection IPC accepts only bounded points in the active viewport', () => {
  const value = { points: triangle, width: 200, height: 120 }
  assert.deepEqual(parseLassoCapture(value, 200, 120), value)
  assert.deepEqual(parseLassoCapture(value, 199, 119), value)
  assert.deepEqual(parseLassoCapture(value, 202, 122), value)
  assert.equal(parseLassoCapture(value, 197, 117), null)
  for (const invalid of [null, {}, { ...value, width: 400 }, { ...value, points: triangle.slice(0, 2) },
    { ...value, points: [...triangle, { x: Infinity, y: 0 }] }, { ...value, points: [...triangle, { x: -1, y: 0 }] },
    { ...value, points: Array.from({ length: 8193 }, () => ({ x: 10, y: 10 })) }]) {
    assert.equal(parseLassoCapture(invalid, 200, 120), null)
  }
})

test('a rejected capture clears the pending selection and lets the user retry with visible guidance', () => {
  const fixture = rendererFixture()
  fixture.init('lasso', 'ko', true)
  const select = () => {
    fixture.pointer('pointerdown', 10, 10)
    fixture.pointer('pointermove', 90, 10)
    fixture.pointer('pointerup', 10, 70)
  }
  select()
  fixture.ipc['snipping-error']()
  assert.ok(fixture.elements['hint-text'].textContent.includes('캡처하지 못했습니다'))
  select()
  assert.equal(fixture.liveRequests.length, 2)
  fixture.ipc['lasso-source']('successful-retry')
  assert.equal(fixture.captured.length, 1)
})

test('a failed native capture can be retried instead of leaving a hidden pending window', async () => {
  let attempts = 0, errors = 0, delivered = 0
  const capture = createLiveCapture({ hide() {}, wait: async () => {},
    capture: async () => { if (++attempts === 1) throw new Error('source unavailable'); return 'source' },
    deliver: () => delivered++, onError: () => errors++ })
  await capture.start()
  assert.equal(errors, 1)
  assert.equal(capture.pending, false)
  await capture.start()
  assert.equal(attempts, 2)
  assert.equal(delivered, 1)
})
