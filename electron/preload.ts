import { contextBridge, ipcRenderer, webUtils } from 'electron'

type RendererCallback = (...args: unknown[]) => void
type IpcListener = (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
const eventListeners = new Map<string, Map<RendererCallback, IpcListener>>()

function addEventListener(channel: string, callback: RendererCallback) {
  const channelListeners = eventListeners.get(channel) ?? new Map<RendererCallback, IpcListener>()
  eventListeners.set(channel, channelListeners)
  const previous = channelListeners.get(callback)
  if (previous) ipcRenderer.removeListener(channel, previous)

  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
  channelListeners.set(callback, listener)
  ipcRenderer.on(channel, listener)
}

function removeEventListener(channel: string, callback: RendererCallback) {
  const channelListeners = eventListeners.get(channel)
  const listener = channelListeners?.get(callback)
  if (!listener) return
  ipcRenderer.removeListener(channel, listener)
  channelListeners?.delete(callback)
  if (channelListeners?.size === 0) eventListeners.delete(channel)
}

contextBridge.exposeInMainWorld('electronAPI', {
  // 스크린샷
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  getSources: () => ipcRenderer.invoke('get-sources'),

  // 비디오
  saveVideo: (buffer: ArrayBuffer, filename: string) =>
    ipcRenderer.invoke('save-video', buffer, filename),
  deleteVideo: (filepath: string) => ipcRenderer.invoke('delete-video', filepath),

  // 파일
  readFileAsBase64: (filepath: string) =>
    ipcRenderer.invoke('read-file-as-base64', filepath),
  importAttachments: (files: File[], mode: 'copy' | 'link' = 'copy') => ipcRenderer.invoke('import-attachments', files.map(file => ({
    path: webUtils.getPathForFile(file),
    name: file.name
  })), mode),
  deleteAttachmentFile: (filepath: string) => ipcRenderer.invoke('delete-attachment-file', filepath),
  getAttachmentSize: (filepath: string) => ipcRenderer.invoke('get-attachment-size', filepath),
  openAttachment: (filepath: string) => ipcRenderer.invoke('open-attachment', filepath),
  showAttachmentInFolder: (filepath: string) => ipcRenderer.invoke('show-attachment-in-folder', filepath),
  downloadAttachment: (filepath: string) => ipcRenderer.invoke('download-attachment', filepath),
  getScreenshotsDir: () => ipcRenderer.invoke('get-screenshots-dir'),
  getVideosDir: () => ipcRenderer.invoke('get-videos-dir'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  getDataUsage: () => ipcRenderer.invoke('get-data-usage'),
  chooseDataLocation: () => ipcRenderer.invoke('choose-data-location'),
  changeDataLocation: (directory: string) => ipcRenderer.invoke('change-data-location', directory),
  setRecordingActive: (active: boolean) => ipcRenderer.invoke('set-recording-active', active),

  // 설정
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('save-settings', settings),
  setHotkeysEnabled: (enabled: boolean) => ipcRenderer.invoke('set-hotkeys-enabled', enabled),

  // 윈도우 제어
  openHtmlPreview: (html: string, title: string) => ipcRenderer.invoke('open-html-preview', html, title),
  openOverlay: () => ipcRenderer.invoke('open-overlay'),
  closeOverlay: () => ipcRenderer.invoke('close-overlay'),
  selectQuickLog: (id: string) => ipcRenderer.invoke('select-quick-log', id),
  closeQuickSwitch: () => ipcRenderer.invoke('close-quick-switch'),
  showMain: () => ipcRenderer.invoke('show-main'),

  // 포트
  getAppPort: () => ipcRenderer.invoke('get-app-port'),

  // 윈도우 컨트롤
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // 오버레이 컨트롤
  overlayMaximize: () => ipcRenderer.invoke('overlay-maximize'),
  overlayIsMaximized: () => ipcRenderer.invoke('overlay-is-maximized'),
  notifyLogCreated: (id?: string) => ipcRenderer.send('notify-log-created', id),

  // 스니핑 도구
  startSnipping: (forceChoose = false) => ipcRenderer.invoke('start-snipping', forceChoose),
  selectRecordingRegion: (forceChoose = false) => ipcRenderer.invoke('select-recording-region', forceChoose),
  snippingDone: (dataUrl: string) => ipcRenderer.send('snipping-done', dataUrl),
  snippingCancel: () => ipcRenderer.send('snipping-cancel'),
  changeSnippingMonitor: () => ipcRenderer.send('snipping-change-monitor'),
  recordingRegionDone: (region: { x: number; y: number; width: number; height: number; canvasWidth: number; canvasHeight: number }) => ipcRenderer.send('recording-region-done', region),
  capturePickerSelect: (index: number) => ipcRenderer.send('capture-picker-select', index),
  capturePickerCancel: () => ipcRenderer.send('capture-picker-cancel'),

  // 외부 열기
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openImageViewer: (filepath: string, theme?: 'light' | 'dark') => ipcRenderer.invoke('open-image-viewer', filepath, theme),
  imageViewerControl: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.invoke('image-viewer-control', action),

  // 앱 버전
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // 업데이트
  getUpdateInfo: () => ipcRenderer.invoke('get-update-info'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // 이벤트 리스너
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'hotkey-triggered',
      'screenshot-captured',
      'start-recording',
      'start-recording-region',
      'stop-recording',
      'log-created',
      'snipping-init',
      'update-state-changed',
      'quick-switch-open',
      'quick-switch-next',
      'quick-switch-previous',
      'quick-switch-confirm',
      'open-log',
      'language-changed',
      'theme-changed',
      'image-viewer-maximized'
    ]
    if (validChannels.includes(channel)) {
      addEventListener(channel, callback)
    }
  },
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    removeEventListener(channel, callback)
  }
})
