type FavoritesWindow = {
  isDestroyed(): boolean
  isVisible(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  hide(): void
  webContents: {
    getURL(): string
    send(channel: string, ...args: unknown[]): void
  }
}

export function handleFavoritesShortcut(window: FavoritesWindow | null, showMainWindow: () => void) {
  if (!window || window.isDestroyed()) return

  let pathname = ''
  try {
    pathname = new URL(window.webContents.getURL()).pathname.replace(/\/+$/, '')
  } catch {}

  if (window.isVisible() && window.isFocused() && !window.isMinimized() && pathname === '/favorites') {
    window.hide()
    return
  }

  showMainWindow()
  window.webContents.send('hotkey-triggered', 'openFavorites')
}
