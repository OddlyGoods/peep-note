import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import type { McpSavedNote } from '../shared/mcpEvents'
import { createNoteNotificationLifetime, noteNotificationBounds, noteNotificationPresentation } from '../shared/noteNotification'
import { noteNotificationHtml } from './noteNotificationView'

export class NoteNotification {
  private window: BrowserWindow | null = null
  private ready = false
  private pending: ReturnType<typeof noteNotificationPresentation> | null = null
  private noteId: string | null = null
  private lifetime = createNoteNotificationLifetime<ReturnType<typeof noteNotificationPresentation>>({
    show: value => {
      const win = this.window
      if (!win || win.isDestroyed()) return
      win.setBounds(noteNotificationBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea))
      win.setIgnoreMouseEvents(false)
      win.webContents.send('note-toast-show', value)
      win.showInactive()
    },
    fade: () => {
      if (!this.window || this.window.isDestroyed()) return
      this.window.setIgnoreMouseEvents(true, { forward: true })
      this.window.webContents.send('note-toast-fade')
    },
    hide: () => this.destroyWindow()
  })

  constructor(private preferences: () => { language?: unknown; theme?: unknown }, private openNote: (id: string) => void) {}

  registerIPC() {
    const trusted = (event: IpcMainInvokeEvent) => this.window && !this.window.isDestroyed()
      && event.sender === this.window.webContents && event.senderFrame === this.window.webContents.mainFrame
    ipcMain.handle('note-toast-open', event => {
      if (!trusted(event) || !this.noteId) return
      const id = this.noteId
      this.dismiss()
      this.openNote(id)
    })
    ipcMain.handle('note-toast-dismiss', event => { if (trusted(event)) this.dismiss() })
  }

  show(note: McpSavedNote) {
    this.noteId = note.id
    this.pending = noteNotificationPresentation(note, this.preferences())
    if (this.window && !this.window.isDestroyed()) {
      if (this.ready) this.lifetime.show(this.pending)
      return
    }
    this.ready = false
    const win = new BrowserWindow({
      width: 480, height: 144, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, alwaysOnTop: true, skipTaskbar: true,
      focusable: false, resizable: false, minimizable: false, maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'noteToastPreload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false
      }
    })
    this.window = win
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.once('did-finish-load', () => {
      if (this.window !== win || !this.pending) return
      this.ready = true
      this.lifetime.show(this.pending)
    })
    win.on('closed', () => {
      if (this.window !== win) return
      this.window = null
      this.dismiss()
    })
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(noteNotificationHtml)}`).catch(() => {
      if (this.window === win) this.dismiss()
    })
  }

  dismiss() {
    this.lifetime.dismiss()
    this.destroyWindow()
  }

  private destroyWindow() {
    const win = this.window
    this.window = null
    this.ready = false
    this.pending = null
    this.noteId = null
    if (win && !win.isDestroyed()) win.destroy()
  }
}
