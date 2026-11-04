import type { BrowserWindow, BrowserWindowConstructorOptions, Display, IpcMain, IpcMainEvent, Rectangle, Screen } from 'electron'
import { parseLassoCapture } from '../shared/lassoCapture'
import { createLiveCapture } from './liveCapture'

type Monitor = Pick<Display, 'id' | 'bounds'> & Partial<Pick<Display, 'workArea'>>
export interface MultiMonitorLassoResult { dataUrl: string; bounds: Rectangle }

export function lassoWindowOptions(display: Monitor, platform = process.platform): BrowserWindowConstructorOptions {
  return { ...display.bounds, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
    transparent: true, backgroundColor: '#00000000', hasShadow: false, show: false,
    // GNOME constrains full-monitor normal/toolbar windows to the active monitor
    // even after setBounds(). A dock is an overlay surface with explicit placement;
    // no struts are set, so it does not reserve desktop space.
    ...(platform === 'linux' ? { type: 'dock' } : {}),
  }
}

// Each window keeps its own DIP viewport. This avoids stretching a single
// Chromium surface across monitors with different scale factors or origins.
export function createMultiMonitorLasso(options: {
  displays: Monitor[]
  preferredDisplayId: number
  language: string
  createWindow: (display: Monitor) => BrowserWindow
  load: (window: BrowserWindow) => Promise<unknown>
  capture: (displayId: number) => Promise<string>
  ipc: Pick<IpcMain, 'on' | 'removeListener'>
  screen: Pick<Screen, 'on' | 'removeListener'>
  onError: (error: unknown) => void
  wait?: () => Promise<void>
}) {
  const entries: { display: Monitor; window: BrowserWindow }[] = []
  let active = true, ready = false, selected: typeof entries[number] | null = null, bounds: Rectangle | null = null
  let resolve!: (value: MultiMonitorLassoResult | null) => void
  const result = new Promise<MultiMonitorLassoResult | null>(done => { resolve = done })
  const find = (event: IpcMainEvent) => entries.find(entry => !entry.window.isDestroyed() && entry.window.webContents === event.sender)
  const show = (focus = options.preferredDisplayId) => {
    for (const entry of entries) if (!entry.window.isDestroyed()) entry.window.showInactive()
    const entry = entries.find(entry => entry.display.id === focus) ?? entries[0]
    if (entry && !entry.window.isDestroyed()) entry.window.focus()
  }
  const finish = (value: MultiMonitorLassoResult | null = null) => {
    if (!active) return
    active = false
    live.dispose()
    options.ipc.removeListener('snipping-capture-lasso', onCapture)
    options.ipc.removeListener('snipping-done', onDone)
    options.ipc.removeListener('snipping-cancel', onCancel)
    options.screen.removeListener('display-added', onDisplaysChanged)
    options.screen.removeListener('display-removed', onDisplaysChanged)
    options.screen.removeListener('display-metrics-changed', onDisplaysChanged)
    for (const { window } of entries) {
      window.removeListener('closed', onClosed)
      if (window.isDestroyed()) continue
      window.webContents.removeListener('render-process-gone', onClosed)
      window.close()
    }
    resolve(value)
  }
  const onClosed = () => finish()
  // Cancel instead of using stale viewport geometry after hot-plug/DPI changes.
  const onDisplaysChanged = () => finish()
  const live = createLiveCapture({
    hide: () => { for (const { window } of entries) if (!window.isDestroyed()) window.hide() },
    wait: options.wait,
    capture: () => options.capture(selected!.display.id),
    deliver: dataUrl => {
      if (selected && !selected.window.isDestroyed()) selected.window.webContents.send('lasso-source', dataUrl)
    },
    onError: error => {
      options.onError(error)
      const focus = selected?.display.id
      selected = null; bounds = null
      for (const { window } of entries) if (!window.isDestroyed()) window.webContents.send('snipping-error')
      show(focus)
    },
  })
  const onCapture = (event: IpcMainEvent, input: unknown) => {
    if (!active || !ready || selected) return
    const entry = find(event)
    if (!entry || !entry.window.isVisible()) return
    const viewport = entry.window.getContentBounds()
    const parsed = parseLassoCapture(input, viewport.width, viewport.height)
    if (!parsed) { entry.window.webContents.send('snipping-error'); return }
    const xs = parsed.points.map(point => point.x), ys = parsed.points.map(point => point.y)
    // Account for the same one-pixel native/renderer rounding tolerated by the parser.
    const sx = viewport.width / parsed.width, sy = viewport.height / parsed.height
    const left = Math.floor(Math.min(...xs) * sx), top = Math.floor(Math.min(...ys) * sy)
    bounds = { x: viewport.x + left, y: viewport.y + top,
      width: Math.ceil(Math.max(...xs) * sx) - left, height: Math.ceil(Math.max(...ys) * sy) - top }
    selected = entry
    void live.start()
  }
  const onDone = (event: IpcMainEvent, dataUrl: unknown) => {
    if (!active || !selected || find(event) !== selected || !live.pending || !bounds) return
    if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) { finish(); return }
    finish({ dataUrl, bounds })
  }
  const onCancel = (event: IpcMainEvent) => { if (find(event)) finish() }
  options.ipc.on('snipping-capture-lasso', onCapture)
  options.ipc.on('snipping-done', onDone)
  options.ipc.on('snipping-cancel', onCancel)
  options.screen.on('display-added', onDisplaysChanged)
  options.screen.on('display-removed', onDisplaysChanged)
  options.screen.on('display-metrics-changed', onDisplaysChanged)
  void (async () => {
    try {
      for (const display of options.displays) {
        const window = options.createWindow(display)
        entries.push({ display, window })
        window.once('closed', onClosed)
        window.webContents.once('render-process-gone', onClosed)
      }
      await Promise.all(entries.map(async ({ display, window }) => {
        await options.load(window)
        if (!active || window.isDestroyed()) return
        const { width, height } = window.getContentBounds()
        window.webContents.send('snipping-init', { live: true, mode: 'lasso', width, height,
          language: options.language, canChangeMonitor: false,
          hintTop: Math.max(48, (display.workArea?.y ?? display.bounds.y) - display.bounds.y + 20) })
      }))
      if (!active) return
      if (!entries.length) { finish(); return }
      ready = true
      show()
    } catch (error) { options.onError(error); finish() }
  })()
  return { result, close: () => finish(), get windows() { return entries.map(entry => entry.window) },
    setLanguage(language: string) {
      options.language = language
      if (active) for (const { window } of entries) if (!window.isDestroyed()) window.webContents.send('language-changed', language)
    } }
}
