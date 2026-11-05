export function handleCaptureAnalysisShortcut(options: {
  session: { window: { isDestroyed(): boolean }; close(): void } | null
  preparing: boolean
  cancelSelection: () => void
  start: () => Promise<void>
}) {
  if (options.session && !options.session.window.isDestroyed()) {
    // A follow-up selection can hide the response window. Close both surfaces
    // so cancelling the selector cannot bring the response window back.
    options.cancelSelection()
    options.session.close()
    return
  }
  if (options.preparing) {
    options.cancelSelection()
    return
  }
  return options.start()
}
