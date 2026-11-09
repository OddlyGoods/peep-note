import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { GlobalHotkeyGate } from '../electron/hotkeyGate'
import { HotkeyToast, HOTKEY_TOAST_MS } from '../electron/hotkeyToast'

app.setPath('userData', path.join(__dirname, 'isolated-profile'))
app.disableHardwareAcceleration()
const deadline = setTimeout(() => app.exit(1), 16000)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const exec = promisify(execFile)
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await wait(20) }
  throw new Error('Hotkey native condition timed out')
}
app.whenReady().then(async () => {
  console.log('Hotkey QA: Electron ready')
  const owner = new BrowserWindow({ width: 500, height: 300, show: true })
  await owner.loadURL('data:text/html,<h1>Isolated shortcut test</h1>')
  console.log('Hotkey QA: owner loaded')
  owner.focus()
  await until(() => owner.isFocused())
  const gate = new GlobalHotkeyGate(), toast = new HotkeyToast()
  let writes = 0, toggles = 0
  const register = (keepToggle = false) => {
    if (keepToggle) globalShortcut.unregister('Alt+1')
    else globalShortcut.unregisterAll()
    const active = gate.active()
    if (active.toggleHotkeys && !keepToggle) assert.ok(globalShortcut.register(active.toggleHotkeys, () => {
      const enabled = gate.toggle(); toggles++; register(true); toast.show(enabled, 'ko')
    }))
    if (active.openOverlay) assert.ok(globalShortcut.register(active.openOverlay, () => { writes++ }))
  }
  register()
  console.log('Hotkey QA: shortcuts registered')
  await exec('xdotool', ['key', 'alt+1']); await until(() => writes === 1)
  await exec('xdotool', ['key', 'alt+x']); await until(() => toggles === 1)
  assert.equal(globalShortcut.isRegistered('Alt+1'), false)
  assert.equal(globalShortcut.isRegistered('Alt+X'), true)
  const findToast = () => BrowserWindow.getAllWindows().find(win => win !== owner)
  await until(() => !!findToast()?.isVisible())
  const badge = findToast()!
  assert.equal(owner.isFocused(), true, 'the toast never steals input focus')
  assert.equal(badge.isFocusable(), false)
  assert.equal(await badge.webContents.executeJavaScript('document.querySelector(".badge").textContent'), '단축키 사용안함')
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const bounds = badge.getBounds()
  assert.ok(Math.abs(bounds.x + bounds.width / 2 - (area.x + area.width / 2)) < 2)
  assert.ok(bounds.y >= area.y)
  await wait(350)
  assert.ok(Number(await badge.webContents.executeJavaScript('getComputedStyle(document.querySelector(".badge")).opacity')) > .9)
  await exec('xdotool', ['key', 'alt+1']); await wait(80); assert.equal(writes, 1)
  await exec('xdotool', ['key', 'alt+x']); await until(() => toggles === 2 && !!findToast()?.isVisible())
  assert.equal(globalShortcut.isRegistered('Alt+1'), true)
  assert.equal(await findToast()!.webContents.executeJavaScript('document.querySelector(".badge").textContent'), '단축키 사용')
  assert.equal(BrowserWindow.getAllWindows().length, 2, 'rapid changes replace the previous badge')
  await exec('xdotool', ['key', 'alt+1']); await until(() => writes === 2)
  await wait(HOTKEY_TOAST_MS + 100)
  assert.equal(findToast(), undefined, 'the badge closes after its two-second fade')
  toast.showMessage('기록 없음')
  await until(() => !!findToast()?.isVisible())
  assert.equal(await findToast()!.webContents.executeJavaScript('document.querySelector(".badge").textContent'), '기록 없음')
  assert.equal(owner.isFocused(), true, 'Quick List empty toast shares the focus-safe presentation')
  toast.dismiss(); globalShortcut.unregisterAll(); owner.destroy(); clearTimeout(deadline)
  console.log('HOTKEY_QA_SUCCESS: Alt+X pause/resume, no focus stealing, upper-center badge, replacement, fade and cleanup')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
