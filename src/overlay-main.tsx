import React from 'react'
import ReactDOM from 'react-dom/client'
import Overlay from './Overlay'
import './index.css'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme'

ReactDOM.createRoot(document.getElementById('overlay-root')!).render(
  <React.StrictMode>
    <ThemeProvider><I18nProvider><Overlay /></I18nProvider></ThemeProvider>
  </React.StrictMode>
)
