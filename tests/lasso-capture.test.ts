import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { DEFAULT_HOTKEYS, getActiveHotkeys, resolveHotkeys } from '../shared/hotkeys'

const lasso = require('../public/lasso.js')
const triangle = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 10, y: 70 }]
function canvasFixture() {
  const operations: any[] = []
  const context: any = {}
  for (const method of ['fillRect', 'save', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'clip', 'drawImage', 'restore', 'clearRect', 'setLineDash', 'stroke', 'strokeRect']) {
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

test('crop uses native screenshot resolution and paints outside the polygon before clipping the original image', () => {
  const fixture = canvasFixture()
  const image = { naturalWidth: 400, naturalHeight: 240 }
  const result = lasso.crop(image, triangle, 200, 120, () => fixture.canvas)
  assert.equal(result.width, 160)
  assert.equal(result.height, 120)
  assert.equal(fixture.context.fillStyle, '#ffffff')
  assert.deepEqual(fixture.operations[0], ['fillRect', 0, 0, 160, 120])
  assert.deepEqual(fixture.operations.find(item => item[0] === 'moveTo'), ['moveTo', 0, 0])
  assert.deepEqual(fixture.operations.filter(item => item[0] === 'lineTo'), [['lineTo', 160, 0], ['lineTo', 0, 120]])
  const clip = fixture.operations.findIndex(item => item[0] === 'clip')
  const draw = fixture.operations.findIndex(item => item[0] === 'drawImage')
  assert.ok(fixture.operations.findIndex(item => item[0] === 'closePath') < clip && clip < draw)
  assert.deepEqual(fixture.operations[clip], ['clip', 'evenodd'])
  assert.deepEqual(fixture.operations[draw], ['drawImage', image, -20, -20])
  assert.equal(lasso.crop(image, [], 200, 120, () => { throw new Error('must not allocate for an invalid path') }), null)
})

function rendererFixture() {
  const frame = canvasFixture()
  const elements: Record<string, any> = { c: frame.canvas }
  const events: Record<string, Record<string, Function>> = {}
  const ipc: Record<string, Function> = {}
  const captured: string[] = [], regions: any[] = []
  const outputCanvases: ReturnType<typeof canvasFixture>[] = []
  let cancellations = 0, monitorChanges = 0
  for (const id of ['c', 'size-badge', 'hint-text', 'change-monitor']) {
    elements[id] ??= { style: {}, textContent: '' }
    events[id] = {}
    elements[id].addEventListener = (name: string, listener: Function) => { events[id][name] = listener }
  }
  const held = new Set<number>()
  Object.assign(frame.canvas, { getBoundingClientRect: () => ({ left: 0, top: 0, width: frame.canvas.width, height: frame.canvas.height }),
    setPointerCapture: (id: number) => held.add(id), hasPointerCapture: (id: number) => held.has(id), releasePointerCapture: (id: number) => held.delete(id) })
  const documentEvents: Record<string, Function> = {}
  const bridge = { on: (name: string, listener: Function) => { ipc[name] = listener }, snippingDone: (value: string) => captured.push(value),
    snippingCancel: () => cancellations++, recordingRegionDone: (value: any) => regions.push(value), changeSnippingMonitor: () => monitorChanges++ }
  const context = { window: { electronAPI: bridge, PeepNoteLasso: lasso, innerWidth: 200, innerHeight: 120 },
    document: { documentElement: { lang: '' }, getElementById: (id: string) => elements[id], addEventListener: (name: string, listener: Function) => { documentEvents[name] = listener },
      createElement: () => { const output = canvasFixture(); outputCanvases.push(output); return output.canvas } },
    Image: class { naturalWidth = 400; naturalHeight = 240; onload: any; set src(_value: string) { this.onload() } },
    requestAnimationFrame: (_callback: Function) => 1 }
  // The production crop helper uses document only to create the output canvas.
  const nativeCrop = lasso.crop
  context.window.PeepNoteLasso = { ...lasso, crop: (...args: any[]) => nativeCrop(...args, () => context.document.createElement()) }
  const html = fs.readFileSync(path.join(__dirname, '../public/snipping.html'), 'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
  vm.runInNewContext(script, context)
  const init = (mode = 'lasso', language = 'ko') => ipc['snipping-init']({ mode, language, dataUrl: 'test-image', width: 200, height: 120 })
  const pointer = (name: string, x: number, y: number) => events.c[name]({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {} })
  return { init, pointer, captured, regions, outputCanvases, held, events, ipc, elements, documentEvents,
    get cancellations() { return cancellations }, get monitorChanges() { return monitorChanges } }
}

test('renderer auto-closes a freehand drag, allows retry after a tiny selection, and supports cancel and monitor reset', () => {
  const fixture = rendererFixture()
  fixture.init()
  assert.ok(fixture.elements['hint-text'].textContent.includes('드래그로 영역 그리기'))
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
  assert.equal(fixture.outputCanvases[0].canvas.width, 160)
  fixture.pointer('pointerdown', 50, 50)
  fixture.events['change-monitor'].click()
  assert.equal(fixture.monitorChanges, 1)
  assert.equal(fixture.held.size, 0)
  fixture.init('lasso', 'en')
  assert.ok(fixture.elements['hint-text'].textContent.includes('Draw around'))
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

test('Alt+5 is a distinct, backward-compatible and disableable default shortcut', () => {
  assert.equal(DEFAULT_HOTKEYS.captureFreeform, 'Alt+5')
  assert.equal(new Set(Object.values(DEFAULT_HOTKEYS)).size, Object.keys(DEFAULT_HOTKEYS).length)
  assert.equal(resolveHotkeys({ takeScreenshot: 'Ctrl+Alt+2' }).captureFreeform, 'Alt+5')
  assert.equal(resolveHotkeys({ openOverlay: 'Alt+5' }).captureFreeform, 'Alt+Shift+5')
  assert.equal(resolveHotkeys({ openOverlay: '5+Alt', takeScreenshot: 'Shift+Alt+5' }).captureFreeform, 'Control+Alt+5')
  assert.equal(resolveHotkeys({ captureFreeform: 'Control+Shift+5' }).captureFreeform, 'Control+Shift+5')
  assert.equal(getActiveHotkeys({ disabled: { captureFreeform: true } }).captureFreeform, '')
  assert.equal(getActiveHotkeys({ disabled: { captureFreeform: true } }).takeScreenshot, 'Alt+2')
})
