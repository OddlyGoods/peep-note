// Use an isolated display and profile; never send test keys to the user's desktop.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { buildSync } = require('esbuild'), { spawnSync } = require('node:child_process')
if (process.platform !== 'linux') { console.log('Native hotkey regression requires Linux/Xvfb and xdotool.'); process.exit(0) }
const root = path.resolve(__dirname, '..'), fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-hotkeys-native-'))
try {
  buildSync({ entryPoints: [path.join(root, 'tests/native-hotkeys.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(fixture, 'main.cjs') })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1440x1000x24', require('electron'), '--no-sandbox', path.join(fixture, 'main.cjs')], { env, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 })
  if (result.status !== 0 || !result.stdout.includes('HOTKEY_QA_SUCCESS')) { process.stderr.write(result.stdout + result.stderr); throw result.error ?? new Error('Native hotkey regression failed') }
  console.log(result.stdout.split('\n').filter(line => line.startsWith('HOTKEY_QA')).join('\n'))
} finally { fs.rmSync(fixture, { recursive: true, force: true }) }
