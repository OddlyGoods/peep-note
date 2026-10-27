import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider><I18nProvider><App /></I18nProvider></ThemeProvider>
  </React.StrictMode>
)
