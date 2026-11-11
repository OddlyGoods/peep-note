const { app, BrowserWindow, ipcMain, nativeImage, session } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
app.setPath('userData',path.join(__dirname,'overlay-capture-data')); app.disableHardwareAcceleration()
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms))
async function until(fn) { for(let i=0;i<100;i++){if(await fn())return;await wait(25)} throw new Error('Overlay capture condition timed out') }
const deadline = setTimeout(()=>app.exit(1),20000)
app.whenReady().then(async()=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_r,callback)=>callback({cancel:true}))
  const win = new BrowserWindow({width:480,height:580,frame:false,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}})
  const js=code=>win.webContents.executeJavaScript(code).catch(error=>{console.error('Fixture expression:',code);throw error})
  const png=nativeImage.createFromBitmap(Buffer.alloc(20*16*4,180),{width:20,height:16}).toPNG().toString('base64')
  let scenario='success',captures=0,holdRead=false,readPending=false,finishRead,reads=0
  ipcMain.handle('set-recording-active',()=>{})
  ipcMain.handle('overlay-is-maximized',()=>false)
  ipcMain.handle('close-overlay',()=>win.hide())
  ipcMain.handle('read-file-as-base64',()=>{
    reads++
    if(holdRead){readPending=true;return new Promise(resolve=>{finishRead=()=>resolve(png)})}
    return png
  })
  ipcMain.handle('start-snipping',async()=>{
    captures++;win.hide()
    await until(()=>js('document.hidden'))
    await wait(60)
    win.show();win.focus()
    await until(()=>js('!document.hidden'))
    if(scenario==='error')throw new Error('Fixture capture failure')
    return scenario==='cancel'?null:'/fixture/captured-'+captures+'.png'
  })
  await win.loadFile(path.join(__dirname,'overlay-preview.html'));win.show()
  await until(()=>js('!!document.querySelector(".overlay-tab")'))
  win.webContents.send('screenshot-captured','/fixture/initial.png','data:image/png;base64,'+png)
  const captureTab=`Array.from(document.querySelectorAll('.overlay-tab')).find(el=>el.textContent.trim()==='Capture')`
  const captureButton=`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Capture screen')`
  const preview='document.querySelector("img[alt=Preview]")'
  const titleInput=`document.querySelector(${JSON.stringify('input[id$="-title"]')})`
  const contentInput=`document.querySelector(${JSON.stringify('textarea[id$="-content"]')})`
  const tagInput=`document.querySelector(${JSON.stringify('input[id$="-tags"]')})`
  await until(()=>js(`${preview}?.src.startsWith('data:image/png')`))
  assert.equal(reads,0,'the composer displays a captured PNG without a second file read')
  const setInput=async(selector,value,textarea=false)=>js(`{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${textarea?'HTMLTextAreaElement':'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`)
  await setInput('input[id$="-title"]','Keep this capture title')
  await setInput('textarea[id$="-content"]','Keep these draft notes',true)
  await setInput('input[id$="-tags"]','capture-tag')
  await js(`${tagInput}.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
  await until(()=>js('!!document.querySelector(".tag-input-badge")'))
  const assertDraft=async()=>{
    assert.equal(await js(`${captureTab}.getAttribute('aria-pressed')`),'true')
    assert.equal(await js(`${titleInput}.value`),'Keep this capture title')
    assert.equal(await js(`${contentInput}.value`),'Keep these draft notes')
    assert.ok((await js('document.querySelector(".tag-input-badge").textContent')).includes('capture-tag'))
    assert.equal(await js(`${preview} !== null`),true)
  }
  await js(`${captureButton}.click();${captureButton}.click()`)
  await until(()=>captures===1 && win.isVisible())
  await wait(100);await assertDraft()
  assert.equal(captures,1,'repeated clicks cannot overlap captures')
  for(scenario of ['cancel','error']){
    const previous=captures
    await js(`${captureButton}.click()`)
    await until(()=>captures>previous && win.isVisible())
    await wait(100);await assertDraft()
  }
  fs.writeFileSync('/tmp/peepnote-overlay-capture-result.png',(await win.webContents.capturePage()).toPNG())
  await js('document.querySelector(".overlay-save").click()')
  await until(()=>js('window.savedLogs.length===1'))
  const saved=await js('window.savedLogs[0]')
  assert.equal(saved.log_type,'screenshot');assert.equal(saved.file_path,'/fixture/captured-1.png')
  assert.equal(saved.title,'Keep this capture title');assert.equal(saved.content,'Keep these draft notes');assert.deepEqual(saved.tags,['capture-tag'])
  await until(()=>!win.isVisible())
  win.show();await until(()=>js('!document.hidden'))
  assert.equal(await js(`${titleInput}.value`),'')
  assert.equal(await js(`${preview} === null`),true,'normal close still resets the composer')
  await js(`${captureTab}.click()`)
  holdRead=true;scenario='success'
  await js(`${captureButton}.click()`)
  await until(()=>readPending && win.isVisible())
  await js('document.querySelector(".overlay-close").click()')
  await until(()=>!win.isVisible())
  finishRead();await wait(100);win.show();await until(()=>js('!document.hidden'))
  assert.equal(await js(`${preview} === null`),true,'closing during preview decoding cannot revive a closed capture')
  win.destroy();clearTimeout(deadline)
  console.log('LIVE_QA '+JSON.stringify({stage:'SUCCESS',feature:'overlay capture',checks:'capture tab and title/content/tags preserved across hide/show, successful capture, cancellation, failure, duplicate clicks, screenshot save type, normal close and late preview cleanup'}))
  app.exit(0)
}).catch(error=>{console.error(error);app.exit(1)})
