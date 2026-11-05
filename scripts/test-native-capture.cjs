// Native regression for renderer/Main viewport rounding, hidden-window IPC,
// PNG encoding and delivery to the real Electron preview. Never use user data
// or the user's display: Linux runs in its own Xvfb server.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
if (process.platform !== 'linux') {
  console.log('Native capture regression skipped: Linux with Xvfb is required.')
  process.exit(0)
}
const root = path.resolve(__dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-native-capture-'))
try {
  for (const [source, output] of [
    ['electron/preload.ts', 'preload.cjs'], ['electron/liveCapture.ts', 'liveCapture.cjs'],
    ['electron/captureAction.ts', 'captureAction.cjs'], ['shared/lassoCapture.ts', 'selection.cjs'],
    ['electron/multiMonitorLasso.ts', 'multiMonitorLasso.cjs'],
    ['electron/multiMonitorRegion.ts', 'multiMonitorRegion.cjs'],
    ['electron/recordingOutline.ts', 'recordingOutline.cjs'],
  ]) buildSync({ entryPoints: [path.join(root, source)], bundle: true, format: 'cjs', platform: 'node', external: ['electron'], outfile: path.join(fixture, output) })
  const html = fs.readFileSync(path.join(root, 'public/snipping.html'), 'utf8')
  const gesture = `<script>window.electronAPI.on('snipping-init',payload=>{if(!payload.live)return;setTimeout(()=>{const c=document.getElementById('c');c.setPointerCapture=()=>{};c.hasPointerCapture=()=>false;for(const [type,x,y] of [['pointerdown',100,100],['pointermove',500,100],['pointerup',100,500]])c.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:3,button:0,bubbles:true}));},100)});</script>`
  fs.writeFileSync(path.join(fixture, 'selector.html'), html.replace('</body>', gesture + '</body>'))
  fs.writeFileSync(path.join(fixture, 'manual-selector.html'), html)
  fs.copyFileSync(path.join(root, 'public/lasso.js'), path.join(fixture, 'lasso.js'))
  fs.mkdirSync(path.join(fixture, 'cursors'))
  fs.copyFileSync(path.join(root, 'public/cursors/ai-pen-32.png'), path.join(fixture, 'cursors/ai-pen-32.png'))
  fs.copyFileSync(path.join(root, 'tests/native-capture.cjs'), path.join(fixture, 'main.cjs'))
  fs.copyFileSync(path.join(root, 'tests/native-multi-monitor-capture.cjs'), path.join(fixture, 'multi-monitor.cjs'))
  fs.copyFileSync(path.join(root, 'tests/native-multi-monitor-region.cjs'), path.join(fixture, 'multi-monitor-region.cjs'))
  fs.copyFileSync(path.join(root, 'tests/native-recording-outline.cjs'), path.join(fixture, 'recording-outline.cjs'))
  buildSync({ entryPoints:[path.join(root,'tests/fixtures/overlay-capture-preview.tsx')],bundle:true,platform:'browser',format:'iife',jsx:'automatic',
    define:{'import.meta.env':'{}','import.meta.hot':'false'},outfile:path.join(fixture,'overlay-preview.js') })
  const assets=path.join(process.env.PEEPNOTE_TEST_DIST || path.join(root,'dist'),'assets')
  const css=fs.existsSync(assets) ? fs.readdirSync(assets).filter(file=>file.endsWith('.css')).map(file=>fs.readFileSync(path.join(assets,file),'utf8')).join('\n') : ''
  fs.writeFileSync(path.join(fixture,'overlay-preview.html'),`<!doctype html><html data-theme="light"><meta charset="utf-8"><style>${css}\nhtml,body,#overlay-root{height:100%;margin:0}</style><body><div id="overlay-root"></div><script src="./overlay-preview.js"></script></body></html>`)
  fs.copyFileSync(path.join(root,'tests/native-overlay-capture.cjs'),path.join(fixture,'overlay-capture.cjs'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const entries = ['main.cjs', 'multi-monitor.cjs', 'multi-monitor-region.cjs', 'recording-outline.cjs', 'overlay-capture.cjs']
  const selected = process.env.PEEPNOTE_CAPTURE_CASE ? entries.filter(entry => entry === process.env.PEEPNOTE_CAPTURE_CASE) : entries
  if (!selected.length) throw new Error('Unknown native capture test case')
  for (const entry of selected) {
    const result = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1024x768x24', require('electron'), '--no-sandbox', path.join(fixture, entry)], {
      env, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    })
    if (result.error) throw result.error
    if (result.status !== 0 || !result.stdout.includes('"stage":"SUCCESS"')) {
      process.stderr.write(result.stdout + result.stderr)
      throw new Error(`Native capture regression failed (${result.status})`)
    }
    process.stdout.write(result.stdout.split('\n').filter(line => line.startsWith('LIVE_QA')).join('\n') + '\n')
  }
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
