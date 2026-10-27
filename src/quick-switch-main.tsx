import React from 'react'
import ReactDOM from 'react-dom/client'
import QuickSwitch from './QuickSwitch'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme'
import './index.css'

ReactDOM.createRoot(document.getElementById('quick-switch-root')!).render(
  <React.StrictMode><ThemeProvider><I18nProvider><QuickSwitch /></I18nProvider></ThemeProvider></React.StrictMode>
)
