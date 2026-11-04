import type { BrowserWindow, Display, IpcMain, IpcMainEvent, Screen } from 'electron'

type Monitor = Pick<Display, 'id' | 'bounds' | 'workArea'>
export type RectangleSelection = { x: number; y: number; width: number; height: number; canvasWidth: number; canvasHeight: number }
export type MonitorRegionResult = { mode: 'screenshot'; displayId: number; dataUrl: string }
  | { mode: 'recording-region'; displayId: number; region: RectangleSelection }

export function parseRectangleSelection(value: unknown, width: number, height: number): RectangleSelection | null {
  if (!value || typeof value !== 'object') return null
  const region = value as RectangleSelection
  if (![region.x, region.y, region.width, region.height, region.canvasWidth, region.canvasHeight].every(Number.isFinite)
    || !Number.isInteger(region.canvasWidth) || !Number.isInteger(region.canvasHeight)
    || region.canvasWidth <= 0 || region.canvasHeight <= 0 || !Number.isFinite(width) || !Number.isFinite(height)
    || Math.abs(region.canvasWidth - width) > 2 || Math.abs(region.canvasHeight - height) > 2
    || region.x < 0 || region.y < 0 || region.width < 5 || region.height < 5
    || region.x + region.width > region.canvasWidth || region.y + region.height > region.canvasHeight) return null
  return { x: region.x, y: region.y, width: region.width, height: region.height, canvasWidth: region.canvasWidth, canvasHeight: region.canvasHeight }
}

// Frozen screenshots are acquired before any selector is created. Recording
// selection uses transparent viewports and never requests a desktop image.
export function createMultiMonitorRegion(options: {
  mode: 'screenshot' | 'recording-region'
  displays: Monitor[]
  preferredDisplayId: number
  language: string
  snapshots?: Map<number, string>
  createWindow: (display: Monitor) => BrowserWindow
  load: (window: BrowserWindow) => Promise<unknown>
  ipc: Pick<IpcMain, 'on' | 'removeListener'>
  screen: Pick<Screen, 'on' | 'removeListener'>
  onError: (error: unknown) => void
}) {
  const entries: { display: Monitor; window: BrowserWindow; loaded: boolean; ready: boolean }[] = []
  let active = true, shown = false
  let resolve!: (result: MonitorRegionResult | null) => void
  const result = new Promise<MonitorRegionResult | null>(done => { resolve = done })
  const find = (event: IpcMainEvent) => entries.find(entry => !entry.window.isDestroyed() && entry.window.webContents === event.sender)
  const finish = (value: MonitorRegionResult | null = null) => {
    if (!active) return
    active = false
    clearTimeout(deadline)
    for (const [event, listener] of listeners) options.ipc.removeListener(event, listener)
    options.screen.removeListener('display-added', onClosed)
    options.screen.removeListener('display-removed', onClosed)
    options.screen.removeListener('display-metrics-changed', onClosed)
    for (const { window } of entries) {
      window.removeListener('closed', onClosed)
      if (window.isDestroyed()) continue
      window.webContents.removeListener('render-process-gone', onClosed)
      window.webContents.removeListener('before-input-event', onInput)
      window.close()
    }
    resolve(value)
  }
  const onClosed = () => finish()
  const onInput = (event: { preventDefault(): void }, input: { type: string; key: string }) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); finish() }
  }
  const showReady = () => {
    if (!active || shown || !entries.length || entries.some(entry => !entry.loaded || !entry.ready)) return
    shown = true
    clearTimeout(deadline)
    for (const { window } of entries) window.showInactive()
    const preferred = entries.find(entry => entry.display.id === options.preferredDisplayId) ?? entries[0]
    preferred.window.focus()
  }
  const onReady = (event: IpcMainEvent) => {
    const entry = find(event)
    if (!active || !entry?.loaded) return
    entry.ready = true
    showReady()
  }
  const onScreenshot = (event: IpcMainEvent, dataUrl: unknown) => {
    const entry = find(event)
    if (!active || !shown || options.mode !== 'screenshot' || !entry?.window.isVisible()) return
    if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) { finish(); return }
    finish({ mode: 'screenshot', displayId: entry.display.id, dataUrl })
  }
  const onRecording = (event: IpcMainEvent, input: unknown) => {
    const entry = find(event)
    if (!active || !shown || options.mode !== 'recording-region' || !entry?.window.isVisible()) return
    const { width, height } = entry.window.getContentBounds()
    const region = parseRectangleSelection(input, width, height)
    if (!region) { entry.window.webContents.send('snipping-error'); return }
    finish({ mode: 'recording-region', displayId: entry.display.id, region })
  }
  const onCancel = (event: IpcMainEvent) => { if (find(event)) finish() }
  const listeners: [string, (...args: any[]) => void][] = [
    ['snipping-ready', onReady], ['snipping-done', onScreenshot],
    ['recording-region-done', onRecording], ['snipping-cancel', onCancel],
  ]
  for (const [event, listener] of listeners) options.ipc.on(event, listener)
  options.screen.on('display-added', onClosed)
  options.screen.on('display-removed', onClosed)
  options.screen.on('display-metrics-changed', onClosed)
  const deadline = setTimeout(() => { options.onError(new Error('Region selector did not become ready')); finish() }, 10000)
  void (async () => {
    try {
      for (const display of options.displays) {
        if (options.mode === 'screenshot' && !options.snapshots?.get(display.id)) throw new Error('Display snapshot is unavailable')
        const window = options.createWindow(display)
        entries.push({ display, window, loaded: false, ready: false })
        window.once('closed', onClosed)
        window.webContents.once('render-process-gone', onClosed)
        window.webContents.on('before-input-event', onInput)
      }
      if (!entries.length) { finish(); return }
      await Promise.all(entries.map(async entry => {
        await options.load(entry.window)
        if (!active || entry.window.isDestroyed()) return
        entry.loaded = true
        const { width, height } = entry.window.getContentBounds()
        entry.window.webContents.send('snipping-init', { mode: options.mode, live: options.mode === 'recording-region',
          dataUrl: options.snapshots?.get(entry.display.id), width, height, language: options.language, canChangeMonitor: false,
          hintTop: Math.max(48, entry.display.workArea.y - entry.display.bounds.y + 20) })
      }))
    } catch (error) { options.onError(error); finish() }
  })()
  return { result, close: () => finish(), get windows() { return entries.map(entry => entry.window) },
    setLanguage(language: string) {
      options.language = language
      if (active) for (const { window } of entries) if (!window.isDestroyed()) window.webContents.send('language-changed', language)
    } }
}
