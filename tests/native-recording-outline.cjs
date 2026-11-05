const { app, BrowserWindow, screen, desktopCapturer } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createRecordingOutline, recordingOutlinePage, recordingOutlineWindowOptions } = require('./recordingOutline.cjs')
app.setPath('userData', path.join(__dirname, 'outline-data'))
app.disableHardwareAcceleration()
const deadline = setTimeout(() => app.exit(1), 20000)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 60; i++) { if (await fn()) return; await wait(40) } throw new Error('Outline condition timed out') }
app.whenReady().then(async () => {
  const display = screen.getPrimaryDisplay(), edges = [], errors = []
  const base = new BrowserWindow({ ...display.bounds, frame:false, show:false, backgroundColor:'#123456', webPreferences:{sandbox:true,nodeIntegration:false} })
  await base.loadURL('data:text/html,<style>html,body{margin:0;background:%23123456;width:100%;height:100%}</style>')
  base.show();base.focus()
  const outline = createRecordingOutline({ screen,
    createWindow: bounds => { const win = new BrowserWindow(recordingOutlineWindowOptions(bounds)); edges.push(win); return win },
    load: win => win.loadURL(recordingOutlinePage), onError: error => errors.push(error),
  })
  const region = { x:160,y:180,width:400,height:280,canvasWidth:display.bounds.width,canvasHeight:display.bounds.height }
  outline.prepare(1,display.bounds,region)
  assert.equal(edges.length,0)
  await outline.start(1)
  assert.deepEqual(errors,[])
  assert.equal(edges.length,4)
  assert.ok(edges.every(win => win.isVisible() && !win.isFocusable()))
  const snapshot = async () => {
    const sources = await desktopCapturer.getSources({types:['screen'],thumbnailSize:display.size})
    return (sources.find(source=>source.display_id===String(display.id)) ?? sources[0]).thumbnail
  }
  const pixel = (image,x,y) => {
    const size=image.getSize(),bytes=image.toBitmap()
    return Array.from(bytes.subarray((y*size.width+x)*4,(y*size.width+x)*4+3))
  }
  await until(async()=>JSON.stringify(pixel(await snapshot(),156,220))===JSON.stringify([94,63,244]))
  const shown=await snapshot()
  fs.writeFileSync('/tmp/peepnote-recording-outline.png',shown.toPNG())
  assert.deepEqual(pixel(shown,200,176),[94,63,244],'top boundary remains visible on the desktop')
  const cropped=shown.crop({x:160,y:180,width:400,height:280}).toBitmap()
  for(let i=0;i<cropped.length;i+=4) assert.deepEqual(Array.from(cropped.subarray(i,i+3)),[86,52,18],'no outline pixels enter the recorded region')
  outline.stop(1)
  assert.ok(edges.every(win=>win.isDestroyed()))
  await until(async()=>JSON.stringify(pixel(await snapshot(),156,220))===JSON.stringify([86,52,18]))
  outline.dispose();base.destroy();clearTimeout(deadline)
  console.log('LIVE_QA '+JSON.stringify({stage:'SUCCESS',feature:'recording outline',visibleEdges:4,cropContainsNoBorder:true,removedOnStop:true}))
  app.exit(0)
}).catch(error=>{console.error(error);app.exit(1)})
