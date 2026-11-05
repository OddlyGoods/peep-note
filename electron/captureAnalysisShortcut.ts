export function handleCaptureAnalysisShortcut(options: {
  session: { window: { isDestroyed(): boolean; isMinimized(): boolean; restore(): void; show(): void; focus(): void } } | null
  preparing: boolean
  cancelSelection: () => void
  start: () => Promise<void>
}) {
  if (options.session && !options.session.window.isDestroyed()) {
    // A follow-up selection can hide the response window. Cancel just the
    // selection and bring the existing conversation back without restarting it.
    options.cancelSelection()
    const window = options.session.window
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    return
  }
  if (options.preparing) {
    options.cancelSelection()
    return
  }
  return options.start()
}
