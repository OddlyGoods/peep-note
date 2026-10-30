import assert from 'node:assert/strict'
import test from 'node:test'
import { htmlPreviewDocument, openHtmlPreview } from '../electron/htmlPreview'

class PreviewWindow {
  static latest: PreviewWindow
  static failLoad = false
  events = new Map<string, (...args: any[]) => void>()
  shown = false
  destroyed = false
  url = ''
  permissionCheck?: () => boolean
  permissionRequest?: (...args: any[]) => void
  popup?: () => { action: string }
  webContents = {
    session: {
      setPermissionRequestHandler: (handler: (...args: any[]) => void) => { this.permissionRequest = handler },
      setPermissionCheckHandler: (handler: () => boolean) => { this.permissionCheck = handler }
    },
    setWindowOpenHandler: (handler: () => { action: string }) => { this.popup = handler },
    on: (name: string, handler: (...args: any[]) => void) => this.events.set(name, handler)
  }
  constructor(public options: any) { PreviewWindow.latest = this }
  on(name: string, handler: (...args: any[]) => void) { this.events.set(name, handler) }
  once(name: string, handler: (...args: any[]) => void) { this.events.set(name, handler) }
  show() { this.shown = true }
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true; this.events.get('closed')?.() }
  async loadURL(url: string) {
    if (PreviewWindow.failLoad) throw new Error('Preview could not load')
    this.url = url
    this.events.get('ready-to-show')?.()
  }
}

test('preview keeps full HTML inside a sandbox without allowing source to escape the frame', () => {
  const source = '<!doctype html><html><body><h1>한국어</h1></body></html>"</iframe><script>test()</script>'
  const document = htmlPreviewDocument(source, '<script>title</script>')
  assert.equal((document.match(/<iframe /g) ?? []).length, 1)
  assert.doesNotMatch(document, /<script>/)
  assert.match(document, /sandbox="allow-scripts"/)
  assert.match(document, /&lt;h1&gt;한국어&lt;\/h1&gt;/)
  assert.match(document, /<title>&lt;script&gt;title&lt;\/script&gt;<\/title>/)
})

test('preview opens an isolated window with no app preload or Node access', async () => {
  await openHtmlPreview('<h1>Hello</h1>', 'Test — Preview', PreviewWindow as any)
  const win = PreviewWindow.latest
  assert.equal(win.shown, true)
  assert.equal(win.options.frame, undefined, 'native window controls remain available')
  assert.equal(win.options.webPreferences.preload, undefined)
  assert.equal(win.options.webPreferences.nodeIntegration, false)
  assert.equal(win.options.webPreferences.contextIsolation, true)
  assert.equal(win.options.webPreferences.sandbox, true)
  assert.equal(win.options.webPreferences.webSecurity, true)
  assert.equal(win.permissionCheck?.(), false)
  let permissionAllowed = true
  win.permissionRequest?.(null, 'media', (allowed: boolean) => { permissionAllowed = allowed })
  assert.equal(permissionAllowed, false)
  assert.deepEqual(win.popup?.(), { action: 'deny' })
  let navigationBlocked = false
  win.events.get('will-navigate')?.({ preventDefault: () => { navigationBlocked = true } })
  assert.equal(navigationBlocked, true)
  assert.match(decodeURIComponent(win.url), /&lt;h1&gt;Hello&lt;\/h1&gt;/)
  win.destroy()
})

test('a failed preview load closes the unused window and reports failure', async () => {
  PreviewWindow.failLoad = true
  try {
    await assert.rejects(openHtmlPreview('<p>Test</p>', 'Preview', PreviewWindow as any))
    assert.equal(PreviewWindow.latest.destroyed, true)
  } finally { PreviewWindow.failLoad = false }
})
