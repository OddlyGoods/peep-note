// Real Electron preload and renderer, with synthetic desktop images only.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
const { EventEmitter } = require('node:events')
const assert = require('node:assert/strict'), path = require('node:path')
const { createMultiMonitorRegion } = require('./multiMonitorRegion.cjs')
const { lassoWindowOptions } = require('./multiMonitorLasso.cjs')
app.setPath('userData', path.join(__dirname, 'isolated-region-data'))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const deadline = setTimeout(() => { console.error('Region fixture timeout'); app.exit(1) }, 24000)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 150; i++) { if (await fn()) return; await wait(20) } throw new Error('Condition timed out') }
const displays = [0, 1].map(index => ({ id: 21 + index, bounds: { x: index * 480, y: 0, width: 480, height: 720 },
  workArea: { x: index * 480, y: 24, width: 480, height: 696 } }))
const snapshots = new Map(displays.map((display, index) => {
  const pixels = Buffer.alloc(960 * 1440 * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = index ? 50 : 180; pixels[i + 1] = index ? 150 : 60; pixels[i + 2] = 60; pixels[i + 3] = 255
  }
  return [display.id, nativeImage.createFromBitmap(pixels, { width: 960, height: 1440 }).toDataURL()]
}))
app.whenReady().then(async () => {
  for (const mode of ['screenshot', 'recording-region']) for (const selected of [0, 1, null]) {
    const errors = []
    const session = createMultiMonitorRegion({ mode, displays, preferredDisplayId: 21, language: 'ko', ipc: ipcMain, screen: new EventEmitter(),
      snapshots: mode === 'screenshot' ? snapshots : undefined,
      createWindow: display => new BrowserWindow({ ...lassoWindowOptions(display),
        transparent: mode === 'recording-region', backgroundColor: mode === 'screenshot' ? '#000000' : '#00000000',
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } }),
      load: window => window.loadFile(path.join(__dirname, 'manual-selector.html'), { query: mode === 'recording-region' ? { live: '1', mode } : {} }),
      onError: error => errors.push(error),
    })
    await until(() => session.windows.length === 2 && session.windows.every(window => window.isVisible()))
    for (const [index, window] of session.windows.entries()) {
      assert.equal(window.getBounds().x, displays[index].bounds.x)
      assert.equal(await window.webContents.executeJavaScript('getComputedStyle(document.getElementById("change-monitor")).display'), 'none')
      const state = await window.webContents.executeJavaScript('({live:document.documentElement.classList.contains("live-selector"),pen:document.documentElement.classList.contains("live-lasso"),hasImage:img!==null,hint:parseInt(document.getElementById("hint").style.top)})')
      assert.deepEqual(state, { live: mode === 'recording-region', pen: false, hasImage: mode === 'screenshot', hint: 48 })
    }
    if (selected === null) {
      await session.windows[1].webContents.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
      assert.equal(await session.result, null)
    } else {
      await session.windows[selected].webContents.executeJavaScript(`(() => {
        const canvas = document.getElementById('c'); canvas.setPointerCapture = () => {}; canvas.hasPointerCapture = () => false;
        for (const [type,x,y] of [['pointerdown',180,200],['pointermove',100,120],['pointerup',40,60]])
          canvas.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:3,button:0,bubbles:true}));
      })()`)
      const result = await session.result
      assert.equal(result?.displayId, displays[selected].id)
      assert.equal(result.mode, mode)
      if (mode === 'recording-region') assert.deepEqual(result.region, { x: 40, y: 60, width: 140, height: 140, canvasWidth: 480, canvasHeight: 720 })
      else {
        const image = nativeImage.createFromDataURL(result.dataUrl)
        assert.deepEqual(image.getSize(), { width: 280, height: 280 }, 'preserve source pixel density')
        assert.deepEqual([...image.toBitmap().subarray(0, 3)], selected ? [50, 150, 60] : [180, 60, 60])
      }
    }
    await until(() => session.windows.every(window => window.isDestroyed()))
    assert.deepEqual(errors, [])
    for (const channel of ['snipping-ready', 'snipping-done', 'recording-region-done', 'snipping-cancel']) assert.equal(ipcMain.listenerCount(channel), 0)
  }
  clearTimeout(deadline)
  console.log('LIVE_QA {"stage":"SUCCESS","case":"multi-monitor-region","checks":"both monitors, frozen screenshots, live recording viewports, either selection, source colors, 2x pixel density, Escape and cleanup"}')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
