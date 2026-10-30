type CaptureWindow = {
  isDestroyed(): boolean
  show(): void
  focus(): void
  webContents: { send(channel: string, ...args: unknown[]): void }
}

// The tray and global shortcut share the complete capture-to-preview action.
export function createCaptureAction(
  capture: () => Promise<string | null>,
  getWindow: () => CaptureWindow | null,
  onError: (error: unknown) => void
) {
  let pending = false
  return async () => {
    if (pending) return
    pending = true
    try {
      const file = await capture()
      if (!file) return
      const window = getWindow()
      if (!window || window.isDestroyed()) return
      window.show()
      window.focus()
      window.webContents.send('screenshot-captured', file)
    } catch (error) { onError(error) }
    finally { pending = false }
  }
}
