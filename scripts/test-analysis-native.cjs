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
  for (const [entry, output] of [['electron/captureAnalysisWindow.ts', 'analysis.cjs'], ['electron/captureAnalysisPreload.ts', 'captureAnalysisPreload.js']]) {
    buildSync({ entryPoints: [path.join(root, entry)], bundle: true, format: 'cjs', platform: 'node', external: ['electron'], outfile: path.join(fixture, output) })
  }
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
