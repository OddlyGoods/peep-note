import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  desktopCapturer,
  screen,
  shell,
  dialog,
  protocol,
  net,
  powerMonitor
} from 'electron'
import path from 'path'
import fs from 'fs'
import { createConnection } from 'node:net'
import { autoUpdater } from 'electron-updater'
import { UpdateController, type UpdateEvent } from './updateController'
import { installDebAndRestart } from './installDeb'
import { UPDATE_STATE_CHANNEL } from '../shared/updates'
import { startServer } from '../server/index'
import { attachmentPath, isLinkedAttachment } from '../shared/attachments'
import { importLocalAttachments, attachmentFileSize } from './attachmentFiles'
import { directoryUsage } from './dataUsage'
import { queryAll } from '../server/db'
import { cleanupUnreferencedMedia } from '../server/media'
import { DataStorageError, prepareDataLocation, scheduleDataLocation } from './dataStorage'
import { restartAfterDataLocationChange } from './restart'
import { dataStorageCopy, dataStorageErrorKey, type DataLocationResult } from '../shared/dataStorage'
import { getActiveHotkeys, resolveHotkeys } from '../shared/hotkeys'
import { handleFavoritesShortcut } from './favoritesShortcut'
import { openHtmlPreview } from './htmlPreview'
import { APP_DEVELOPER, APP_GITHUB_URL, APP_WEBSITE_URL } from '../shared/appInfo'

// Register the internal app scheme before Electron is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true } }
])

const isDev = process.env.NODE_ENV === 'development'
const configuredPort = Number(import.meta.env.VITE_LOCAL_SERVER_PORT)
const APP_PORT = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535 ? configuredPort : 3848

function isLocalServerRunning() {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: APP_PORT })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.setTimeout(250, () => { socket.destroy(); resolve(false) })
  })
}

// On Linux, Chromium's GPU process can lose its compositing surface across
// suspend/resume, especially with X11 and NVIDIA hybrid graphics. PeepNote does
// not need accelerated 3D rendering, so use software compositing to keep its
// windows paintable after resume. This must run before Electron becomes ready.
if (process.platform === 'linux') {
  app.disableHardwareAcceleration()

  // Modern Ubuntu/Wayland screen capture uses PipeWire through
  // xdg-desktop-portal. Keep X11 compatibility while enabling that path.
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
}

// Keep one instance of this local app running.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  // Prevent the duplicate process from reaching server/window initialization.
  process.exit(0)
} else {
  app.on('second-instance', () => showMainWindow())
}

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let snippingWindow: BrowserWindow | null = null
// Capturing a desktop thumbnail is asynchronous. Keep a separate guard for
// that short period before the selector BrowserWindow exists, otherwise a
// repeated global shortcut can open two overlapping selector windows.
let snippingPreparing = false
let capturePickerWindow: BrowserWindow | null = null
let quickSwitchWindow: BrowserWindow | null = null
const imageViewerWindows = new Set<BrowserWindow>()
let tray: Tray | null = null
let updateController: UpdateController
let quickSwitchAccelerator = 'Alt+Q'
let quickSwitchPreviousAccelerator = 'Alt+E'
let globalHotkeysEnabled = true

// A restored Linux compositor can accept show/focus before Chromium's surface
// is ready. Request a few frames so the window does not remain transparent.
function requestWindowRepaint(win: BrowserWindow) {
  for (const delay of [0, 100, 300]) {
    setTimeout(() => {
      if (win.isDestroyed() || !win.isVisible() || win.webContents.isDestroyed()) return
      win.webContents.invalidate()
    }, delay)
  }
}

function showMainWindow() {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.focus()
  requestWindowRepaint(win)
}

// ── 데이터 디렉토리 준비 ──────────────────────────────────────────────
app.setPath('userData', path.join(app.getPath('appData'), 'open-peep-note'))
const userData = app.getPath('userData')
const profilePath = userData
let dataDirectory = userData
let screenshotsDir = path.join(dataDirectory, 'screenshots')
let videosDir = path.join(dataDirectory, 'videos')
let attachmentsDir = path.join(dataDirectory, 'attachments')
const recordingWindows = new Set<number>()
const observedRecordingWindows = new WeakSet<Electron.WebContents>()
let changingDataLocation = false

const selectedAttachmentLinks = new Set<string>()

function managedLocalFile(filePath: string): string | null {
  if (isLinkedAttachment(filePath)) return null
  try {
    const resolved = fs.realpathSync(filePath)
    const insideManagedRoot = [screenshotsDir, videosDir, attachmentsDir].some(root => {
      const relative = path.relative(path.resolve(root), resolved)
      return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    })
    return insideManagedRoot ? resolved : null
  } catch { return null }
}

function readableAttachmentFile(reference: string): string | null {
  if (!isLinkedAttachment(reference)) return managedLocalFile(reference)
  if (!path.isAbsolute(attachmentPath(reference))) return null
  try {
    const saved = selectedAttachmentLinks.has(reference) || queryAll<{ attachments: string }>('SELECT attachments FROM logs UNION ALL SELECT attachments FROM comments')
      .some(row => { try { const files = JSON.parse(row.attachments); return Array.isArray(files) && files.includes(reference) } catch { return false } })
    if (!saved) return null
    const resolved = fs.realpathSync(attachmentPath(reference))
    return fs.statSync(resolved).isFile() ? resolved : null
  } catch { return null }
}

// ── 설정 파일 ──────────────────────────────────────────────────────────
let settingsPath = path.join(dataDirectory, 'settings.json')
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      return { ...settings, hotkeys: resolveHotkeys(settings.hotkeys) }
    }
  } catch {}
  return {
    language: 'en',
    hotkeys: resolveHotkeys()
  }
}
function saveSettings(settings: object) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

// ── 메인 윈도우 ────────────────────────────────────────────────────────
function createMainWindow() {
  const resourcesDir = isDev ? path.join(__dirname, '../resources') : path.join(process.resourcesPath, 'resources')
  const platformIcon = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const preferredIcon = path.join(resourcesDir, platformIcon)
  const appIcon = fs.existsSync(preferredIcon)
    ? preferredIcon
    : path.join(resourcesDir, 'icon.png')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#080b1a',
    frame: false,
    titleBarStyle: 'hidden',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadURL('app://dist/index.html')
  }

  mainWindow.once('ready-to-show', showMainWindow)

  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

// ── 오버레이 윈도우 ────────────────────────────────────────────────────
function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const margin = 20
  const winW = 480
  const winH = 420

  overlayWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: width - winW - margin,
    y: height - winH - margin,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev) {
    overlayWindow.loadURL('http://localhost:5173/overlay.html')
  } else {
    overlayWindow.loadURL('app://dist/overlay.html')
  }

  // blur 시 자동 닫힘 제거 → 드래그 중 사라지는 문제 방지
}

