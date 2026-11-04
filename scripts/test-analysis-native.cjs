// Exercises the production analysis window/preload/renderer on an isolated
// synthetic display. No user data, actual desktop capture, or AI calls.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
if (process.platform !== 'linux') { console.log('Analysis window regression requires Linux/Xvfb.'); process.exit(0) }
const root = path.resolve(__dirname, '..')
if (!fs.existsSync(path.join(root, 'dist/capture-analysis.html'))) throw new Error('Run npx vite build before testing the analysis window')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-native-analysis-'))
try {
  for (const [entry, output] of [['electron/captureAnalysisWindow.ts', 'analysis.cjs'], ['electron/captureAnalysisPreload.ts', 'captureAnalysisPreload.js'], ['electron/preload.ts', 'settingsPreload.js'], ['electron/codexModelCatalog.ts', 'catalog.cjs']]) {
    buildSync({ entryPoints: [path.join(root, entry)], bundle: true, format: 'cjs', platform: 'node', external: ['electron'], outfile: path.join(fixture, output) })
  }
  buildSync({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import CaptureCodexSettings from './src/components/CaptureCodexSettings';import RetentionSelect from './src/components/RetentionSelect';import{I18nProvider}from'./src/i18n';localStorage.setItem('openpeepnote_language','ko');function Preview(){const[value,setValue]=React.useState('gpt-6.1-sol');const[lastCustom,setLastCustom]=React.useState('');const[days,setDays]=React.useState(10);return <I18nProvider><CaptureCodexSettings value={value} customValue={lastCustom || undefined} onChange={(value,typing)=>{window.modelChanges={value,typing};setValue(value);if(typing&&value.trim())setLastCustom(value)}}/><div style={{marginTop:24}}><RetentionSelect value={days} onChange={value=>{window.retentionDays=value;setDays(value)}}/></div></I18nProvider>}createRoot(document.getElementById('root')).render(<Preview/>);`, resolveDir: root, sourcefile: 'model-picker-preview.tsx', loader: 'tsx' },
    bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', outfile: path.join(fixture, 'model-picker.js') })
  const assets = path.join(root, 'dist/assets')
  const styles = fs.readdirSync(assets).filter(file => file.endsWith('.css')).map(file => fs.readFileSync(path.join(assets, file), 'utf8')).join('\n')
  fs.writeFileSync(path.join(fixture, 'model-picker.html'), `<!DOCTYPE html><html lang="ko" data-theme="light"><head><meta charset="UTF-8"><style>${styles}</style></head><body style="background:#f7f7fc;padding:24px"><div id="root"></div><script src="./model-picker.js"></script></body></html>`)
  fs.copyFileSync(path.join(root, 'tests/native-analysis.cjs'), path.join(fixture, 'main.cjs'))
  const env = { ...process.env, PEEPNOTE_TEST_DIST: path.join(root, 'dist') }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1024x768x24', require('electron'), '--no-sandbox', path.join(fixture, 'main.cjs')], {
    env, encoding: 'utf8', timeout: 25000, maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0 || !result.stdout.includes('ANALYSIS_QA_SUCCESS')) { process.stderr.write(result.stdout + result.stderr); throw new Error(`Analysis window regression failed (${result.status})`) }
  process.stdout.write(result.stdout.split('\n').filter(line => line.startsWith('ANALYSIS_QA')).join('\n') + '\n')
} finally { fs.rmSync(fixture, { recursive: true, force: true }) }
