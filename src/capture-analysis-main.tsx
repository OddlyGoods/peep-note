import React from 'react'
import ReactDOM from 'react-dom/client'
import CaptureAnalysis from './CaptureAnalysis'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme'
import './index.css'
import './capture-analysis.css'
const params = new URLSearchParams(location.search)
if (params.get('theme') === 'dark' || params.get('theme') === 'light') localStorage.setItem('openpeepnote_theme', params.get('theme')!)
if (['en', 'ko', 'ja', 'zh'].includes(params.get('language') || '')) localStorage.setItem('openpeepnote_language', params.get('language')!)
ReactDOM.createRoot(document.getElementById('capture-analysis-root')!).render(
  <React.StrictMode><ThemeProvider><I18nProvider><CaptureAnalysis /></I18nProvider></ThemeProvider></React.StrictMode>
)
