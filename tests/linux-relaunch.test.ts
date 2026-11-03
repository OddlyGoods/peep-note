import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { prepareLinuxRelaunch, restartInstalledApp } from '../electron/linuxRelaunch'
const { buildSync } = require('esbuild')

test('Linux quits only once its replacement is ready, without calling the Electron relauncher', async () => {
  const events: string[] = []
  let ready!: () => void
  const app = { relaunch: () => events.push('electron'), quit: () => events.push('quit') }
  const pending = restartInstalledApp(app, process.execPath, ['space and quotes "'], 'linux', async (exe, args) => {
    assert.equal(exe, process.execPath)
    assert.deepEqual(args, ['space and quotes "'])
    events.push('prepare')
    await new Promise<void>(resolve => { ready = resolve })
  })
  assert.deepEqual(events, ['prepare'])
  ready(); await pending
  assert.deepEqual(events, ['prepare', 'quit'])
  await assert.rejects(restartInstalledApp(app, process.execPath, [], 'linux', async () => { throw new Error('Cannot restart') }), /Cannot restart/)
  assert.deepEqual(events, ['prepare', 'quit'])
})

test('Windows and macOS retain Electron relaunch and never start the Linux helper', async () => {
  for (const platform of ['win32', 'darwin'] as const) {
    const events: string[] = []
    const app = { relaunch: (options: unknown) => { assert.deepEqual(options, { execPath: process.execPath, args: ['test'] }); events.push('relaunch') }, quit: () => events.push('quit') }
    await restartInstalledApp(app, process.execPath, ['test'], platform, async () => { throw new Error('Unexpected Linux helper') })
    assert.deepEqual(events, ['relaunch', 'quit'])
  }
})

test('a missing helper, an early exit or a readiness timeout rejects without shutting down the app', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  for (const failure of ['error', 'exit', 'timeout']) {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: () => true, unref: () => {} })
    const pending = prepareLinuxRelaunch(process.execPath, [], (() => child) as any)
    const rejected = assert.rejects(pending, /missing|exited|ready/)
    if (failure === 'error') child.emit('error', new Error('missing'))
    else if (failure === 'exit') child.emit('exit', 1)
    else context.mock.timers.tick(5000)
    await rejected
  }
})

test('real Electron restarts preserve NoNewPrivs, wait for the old process and keep arguments literal', {
  skip: process.platform !== 'linux', timeout: 20_000
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-linux-restart-'))
  const module = path.join(root, 'restart.cjs'), entry = path.join(root, "app with 'quotes'.cjs"), output = path.join(root, 'result.jsonl'), injected = path.join(root, 'must-not-exist')
  buildSync({ entryPoints: [path.join(__dirname, '../electron/linuxRelaunch.ts')], outfile: module, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const literal = ['--custom-value', 'space and "quotes"', `$(touch ${injected})`]
  fs.writeFileSync(entry, `
    const {app}=require('electron'), fs=require('node:fs');
    const {restartInstalledApp}=require(${JSON.stringify(module)});
    app.setPath('userData',${JSON.stringify(path.join(root, 'profile'))});app.disableHardwareAcceleration();
    app.whenReady().then(async()=>{
      const rows=fs.existsSync(${JSON.stringify(output)})?fs.readFileSync(${JSON.stringify(output)},'utf8').trim().split('\\n').map(JSON.parse):[];
      let previousAlive=false;
      if(rows.length){try{process.kill(rows[rows.length-1].pid,0);previousAlive=true}catch{}}
      const flag=fs.readFileSync('/proc/self/status','utf8').match(/^NoNewPrivs:\\s*(\\d+)/m)[1];
      fs.appendFileSync(${JSON.stringify(output)},JSON.stringify({pid:process.pid,flag,previousAlive,args:process.argv.slice(1)})+'\\n');
      if(rows.length<2) await restartInstalledApp(app,process.execPath,process.argv.slice(1));else app.quit();
    }).catch(()=>app.exit(1));
  `)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [entry, '--ozone-platform=headless', '--no-sandbox', ...literal], { env, stdio: 'ignore' })
  const exited = once(child, 'exit')
  try {
    let rows: any[] = []
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (fs.existsSync(output)) rows = fs.readFileSync(output, 'utf8').trim().split('\n').map(line => JSON.parse(line))
      if (rows.length === 3) break
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(rows.length, 3, 'All three isolated Electron generations must run')
    assert.deepEqual(rows.map(row => row.flag), [rows[0].flag, rows[0].flag, rows[0].flag])
    assert.deepEqual(rows.map(row => row.previousAlive), [false, false, false])
    for (const row of rows) assert.deepEqual(row.args.slice(-literal.length), literal)
    assert.equal(fs.existsSync(injected), false)
    assert.equal((await exited)[0], 0)
  } finally {
    if (child.exitCode === null) child.kill()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
