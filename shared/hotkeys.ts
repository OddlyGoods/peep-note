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

export type Hotkeys = typeof DEFAULT_HOTKEYS

export function resolveHotkeys(hotkeys?: Partial<Hotkeys> | null): Hotkeys {
  return { ...DEFAULT_HOTKEYS, ...hotkeys }
}