// ── 최근 기록 빠른 전환창 ──────────────────────────────────────────────
function createQuickSwitchWindow() {
  if (quickSwitchWindow && !quickSwitchWindow.isDestroyed()) return quickSwitchWindow

  const { workArea } = screen.getPrimaryDisplay()
  quickSwitchWindow = new BrowserWindow({
    width: 460,
    height: 320,
    x: workArea.x + workArea.width - 480,
    y: workArea.y + 24,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  quickSwitchWindow.setAlwaysOnTop(true, 'floating')
  quickSwitchWindow.on('closed', () => { quickSwitchWindow = null })
  quickSwitchWindow.on('hide', () => registerQuickSwitchShortcut())
  quickSwitchWindow.on('blur', () => {
    if (quickSwitchWindow && !quickSwitchWindow.isDestroyed() && quickSwitchWindow.isVisible()) {
      quickSwitchWindow.hide()
    }
  })
  quickSwitchWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'ArrowDown') {
      event.preventDefault()
      quickSwitchWindow?.webContents.send('quick-switch-next')
    } else if (input.type === 'keyDown' && input.key === 'ArrowUp') {
      event.preventDefault()
      quickSwitchWindow?.webContents.send('quick-switch-previous')
    } else if (input.type === 'keyDown' && input.key === 'Enter') {
      event.preventDefault()
      quickSwitchWindow?.webContents.send('quick-switch-confirm')
    } else if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      quickSwitchWindow?.hide()
    }
  })

  if (isDev) quickSwitchWindow.loadURL('http://localhost:5173/quick-switch.html')
  else quickSwitchWindow.loadURL('app://dist/quick-switch.html')
  return quickSwitchWindow
}

