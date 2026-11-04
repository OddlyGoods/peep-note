import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureAnalysisState } from '../shared/captureAnalysis'
const action = (name: string, value?: unknown) => ipcRenderer.invoke('capture-analysis-action', name, value)
contextBridge.exposeInMainWorld('captureAnalysis', {
  state: () => action('state'), capture: (question: string) => action('capture', question),
  ask: (question: string) => action('ask', question), retry: () => action('retry'),
  save: (workspace: string | null) => action('save', workspace), maximize: () => action('maximize'), close: () => action('close'),
  onState: (callback: (state: CaptureAnalysisState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CaptureAnalysisState) => callback(state)
    ipcRenderer.on('capture-analysis-state', listener)
    return () => ipcRenderer.removeListener('capture-analysis-state', listener)
  },
})
// Shared Markdown links use the existing, protocol-validated external opener.
// No file-system, settings, or note-editing methods are exposed to this window.
contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  on: () => {}, off: () => {},
})
