import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { transformSync } from 'esbuild'
import { createNoteNotificationLifetime, noteNotificationBounds, noteNotificationPresentation } from '../shared/noteNotification'
import { noteNotificationHtml } from '../electron/noteNotificationView'

function fixture() {
  let now = 0, id = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  const events: string[] = []
  const lifetime = createNoteNotificationLifetime<string>({
    show: value => events.push(value), fade: () => events.push('fade'), hide: () => events.push('hide')
  }, {
    set: (delay, run) => { timers.set(++id, { at: now + delay, run }); return id },
    clear: key => timers.delete(key as number)
  })
  return { events, lifetime, tick(ms: number) {
    const end = now + ms
    for (;;) {
      const next = [...timers.entries()].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0]); now = next[1].at; next[1].run()
    }
    now = end
  } }
}

test('save notification holds for five seconds, fades for half a second and closes', () => {
  const f = fixture()
  f.lifetime.show('first')
  f.tick(4999)
  assert.deepEqual(f.events, ['first'])
  f.tick(1)
  assert.deepEqual(f.events, ['first', 'fade'])
  f.tick(499)
  assert.deepEqual(f.events, ['first', 'fade'])
  f.tick(1)
  assert.deepEqual(f.events, ['first', 'fade', 'hide'])
})

test('a new save during the hold or fade replaces the notification and restarts its lifetime', () => {
  const f = fixture()
  f.lifetime.show('first'); f.tick(4500)
  f.lifetime.show('second'); f.tick(5000)
  assert.deepEqual(f.events, ['first', 'second', 'fade'])
  f.tick(250); f.lifetime.show('third'); f.tick(5000)
  assert.deepEqual(f.events, ['first', 'second', 'fade', 'third', 'fade'])
  f.tick(500)
  assert.equal(f.events.filter(event => event === 'hide').length, 1)
})

test('opening, closing or quitting cancels pending notification timers', () => {
  const f = fixture()
  f.lifetime.show('first'); f.tick(1000); f.lifetime.dismiss(); f.lifetime.dismiss(); f.tick(20_000)
  assert.deepEqual(f.events, ['first', 'hide'])
})

test('notification follows the bottom right of the monitor work area, including negative coordinates', () => {
  assert.deepEqual(noteNotificationBounds({ x: -1920, y: 24, width: 1920, height: 1032 }), {
    x: -496, y: 896, width: 480, height: 144
  })
  assert.deepEqual(noteNotificationBounds({ x: 0, y: 0, width: 360, height: 640 }), {
    x: 16, y: 480, width: 328, height: 144
  })
})

test('notification uses the selected language and theme, bounds its text and forwards no other preferences', () => {
  const note = { id: 'test', title: '', preview: 'a'.repeat(800), savedAt: 1793325600 }
  const preferences = { language: 'ko', theme: 'dark', openai_api_key: 'fixture-secret', token: 'fixture-token' }
  const view = noteNotificationPresentation(note, preferences)
  assert.equal(view.theme, 'dark')
  assert.equal(view.title, '제목 없는 메모')
  assert.match(view.metadata, /MCP · 메모 저장됨/)
  assert.equal(view.preview.length, 600)
  assert.equal(JSON.stringify(view).includes('fixture-'), false)
  assert.equal(noteNotificationPresentation(note, { language: 'constructor' }).language, 'en')
  assert.equal(noteNotificationPresentation(note, { language: 'ja' }).close, '閉じる')
  assert.equal(noteNotificationPresentation(note, { language: 'zh' }).close, '关闭')
})

