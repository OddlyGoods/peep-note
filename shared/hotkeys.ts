export const DEFAULT_HOTKEYS = {
  openMain: 'Alt+W',
  openFavorites: 'Alt+F',
  openOverlay: 'Alt+1',
  takeScreenshot: 'Alt+2',
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
  return { ...DEFAULT_HOTKEYS, ...hotkeys }
}

export function getActiveHotkeys(hotkeys?: Partial<Hotkeys> | null): typeof DEFAULT_HOTKEYS {
  const resolved = resolveHotkeys(hotkeys)
  const active = { ...DEFAULT_HOTKEYS }
  for (const action of Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[]) {
    active[action] = resolved.disabled?.[action] ? '' : resolved[action]
  }
  return active
}
