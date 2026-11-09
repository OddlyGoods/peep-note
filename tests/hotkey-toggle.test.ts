import assert from 'node:assert/strict'
import test from 'node:test'
import { GlobalHotkeyGate } from '../electron/hotkeyGate'
import { DEFAULT_HOTKEYS, resolveHotkeys } from '../shared/hotkeys'
import { hotkeyCopy } from '../shared/hotkeyMessages'

test('Alt+X pauses every action while retaining the shortcut needed to resume', () => {
  const gate = new GlobalHotkeyGate()
  assert.deepEqual(gate.active(), DEFAULT_HOTKEYS)
  assert.equal(gate.toggle(), false)
  assert.equal(gate.actionsEnabled, false)
  assert.deepEqual(Object.entries(gate.active()).filter(([, value]) => value), [['toggleHotkeys', 'Alt+X']])
  assert.equal(gate.toggle(), true)
  assert.deepEqual(gate.active(), DEFAULT_HOTKEYS)
})
test('resuming restores custom combinations and preserves individually disabled shortcuts', () => {
  const gate = new GlobalHotkeyGate()
  const custom = resolveHotkeys({ openOverlay: 'Ctrl+Alt+N', toggleHotkeys: 'Ctrl+Alt+X', disabled: { takeScreenshot: true, quickSwitch: true } })
  const before = gate.active(custom)
  gate.toggle()
  assert.deepEqual(Object.entries(gate.active(custom)).filter(([, value]) => value), [['toggleHotkeys', 'Ctrl+Alt+X']])
  gate.toggle()
  assert.deepEqual(gate.active(custom), before)
  assert.equal(gate.active(custom).takeScreenshot, '')
  assert.equal(custom.openOverlay, 'Ctrl+Alt+N')
})
test('shortcut editing pauses all registrations without resetting the user’s disabled state', () => {
  const gate = new GlobalHotkeyGate()
  gate.toggle(); gate.setEditing(true)
  assert.equal(gate.actionsEnabled, false)
  assert.ok(Object.values(gate.active()).every(value => value === ''))
  gate.setEditing(false)
  assert.equal(gate.actionsEnabled, false)
  assert.equal(gate.active().openOverlay, '')
  assert.equal(gate.active().toggleHotkeys, 'Alt+X')
  gate.toggle(); assert.equal(gate.actionsEnabled, true)
})
test('adding the new toggle does not take Alt+X away from existing customized actions', () => {
  assert.equal(resolveHotkeys().toggleHotkeys, 'Alt+X')
  assert.equal(resolveHotkeys({ openOverlay: 'Alt+X' }).toggleHotkeys, 'Alt+Shift+X')
  assert.equal(resolveHotkeys({ openMain: 'X+Alt', openOverlay: 'Shift+Alt+X' }).toggleHotkeys, 'Control+Alt+X')
  assert.equal(resolveHotkeys({ toggleHotkeys: 'Ctrl+Shift+X' }).toggleHotkeys, 'Ctrl+Shift+X')
})
test('global shortcut status messages are localized independently of the focused app', () => {
  assert.equal(hotkeyCopy('ko').hotkeysEnabled, '단축키 사용')
  assert.equal(hotkeyCopy('ko').hotkeysDisabled, '단축키 사용안함')
  for (const language of ['en', 'ko', 'ja', 'zh']) assert.notEqual(hotkeyCopy(language).hotkeysEnabled, hotkeyCopy(language).hotkeysDisabled)
})
