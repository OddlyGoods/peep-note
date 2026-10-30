import type { McpSavedNote } from './mcpEvents'

export const NOTE_NOTIFICATION_HOLD_MS = 5000
export const NOTE_NOTIFICATION_FADE_MS = 500

const messages = {
  en: { saved: 'Note saved', untitled: 'Untitled note', close: 'Close', locale: 'en-US' },
  ko: { saved: '메모 저장됨', untitled: '제목 없는 메모', close: '닫기', locale: 'ko-KR' },
  ja: { saved: 'メモを保存しました', untitled: '無題のメモ', close: '閉じる', locale: 'ja-JP' },
  zh: { saved: '笔记已保存', untitled: '无标题笔记', close: '关闭', locale: 'zh-CN' }
}

export function noteNotificationPresentation(note: McpSavedNote, preferences: { theme?: unknown; language?: unknown }) {
  const language = typeof preferences.language === 'string' && Object.prototype.hasOwnProperty.call(messages, preferences.language) ? preferences.language as keyof typeof messages : 'en'
  const text = messages[language]
  const date = new Date(note.savedAt * 1000)
  const time = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(text.locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date) : ''
  return {
    theme: preferences.theme === 'dark' ? 'dark' : 'light',
    language,
    title: note.title.trim().slice(0, 200) || text.untitled,
    preview: note.preview.replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, 600),
    metadata: ['MCP', text.saved, time].filter(Boolean).join(' · '),
    close: text.close
  }
}

export function noteNotificationBounds(area: { x: number; y: number; width: number; height: number }) {
  const gap = 16
  const width = Math.min(480, area.width - gap * 2)
  const height = Math.min(144, area.height - gap * 2)
  return { x: area.x + area.width - width - gap, y: area.y + area.height - height - gap, width, height }
}

interface Clock {
  set(delay: number, callback: () => void): unknown
  clear(timer: unknown): void
}
const clock: Clock = {
  set: (delay, callback) => setTimeout(callback, delay),
  clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>)
}

// A replacement cancels both old timers, including one already fading out.
export function createNoteNotificationLifetime<T>(view: { show: (value: T) => void; fade: () => void; hide: () => void }, timer: Clock = clock) {
  let visible = false
  let hold: unknown, fade: unknown
  const clear = () => { timer.clear(hold); timer.clear(fade); hold = fade = undefined }
  const dismiss = () => {
    clear()
    if (!visible) return
    visible = false
    view.hide()
  }
  return {
    show(value: T) {
      clear()
      visible = true
      view.show(value)
      hold = timer.set(NOTE_NOTIFICATION_HOLD_MS, () => {
        view.fade()
        fade = timer.set(NOTE_NOTIFICATION_FADE_MS, dismiss)
      })
    },
    dismiss
  }
}