function openQuickSwitch() {

  const win = createQuickSwitchWindow()
  const open = () => {
    if (!win || win.isDestroyed()) return
    win.show()
    win.focus()
    win.webContents.focus()
    // Some Linux compositors finish mapping an always-on-top window after
    // show() returns, so repeat the focus request once it is visible.
    setTimeout(() => {
      if (win.isVisible() && !win.isDestroyed()) {
        win.focus()
        win.webContents.focus()
      }
    }, 50)
    win.webContents.send('quick-switch-open')
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', open)
  else open()
}

function advanceQuickSwitch() {
  if (quickSwitchWindow?.isVisible()) {
    // Alt+Q should restore keyboard control when the floating window lost focus.
    quickSwitchWindow.show()
    quickSwitchWindow.focus()
    quickSwitchWindow.webContents.focus()
    quickSwitchWindow.webContents.send('quick-switch-next')
    return
  }
  openQuickSwitch()
}

function previousQuickSwitch() {

  if (quickSwitchWindow?.isVisible()) {
    quickSwitchWindow.show()
    quickSwitchWindow.focus()
    quickSwitchWindow.webContents.focus()
    quickSwitchWindow.webContents.send('quick-switch-previous')
  }
}

function registerQuickSwitchShortcut() {
  if (!globalHotkeysEnabled) return
  if (quickSwitchAccelerator) globalShortcut.register(quickSwitchAccelerator, advanceQuickSwitch)
  if (quickSwitchPreviousAccelerator) globalShortcut.register(quickSwitchPreviousAccelerator, previousQuickSwitch)
}

// ── 제품 정보 창 ────────────────────────────────────────────────────────
function showAboutWindow() {
  const version = app.getVersion()
  const platform = process.platform === 'linux' ? 'Linux' : process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform
  const appSettings = loadSettings()
  const appLanguage = appSettings.language
  const isLight = appSettings.theme === 'light'
  const palette = isLight
    ? {
        body: '#f6f7fb', titlebar: '#ffffff', titlebarBorder: 'rgba(99,102,241,0.26)',
        title: '#4338ca', close: '#475569', appName: '#172033', versionText: '#4338ca',
        versionBg: '#e0e7ff', versionBorder: '#a5b4fc', divider: 'rgba(99,102,241,0.24)',
        label: '#475569', value: '#1e293b', link: '#4338ca', linkHover: '#5b21b6'
      }
    : {
        body: '#080b1a', titlebar: '#0b0f2e', titlebarBorder: 'rgba(99,102,241,0.2)',
        title: '#a5b4fc', close: '#475569', appName: '#fff', versionText: '#6366f1',
        versionBg: 'rgba(99,102,241,0.12)', versionBorder: 'rgba(99,102,241,0.25)', divider: 'rgba(99,102,241,0.12)',
        label: '#64748b', value: '#cbd5e1', link: '#a5b4fc', linkHover: '#c4b5fd'
      }
  const text = appLanguage === 'ko'
    ? { about: '앱 정보', platform: '플랫폼', version: '버전', developer: '개발자', website: '웹사이트' }
    : appLanguage === 'ja'
      ? { about: 'アプリ情報', platform: 'プラットフォーム', version: 'バージョン', developer: '開発者', website: 'ウェブサイト' }
      : appLanguage === 'zh'
        ? { about: '应用信息', platform: '平台', version: '版本', developer: '开发者', website: '网站' }
        : { about: 'About', platform: 'Platform', version: 'Version', developer: 'Developer', website: 'Website' }
  const iconPath = isDev
    ? path.join(__dirname, '../public/icon.png')
    : path.join(process.resourcesPath, 'resources/icon.png')
  const iconBase64 = fs.existsSync(iconPath)
    ? `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`
    : ''
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      background:${palette.body}; color:${palette.value}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      display:flex; flex-direction:column; height:100vh; overflow:hidden; user-select:none;
    }
    .titlebar {
      height:36px; display:flex; align-items:center; justify-content:space-between;
      padding:0 12px; background:${palette.titlebar}; border-bottom:1px solid ${palette.titlebarBorder};
      -webkit-app-region:drag; shrink:0;
    }
    .titlebar-left { display:flex; align-items:center; }
    .titlebar-title { font-size:12px; color:${palette.title}; font-weight:500; }
    .titlebar-close {
      -webkit-app-region:no-drag; width:24px; height:24px; border-radius:6px; border:none;
      background:transparent; color:${palette.close}; cursor:pointer; display:flex; align-items:center; justify-content:center;
      font-size:16px; transition:all 0.15s;
    }
    .titlebar-close:hover { background:rgba(239,68,68,0.15); color:#f87171; }
    .content {
      flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:20px; padding:32px;
    }
    .logo { width:72px; height:72px; }
    .app-name { font-size:22px; font-weight:700; color:${palette.appName}; letter-spacing:-0.3px; }
    .version { font-size:12px; color:${palette.versionText}; background:${palette.versionBg}; border:1px solid ${palette.versionBorder}; padding:3px 10px; border-radius:20px; }
    .divider { width:100%; border:none; border-top:1px solid ${palette.divider}; }
    .meta { display:flex; flex-direction:column; gap:6px; width:100%; }
    .meta-row { display:flex; justify-content:space-between; font-size:12px; }
    .meta-label { color:${palette.label}; }
    .meta-value { color:${palette.value}; }
    .meta-link { color:${palette.link}; text-decoration:none; }
    .meta-link:hover { color:${palette.linkHover}; text-decoration:underline; }
  </style></head><body>
    <div class="titlebar">
      <div class="titlebar-left">
        <span class="titlebar-title">${text.about}</span>
      </div>
      <button class="titlebar-close" onclick="window.close()">✕</button>
    </div>
    <div class="content">
      <div class="logo">
        ${iconBase64 ? `<img src="${iconBase64}" style="width:72px;height:72px;object-fit:contain;" />` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
        <span class="app-name">PeepNote</span>
        <span class="version">v${version}</span>
      </div>
      <hr class="divider"/>
      <div class="meta">
        <div class="meta-row"><span class="meta-label">${text.platform}</span><span class="meta-value">${platform} (Electron)</span></div>
        <div class="meta-row"><span class="meta-label">${text.version}</span><span class="meta-value">${version}</span></div>
        <div class="meta-row"><span class="meta-label">${text.developer}</span><span class="meta-value">${APP_DEVELOPER}</span></div>
        <div class="meta-row"><span class="meta-label">GitHub</span><a class="meta-link" href="${APP_GITHUB_URL}" target="_blank" rel="noopener noreferrer">${APP_GITHUB_URL.replace('https://', '')}</a></div>
        <div class="meta-row"><span class="meta-label">${text.website}</span><a class="meta-link" href="${APP_WEBSITE_URL}" target="_blank" rel="noopener noreferrer">${APP_WEBSITE_URL.replace('https://', '').replace(/\/$/, '')}</a></div>
      </div>
    </div>
  </body></html>`

  const win = new BrowserWindow({
    width: 340,
    height: 450,
    resizable: false,
    frame: false,
    backgroundColor: palette.body,
    autoHideMenuBar: true,
    title: text.about,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

// ── 트레이 ─────────────────────────────────────────────────────────────
function createTray() {
  const resourcesDir = isDev ? path.join(__dirname, '../resources') : path.join(process.resourcesPath, 'resources')
  const iconPath = path.join(resourcesDir, 'icon.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()

  tray = new Tray(icon)
  tray.setToolTip('PeepNote')

  const language = loadSettings().language
  const text = language === 'ko'
    ? { open: 'PeepNote 열기', quick: '빠른 기록', screenshot: '캡쳐', video: '동영상 녹화', about: '앱 정보', quit: '종료' }
    : language === 'ja'
      ? { open: 'PeepNoteを開く', quick: 'クイック記録', screenshot: 'キャプチャ', video: '画面録画を開始', about: 'アプリ情報', quit: '終了' }
      : language === 'zh'
        ? { open: '打开 PeepNote', quick: '快速记录', screenshot: '截图', video: '开始屏幕录制', about: '应用信息', quit: '退出' }
        : { open: 'Show PeepNote', quick: 'Quick record', screenshot: 'Capture', video: 'Start screen recording', about: 'About', quit: 'Quit' }
  const menu = Menu.buildFromTemplate([
    { label: text.open, click: () => showMainWindow() },
    { type: 'separator' },
    { label: text.quick, click: () => toggleOverlay() },
    { label: text.screenshot, click: () => captureScreenshot() },
    { label: text.video, click: () => startRecordingFromTray() },
    { type: 'separator' },
    { label: text.about, click: () => showAboutWindow() },
    { label: text.quit, click: () => { app.exit(0) } }
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => showMainWindow())
}

function startRecordingFromTray() {

  overlayWindow?.show()
  overlayWindow?.focus()
  overlayWindow?.webContents.send('start-recording')
}

// ── 오버레이 토글 ──────────────────────────────────────────────────────
function toggleOverlay() {
  if (!overlayWindow) return
  if (overlayWindow.isVisible()) {
    overlayWindow.hide()
  } else {
    overlayWindow.show()
    overlayWindow.focus()
  }
}

// ── 스크린샷 ───────────────────────────────────────────────────────────
function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!))
}

async function chooseCaptureDisplay(forceChoose = false): Promise<{ display: Electron.Display; index: number } | null> {
  const displays = screen.getAllDisplays()
  if (displays.length === 1) return { display: displays[0], index: 0 }

  const settings = loadSettings()
  if (!forceChoose && typeof settings.captureDisplayId === 'number') {
    const index = displays.findIndex(display => display.id === settings.captureDisplayId)
    if (index >= 0) return { display: displays[index], index }
  }

  const language = settings.language
  const copy = language === 'ko'
    ? { title: '캡쳐할 화면 선택', message: '영역을 캡쳐할 화면을 선택하세요.', cancel: '취소', monitor: '화면' }
    : language === 'ja'
      ? { title: 'キャプチャする画面を選択', message: '範囲をキャプチャするモニターを選択してください。', cancel: 'キャンセル', monitor: 'モニター' }
      : language === 'zh'
        ? { title: '选择要捕获的屏幕', message: '请选择要进行区域捕获的显示器。', cancel: '取消', monitor: '显示器' }
        : { title: 'Choose screen to capture', message: 'Choose the monitor for the area capture.', cancel: 'Cancel', monitor: 'Monitor' }
  const isLight = loadSettings().theme !== 'dark'
  const pickerTheme = isLight
    ? { bg: '#f6f7fb', text: '#1e293b', muted: '#64748b', card: '#ffffff', border: 'rgba(79,70,229,.28)', hoverBorder: 'rgba(99,102,241,.72)', shadow: 'rgba(79,70,229,.14)', preview: '#eef2ff', cancelHover: '#eef2ff' }
    : { bg: '#0d1130', text: '#e2e8f0', muted: '#94a3b8', card: '#181b35', border: 'rgba(129,140,248,.22)', hoverBorder: 'rgba(139,92,246,.8)', shadow: 'rgba(0,0,0,.26)', preview: '#050713', cancelHover: 'rgba(148,163,184,.1)' }
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 560, height: 315 }
  })
  const cards = displays.map((display, index) => {
    const source = sources.find(item => item.display_id === String(display.id)) ?? sources[index]
    const label = display.label || `${copy.monitor} ${index + 1}`
    return `<button class="screen-card" data-index="${index}">
      <img src="${source?.thumbnail.toDataURL() ?? ''}" alt="${escapeHtml(label)}" />
      <span><strong>${escapeHtml(label)}</strong><small>${display.size.width} × ${display.size.height}</small></span>
    </button>`
  }).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
    *{box-sizing:border-box} html,body{width:100%;height:100%;overflow:hidden} body{margin:0;background:rgba(2,6,23,.58);color:${pickerTheme.text};font-family:Inter,"Noto Sans KR",system-ui,sans-serif;user-select:none;display:flex;align-items:center;justify-content:center}
    .modal{width:min(820px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow:hidden;background:${pickerTheme.bg};border:1px solid ${pickerTheme.border};border-radius:18px;box-shadow:0 26px 80px rgba(0,0,0,.46),0 2px 8px ${pickerTheme.shadow}}
    header{padding:18px 22px 15px;border-bottom:1px solid ${pickerTheme.border}}.title{font-size:15px;font-weight:700;letter-spacing:-.2px}.message{margin:5px 0 0;color:${pickerTheme.muted};font-size:12px}
    .content{padding:17px 22px}.screens{display:grid;grid-template-columns:repeat(${Math.min(displays.length, 2)},minmax(0,1fr));gap:12px;max-height:360px;overflow:auto;padding:1px}
    .screen-card{appearance:none;display:flex;flex-direction:column;overflow:hidden;padding:0;text-align:left;background:${pickerTheme.card};border:1px solid ${pickerTheme.border};border-radius:12px;cursor:pointer;transition:transform .16s,border-color .16s,box-shadow .16s;color:inherit}
    .screen-card:hover{transform:translateY(-2px);border-color:${pickerTheme.hoverBorder};box-shadow:0 10px 22px ${pickerTheme.shadow}} .screen-card img{width:100%;aspect-ratio:16/9;object-fit:cover;background:${pickerTheme.preview}}.screen-card span{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 11px}.screen-card strong{font-size:12px;font-weight:600}.screen-card small{font-size:10px;color:${pickerTheme.muted};white-space:nowrap}
    footer{display:flex;justify-content:flex-end;padding:13px 22px 15px;border-top:1px solid ${pickerTheme.border};background:${pickerTheme.card}}.cancel{border:1px solid ${pickerTheme.border};border-radius:8px;padding:7px 14px;color:${pickerTheme.text};background:transparent;font-size:12px;cursor:pointer}.cancel:hover{background:${pickerTheme.cancelHover}}
  </style></head><body><main class="modal"><header><div class="title">${escapeHtml(copy.title)}</div><div class="message">${escapeHtml(copy.message)}</div></header><section class="content"><div class="screens">${cards}</div></section><footer><button class="cancel">${escapeHtml(copy.cancel)}</button></footer></main><script>
    document.querySelectorAll('.screen-card').forEach(button => button.addEventListener('click', () => window.electronAPI.capturePickerSelect(Number(button.dataset.index))))
    document.querySelector('.cancel').addEventListener('click', () => window.electronAPI.capturePickerCancel())
    document.addEventListener('keydown', event => { if (event.key === 'Escape') window.electronAPI.capturePickerCancel() })
  </script></body></html>`

  return new Promise(resolve => {
    let settled = false
    const finish = (index: number | null) => {
      if (settled) return
      settled = true
      ipcMain.removeListener('capture-picker-select', onSelect)
      ipcMain.removeListener('capture-picker-cancel', onCancel)
      if (capturePickerWindow && !capturePickerWindow.isDestroyed()) capturePickerWindow.close()
      capturePickerWindow = null
      if (index !== null) saveSettings({ ...loadSettings(), captureDisplayId: displays[index].id })
      resolve(index === null ? null : { display: displays[index], index })
    }
    const onSelect = (_event: Electron.IpcMainEvent, index: number) => finish(Number.isInteger(index) && index >= 0 && index < displays.length ? index : null)
    const onCancel = () => finish(null)
    ipcMain.once('capture-picker-select', onSelect)
    ipcMain.once('capture-picker-cancel', onCancel)

    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    capturePickerWindow = new BrowserWindow({
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height,
      resizable: false,
      maximizable: false,
      minimizable: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
    })
    capturePickerWindow.on('closed', () => finish(null))
    capturePickerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })
}

async function captureScreenshot(forceChoose = false): Promise<string | null> {
  try {
    const selection = await chooseCaptureDisplay(forceChoose)
    if (!selection) return null
    const { display, index } = selection
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: display.size
    })
    const source = sources.find(item => item.display_id === String(display.id)) ?? sources[index] ?? sources[0]
    if (!source) return null

    const timestamp = Date.now()
    const filename = `screenshot_${timestamp}.png`
    const filepath = path.join(screenshotsDir, filename)

    const png = source.thumbnail.toPNG()
    fs.writeFileSync(filepath, png)
    return filepath
  } catch (err) {
    console.error('Screenshot error:', err)
    return null
  }
}

