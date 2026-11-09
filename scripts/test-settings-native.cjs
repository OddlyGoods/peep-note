// Render the actual Settings page against fake local APIs, never a user's app.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { buildSync } = require('esbuild'), { spawnSync } = require('node:child_process')
if (process.platform !== 'linux') { console.log('Settings UI regression requires Linux/Xvfb.'); process.exit(0) }
const root = path.resolve(__dirname, '..'), fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-settings-native-'))
try {
  buildSync({ entryPoints: [path.join(root, 'tests/fixtures/settings-preview.tsx')], bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'import.meta.env': '{}', 'import.meta.hot': 'false' }, outfile: path.join(fixture, 'preview.js') })
  const assets = path.join(process.env.PEEPNOTE_TEST_DIST || path.join(root, 'dist'), 'assets')
  const css = fs.readdirSync(assets).filter(file => file.endsWith('.css')).map(file => fs.readFileSync(path.join(assets, file), 'utf8')).join('\n')
  fs.writeFileSync(path.join(fixture, 'index.html'), `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>${css}\nhtml,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script src="./preview.js"></script></body></html>`)
  fs.copyFileSync(path.join(root, 'tests/native-settings.cjs'), path.join(fixture, 'main.cjs'))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1280x1000x24', require('electron'), '--no-sandbox', path.join(fixture, 'main.cjs')], { env, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 })
  if (result.status !== 0 || !result.stdout.includes('SETTINGS_QA_SUCCESS')) { process.stderr.write(result.stdout + result.stderr); throw result.error ?? new Error('Settings UI regression failed') }
  console.log(result.stdout.split('\n').filter(line => line.startsWith('SETTINGS_QA')).join('\n'))
} finally { fs.rmSync(fixture, { recursive: true, force: true }) }
