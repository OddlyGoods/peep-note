import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { UpdateController } from '../electron/updateController'
import { installDeb } from '../electron/installDeb'
import type { UpdateState } from '../shared/updates'
import { UPDATE_STATE_CHANNEL } from '../shared/updates'
import { useUpdateStore, subscribeToUpdates, checkForUpdates as rendererCheck } from '../src/stores/updateStore'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UpdatePanelView } from '../src/components/UpdatePanel'
import { I18nProvider } from '../src/i18n'
const { verifyVersion, verifyArtifacts } = require('../scripts/verify-release.cjs')

class Backend extends EventEmitter {
  checks = 0
  downloads = 0
  installs = 0
  checkError = false
  downloadError = false
  installError = false
  version: string | null = '1.0.15'
  onDownload: (() => void) | null = null
  async checkForUpdates() {
    this.checks++
    if (this.checkError) throw new Error('Offline')
    this.emit(this.version ? 'update-available' : 'update-not-available', { version: this.version })
  }
  async downloadUpdate() {
    this.downloads++
    this.emit('download-progress', { percent: 42.5 })
    this.onDownload?.()
    if (this.downloadError) throw new Error('Download interrupted')
    this.emit('update-downloaded', { version: this.version })
  }
  async quitAndInstall(silent?: boolean, run?: boolean) {
    assert.equal(silent, false)
    assert.equal(run, true)
    this.installs++
    if (this.installError) throw new Error('Administrator authentication cancelled')
  }
}

function fixture(supported = true, platform = 'win32') {
  const backend = new Backend()
  const events: UpdateState[] = []
  const controller = new UpdateController(backend, '1.0.14', platform, supported, state => events.push(state))
  return { backend, controller, events }
}

test('check, progress, download and explicit install produce persistent snapshots', async () => {
  const { backend, controller, events } = fixture()
  assert.equal((await controller.install()).status, 'idle')
  assert.equal(backend.installs, 0)
  await controller.check()
  assert.equal(controller.snapshot().version, '1.0.15')
  assert.equal(controller.snapshot().status, 'available')
  assert.equal(backend.downloads, 0)
  await controller.download()
  assert.ok(events.some(event => event.percent === 42.5 && event.status === 'downloading'))
  assert.equal(controller.snapshot().downloaded, true)
  await controller.check()
  assert.equal(backend.checks, 1)
  assert.equal((await controller.install()).status, 'installing')
  assert.equal(backend.installs, 1)
  assert.ok(events.every((event, index) => index === 0 || event.revision > events[index - 1].revision))
})

test('failed checks and downloads exit busy state and can be retried', async () => {
  const { backend, controller } = fixture()
  backend.checkError = true
  assert.equal((await controller.check()).status, 'error')
  backend.checkError = false
  await controller.check()
  backend.downloadError = true
  assert.equal((await controller.download()).status, 'error')
  assert.equal(controller.snapshot().downloaded, false)
  backend.downloadError = false
  assert.equal((await controller.download()).status, 'downloaded')
})

test('cancelled Linux administrator authentication retains downloaded package for retry', async () => {
  const { backend, controller } = fixture(true, 'linux')
  await controller.check()
  await controller.download()
  backend.installError = true
  assert.equal((await controller.install()).status, 'error')
  assert.equal(controller.snapshot().downloaded, true)
  backend.installError = false
  assert.equal((await controller.install()).status, 'installing')
  assert.equal(backend.installs, 2)
  assert.equal(backend.downloads, 1)
})

