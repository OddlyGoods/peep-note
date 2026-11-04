// Isolated browser fixture. Every API call is intercepted before rendering.
import React from 'react'
import { createRoot } from 'react-dom/client'
import Settings from '../../src/pages/Settings'
import { I18nProvider } from '../../src/i18n'
import { getMagicPenSettings } from '../../shared/magicPen'
import { DEFAULT_AI_MODELS } from '../../shared/aiModels'
import { resolveHotkeys } from '../../shared/hotkeys'

localStorage.clear()
localStorage.setItem('openpeepnote_language', 'ko')
localStorage.setItem('openpeepnote_settings_section', 'ai')
const qa = (window as any).qa = {
  settings: { user_id: 'local', hotkeys: resolveHotkeys(), ai_provider: 'qwen', ai_model: DEFAULT_AI_MODELS.qwen,
    ai_models: DEFAULT_AI_MODELS, ai_custom_models: {}, ai_context_length: 32768, ai_response_language: 'auto',
    magic_pen: getMagicPenSettings(), openai_api_key: null, anthropic_api_key: null, gemini_api_key: null,
    qwen_api_key: 'fixture-key', qwen_base_url: 'https://example.test/v1', language: 'ko',
    auto_advance_date_range: false, fixed_start_date: true, trash_retention_days: 10 },
  mcp: { enabled: false, notificationsEnabled: true, endpoint: 'http://127.0.0.1:9999/mcp' },
  writes: [] as any[], failNext: false,
}
window.fetch = (async (url: any, options: any = {}) => {
  const path = new URL(String(url)).pathname, method = options.method ?? 'GET'
  if (method !== 'GET') qa.writes.push({ path, body: JSON.parse(options.body) })
  if (path === '/api/settings') {
    if (method !== 'GET') {
      if (qa.failNext) { qa.failNext = false; return Response.json({ error: 'fixture failure' }, { status: 500 }) }
      qa.settings = { ...qa.settings, ...JSON.parse(options.body) }
    }
    return Response.json(qa.settings)
  }
  if (path === '/api/mcp') {
    if (method !== 'GET') qa.mcp = { ...qa.mcp, ...JSON.parse(options.body) }
    return Response.json(qa.mcp)
  }
  throw new Error('Unexpected fixture request: ' + method + ' ' + path)
}) as typeof fetch
;(window as any).electronAPI = {
  on() {}, off() {}, setHotkeysEnabled: async () => {},
  getSettings: async () => ({ hotkeys: resolveHotkeys(), language: 'ko' }), saveSettings: async () => {},
  getAppVersion: async () => 'fixture', getUserDataPath: async () => '/fixture', getDataUsage: async () => ({ bytes: 0, partial: false }),
  getCaptureCodexModels: async () => [],
}
let root = createRoot(document.getElementById('root')!)
qa.unmount = () => root.unmount()
qa.mount = () => { root = createRoot(document.getElementById('root')!); root.render(<I18nProvider><Settings /></I18nProvider>) }
root.render(<I18nProvider><Settings /></I18nProvider>)
