const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { buildSync } = require('esbuild'), { spawnSync } = require('node:child_process')
if (process.platform !== 'linux') { console.log('Quick List UI regression requires Linux/Xvfb.'); process.exit(0) }
const root = path.resolve(__dirname, '..'), fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-quick-list-native-'))
try {
  buildSync({ entryPoints: [path.join(root, 'tests/fixtures/quick-list-preview.tsx')], bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'import.meta.env': '{}' }, outfile: path.join(fixture, 'preview.js') })
  fs.writeFileSync(path.join(fixture, 'index.html'), '<!doctype html><div id="root"></div><script src="./preview.js"></script>')
  fs.copyFileSync(path.join(root, 'tests/native-quick-list.cjs'), path.join(fixture, 'main.cjs'))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync('xvfb-run', ['-a', require('electron'), '--no-sandbox', path.join(fixture, 'main.cjs')], { env, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 })
  if (result.status !== 0 || !result.stdout.includes('QUICK_LIST_QA_SUCCESS')) { process.stderr.write(result.stdout + result.stderr); throw result.error ?? new Error('Quick List UI regression failed') }
  console.log(result.stdout.split('\n').filter(line => line.startsWith('QUICK_LIST_QA')).join('\n'))
} finally { fs.rmSync(fixture, { recursive: true, force: true }) }
