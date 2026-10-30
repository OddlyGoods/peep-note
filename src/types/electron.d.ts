import type { UpdateState } from '../../shared/updates'
import type { DataLocationResult } from '../../shared/dataStorage'
export {}

declare global {
  interface Window {
    electronAPI?: {
      openHtmlPreview: (html: string, title: string) => Promise<boolean>
      takeScreenshot: () => Promise<string | null>
      getSources: () => Promise<{ id: string; name: string; thumbnail: string }[]>
      saveVideo: (buffer: ArrayBuffer, filename: string) => Promise<string | null>
      deleteVideo: (filepath: string) => Promise<boolean>
      readFileAsBase64: (filepath: string) => Promise<string | null>
      importAttachments: (files: File[], mode?: 'copy' | 'link') => Promise<Array<{ path: string; name: string; size: number; isImage: boolean; mimeType: string | null }>>
      deleteAttachmentFile: (filepath: string) => Promise<boolean>
      getAttachmentSize?: (filepath: string) => Promise<number | null>
      openAttachment: (filepath: string) => Promise<boolean>
      showAttachmentInFolder: (filepath: string) => Promise<boolean>
      downloadAttachment: (filepath: string) => Promise<boolean>
      getScreenshotsDir: () => Promise<string>
      getVideosDir: () => Promise<string>
      getUserDataPath: () => Promise<string>
      getDataUsage: () => Promise<{ bytes: number; partial: boolean }>
      chooseDataLocation: () => Promise<string | null>
      changeDataLocation: (directory: string) => Promise<DataLocationResult>
      setRecordingActive: (active: boolean) => Promise<void>
      getSettings: () => Promise<Record<string, unknown>>
      saveSettings: (settings: unknown) => Promise<{ ok: boolean }>
      setHotkeysEnabled: (enabled: boolean) => Promise<{ ok: boolean }>
      openOverlay: () => Promise<void>
      closeOverlay: () => Promise<void>
      selectQuickLog: (id: string) => Promise<void>
      closeQuickSwitch: () => Promise<void>
      showMain: () => Promise<void>
      getAppPort: () => Promise<number>
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      quitApp: () => Promise<boolean>
      windowIsMaximized: () => Promise<boolean>
      overlayMaximize: () => Promise<void>
      overlayIsMaximized: () => Promise<boolean>
      notifyLogCreated: (id?: string) => void
      startSnipping: (forceChoose?: boolean) => Promise<string | null>
      selectRecordingRegion: (forceChoose?: boolean) => Promise<{ sourceId: string; x: number; y: number; width: number; height: number; canvasWidth: number; canvasHeight: number } | null>
      snippingDone: (dataUrl: string) => void
      snippingCancel: () => void
      changeSnippingMonitor: () => void
      recordingRegionDone: (region: { x: number; y: number; width: number; height: number; canvasWidth: number; canvasHeight: number }) => void
      capturePickerSelect: (index: number) => void
      capturePickerCancel: () => void
      getAppVersion: () => Promise<string>
      getUpdateInfo: () => Promise<UpdateState>
      checkForUpdates: () => Promise<UpdateState>
      downloadUpdate: () => Promise<UpdateState>
      installUpdate: () => Promise<UpdateState>
      openExternal: (url: string) => Promise<void>
      openImageViewer: (filepath: string, theme?: 'light' | 'dark') => Promise<void>
      imageViewerControl: (action: 'minimize' | 'maximize' | 'close') => Promise<void>
      on: (channel: string, callback: (...args: unknown[]) => void) => void
      off: (channel: string, callback: (...args: unknown[]) => void) => void
    }
  }
}
