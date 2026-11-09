import { getActiveHotkeys, type Hotkeys, type HotkeyAction } from '../shared/hotkeys'

// Temporarily recording a new key must not change the user's on/off state.
export class GlobalHotkeyGate {
  private enabled = true
  private editing = false
  get actionsEnabled() { return this.enabled && !this.editing }
  toggle() { this.enabled = !this.enabled; return this.enabled }
  setEditing(editing: boolean) { this.editing = editing }
  active(hotkeys?: Partial<Hotkeys> | null) {
    const active = getActiveHotkeys(hotkeys)
    for (const action of Object.keys(active) as HotkeyAction[]) {
      if (this.editing || (!this.enabled && action !== 'toggleHotkeys')) active[action] = ''
    }
    return active
  }
}
