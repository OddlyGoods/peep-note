import React from 'react'
import { createRoot } from 'react-dom/client'
import Overlay from '../../src/Overlay'
import { I18nProvider } from '../../src/i18n'
import { ThemeProvider } from '../../src/theme'

localStorage.clear()
localStorage.setItem('openpeepnote_language', 'en')
;(window as any).savedLogs = []
window.fetch = (async (url: any, options: any = {}) => {
  const route = new URL(String(url)).pathname
  if (route === '/api/workspaces') return Response.json([{ id: 'general', name: 'General', is_default: true }])
  if (route === '/api/logs' && options.method === 'POST') {
    const log = { ...JSON.parse(options.body), id: 'fixture-note' }
    ;(window as any).savedLogs.push(log)
    return Response.json(log)
  }
  throw new Error('Unexpected overlay fixture request: ' + route)
}) as typeof fetch

createRoot(document.getElementById('overlay-root')!).render(
  <React.StrictMode><ThemeProvider><I18nProvider><Overlay /></I18nProvider></ThemeProvider></React.StrictMode>
)
