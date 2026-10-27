import { useState, useEffect } from 'react'
import { Minus, Square, X, Moon, Sun } from 'lucide-react'
import { useI18n } from '../i18n'
import { useTheme } from '../theme'
import { api } from '../lib/api'

export default function TitleBar() {
  const { t } = useI18n()
  const { theme, setTheme } = useTheme()
  const [isMaximized, setIsMaximized] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.electronAPI?.windowIsMaximized().then(setIsMaximized)
    window.electronAPI?.getAppVersion?.().then(setVersion)
  }, [])

  const handleMinimize = () => window.electronAPI?.windowMinimize()
  const handleMaximize = async () => {
    await window.electronAPI?.windowMaximize()
    const maximized = await window.electronAPI?.windowIsMaximized()
    setIsMaximized(!!maximized)
  }
  const handleClose = () => window.electronAPI?.windowClose()
  const handleThemeToggle = async () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    try {
      await api.settings.update({ theme: nextTheme })
      const localSettings = await window.electronAPI?.getSettings()
      await window.electronAPI?.saveSettings({ ...(localSettings ?? {}), theme: nextTheme })
    } catch (error) {
      console.error('Failed to save theme:', error)
    }
  }

  return (
    <div
      className="flex items-center justify-between h-10 px-4 shrink-0 select-none"
      style={{
        WebkitAppRegion: 'drag',
        background: 'var(--titlebar-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--soft-border)',
        boxShadow: 'var(--titlebar-shadow)'
      } as React.CSSProperties}
    >
      {/* 왼쪽: 로고 + 타이틀 */}
      <div className="flex items-center gap-2">
        <div style={{ width: 20, height: 20, flexShrink: 0 }}>
          <img
            src="/icon.png"
            alt="logo"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            draggable={false}
          />
        </div>
        <span
          className="text-[11px] font-semibold tracking-widest translate-y-px"
          style={{ color: 'var(--title-text)' }}
        >
          Open PeepNote
        </span>
        {version && (
          <span
            className="px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none"
            style={{ color: 'var(--version-badge-text)', background: 'var(--version-badge-bg)', border: '1px solid var(--version-badge-border)' }}
          >
            v{version}
          </span>
        )}
      </div>

      {/* 오른쪽: 테마 및 윈도우 컨트롤 */}
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span className="mr-1 flex h-6 w-5 items-center justify-center" title={t('lightMode')}>
          {theme === 'light' ? <Sun className="w-3.5 h-3.5 text-amber-500" /> : <Moon className="w-3.5 h-3.5 text-indigo-400" />}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={theme === 'light'}
          onClick={handleThemeToggle}
          title={t('lightMode')}
          className="relative mr-2 h-4 w-7 rounded-full border transition-colors"
          style={{
            background: theme === 'light' ? 'rgba(139, 92, 246, 0.88)' : 'rgba(99, 102, 241, 0.32)',
            borderColor: theme === 'light' ? 'rgba(167, 139, 250, 0.75)' : 'rgba(129, 140, 248, 0.55)'
          }}
        >
          <span
            className="absolute rounded-full bg-white shadow-sm transition-[left]"
            style={{ width: 10, height: 10, top: 2, left: theme === 'light' ? 16 : 2 }}
          />
        </button>
        <button
          onClick={handleMinimize}
          title={t('minimize')}
          className="group w-8 h-7 flex items-center justify-center rounded-md transition-all hover:bg-white/10"
        >
          <Minus className="w-3.5 h-3.5 text-indigo-300/60 group-hover:text-indigo-200 transition-colors" />
        </button>
        <button
          onClick={handleMaximize}
          title={isMaximized ? t('restore') : t('maximize')}
          className="group w-8 h-7 flex items-center justify-center rounded-md transition-all hover:bg-white/10"
        >
          {isMaximized ? (
            /* 복원 아이콘 */
            <svg className="w-3 h-3 text-indigo-300/60 group-hover:text-indigo-200 transition-colors" fill="none" viewBox="0 0 12 12">
              <rect x="3" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1 4v6a1 1 0 001 1h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          ) : (
            <Square className="w-3 h-3 text-indigo-300/60 group-hover:text-indigo-200 transition-colors" />
          )}
        </button>
        <button
          onClick={handleClose}
          title={t('closeToTray')}
          className="group w-8 h-7 flex items-center justify-center rounded-md transition-all hover:bg-red-500/20"
        >
          <X className="w-3.5 h-3.5 text-indigo-300/60 group-hover:text-red-400 transition-colors" />
        </button>
      </div>
    </div>
  )
}
