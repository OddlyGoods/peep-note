import { BrowserWindow, screen } from 'electron'
import { hotkeyCopy } from '../shared/hotkeyMessages'

export const HOTKEY_TOAST_MS = 2000
export function hotkeyToastHtml(enabled: boolean, language: unknown) {
  const text = hotkeyCopy(language)[enabled ? 'hotkeysEnabled' : 'hotkeysDisabled']
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}
  body{display:flex;align-items:center;justify-content:center}
  .badge{background:rgba(10,12,40,.85);color:#a5b4fc;padding:6px 16px;border-radius:20px;font:12px/18px 'Segoe UI',sans-serif;border:1px solid rgba(99,102,241,.3);white-space:nowrap;animation:toast ${HOTKEY_TOAST_MS}ms ease-in-out both}
  @keyframes toast{0%{opacity:0;transform:translateY(-4px)}15%,75%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-4px)}}
  </style></head><body><div class="badge" role="status">${text}</div></body></html>`
}

export class HotkeyToast {
  private window: BrowserWindow | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  show(enabled: boolean, language: unknown) {
    this.dismiss()
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const width = Math.min(340, display.workArea.width)
    const win = this.window = new BrowserWindow({
      x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
      y: Math.max(display.bounds.y + 48, display.workArea.y + 20), width, height: 44,
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, minimizable: false, maximizable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    })
    win.setIgnoreMouseEvents(true)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.once('did-finish-load', () => {
      if (this.window !== win || win.isDestroyed()) return
      win.showInactive()
      this.timer = setTimeout(() => this.dismiss(), HOTKEY_TOAST_MS)
      this.timer.unref()
    })
    win.on('closed', () => { if (this.window === win) this.dismiss() })
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(hotkeyToastHtml(enabled, language))}`).catch(() => {
      if (this.window === win) this.dismiss()
    })
  }
  dismiss() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const win = this.window; this.window = null
    if (win && !win.isDestroyed()) win.destroy()
  }
}
