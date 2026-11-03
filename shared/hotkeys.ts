export const DEFAULT_HOTKEYS = {
  openMain: 'Alt+W',
  openFavorites: 'Alt+F',
  openOverlay: 'Alt+1',
  takeScreenshot: 'Alt+2',
  captureFreeform: 'Alt+5',
  startRecording: 'Alt+3',
  stopRecording: 'Alt+4',
  quickSwitch: 'Alt+Q',
  quickSwitchPrevious: 'Alt+E'
}

export type HotkeyAction = keyof typeof DEFAULT_HOTKEYS
export type Hotkeys = typeof DEFAULT_HOTKEYS & {
  disabled?: Partial<Record<HotkeyAction, boolean>>
}

export function resolveHotkeys(hotkeys?: Partial<Hotkeys> | null): Hotkeys {
  const resolved = { ...DEFAULT_HOTKEYS, ...hotkeys }
  // Do not take an accelerator already customized in an older installation.
  if (hotkeys?.captureFreeform === undefined) {
    const normalized = (value: unknown) => typeof value === 'string' ? value.toLowerCase().replace(/\s/g, '').replace(/ctrl\+/g, 'control+').split('+').sort().join('+') : ''
    const used = new Set((Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[])
      .filter(action => action !== 'captureFreeform' && !resolved.disabled?.[action])
      .map(action => normalized(resolved[action])))
    const candidates = ['Alt+5', 'Alt+Shift+5', 'Control+Alt+5', ...Array.from({ length: 8 }, (_, index) => `Alt+Shift+F${index + 5}`)]
    resolved.captureFreeform = candidates.find(value => !used.has(normalized(value)))!
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
