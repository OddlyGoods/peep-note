import { contextBridge, ipcRenderer } from 'electron'
import type { noteNotificationPresentation } from '../shared/noteNotification'

contextBridge.exposeInMainWorld('noteNotification', {
  open: () => ipcRenderer.invoke('note-toast-open'),
  dismiss: () => ipcRenderer.invoke('note-toast-dismiss'),
  setHovered: (hovered: boolean) => ipcRenderer.invoke('note-toast-hover', hovered),
  onShow: (callback: (value: ReturnType<typeof noteNotificationPresentation>) => void) => {
    ipcRenderer.on('note-toast-show', (_event, value) => callback(value))
  },
  onFade: (callback: () => void) => {
    ipcRenderer.on('note-toast-fade', () => callback())
  },
  onRestore: (callback: () => void) => {
    ipcRenderer.on('note-toast-restore', () => callback())
  }
})
