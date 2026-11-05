import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle, Screen } from 'electron'
import { parseRectangleSelection, type RectangleSelection } from './multiMonitorRegion'

// Paint outside the crop, including a small rounding gap for mixed-DPI screens.
// At a display edge the off-screen side is omitted rather than entering the video.
export function recordingOutlineBounds(display: Rectangle, region: RectangleSelection): Rectangle[] {
  if (!parseRectangleSelection(region, display.width, display.height)) return []
  const left = Math.floor(display.x + region.x * display.width / region.canvasWidth)
  const top = Math.floor(display.y + region.y * display.height / region.canvasHeight)
  const right = Math.ceil(display.x + (region.x + region.width) * display.width / region.canvasWidth)
  const bottom = Math.ceil(display.y + (region.y + region.height) * display.height / region.canvasHeight)
  return [
    { x: left - 4, y: top - 4, width: right - left + 8, height: 2 },
    { x: left - 4, y: bottom + 2, width: right - left + 8, height: 2 },
    { x: left - 4, y: top - 2, width: 2, height: bottom - top + 4 },
    { x: right + 2, y: top - 2, width: 2, height: bottom - top + 4 },
  ].flatMap(bounds => {
    const x = Math.max(bounds.x, display.x), y = Math.max(bounds.y, display.y)
    const width = Math.min(bounds.x + bounds.width, display.x + display.width) - x
    const height = Math.min(bounds.y + bounds.height, display.y + display.height) - y
    return width > 0 && height > 0 ? [{ x, y, width, height }] : []
  })
}

export function recordingOutlineWindowOptions(bounds: Rectangle, platform = process.platform): BrowserWindowConstructorOptions {
  return { ...bounds, frame: false, transparent: true, backgroundColor: '#00000000', show: false,
    focusable: false, skipTaskbar: true, resizable: false, movable: false, hasShadow: false, alwaysOnTop: true,
    ...(platform === 'linux' ? { type: 'dock' } : {}),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  }
}

export const recordingOutlinePage = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#f43f5e}</style></head><body></body></html>'
)

export function createRecordingOutline(options: {
  createWindow: (bounds: Rectangle) => BrowserWindow
  load: (window: BrowserWindow) => Promise<unknown>
  screen: Pick<Screen, 'on' | 'removeListener'>
  onError: (error: unknown) => void
}) {
  const regions = new Map<number, Rectangle[]>()
  const active = new Map<number, BrowserWindow[]>()
  const stop = (owner: number) => {
    const windows = active.get(owner)
    active.delete(owner)
    for (const window of windows ?? []) if (!window.isDestroyed()) window.destroy()
  }
  const clear = () => {
    regions.clear()
    for (const owner of active.keys()) stop(owner)
  }
  options.screen.on('display-added', clear)
  options.screen.on('display-removed', clear)
  options.screen.on('display-metrics-changed', clear)
  return {
    prepare(owner: number, display: Rectangle, region: RectangleSelection) {
      stop(owner)
      regions.set(owner, recordingOutlineBounds(display, region))
    },
    async start(owner: number) {
      if (active.has(owner) || !regions.has(owner)) return
      const windows: BrowserWindow[] = []
      active.set(owner, windows)
      try {
        for (const bounds of regions.get(owner)!) {
          const window = options.createWindow(bounds)
          windows.push(window)
          window.setIgnoreMouseEvents(true, { forward: true })
          window.setAlwaysOnTop(true, 'screen-saver')
          window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
          if (process.platform === 'win32') window.setContentProtection(true)
          window.once('closed', () => stop(owner))
          window.webContents.once('render-process-gone', () => stop(owner))
        }
        await Promise.all(windows.map(window => options.load(window)))
        if (active.get(owner) !== windows) return
        for (const window of windows) if (!window.isDestroyed()) window.showInactive()
      } catch (error) {
        // A cancelled load belongs to the old recording, never a newer session.
        if (active.get(owner) === windows) { stop(owner); options.onError(error) }
      }
    },
    stop,
    forget(owner: number) { stop(owner); regions.delete(owner) },
    dispose() {
      clear()
      options.screen.removeListener('display-added', clear)
      options.screen.removeListener('display-removed', clear)
      options.screen.removeListener('display-metrics-changed', clear)
    },
  }
}