// ── 스니핑 도구 ────────────────────────────────────────────────────
function attachSnippingMonitorSwitch(
  regionWindow: BrowserWindow,
  mode: 'screenshot' | 'recording-region',
  onSourceChanged: (sourceId: string) => void = () => {}
) {
  let active = true
  let changing = false
  const onChange = async (event: Electron.IpcMainEvent) => {
    if (!active || changing || event.sender !== regionWindow.webContents) return
    changing = true
    regionWindow.hide()
    try {
      const selection = await chooseCaptureDisplay(true)
      if (!active || regionWindow.isDestroyed() || !selection) return
      // Let the picker disappear before capturing the newly selected monitor.
      await new Promise(resolve => setTimeout(resolve, 150))
      if (!active || regionWindow.isDestroyed()) return
      const { display, index } = selection
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display.size })
      if (!active || regionWindow.isDestroyed()) return
      const source = sources.find(item => item.display_id === String(display.id)) ?? sources[index]
      if (!source) return
      regionWindow.setBounds(display.bounds)
      onSourceChanged(source.id)
      regionWindow.webContents.send('snipping-init', {
        dataUrl: source.thumbnail.toDataURL(), mode,
        language: loadSettings().language,
        width: display.bounds.width, height: display.bounds.height
      })
    } catch (error) {
      console.error('Snipping monitor change error:', error)
    } finally {
      changing = false
      if (active && !regionWindow.isDestroyed()) {
        regionWindow.show()
        regionWindow.focus()
      }
    }
  }
  ipcMain.on('snipping-change-monitor', onChange)
  return () => {
    active = false
    ipcMain.removeListener('snipping-change-monitor', onChange)
  }
}

