import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter, once } from 'node:events'
import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDevelopmentElectron } from '../scripts/developmentElectron'
import { restartAfterDataLocationChange } from '../electron/restart'
import { DEVELOPMENT_RESTART_EXIT_CODE } from '../shared/developmentRestart'
const { buildSync } = require('esbuild')

test('managed development restarts hand off to Vite; installed apps still relaunch normally', () => {
  const calls: string[] = []
  const app = { exit: (code: number) => calls.push(`exit:${code}`), relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit') }
  restartAfterDataLocationChange(app, true)
  assert.deepEqual(calls, [`exit:${DEVELOPMENT_RESTART_EXIT_CODE}`])
  calls.length = 0
  restartAfterDataLocationChange(app, false)
  assert.deepEqual(calls, ['relaunch', 'quit'])
})

test('normal quit, crashes and signals exit the Vite parent without a restart loop', async () => {
  for (const [code, signal, expected] of [[0, null, 0], [1, null, 1], [null, 'SIGTERM', 1]] as const) {
    const exits: number[] = []
    let starts = 0
    const child = new EventEmitter() as ChildProcess
    const host = { env: {}, electronApp: child as ChildProcess | undefined, exit: (value?: number) => { exits.push(value ?? 0) } }
    const startup = async () => { starts++; child.once('exit', host.exit) }
    await startDevelopmentElectron(startup, host)
    child.emit('exit', code, signal)
    assert.deepEqual(exits, [expected])
    assert.equal(starts, 1)
  }
})

test('the real Vite plugin restarts its child while keeping the same frontend server running', { timeout: 15_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-dev-restart-'))
  const launcherFile = path.join(root, 'launcher.cjs')
  const parentFile = path.join(root, 'parent.cjs')
  const childFile = path.join(root, 'child.cjs')
  const electronPackageFile = path.join(root, 'electron-package.cjs')
  fs.writeFileSync(electronPackageFile, 'module.exports = process.execPath')
  buildSync({ entryPoints: [path.join(__dirname, '../scripts/developmentElectron.ts')], outfile: launcherFile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  fs.writeFileSync(childFile, `
    process.on('message', message => {
      if (message === 'restart') process.exit(${DEVELOPMENT_RESTART_EXIT_CODE});
      if (message === 'quit') process.exit(0);
    });
    process.on('disconnect', () => process.exit(0));
    process.send({ ready: true });
  `)
  fs.writeFileSync(parentFile, `
    const http = require('node:http');
    const { once } = require('node:events');
    const { startDevelopmentElectron } = require(${JSON.stringify(launcherFile)});
    const { startup: pluginStartup } = require(${JSON.stringify(require.resolve('vite-plugin-electron'))});
    const server = http.createServer((req, res) => res.end('renderer is available'));
    let starts = 0;
    async function startup(argv, options) {
      if (process.electronApp) throw new Error('The exited child must be detached before startup');
      await pluginStartup([${JSON.stringify(childFile)}], { ...options, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }, ${JSON.stringify(electronPackageFile)});
      const child = process.electronApp;
      await once(child, 'message');
      process.send({ started: ++starts, childPid: child.pid, port: server.address().port });
    }
    process.on('message', message => process.electronApp?.send(message));
    process.on('disconnect', () => { process.electronApp?.kill(); server.close(); });
    server.listen(0, '127.0.0.1', () => startDevelopmentElectron(startup).catch(error => { console.error(error); process.exit(1); }));
  `)
  const parent = fork(parentFile, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  const messages: Array<{ started: number; childPid: number; port: number }> = []
  const notifications = new EventEmitter()
  parent.on('message', message => { messages.push(message as any); notifications.emit('message') })
  const exited = once(parent, 'exit')
  const stderr: string[] = []
  parent.stderr?.on('data', value => stderr.push(String(value)))
  const nextStart = async (count: number) => {
    while (messages.length < count) await once(notifications, 'message')
    return messages[count - 1]
  }
  try {
    const first = await nextStart(1)
    assert.equal(await (await fetch(`http://127.0.0.1:${first.port}`)).text(), 'renderer is available')
    const originalParentPid = parent.pid
    parent.send('restart')
    const second = await nextStart(2)
    assert.equal(parent.pid, originalParentPid)
    assert.equal(second.port, first.port)
    assert.notEqual(second.childPid, first.childPid)
    assert.equal(await (await fetch(`http://127.0.0.1:${first.port}`)).text(), 'renderer is available')
    parent.send('restart')
    const third = await nextStart(3)
    assert.equal(third.port, first.port)
    assert.notEqual(third.childPid, second.childPid)
    parent.send('quit')
    assert.equal((await exited)[0], 0, stderr.join(''))
  } finally {
    if (parent.exitCode === null) parent.kill()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
