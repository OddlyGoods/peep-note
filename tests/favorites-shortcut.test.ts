import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleFavoritesShortcut } from '../electron/favoritesShortcut'

function fixture(overrides: Partial<{ url: string; visible: boolean; focused: boolean; minimized: boolean; destroyed: boolean }> = {}) {
  const state = { url: 'http://localhost:5173/favorites', visible: true, focused: true, minimized: false, destroyed: false, ...overrides }
  const calls: string[] = []
  const window = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    isFocused: () => state.focused,
    isMinimized: () => state.minimized,
    hide: () => { calls.push('hide'); state.visible = false; state.focused = false },
    webContents: {
      getURL: () => state.url,
      send: (channel: string, action: unknown) => {
        calls.push(`${channel}:${action}`)
        state.url = new URL('/favorites', state.url).href
      }
    }
  }
  const show = () => { calls.push('show'); state.visible = true; state.focused = true; state.minimized = false }
  return { window, show, calls, state }
}

test('the favorites shortcut hides a focused favorites list in development and installed apps', () => {
  for (const url of ['http://localhost:5173/favorites', 'app://dist/favorites', 'app://dist/favorites/?search=note#top']) {
    const f = fixture({ url })
    handleFavoritesShortcut(f.window, f.show)
    assert.deepEqual(f.calls, ['hide'])
  }
})

test('the favorites shortcut opens the list from other screens, then toggles the window', () => {
  for (const pathname of ['/', '/settings', '/search', '/favorites/log/record']) {
    const f = fixture({ url: `http://localhost:5173${pathname}` })
    handleFavoritesShortcut(f.window, f.show)
    assert.deepEqual(f.calls, ['show', 'hotkey-triggered:openFavorites'])
    f.calls.length = 0
    handleFavoritesShortcut(f.window, f.show)
    assert.deepEqual(f.calls, ['hide'])
    f.calls.length = 0
    handleFavoritesShortcut(f.window, f.show)
    assert.deepEqual(f.calls, ['show', 'hotkey-triggered:openFavorites'])
  }
})

test('hidden, minimized and unfocused favorites windows are shown instead of hidden', () => {
  for (const state of [{ visible: false }, { focused: false }, { minimized: true }]) {
    const f = fixture(state)
    handleFavoritesShortcut(f.window, f.show)
    assert.deepEqual(f.calls, ['show', 'hotkey-triggered:openFavorites'])
    assert.equal(f.state.visible, true)
    assert.equal(f.state.focused, true)
    assert.equal(f.state.minimized, false)
  }
})

test('the favorites shortcut ignores missing and destroyed windows', () => {
  const f = fixture({ destroyed: true })
  handleFavoritesShortcut(null, f.show)
  handleFavoritesShortcut(f.window, f.show)
  assert.deepEqual(f.calls, [])
})
