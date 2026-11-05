const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { createVideoViewer } = require('./videoViewer.cjs')
app.setPath('userData', path.join(__dirname, 'isolated-data'))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const deadline = setTimeout(() => { console.error('Video viewer fixture timed out'); app.exit(1) }, 20000)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i=0;i<150;i++) { if (await fn()) return; await wait(30) } throw new Error('Condition timed out') }
app.whenReady().then(async () => {
  // Generate an app-format WebM from a synthetic canvas, without recording the desktop.
  const generator = new BrowserWindow({ width: 100, height: 100, show: false, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } })
  await generator.loadURL('data:text/html,<canvas id="sample" width="64" height="64"></canvas>')
  const encoded = await generator.webContents.executeJavaScript(`(async()=>{
    const canvas=document.getElementById('sample'),ctx=canvas.getContext('2d'),stream=canvas.captureStream(10),chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});
    const completed=new Promise(resolve=>{recorder.ondataavailable=event=>chunks.push(event.data);recorder.onstop=async()=>resolve(Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer())))});
    recorder.start();let frame=0;const timer=setInterval(()=>{ctx.fillStyle=frame++%2?'#8b5cf6':'#22c55e';ctx.fillRect(0,0,64,64)},100);
    await new Promise(resolve=>setTimeout(resolve,2200));clearInterval(timer);recorder.stop();const result=await completed;stream.getTracks().forEach(track=>track.stop());return result;
  })()`)
  generator.destroy()
  const source = path.join(__dirname, '테스트 video #1.webm')
  fs.writeFileSync(source, Buffer.from(encoded))
  assert.ok(fs.statSync(source).size>0)
  const controls = []
  let win
  ipcMain.handle('image-viewer-control', (event, action) => {
    assert.equal(event.sender, win.webContents); controls.push(action)
    if (action==='maximize') win.webContents.send('image-viewer-maximized', true)
    if (action==='close') win.close()
  })
  for (const [theme, language] of [['light','ko'],['dark','en']]) {
    const viewer = createVideoViewer({ source, theme, language, page: path.join(__dirname,'video-viewer.html'), preload: path.join(__dirname,'preload.cjs') })
    win = viewer.window
    await viewer.ready
    const js = code => win.webContents.executeJavaScript(code, true)
    await until(()=>js('document.getElementById("player").currentTime>0.1'))
    assert.equal(win.isVisible(),true)
    assert.equal(win.isAlwaysOnTop(),false)
    assert.equal(await js('document.getElementById("filename").textContent'),path.basename(source))
    assert.equal(await js('document.documentElement.dataset.theme'),theme)
    assert.equal(await js('document.getElementById("error").hidden'),true)
    assert.equal(await js('document.getElementById("player").controls'),true)
    assert.equal(await js('document.getElementById("player").videoWidth'),64)
    assert.equal(await js('document.getElementById("player").paused'),false,'opening a preview starts playback')
    assert.equal(await js('document.getElementById("player").currentSrc.startsWith("file:")'),true,'play directly from the recording file')
    await js('document.getElementById("player").pause()')
    assert.equal(await js('document.getElementById("player").paused'),true)
    await js('new Promise(resolve=>{const player=document.getElementById("player");player.addEventListener("seeked",resolve,{once:true});player.currentTime=0.05})')
    assert.ok(Math.abs(await js('document.getElementById("player").currentTime')-0.05)<0.02,'native controls can seek within the recording')
    await js('document.getElementById("player").play()')
    assert.equal(await js('document.getElementById("player").paused'),false)
    win.webContents.send('theme-changed',theme==='light'?'dark':'light')
    await until(()=>js(`document.documentElement.dataset.theme==='${theme==='light'?'dark':'light'}'`))
    await js('document.getElementById("maximize").click()')
    await until(()=>js('document.getElementById("maximize").textContent==="❐"'))
    await js('document.getElementById("close").click()')
    await until(()=>win.isDestroyed())
  }
  assert.deepEqual(controls,['maximize','close','maximize','close'])
  clearTimeout(deadline)
  console.log('VIDEO_QA_SUCCESS automatic playback, pause/resume/seek, file streaming, encoded filenames, both themes, localization and window controls')
  app.exit(0)
}).catch(error=>{console.error(error);app.exit(1)})
