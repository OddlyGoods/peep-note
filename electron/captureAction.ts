import { showWindow, type PresentableWindow } from './windowPresentation'

type CaptureWindow = PresentableWindow & { webContents: { send(channel: string, ...args: unknown[]): void } }
export type CapturedScreenshot = { file: string; previewUrl: string }

// The tray and global shortcut share the complete capture-to-preview action.
export function createCaptureAction(
  capture: () => Promise<string | CapturedScreenshot | null>,
  getWindow: () => CaptureWindow | null,
  onError: (error: unknown) => void
) {
  let pending = false
  return async () => {
    if (pending) return
    pending = true
    try {
      const captured = await capture()
      if (!captured) return
      const window = getWindow()
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
      showWindow(window)
      // Reuse the selector's PNG instead of reading the saved file over IPC.
      if (typeof captured === 'string') window.webContents.send('screenshot-captured', captured)
      else window.webContents.send('screenshot-captured', captured.file, captured.previewUrl)
    } catch (error) { onError(error) }
    finally { pending = false }
  }
}