async function startSnipping(forceChoose = false): Promise<string | null> {
  if (snippingWindow || snippingPreparing) return null
  snippingPreparing = true

  let selection: { display: Electron.Display; index: number } | null
  try {
    selection = await chooseCaptureDisplay(forceChoose)
  } catch (err) {
    snippingPreparing = false
    console.error('Capture display selection error:', err)
    return null
  }
  if (!selection) {
    snippingPreparing = false
    return null
  }
  const { display, index } = selection
  const { x, y, width, height } = display.bounds

  // 오버레이 잠깐 숨기고 깨끗한 스크린샷 캡처
  const overlayWasVisible = overlayWindow?.isVisible() ?? false
  if (overlayWasVisible) overlayWindow?.hide()
  await new Promise(r => setTimeout(r, 150))

  let sources: Electron.DesktopCapturerSource[]
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: display.size
    })
  } catch (err) {
    snippingPreparing = false
    if (overlayWasVisible) overlayWindow?.show()
    console.error('Desktop capture source error:', err)
    return null
  }
  const source = sources.find(item => item.display_id === String(display.id)) ?? sources[index] ?? sources[0]
  if (!source) {
    snippingPreparing = false
    if (overlayWasVisible) overlayWindow?.show()
    return null
  }
  const dataUrl = source.thumbnail.toDataURL()

  snippingWindow = new BrowserWindow({
    x, y, width, height,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  snippingPreparing = false

  if (isDev) {
    snippingWindow.loadURL('http://localhost:5173/snipping.html')
  } else {
    snippingWindow.loadURL('app://dist/snipping.html')
  }

  snippingWindow.webContents.once('did-finish-load', () => {
    snippingWindow?.webContents.send('snipping-init', { dataUrl, width, height, language: loadSettings().language })
  })

  return new Promise((resolve) => {
    const regionWindow = snippingWindow!
    const removeMonitorSwitch = attachSnippingMonitorSwitch(regionWindow, 'screenshot')
    let settled = false
    const finish = (filepath: string | null) => {
      if (settled) return
      settled = true
      removeMonitorSwitch()
      ipcMain.removeListener('snipping-done', onDone)
      ipcMain.removeListener('snipping-cancel', onCancel)
      regionWindow.removeListener('closed', onCancel)
      if (!regionWindow.isDestroyed()) regionWindow.close()
      snippingWindow = null
      if (overlayWasVisible) overlayWindow?.show()
      resolve(filepath)
    }
    const onDone = (_e: Electron.IpcMainEvent, croppedDataUrl: string) => {
      if (_e.sender !== regionWindow.webContents || !regionWindow.isVisible()) return
      const base64 = croppedDataUrl.replace(/^data:image\/png;base64,/, '')
      const filename = `screenshot_${Date.now()}.png`
      const filepath = path.join(screenshotsDir, filename)
      fs.writeFileSync(filepath, Buffer.from(base64, 'base64'))
      finish(filepath)
    }

    const onCancel = () => finish(null)

    ipcMain.on('snipping-done', onDone)
    ipcMain.once('snipping-cancel', onCancel)
    regionWindow.once('closed', onCancel)
  })
}

type RecordingRegion = {
  sourceId: string
  x: number
  y: number
  width: number
  height: number
  canvasWidth: number
  canvasHeight: number
}

async function selectRecordingRegion(forceChoose = false): Promise<RecordingRegion | null> {
  if (snippingWindow || snippingPreparing) return null
  snippingPreparing = true

  let selection: { display: Electron.Display; index: number } | null
  try {
    selection = await chooseCaptureDisplay(forceChoose)
  } catch (err) {
    snippingPreparing = false
    console.error('Recording display selection error:', err)
    return null
  }
  if (!selection) {
    snippingPreparing = false
    return null
  }
  const { display, index } = selection
  const { x, y, width, height } = display.bounds
  const overlayWasVisible = overlayWindow?.isVisible() ?? false
  if (overlayWasVisible) overlayWindow?.hide()
  await new Promise(resolve => setTimeout(resolve, 150))

  let sources: Electron.DesktopCapturerSource[]
  try {
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display.size })
  } catch (err) {
    snippingPreparing = false
    if (overlayWasVisible) overlayWindow?.show()
    console.error('Recording capture source error:', err)
    return null
  }
  const source = sources.find(item => item.display_id === String(display.id)) ?? sources[index] ?? sources[0]
  if (!source) {
    snippingPreparing = false
    if (overlayWasVisible) overlayWindow?.show()
    return null
  }

  snippingWindow = new BrowserWindow({
    x, y, width, height,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  snippingPreparing = false
  if (isDev) snippingWindow.loadURL('http://localhost:5173/snipping.html')
  else snippingWindow.loadURL('app://dist/snipping.html')
  snippingWindow.webContents.once('did-finish-load', () => {
    snippingWindow?.webContents.send('snipping-init', { dataUrl: source.thumbnail.toDataURL(), mode: 'recording-region', width, height, language: loadSettings().language })
    snippingWindow?.show()
    snippingWindow?.focus()
  })

  return new Promise(resolve => {
    const regionWindow = snippingWindow!
    let sourceId = source.id
    let settled = false
    const removeMonitorSwitch = attachSnippingMonitorSwitch(regionWindow, 'recording-region', id => { sourceId = id })
    const finish = (region: Omit<RecordingRegion, 'sourceId'> | null) => {
      if (settled) return
      settled = true
      removeMonitorSwitch()
      ipcMain.removeListener('recording-region-done', onDone)
      ipcMain.removeListener('snipping-cancel', onCancel)
      regionWindow?.webContents.removeListener('before-input-event', onBeforeInput)
      regionWindow.removeListener('closed', onCancel)
      if (!regionWindow.isDestroyed()) regionWindow.close()
      snippingWindow = null
      if (overlayWasVisible) overlayWindow?.show()
      resolve(region ? { sourceId, ...region } : null)
    }
    const onDone = (_event: Electron.IpcMainEvent, region: Omit<RecordingRegion, 'sourceId'>) => {
      if (_event.sender !== regionWindow.webContents || !regionWindow.isVisible()) return
      const valid = region && [region.x, region.y, region.width, region.height, region.canvasWidth, region.canvasHeight]
        .every(value => Number.isFinite(value)) && region.width >= 5 && region.height >= 5
      finish(valid ? region : null)
    }
    const onCancel = () => finish(null)
    const onBeforeInput = (event: Electron.Event, input: Electron.Input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    ipcMain.on('recording-region-done', onDone)
    ipcMain.once('snipping-cancel', onCancel)
    regionWindow?.webContents.on('before-input-event', onBeforeInput)
    regionWindow.once('closed', onCancel)
  })
}

// ── 글로벌 단축키 등록 ────────────────────────────────────────────────
function registerHotkeys() {
  if (!globalHotkeysEnabled) return
  globalShortcut.unregisterAll()
  const settings = loadSettings()
  const hk = getActiveHotkeys(settings.hotkeys)
  quickSwitchAccelerator = hk.quickSwitch
  quickSwitchPreviousAccelerator = hk.quickSwitchPrevious

  try {
    if (hk.openMain) {
      globalShortcut.register(hk.openMain, () => {

        if (mainWindow?.isVisible() && mainWindow?.isFocused()) {
          mainWindow.hide()
        } else {
          showMainWindow()
          mainWindow?.webContents.send('hotkey-triggered', 'openMain')
        }
      })
    }

    if (hk.openFavorites) {
      globalShortcut.register(hk.openFavorites, () => {
        handleFavoritesShortcut(mainWindow, showMainWindow)
      })
    }

    if (hk.openOverlay) {
      globalShortcut.register(hk.openOverlay, () => {

        toggleOverlay()
      })
    }
    if (hk.takeScreenshot) {
      globalShortcut.register(hk.takeScreenshot, async () => {

        const filepath = await startSnipping()
        if (filepath) {
          overlayWindow?.show()
          overlayWindow?.focus()
          overlayWindow?.webContents.send('screenshot-captured', filepath)
        }
      })
    }
    if (hk.startRecording) {
      globalShortcut.register(hk.startRecording, async () => {

        // Do not show and immediately hide the overlay before taking the
        // desktop thumbnail: on some Linux multi-monitor setups that leaves
        // part of the source black. Pick the region first, then open it.
        const region = await selectRecordingRegion()
        if (!region) return
        overlayWindow?.show()
        overlayWindow?.focus()
        overlayWindow?.webContents.send('start-recording-region', region)
      })
    }
    if (hk.stopRecording) {
      globalShortcut.register(hk.stopRecording, () => {

        overlayWindow?.webContents.send('stop-recording')
      })
    }
    // 퀵 리스트가 열려 있을 때 Alt+Q/E로 다음/이전 기록을 탐색한다.
    registerQuickSwitchShortcut()
  } catch (err) {
    console.error('Hotkey registration error:', err)
  }
}

// ── IPC 핸들러 ─────────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('open-html-preview', async (event, source: unknown, title: unknown) => {
    if (event.sender !== mainWindow?.webContents || typeof source !== 'string' || source.length > 5_000_000) return false
    const windowTitle = typeof title === 'string' ? title.slice(0, 200) : 'HTML Preview'
    try {
      await openHtmlPreview(source, windowTitle)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('open-image-viewer', (_e, filepath: string, requestedTheme?: string) => {
    const source = isLinkedAttachment(filepath) ? readableAttachmentFile(filepath) : filepath
    if (!source) return null
    const data = fs.readFileSync(source).toString('base64')
    const filename = path.basename(filepath)
    const settings = loadSettings()
    const theme = requestedTheme === 'light' || requestedTheme === 'dark'
      ? requestedTheme : settings.theme === 'dark' ? 'dark' : 'light'
    const labels = settings.language === 'ko'
      ? { title: '이미지 보기', minimize: '최소화', maximize: '최대화', restore: '이전 크기로', close: '닫기' }
      : settings.language === 'ja'
        ? { title: '画像ビューア', minimize: '最小化', maximize: '最大化', restore: '元に戻す', close: '閉じる' }
        : settings.language === 'zh'
          ? { title: '查看图片', minimize: '最小化', maximize: '最大化', restore: '还原', close: '关闭' }
          : { title: 'Image viewer', minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close' }
    const appIconPath = isDev
      ? path.join(__dirname, '../public/icon.png')
      : path.join(process.resourcesPath, 'resources/icon.png')
    const appIconBase64 = fs.existsSync(appIconPath)
      ? `data:image/png;base64,${fs.readFileSync(appIconPath).toString('base64')}`
      : ''
    const html = `<!DOCTYPE html><html data-theme="${theme}"><head><meta charset="utf-8"><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      :root { color-scheme:light; --bg:#f6f7fb; --bar:#ffffff; --text:#334155; --border:rgba(99,102,241,.2); --hover:#e0e7ff; }
      :root[data-theme="dark"] { color-scheme:dark; --bg:#080b1a; --bar:#0b0f2e; --text:#cbd5e1; --border:rgba(99,102,241,.3); --hover:#24294d; }
      body { background:var(--bg); display:flex; flex-direction:column; height:100vh; font-family:sans-serif; }
      .titlebar {
        height:36px; min-height:36px; display:flex; align-items:center; justify-content:space-between;
        padding:0 6px 0 12px; background:var(--bar);
        border-bottom:1px solid var(--border);
        -webkit-app-region:drag; user-select:none;
      }
      .titlebar-left { display:flex; align-items:center; gap:8px; min-width:0; }
      .titlebar-icon { width:14px; height:14px; object-fit:contain; }
      .titlebar-title { font-size:12px; color:var(--text); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .titlebar-controls { display:flex; gap:4px; margin-left:12px; flex-shrink:0; -webkit-app-region:no-drag; }
      .titlebar-button {
        -webkit-app-region:no-drag; width:30px; height:26px; border-radius:6px; border:none;
        background:transparent; color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center;
        font-size:16px; transition:all 0.15s;
      }
      .titlebar-button:hover { background:var(--hover); }
      .titlebar-button:focus-visible { outline:2px solid #818cf8; outline-offset:1px; }
      .titlebar-close:hover { background:rgba(239,68,68,0.15); color:#f87171; }
      .img-wrap { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; overflow:auto; padding:16px; }
      img { max-width:100%; max-height:100%; object-fit:contain; border-radius:4px; }
    </style></head><body>
      <div class="titlebar">
        <div class="titlebar-left">
          ${appIconBase64 ? `<img class="titlebar-icon" src="${appIconBase64}" />` : ''}
          <span class="titlebar-title">${escapeHtml(filename)}</span>
        </div>
        <div class="titlebar-controls">
          <button class="titlebar-button" id="minimize" title="${labels.minimize}" aria-label="${labels.minimize}">−</button>
          <button class="titlebar-button" id="maximize" title="${labels.maximize}" aria-label="${labels.maximize}">□</button>
          <button class="titlebar-button titlebar-close" id="close" title="${labels.close}" aria-label="${labels.close}">✕</button>
        </div>
      </div>
      <div class="img-wrap"><img src="data:image/png;base64,${data}"/></div>
      <script>
        const api = window.electronAPI
        const maximize = document.getElementById('maximize')
        document.getElementById('minimize').onclick = () => api.imageViewerControl('minimize')
        maximize.onclick = () => api.imageViewerControl('maximize')
        document.getElementById('close').onclick = () => api.imageViewerControl('close')
        api.on('image-viewer-maximized', value => {
          maximize.textContent = value ? '❐' : '□'
          maximize.title = value ? '${labels.restore}' : '${labels.maximize}'
          maximize.setAttribute('aria-label', maximize.title)
        })
        api.on('theme-changed', theme => {
          if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
        })
      </script>
    </body></html>`
    const win = new BrowserWindow({
      width: 1200, height: 820,
      backgroundColor: theme === 'dark' ? '#080b1a' : '#f6f7fb',
      frame: false,
      autoHideMenuBar: true,
      title: labels.title,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    imageViewerWindows.add(win)
    win.on('closed', () => imageViewerWindows.delete(win))
    win.on('maximize', () => win.webContents.send('image-viewer-maximized', true))
    win.on('unmaximize', () => win.webContents.send('image-viewer-maximized', false))
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })

  ipcMain.handle('image-viewer-control', (event, action: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !imageViewerWindows.has(win)) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else if (action === 'close') win.close()
  })

  ipcMain.handle('take-screenshot', async () => {
    return await captureScreenshot()
  })

  ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    })
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }))
  })

  ipcMain.handle('get-settings', () => loadSettings())

  ipcMain.handle('save-settings', (_e, settings) => {
    saveSettings(settings)
    registerHotkeys()
    tray?.destroy()
    tray = null
    createTray()
    const language = (settings as { language?: unknown }).language
    if (language === 'en' || language === 'ko' || language === 'ja' || language === 'zh') {
      mainWindow?.webContents.send('language-changed', language)
      overlayWindow?.webContents.send('language-changed', language)
      quickSwitchWindow?.webContents.send('language-changed', language)
      snippingWindow?.webContents.send('language-changed', language)
    }
    const theme = (settings as { theme?: unknown }).theme
    if (theme === 'dark' || theme === 'light') {
      mainWindow?.webContents.send('theme-changed', theme)
      overlayWindow?.webContents.send('theme-changed', theme)
      quickSwitchWindow?.webContents.send('theme-changed', theme)
      for (const win of imageViewerWindows) {
        win.setBackgroundColor(theme === 'dark' ? '#080b1a' : '#f6f7fb')
        win.webContents.send('theme-changed', theme)
      }
    }
    return { ok: true }
  })

  ipcMain.handle('set-hotkeys-enabled', (_e, enabled: unknown) => {
    globalHotkeysEnabled = enabled !== false
    if (globalHotkeysEnabled) registerHotkeys()
    else globalShortcut.unregisterAll()
    return { ok: true }
  })

  ipcMain.handle('get-user-data-path', () => dataDirectory)
  ipcMain.handle('get-data-usage', () => directoryUsage(dataDirectory))

  ipcMain.handle('set-recording-active', (event, active: boolean) => {
    if (active) {
      recordingWindows.add(event.sender.id)
      if (!observedRecordingWindows.has(event.sender)) {
        observedRecordingWindows.add(event.sender)
        event.sender.once('destroyed', () => recordingWindows.delete(event.sender.id))
      }
    } else recordingWindows.delete(event.sender.id)
  })

  ipcMain.handle('choose-data-location', async event => {
    if (event.sender !== mainWindow?.webContents || changingDataLocation || !mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: dataStorageCopy(loadSettings().language).changeDataLocation,
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: path.dirname(dataDirectory)
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('change-data-location', (event, target: unknown): DataLocationResult => {
    if (event.sender !== mainWindow?.webContents || typeof target !== 'string') return { status: 'error', error: 'unavailable' }
    if (changingDataLocation || recordingWindows.size || snippingPreparing || snippingWindow || capturePickerWindow
      || updateController.snapshot().status === 'installing') return { status: 'error', error: 'busy' }
    try {
      scheduleDataLocation(profilePath, dataDirectory, target)
      changingDataLocation = true
      // Normal window close handlers hide to tray. A storage change must exit
      // the process so the next launch can copy data before opening the DB.
      setImmediate(() => {
        for (const win of BrowserWindow.getAllWindows()) win.removeAllListeners('close')
        restartAfterDataLocationChange(app, isDev && process.env.PEEPNOTE_MANAGED_DEV_RESTART === '1')
      })
      return { status: 'restarting' }
    } catch (error) {
      return { status: 'error', error: error instanceof DataStorageError ? error.code : 'failed' }
    }
  })

  ipcMain.handle('get-screenshots-dir', () => screenshotsDir)

  ipcMain.handle('get-videos-dir', () => videosDir)

  ipcMain.handle('save-video', (_e, buffer: Buffer, filename: string) => {
    const filepath = path.join(videosDir, filename)
    fs.writeFileSync(filepath, Buffer.from(buffer))
    return filepath
  })

  ipcMain.handle('delete-video', (_e, filepath: unknown) => {
    if (typeof filepath !== 'string') return false
    const resolvedPath = path.resolve(filepath)
    const resolvedVideosDir = `${path.resolve(videosDir)}${path.sep}`
    if (!resolvedPath.startsWith(resolvedVideosDir)) return false
    try {
      fs.unlinkSync(resolvedPath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('read-file-as-base64', (_e, filepath: string) => {
    try {
      const source = isLinkedAttachment(filepath) ? readableAttachmentFile(filepath) : filepath
      if (!source) return null
      const data = fs.readFileSync(source)
      return data.toString('base64')
    } catch {
      return null
    }
  })

  ipcMain.handle('import-attachments', async (_e, entries: unknown, mode: unknown = 'copy') => {
    const imported = await importLocalAttachments(entries, mode, attachmentsDir)
    for (const file of imported) if (isLinkedAttachment(file.path)) selectedAttachmentLinks.add(file.path)
    return imported
  })

  ipcMain.handle('delete-attachment-file', async (_e, filepath: unknown) => {
    if (typeof filepath !== 'string') return false
    const resolved = managedLocalFile(filepath)
    if (!resolved) return false
    cleanupUnreferencedMedia([resolved])
    return !fs.existsSync(resolved)
  })

  ipcMain.handle('get-attachment-size', (_e, reference: unknown) => attachmentFileSize(reference, readableAttachmentFile))

  ipcMain.handle('open-attachment', async (_e, filepath: unknown) => {
    if (typeof filepath !== 'string') return false
    const resolved = readableAttachmentFile(filepath)
    if (!resolved) return false
    return (await shell.openPath(resolved)) === ''
  })

  ipcMain.handle('show-attachment-in-folder', (_e, filepath: unknown) => {
    if (typeof filepath !== 'string') return false
    const resolved = readableAttachmentFile(filepath)
    if (!resolved) return false
    try { shell.showItemInFolder(resolved); return true }
    catch { return false }
  })

  ipcMain.handle('download-attachment', async (_e, filepath: unknown) => {
    if (typeof filepath !== 'string') return false
    const resolved = readableAttachmentFile(filepath)
    if (!resolved) return false
    const options = { defaultPath: path.join(app.getPath('downloads'), path.basename(resolved)) }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath || path.resolve(result.filePath) === path.resolve(resolved)) return false
    try {
      await fs.promises.copyFile(resolved, result.filePath)
      return true
    } catch { return false }
  })

  ipcMain.handle('start-snipping', async (_event, forceChoose = false) => await startSnipping(forceChoose === true))
  ipcMain.handle('select-recording-region', async (_event, forceChoose = false) => await selectRecordingRegion(forceChoose === true))

  ipcMain.on('notify-log-created', (_event, id?: string) => {
    mainWindow?.webContents.send('log-created', id)
  })

  ipcMain.handle('open-overlay', () => toggleOverlay())

  ipcMain.handle('close-overlay', () => overlayWindow?.hide())

  ipcMain.handle('select-quick-log', (_e, id: string) => {
    quickSwitchWindow?.hide()
    showMainWindow()
    mainWindow?.webContents.send('open-log', { id, fromQuickSwitch: true })
  })
  ipcMain.handle('close-quick-switch', () => quickSwitchWindow?.hide())

  ipcMain.handle('overlay-maximize', () => {
    if (!overlayWindow) return
    if (overlayWindow.isMaximized()) overlayWindow.unmaximize()
    else overlayWindow.maximize()
  })

  ipcMain.handle('overlay-is-maximized', () => overlayWindow?.isMaximized() ?? false)

  ipcMain.handle('show-main', showMainWindow)

  ipcMain.handle('window-minimize', () => mainWindow?.minimize())
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window-close', () => mainWindow?.hide())
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle('open-external', (_e, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('get-app-port', () => APP_PORT)

  ipcMain.handle('get-app-version', () => app.getVersion())


  ipcMain.handle('get-update-info', () => updateController.snapshot())
  ipcMain.handle('check-for-updates', () => updateController.check())

  // DevTools 단축키 (Ctrl+Shift+I)
  mainWindow?.webContents.on('before-input-event', (_e, input) => {
    if (input.control && input.shift && input.key === 'I') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  ipcMain.handle('download-update', () => updateController.download())
  ipcMain.handle('install-update', () => updateController.install())

}

// ── 자동 업데이트 ──────────────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  const packageTypePath = path.join(process.resourcesPath, 'package-type')
  const isDeb = process.platform === 'linux' && fs.existsSync(packageTypePath)
    && fs.readFileSync(packageTypePath, 'utf8').trim() === 'deb'
  const supported = !isDev && app.isPackaged && (process.platform === 'win32' || isDeb)
  let downloadedDeb: string | null = null
  autoUpdater.on('update-downloaded', info => { downloadedDeb = info.downloadedFile })
  const backend = {
    on: (event: UpdateEvent, listener: (...args: any[]) => void) => autoUpdater.on(event, listener),
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall: async () => {
      if (!isDeb) return autoUpdater.quitAndInstall(false, true)
      // electron-updater verifies the downloaded package checksum. Run dpkg
      // without a shell and keep the app open if authentication/install fails.
      await installDebAndRestart(downloadedDeb, app, process.execPath, process.argv.slice(1))
    }
  }
  updateController = new UpdateController(backend, app.getVersion(), process.platform, supported, state => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(UPDATE_STATE_CHANNEL, state)
    }
  })
  app.on('before-quit', () => {
    if (updateController.snapshot().status !== 'installing') return
    for (const win of BrowserWindow.getAllWindows()) win.removeAllListeners('close')
    tray?.destroy()
    tray = null
  })
  if (!supported) return
  // Snapshot IPC also recovers state if the renderer is not ready for an event.
  setTimeout(() => void updateController.check(), 3000).unref()
  setInterval(() => {
    const { status } = updateController.snapshot()
    if (['idle', 'up-to-date', 'error'].includes(status)) void updateController.check()
  }, 6 * 60 * 60 * 1000).unref()
}

// After suspend/resume, some Linux GPU/Wayland compositor combinations can
// retain the last Chromium frame until a repaint is explicitly requested.
function refreshWindowsAfterResume() {
  const windows = [mainWindow, overlayWindow, quickSwitchWindow, snippingWindow]
  for (const win of windows) {
    if (win && !win.isDestroyed()) requestWindowRepaint(win)
  }
}

// ── 앱 초기화 ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // A packaged app and a dev app can have separate Electron instance locks,
  // but they share this local API port. Treat that as an existing PeepNote.
  if (await isLocalServerRunning()) {
    app.quit()
    return
  }

  try {
    const location = await prepareDataLocation(profilePath)
    dataDirectory = location.directory
    screenshotsDir = path.join(dataDirectory, 'screenshots')
    videosDir = path.join(dataDirectory, 'videos')
    attachmentsDir = path.join(dataDirectory, 'attachments')
    settingsPath = path.join(dataDirectory, 'settings.json')
    for (const directory of [screenshotsDir, videosDir, attachmentsDir]) fs.mkdirSync(directory, { recursive: true })
    if (location.error) {
      const copy = dataStorageCopy(loadSettings().language)
      dialog.showErrorBox(copy.dataLocationStartupTitle, `${copy.dataLocationFailed}\n${copy[dataStorageErrorKey(location.error)]}`)
    }
  } catch {
    const copy = dataStorageCopy(loadSettings().language)
    dialog.showErrorBox(copy.dataLocationStartupTitle, copy.dataLocationStartupFailed)
    app.exit(1)
    return
  }

  // 기본 메뉴바(File, Edit...) 제거
  Menu.setApplicationMenu(null)

  // app:// 프로토콜 핸들러 등록
  protocol.handle('app', (request) => {
    const filePath = request.url.replace('app://', '')
    const fullPath = path.join(app.getAppPath(), filePath)
    return net.fetch(`file://${fullPath}`)
  })

  // 로컬 Hono 서버 시작
  await startServer(APP_PORT, dataDirectory)

  createMainWindow()
  createOverlayWindow()
  createTray()
  setupIPC()
  registerHotkeys()
  setupAutoUpdater()

  powerMonitor.on('resume', () => {
    // Give the display server a moment to restore its GPU surfaces first.
    setTimeout(refreshWindowsAfterResume, 300)
  })
})


app.on('window-all-closed', () => {
  // 트레이로 계속 실행 (종료 안 함)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('activate', () => {
  if (!mainWindow) createMainWindow()
  else showMainWindow()
})