test('Debian installer passes file paths as one argument and reports cancellation without exiting', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-install-'))
  const file = path.join(root, "Peep Note 'test'.deb")
  fs.writeFileSync(file, 'fixture')
  try {
    let calls = 0
    const runner = (command: string, args: string[], callback: (error: Error | null) => void) => {
      calls++
      assert.equal(command, 'pkexec')
      assert.deepEqual(args, ['/usr/bin/dpkg', '--install', file])
      callback(calls === 1 ? new Error('Cancelled') : null)
    }
    await assert.rejects(installDeb(file, runner), /Cancelled/)
    await installDeb(file, runner)
    await assert.rejects(installDeb(null, runner), /unavailable/)
    await assert.rejects(installDeb(`${file}.missing`, runner), /unavailable/)
    assert.equal(calls, 2)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('no-update, unsupported and duplicate requests do not trigger downloads', async () => {
  const { backend, controller } = fixture()
  backend.version = null
  assert.equal((await controller.check()).status, 'up-to-date')
  assert.ok(controller.snapshot().checkedAt)
  await controller.download()
  assert.equal(backend.downloads, 0)
  const unsupported = fixture(false)
  await unsupported.controller.check()
  await unsupported.controller.download()
  await unsupported.controller.install()
  assert.equal(unsupported.controller.snapshot().status, 'unsupported')
  assert.equal(unsupported.backend.checks, 0)
  backend.version = '1.0.15'
  await controller.check()
  backend.onDownload = () => { void controller.download(); void controller.check() }
  await controller.download()
  assert.equal(backend.downloads, 1)
  assert.equal(backend.checks, 2)
})

test('renderer survives navigation, ignores stale snapshots and removes event listeners', async () => {
  const initial = fixture().controller.snapshot()
  let listener: ((state: unknown) => void) | null = null
  let resolveSnapshot: (state: UpdateState) => void = () => {}
  ;(globalThis as any).window = { electronAPI: {
    on: (channel: string, callback: typeof listener) => { assert.equal(channel, UPDATE_STATE_CHANNEL); listener = callback },
    off: (channel: string, callback: typeof listener) => { assert.equal(callback, listener); listener = null },
    getUpdateInfo: () => new Promise(resolve => { resolveSnapshot = resolve }),
    checkForUpdates: async () => { throw new Error('IPC disconnected') }
  } }
  useUpdateStore.setState({ state: null, dismissedVersion: null })
  const unsubscribe = subscribeToUpdates()
  listener!({ ...initial, revision: 3, status: 'downloaded', version: '1.0.15', downloaded: true })
  resolveSnapshot({ ...initial, revision: 1, status: 'available' })
  await Promise.resolve()
  assert.equal(useUpdateStore.getState().state?.status, 'downloaded')
  unsubscribe()
  assert.equal(listener, null)
  assert.equal(useUpdateStore.getState().state?.downloaded, true)
  await rendererCheck()
  assert.equal(useUpdateStore.getState().state?.status, 'error')
  assert.equal(useUpdateStore.getState().state?.downloaded, true)
})

test('update UI renders progress, localized install actions and escaped errors', () => {
  const initial = fixture().controller.snapshot()
  for (const [language, installText] of [['ko', '재시작하여 설치'], ['en', 'Restart and install'], ['ja', '再起動してインストール'], ['zh', '重启并安装']]) {
    ;(globalThis as any).localStorage = { getItem: () => language }
    useUpdateStore.setState({ state: { ...initial, status: 'downloaded', downloaded: true, version: '1.0.15' } })
    const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(UpdatePanelView, { state: useUpdateStore.getState().state })))
    assert.ok(html.includes(installText))
    assert.ok(html.includes('1.0.15'))
  }
  useUpdateStore.setState({ state: { ...initial, status: 'downloading', percent: 42.5, version: '1.0.15' } })
  let html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(UpdatePanelView, { state: useUpdateStore.getState().state })))
  assert.ok(html.includes('aria-valuenow="42"'))
  assert.ok(html.includes('width:42.5%'))
  useUpdateStore.setState({ state: { ...initial, status: 'error', error: '<script>bad()</script>' } })
  html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(UpdatePanelView, { state: useUpdateStore.getState().state })))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
})

test('release validation rejects mismatched versions, missing assets and incorrect checksums', () => {
  const version = require('../package.json').version
  assert.equal(verifyVersion(`v${version}`), version)
  assert.throws(() => verifyVersion('v0.0.0'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'peepnote-release-'))
  try {
    const name = `PeepNote-${version}-linux-amd64.deb`
    const binary = Buffer.from('installer fixture')
    const sha512 = crypto.createHash('sha512').update(binary).digest('base64')
    fs.writeFileSync(path.join(root, 'latest-linux.yml'), `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${binary.length}\n`)
    assert.throws(() => verifyArtifacts('linux', root))
    fs.writeFileSync(path.join(root, name), binary)
    verifyArtifacts('linux', root)
    fs.writeFileSync(path.join(root, name), 'tampered')
    assert.throws(() => verifyArtifacts('linux', root))
    fs.writeFileSync(path.join(root, 'latest.yml'), `version: ${version}\nfiles:\n  - url: setup.exe\n    sha512: ${sha512}\n`)
    fs.writeFileSync(path.join(root, 'setup.exe'), binary)
    assert.throws(() => verifyArtifacts('win', root))
    fs.writeFileSync(path.join(root, 'setup.exe.blockmap'), 'blockmap fixture')
    verifyArtifacts('win', root)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
