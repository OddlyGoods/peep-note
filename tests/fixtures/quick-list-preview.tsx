import React from 'react'
import { createRoot } from 'react-dom/client'
import QuickSwitch from '../../src/QuickSwitch'
import { I18nProvider } from '../../src/i18n'

localStorage.clear()
const handlers = new Map<string, (...args: unknown[]) => void>()
const qa = (window as any).qa = { ready: false, results: [] as unknown[], mode: 'empty', release: null as null | (() => void) }
qa.open = (request: number, mode: string) => { qa.mode = mode; handlers.get('quick-switch-open')?.(request) }
window.fetch = (async () => {
  const mode = qa.mode
  if (mode === 'deferred') await new Promise<void>(resolve => { qa.release = resolve })
  if (mode === 'error') return Response.json({ error: 'Fixture failure' }, { status: 503 })
  return Response.json(mode === 'empty' ? [] : [{ id: 'synthetic-note', title: 'Quick List fixture', content: 'Visible note', log_type: 'note', created_at: 1700000000, tags: [], attachments: [] }])
}) as typeof fetch
;(window as any).electronAPI = {
  on: (channel: string, callback: (...args: unknown[]) => void) => handlers.set(channel, callback),
  off: (channel: string) => handlers.delete(channel),
  quickSwitchReady: async () => { qa.ready = true },
  quickSwitchResult: async (request: number, status: string) => { qa.results.push({ request, status }) },
  closeQuickSwitch: async () => {}, selectQuickLog: async () => {},
}
createRoot(document.getElementById('root')!).render(<I18nProvider><QuickSwitch /></I18nProvider>)
