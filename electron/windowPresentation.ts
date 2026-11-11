export type PresentableWindow = {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  webContents: { isDestroyed(): boolean; focus(): void; invalidate(): void }
}

// Hidden/restored Chromium surfaces can miss their first frame after resume.
// Request a few frames without delaying opening or touching a closed window.
export function requestWindowRepaint(win: PresentableWindow) {
  for (const delay of [0, 100, 300]) {
    setTimeout(() => {
      if (win.isDestroyed() || !win.isVisible() || win.webContents.isDestroyed()) return
      win.webContents.invalidate()
    }, delay)
  }
}

export function showWindow(win: PresentableWindow) {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.focus()
  requestWindowRepaint(win)
}
