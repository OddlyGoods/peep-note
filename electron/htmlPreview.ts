import { BrowserWindow } from 'electron'

const previewWindows = new Set<BrowserWindow>()

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]!)
}

export function htmlPreviewDocument(source: string, title: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src https:; frame-src 'self'; form-action 'none'; base-uri 'none'">
<title>${escapeHtml(title)}</title>
<style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;width:100%;height:100%;border:0;background:#fff}</style>
</head><body><iframe title="HTML preview" sandbox="allow-scripts" srcdoc="${escapeHtml(source)}"></iframe></body></html>`
}

export async function openHtmlPreview(source: string, title: string, Window = BrowserWindow) {
  const win = new Window({
    width: 1100, height: 800, minWidth: 400, minHeight: 300,
    title, backgroundColor: '#ffffff', autoHideMenuBar: true, show: false,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, partition: 'html-preview'
    }
  })
  previewWindows.add(win)
  win.on('closed', () => previewWindows.delete(win))
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  win.webContents.session.setPermissionCheckHandler(() => false)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.once('ready-to-show', () => win.show())
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlPreviewDocument(source, title))}`)
  } catch (error) {
    if (!win.isDestroyed()) win.destroy()
    throw error
  }
}
