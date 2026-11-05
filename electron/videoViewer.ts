import { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'

export function createVideoViewer(options: {
  source: string; page: string; preload: string; theme: 'light' | 'dark'; language: string
}, Window = BrowserWindow) {
  const win = new Window({
    width: 1000, height: 700, minWidth: 360, minHeight: 260, frame: false, show: false,
    backgroundColor: options.theme === 'dark' ? '#080b1a' : '#f6f7fb', autoHideMenuBar: true,
    webPreferences: { preload: options.preload, contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required' },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.once('ready-to-show', () => { if (!win.isDestroyed()) { win.show(); win.focus() } })
  // File-backed video supports streaming/seeking without base64-encoding the
  // entire recording or copying it into another persistent file.
  const ready = win.loadFile(options.page, { query: { source: pathToFileURL(options.source).href,
    theme: options.theme, language: options.language } }).catch(error => {
    if (!win.isDestroyed()) win.destroy()
    throw error
  })
  return { window: win, ready }
}
