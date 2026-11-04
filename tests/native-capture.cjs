// Runs only in the isolated Electron/Xvfb fixture prepared by test-native-capture.cjs.
const {app,BrowserWindow,ipcMain,desktopCapturer,screen,nativeImage}=require('electron');
const fs=require('fs'),path=require('path');
const {createLiveCapture}=require('./liveCapture.cjs'),{parseLassoCapture}=require('./selection.cjs'),{createCaptureAction}=require('./captureAction.cjs');
app.setPath('userData',path.join(__dirname,'isolated-data'));app.disableHardwareAcceleration();
const mark=(stage,details={})=>console.log('LIVE_QA',JSON.stringify({stage,...details}));
let stage='boot',region,preview,background;
const timer=setTimeout(()=>{mark('TIMEOUT',{lastStage:stage});app.exit(1)},12000);
app.whenReady().then(async()=>{
 const display=screen.getPrimaryDisplay(),{width,height}=display.bounds;
 background=new BrowserWindow({width,height,frame:false,show:false,backgroundColor:'#28324a'});await background.loadURL('data:text/html,<body style="background:%2328324a;color:white">Synthetic test screen</body>');background.show();
 preview=new BrowserWindow({width:400,height:400,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}});
 await preview.loadURL('data:text/html,<img id="result"><script>window.electronAPI.on("screenshot-captured",file=>{window.electronAPI.readFileAsBase64(file).then(data=>{const image=document.getElementById("result");image.onload=()=>window.electronAPI.notifyLogCreated("native-preview-ready");image.src="data:image/png;base64,"+data})})</script>');
 ipcMain.handle('read-file-as-base64',(_event,file)=>fs.readFileSync(file).toString('base64'));
 ipcMain.on('notify-log-created',(_event,id)=>{if(id==='native-preview-ready'){mark('SUCCESS');clearTimeout(timer);app.exit(0)}});
 const action=createCaptureAction(()=>new Promise(resolve=>{
   region=new BrowserWindow({x:0,y:0,width,height,frame:false,alwaysOnTop:true,transparent:true,backgroundColor:'#00000000',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}});
   const live=createLiveCapture({hide:()=>{region.hide();stage='hidden';mark(stage)},capture:async()=>{stage='capture';const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:display.size});mark(stage,{displayId:display.id,sources:sources.map(s=>s.display_id)});const source=sources.find(s=>s.display_id===String(display.id))??(sources.length===1?sources[0]:undefined);if(!source)throw Error('source missing');return source.thumbnail.toDataURL()},deliver:data=>{stage='source-delivered';mark(stage,{visible:region.isVisible()});region.webContents.send('lasso-source',data)},onError:error=>{mark('ERROR',{message:error.message});app.exit(2)}});
   ipcMain.on('snipping-capture-lasso',(event,selection)=>{stage='selection';const bounds=region.getContentBounds();const valid=!!parseLassoCapture(selection,bounds.width,bounds.height);mark(stage,{valid,requested:[selection.width,selection.height],actual:[bounds.width,bounds.height]});if(valid)void live.start()});
   ipcMain.on('snipping-done',(event,png)=>{stage='png-received';mark(stage);if(event.sender!==region.webContents||(!region.isVisible()&&!live.pending))return;const file=path.join(__dirname,'cropped.png');fs.writeFileSync(file,Buffer.from(png.split(',')[1],'base64'));
     const cropped=nativeImage.createFromPath(file),size=cropped.getSize(),bitmap=cropped.toBitmap();
     const pixel=(x,y)=>Array.from(bitmap.subarray((y*size.width+x)*4,(y*size.width+x)*4+3));
     if(size.width<=400||size.height<=400||pixel(5,50).every(value=>value===255)||!pixel(0,0).every(value=>value===255)){
       mark('BAD_MARGIN',{size,nearEdge:pixel(5,50),outside:pixel(0,0)});app.exit(6);return;
     }
     mark('MARGIN_OK',{size});live.dispose();region.close();resolve(file)});
   ipcMain.on('snipping-cancel',()=>{mark('CANCEL');app.exit(3)});
   region.webContents.once('did-finish-load',async()=>{
     try {
       const cursor=await region.webContents.executeJavaScript('getComputedStyle(document.getElementById("c")).cursor');
       const asset=await region.webContents.executeJavaScript('new Promise(resolve=>{const image=new Image();image.onload=()=>resolve([image.naturalWidth,image.naturalHeight]);image.onerror=()=>resolve(null);image.src="./cursors/ai-pen-32.png"})');
       if(!cursor.includes('ai-pen-32.png')||!cursor.includes('5 27')||JSON.stringify(asset)!=='[32,32]')throw Error('Pen cursor did not load');
       mark('CURSOR_OK',{hotspot:[5,27],size:asset});
       region.webContents.send('snipping-init',{live:true,mode:'lasso',width,height,language:'en'});region.show();region.focus();stage='selector-ready';mark(stage);
     }catch(error){mark('CURSOR_ERROR',{message:error.message});app.exit(7)}
   });
   region.loadFile(path.join(__dirname,'selector.html'),{query:{live:'1'}});
 }),()=>preview,error=>{mark('ACTION_ERROR',{message:error.message});app.exit(4)});
 await action();stage='preview-sent';mark(stage);
}).catch(error=>{mark('BOOT_ERROR',{message:error.message});app.exit(5)});
