export const DEFAULT_HOTKEYS = {
  openMain: 'Alt+W',
  openFavorites: 'Alt+F',
  openOverlay: 'Alt+1',
  takeScreenshot: 'Alt+2',
  captureFreeform: 'Alt+S',
  startRecording: 'Alt+3',
  stopRecording: 'Alt+4',
  quickSwitch: 'Alt+Q',
  quickSwitchPrevious: 'Alt+E',
  toggleHotkeys: 'Alt+X'
}

export type HotkeyAction = keyof typeof DEFAULT_HOTKEYS
export type Hotkeys = typeof DEFAULT_HOTKEYS & {
  disabled?: Partial<Record<HotkeyAction, boolean>>
  freeformShortcutVersion?: number
}

export function resolveHotkeys(hotkeys?: Partial<Hotkeys> | null): Hotkeys {
  const normalized = (value: unknown) => typeof value === 'string' ? value.toLowerCase().replace(/\s/g, '').replace(/ctrl\+/g, 'control+').split('+').sort().join('+') : ''
  const legacyDefault = hotkeys?.freeformShortcutVersion !== 2 && normalized(hotkeys?.captureFreeform) === normalized('Alt+5')
  const resolved = { ...DEFAULT_HOTKEYS, ...hotkeys, freeformShortcutVersion: 2 }
  // Do not take an accelerator already customized in an older installation.
  if (hotkeys?.captureFreeform === undefined || legacyDefault) {
    const used = new Set((Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[])
      .filter(action => action !== 'captureFreeform' && !resolved.disabled?.[action])
      .map(action => normalized(resolved[action])))
    const candidates = ['Alt+S', 'Alt+Shift+S', 'Control+Alt+S', ...Array.from({ length: 8 }, (_, index) => `Alt+Shift+F${index + 5}`)]
    resolved.captureFreeform = candidates.find(value => !used.has(normalized(value)))!
  }
  if (hotkeys?.toggleHotkeys === undefined) {
    const used = new Set((Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[])
      .filter(action => action !== 'toggleHotkeys' && !resolved.disabled?.[action])
      .map(action => normalized(resolved[action])))
    resolved.toggleHotkeys = ['Alt+X', 'Alt+Shift+X', 'Control+Alt+X', ...Array.from({ length: 8 }, (_, index) => `Alt+Shift+F${index + 5}`)]
      .find(value => !used.has(normalized(value)))!
  }
  return resolved
}

export function getActiveHotkeys(hotkeys?: Partial<Hotkeys> | null): typeof DEFAULT_HOTKEYS {
  const resolved = resolveHotkeys(hotkeys)
  const active = { ...DEFAULT_HOTKEYS }
  for (const action of Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[]) {
    active[action] = resolved.disabled?.[action] ? '' : resolved[action]
  }
  return active
}
