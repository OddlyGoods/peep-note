// Production multi-monitor coordinator, preload, renderer and crop helper on
// two synthetic viewports. No user desktop, settings or AI requests are used.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
const { EventEmitter } = require('node:events')
const assert = require('node:assert/strict'), path = require('node:path')
const { createMultiMonitorLasso, lassoWindowOptions } = require('./multiMonitorLasso.cjs')
app.setPath('userData', path.join(__dirname, 'isolated-multi-monitor-data'))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const deadline = setTimeout(() => { console.error('Multi-monitor fixture timeout'); app.exit(1) }, 12000)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await wait(20) } throw new Error('Condition timed out') }
const displays = [
  { id: 21, bounds: { x: 0, y: 0, width: 480, height: 720 } },
  { id: 42, bounds: { x: 480, y: 0, width: 480, height: 720 } },
]
const images = displays.map((display, index) => {
  const pixels = Buffer.alloc(display.bounds.width * display.bounds.height * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = index ? 50 : 180; pixels[i + 1] = index ? 150 : 60; pixels[i + 2] = 60; pixels[i + 3] = 255
  }
  return nativeImage.createFromBitmap(pixels, display.bounds).toDataURL()
})
app.whenReady().then(async () => {
  for (const selected of [1, 0, null, 'closed']) {
    const captures = [], errors = []
    const session = createMultiMonitorLasso({ displays, preferredDisplayId: 21, language: 'en', ipc: ipcMain, screen: new EventEmitter(),
      createWindow: display => new BrowserWindow({ ...lassoWindowOptions(display),
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } }),
      load: window => window.loadFile(path.join(__dirname, 'manual-selector.html'), { query: { live: '1' } }),
      capture: async id => {
        assert.ok(session.windows.every(window => !window.isVisible()), 'all marker windows must disappear before capture')
        captures.push(id)
        return images[displays.findIndex(display => display.id === id)]
      }, onError: error => errors.push(error),
    })
    await until(() => session.windows.length === 2 && session.windows.every(window => window.isVisible()))
    for (const window of session.windows) {
      assert.equal(await window.webContents.executeJavaScript('getComputedStyle(document.getElementById("change-monitor")).display'), 'none')
      assert.ok((await window.webContents.executeJavaScript('getComputedStyle(document.getElementById("c")).cursor')).includes('ai-pen-32.png'))
    }
    session.setLanguage('ko')
    await until(async () => (await Promise.all(session.windows.map(window => window.webContents.executeJavaScript('document.documentElement.lang')))).every(value => value === 'ko'))
    if (selected === 'closed') {
      session.windows[0].destroy()
      assert.equal(await session.result, null)
      assert.deepEqual(captures, [])
    } else if (selected === null) {
      await session.windows[1].webContents.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
      assert.equal(await session.result, null)
      assert.deepEqual(captures, [])
    } else {
      await session.windows[selected].webContents.executeJavaScript(`(() => {
        const canvas = document.getElementById('c'); canvas.setPointerCapture = () => {}; canvas.hasPointerCapture = () => false;
        for (const [type,x,y] of [['pointerdown',40,60],['pointermove',180,60],['pointerup',40,200]])
          canvas.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:3,button:0,bubbles:true}));
      })()`)
      const result = await session.result
      assert.ok(result)
      assert.deepEqual(captures, [displays[selected].id])
      assert.deepEqual(result.bounds, { x: displays[selected].bounds.x + 40, y: 60, width: 140, height: 140 })
      const image = nativeImage.createFromDataURL(result.dataUrl), size = image.getSize(), pixels = image.toBitmap()
      assert.deepEqual(size, { width: 172, height: 172 })
      const inside = pixels.subarray((30 * size.width + 30) * 4, (30 * size.width + 30) * 4 + 3)
      assert.deepEqual([...inside], selected ? [50, 150, 60] : [180, 60, 60], 'the cropped image must come from the selected monitor')
    }
    await until(() => session.windows.every(window => window.isDestroyed()))
    assert.deepEqual(errors, [])
    assert.equal(ipcMain.listenerCount('snipping-capture-lasso'), 0)
    assert.equal(ipcMain.listenerCount('snipping-done'), 0)
    assert.equal(ipcMain.listenerCount('snipping-cancel'), 0)
  }
  clearTimeout(deadline)
  console.log('LIVE_QA {"stage":"SUCCESS","case":"multi-monitor","checks":"both viewports, either monitor, correct image and coordinates, hidden overlays, cursor, language, Escape and cleanup"}')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
