const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
if (process.platform !== 'linux') { console.log('Video viewer regression requires Linux/Xvfb.'); process.exit(0) }
const root = path.resolve(__dirname, '..'), fixture = fs.mkdtempSync(path.join(os.tmpdir(),'peepnote-native-video-'))
try {
  for (const [entry,output] of [['electron/videoViewer.ts','videoViewer.cjs'],['electron/preload.ts','preload.cjs']]) {
    buildSync({ entryPoints:[path.join(root,entry)],bundle:true,format:'cjs',platform:'node',external:['electron'],outfile:path.join(fixture,output) })
  }
  for (const file of ['video-viewer.html','video-viewer.js']) fs.copyFileSync(path.join(root,'public',file),path.join(fixture,file))
  fs.copyFileSync(path.join(root,'tests/native-video-viewer.cjs'),path.join(fixture,'main.cjs'))
  const env = {...process.env};delete env.ELECTRON_RUN_AS_NODE
  const result=spawnSync('xvfb-run',['-a','-s','-screen 0 1024x768x24',require('electron'),'--no-sandbox',path.join(fixture,'main.cjs')],{env,encoding:'utf8',timeout:25000,maxBuffer:4*1024*1024})
  if(result.error)throw result.error
  if(result.status!==0||!result.stdout.includes('VIDEO_QA_SUCCESS')){process.stderr.write(result.stdout+result.stderr);throw new Error(`Video viewer regression failed (${result.status})`)}
  process.stdout.write(result.stdout.split('\n').filter(line=>line.startsWith('VIDEO_QA')).join('\n')+'\n')
} finally { fs.rmSync(fixture,{recursive:true,force:true}) }