test('notification renders note text literally and exposes only open and dismiss actions', () => {
  const elements = new Map<string, any>()
  let show!: (data: unknown) => void, fade!: () => void, opened = 0, dismissed = 0
  const body = { dataset: {}, classList: { remove() {}, add() {} } }
  const document = {
    body, documentElement: { lang: '' }, getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, { textContent: '', setAttribute() {}, addEventListener(_event: string, handler: () => void) { this.click = handler } })
      return elements.get(id)
    }
  }
  const code = noteNotificationHtml.match(/<script>([\s\S]*?)<\/script>/)![1]
  vm.runInNewContext(code, { document, window: { noteNotification: {
    onShow: (fn: typeof show) => { show = fn }, onFade: (fn: typeof fade) => { fade = fn },
    open: () => opened++, dismiss: () => dismissed++
  } } })
  const hostile = '<img src=x onerror="alert(1)"><script>bad()</script>'
  show(noteNotificationPresentation({ id: 'test', title: hostile, preview: hostile, savedAt: 1 }, {}))
  assert.equal(elements.get('title').textContent, hostile)
  assert.equal(elements.get('preview').textContent, hostile)
  elements.get('open').click(); elements.get('dismiss').click(); fade()
  assert.equal(opened, 1)
  assert.equal(dismissed, 1)
})

function nativeFixture() {
  const windows: any[] = [], handlers = new Map<string, (...args: any[]) => void>(), opened: string[] = []
  class Window extends EventEmitter {
    destroyed = false
    inactiveShows = 0
    sent: any[] = []
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {},
      send: (...args: any[]) => this.sent.push(args),
      setWindowOpenHandler: (handler: () => unknown) => { this.windowOpen = handler }
    })
    windowOpen!: () => unknown
    constructor(public options: any) { super(); windows.push(this) }
    isDestroyed() { return this.destroyed }
    setBounds() {}
    setIgnoreMouseEvents() {}
    showInactive() { this.inactiveShows++ }
    loadURL() { return Promise.resolve() }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  const native = {
    BrowserWindow: Window,
    ipcMain: { handle: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler) },
    screen: { getCursorScreenPoint: () => ({ x: 10, y: 10 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) }
  }
  const file = path.resolve(__dirname, '../electron/noteNotification.ts'), requireFrom = createRequire(file), module = { exports: {} as any }
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node18' }).code
  vm.runInNewContext(`(function(require,module,exports,__dirname){${code}\n})`)(
    (id: string) => id === 'electron' ? native : requireFrom(id), module, module.exports, path.dirname(file)
  )
  const notification = new module.exports.NoteNotification(() => ({ theme: 'light', language: 'en' }), (id: string) => opened.push(id))
  notification.registerIPC()
  return { notification, windows, handlers, opened }
}

test('desktop notification shows without taking focus and opens only its own latest note from its trusted frame', t => {
  const f = nativeFixture()
  t.after(() => f.notification.dismiss())
  const first = { id: 'first', title: 'First', preview: 'Draft', savedAt: 1 }
  f.notification.show(first)
  f.notification.show({ ...first, id: 'latest', title: 'Latest' })
  assert.equal(f.windows.length, 1)
  const win = f.windows[0]
  assert.equal(win.inactiveShows, 0)
  win.webContents.emit('did-finish-load')
  assert.equal(win.inactiveShows, 1)
  assert.equal(win.sent[0][1].title, 'Latest')
  assert.equal(win.options.focusable, false)
  assert.equal(win.options.skipTaskbar, true)
  assert.equal(win.options.webPreferences.sandbox, true)
  assert.match(win.options.webPreferences.preload, /noteToastPreload\.js$/)
  const click = f.handlers.get('note-toast-open')!
  click({ sender: {}, senderFrame: win.webContents.mainFrame })
  click({ sender: win.webContents, senderFrame: {} })
  assert.equal(f.opened.length, 0)
  click({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, 'untrusted-id')
  assert.deepEqual(f.opened, ['latest'])
  assert.equal(win.destroyed, true)
})

test('notification rejects navigation and popups and can close before its page finishes loading', t => {
  const f = nativeFixture()
  t.after(() => f.notification.dismiss())
  f.notification.show({ id: 'first', title: 'First', preview: 'Text', savedAt: 1 })
  const win = f.windows[0]
  assert.equal(win.windowOpen().action, 'deny')
  let prevented = false
  win.webContents.emit('will-navigate', { preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  f.notification.dismiss()
  win.webContents.emit('did-finish-load')
  assert.equal(win.destroyed, true)
  assert.equal(win.inactiveShows, 0)
})
