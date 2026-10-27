import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type Theme = 'dark' | 'light'

type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void }

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => localStorage.getItem('openpeepnote_theme') === 'dark' ? 'dark' : 'light')
  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem('openpeepnote_theme', next)
    setThemeState(next)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    const applyTheme = (next: unknown) => {
      if (next === 'dark' || next === 'light') setTheme(next)
    }
    const syncFromStorage = (event: StorageEvent) => {
      if (event.key === 'openpeepnote_theme') applyTheme(event.newValue)
    }
    window.addEventListener('storage', syncFromStorage)
    window.electronAPI?.on('theme-changed', applyTheme)
    return () => {
      window.removeEventListener('storage', syncFromStorage)
      window.electronAPI?.off('theme-changed', applyTheme)
    }
  }, [setTheme])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
