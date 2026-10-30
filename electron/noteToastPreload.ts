import { contextBridge, ipcRenderer } from 'electron'
import type { noteNotificationPresentation } from '../shared/noteNotification'

contextBridge.exposeInMainWorld('noteNotification', {
  open: () => ipcRenderer.invoke('note-toast-open'),
  dismiss: () => ipcRenderer.invoke('note-toast-dismiss'),
  onShow: (callback: (value: ReturnType<typeof noteNotificationPresentation>) => void) => {
    ipcRenderer.on('note-toast-show', (_event, value) => callback(value))
  },
  onFade: (callback: () => void) => {
    ipcRenderer.on('note-toast-fade', () => callback())
  }
})
