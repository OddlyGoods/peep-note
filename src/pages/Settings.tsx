import { useEffect, useRef, useState } from 'react'
import { Save, Keyboard, Cloud, User, RotateCcw, Sparkles, Eye, EyeOff, Check, ChevronDown, Lock, Loader2, MoreHorizontal, Settings2 } from 'lucide-react'
import { api, Settings as SettingsType } from '../lib/api'
import { Language, useI18n } from '../i18n'
import { useLogStore } from '../stores/logStore'
import SecretPasswordModal from '../components/SecretPasswordModal'
import UpdatePanel from '../components/UpdatePanel'
import ConfirmModal from '../components/ConfirmModal'
import { dataStorageErrorKey } from '../../shared/dataStorage'
import DataLocationField from '../components/DataLocationField'
import { DEFAULT_TRASH_RETENTION_DAYS, TRASH_RETENTION_OPTIONS, normalizeTrashRetentionDays } from '../../shared/trashRetention'
import { AI_MODELS, DEFAULT_AI_MODELS, getAiModelSelection, type AiProvider } from '../../shared/aiModels'
import { resolveHotkeys, type HotkeyAction, type Hotkeys } from '../../shared/hotkeys'

function HotkeyInput({ value, label, disabled, onChange, onDisabledChange }: {
  value: string
  label: string
  disabled: boolean
  onChange: (value: string) => void
  onDisabledChange: (disabled: boolean) => void
}) {
  const { t } = useI18n()
  const [listening, setListening] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const menuItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => () => {
    window.electronAPI?.setHotkeysEnabled(true)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    menuItemRef.current?.focus()
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOpen(false)
      menuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault()
    if (e.key === 'Escape') {
      setListening(false)
      window.electronAPI?.setHotkeysEnabled(true)
      return
    }
    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    if (e.metaKey) parts.push('Meta')

    const key = e.key
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      if (key.startsWith('F') && !isNaN(Number(key.slice(1)))) {
        parts.push(key)
      } else if (key.length === 1) {
        parts.push(key.toUpperCase())
      } else {
        parts.push(key)
      }
      onChange(parts.join('+'))
      setListening(false)
      window.electronAPI?.setHotkeysEnabled(true)
    }
  }

  return (
    <div ref={containerRef} className="relative shrink-0" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false)
    }}>
      <div className="settings-hotkey-control" data-disabled={disabled} data-listening={listening}>
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${disabled ? `${t('shortcutDisabled')} · ` : ''}${value}`}
        onClick={() => {
          setListening(true)
          setMenuOpen(false)
          window.electronAPI?.setHotkeysEnabled(false)
        }}
        onBlur={() => {
          setListening(false)
          window.electronAPI?.setHotkeysEnabled(true)
        }}
        onKeyDown={listening ? handleKeyDown : undefined}
        className={`settings-hotkey-input px-3 py-1.5 text-sm font-mono select-none min-w-24 text-center transition-colors ${listening ? 'is-listening' : ''}`}
      >
        {listening ? t('pressKey') : value || '—'}
      </button>
      <button ref={menuTriggerRef} type="button" className="settings-hotkey-menu-trigger"
        aria-label={t('shortcutOptions', { name: label })} aria-haspopup="menu" aria-expanded={menuOpen}
        onClick={() => setMenuOpen(open => !open)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setMenuOpen(true)
          }
        }}>
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      </div>
      {menuOpen && <div role="menu" aria-label={t('shortcutOptions', { name: label })} className="settings-hotkey-menu">
        <button ref={menuItemRef} type="button" role="menuitem" onClick={() => {
          onDisabledChange(!disabled)
          setMenuOpen(false)
          menuTriggerRef.current?.focus()
        }}>{t(disabled ? 'enableShortcut' : 'disableShortcut')}</button>
      </div>}
    </div>
  )
}

export default function Settings() {
  const { language, setLanguage, t } = useI18n()
  const secretSettingsCopy = {
    en: { title: 'Secret note lock', set: 'Set a 4-digit password to protect secret notes.', active: 'A 4-digit password is set.', actionSet: 'Set password', actionChange: 'Reset password' },
    ko: { title: '비밀 노트 잠금', set: '비밀 노트를 보호할 4자리 비밀번호를 설정하세요.', active: '4자리 비밀번호가 설정되어 있습니다.', actionSet: '비밀번호 설정', actionChange: '비밀번호 재설정' },
    ja: { title: 'シークレットノートのロック', set: 'シークレットノートを保護する4桁のパスワードを設定します。', active: '4桁のパスワードが設定されています。', actionSet: 'パスワードを設定', actionChange: 'パスワードを再設定' },
    zh: { title: '私密笔记锁定', set: '设置 4 位密码以保护私密笔记。', active: '已设置 4 位密码。', actionSet: '设置密码', actionChange: '重设密码' }
  }[language]
  const [settings, setSettings] = useState<SettingsType | null>(null)
  const [hotkeys, setHotkeys] = useState<Hotkeys>(() => resolveHotkeys())
  const [backupEnabled, setBackupEnabled] = useState(false)
  const [backupUrl, setBackupUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [aiProvider, setAiProvider] = useState<AiProvider>('openai')
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODELS.openai)
  const [customAiModel, setCustomAiModel] = useState(false)
  const customModelInputRef = useRef<HTMLInputElement>(null)
  const [openaiKey, setOpenaiKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [qwenKey, setQwenKey] = useState('')
  const [qwenBaseUrl, setQwenBaseUrl] = useState('https://dashscope-intl.aliyuncs.com/compatible-mode/v1')
  const [showKey, setShowKey] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [dataPath, setDataPath] = useState('')
  const [dataUsage, setDataUsage] = useState<{ bytes: number; partial: boolean } | null>(null)
  const [dataUsageError, setDataUsageError] = useState(false)
  const [pendingDataPath, setPendingDataPath] = useState<string | null>(null)
  const [changingDataPath, setChangingDataPath] = useState(false)
  const [dataPathError, setDataPathError] = useState<ReturnType<typeof dataStorageErrorKey> | ''>('')
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language)
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement>(null)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const [autoAdvanceDateRange, setAutoAdvanceDateRange] = useState(true)
  const [fixedStartDate, setFixedStartDate] = useState(true)
  const [trashRetentionDays, setTrashRetentionDays] = useState(DEFAULT_TRASH_RETENTION_DAYS)
  const [secretPasswordSet, setSecretPasswordSet] = useState(false)
  const [showSecretPasswordModal, setShowSecretPasswordModal] = useState(false)
  const setStoreDateNavigation = useLogStore(s => s.setDateNavigation)

  useEffect(() => {
    api.settings.get().then(s => {
      setSettings(s)
      setHotkeys(resolveHotkeys(s.hotkeys))
      setBackupEnabled(s.backup_enabled)
      setBackupUrl(s.backup_url ?? '')
      const provider = s.ai_provider ?? 'openai'
      setAiProvider(provider)
      const selection = getAiModelSelection(provider, s.ai_model)
      setAiModel(selection.model)
      setCustomAiModel(selection.custom)
      if (s.openai_api_key) setOpenaiKey(s.openai_api_key)
      if (s.anthropic_api_key) setAnthropicKey(s.anthropic_api_key)
      if (s.gemini_api_key) setGeminiKey(s.gemini_api_key)
      if (s.qwen_api_key) setQwenKey(s.qwen_api_key)
      if (s.qwen_base_url) setQwenBaseUrl(s.qwen_base_url)
      setSelectedLanguage(s.language ?? 'en')
      setLanguage(s.language ?? 'en')
      const autoAdvance = s.auto_advance_date_range ?? true
      const fixedStart = s.fixed_start_date ?? true
      setAutoAdvanceDateRange(autoAdvance)
      setFixedStartDate(fixedStart)
      setStoreDateNavigation({ autoAdvanceDateRange: autoAdvance, fixedStartDate: fixedStart })
      setTrashRetentionDays(normalizeTrashRetentionDays(s.trash_retention_days))
      setSecretPasswordSet(!!s.secret_password_set)
      setLoading(false)
    }).catch(() => setLoading(false))
    window.electronAPI?.getAppVersion?.().then((v: string) => setAppVersion(v))
    window.electronAPI?.getUserDataPath?.().then((path: string) => setDataPath(path))
    const usage = window.electronAPI?.getDataUsage?.()
    if (usage) void usage.then(setDataUsage).catch(() => setDataUsageError(true))
    else setDataUsageError(true)
  }, [])

  useEffect(() => {
    if (!languageMenuOpen && !modelMenuOpen) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (!languageMenuRef.current?.contains(target) && !modelMenuRef.current?.contains(target)) {
        setLanguageMenuOpen(false)
        setModelMenuOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLanguageMenuOpen(false)
        setModelMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [languageMenuOpen, modelMenuOpen])

  const handleSave = async () => {
    if (!aiModel.trim()) return
    setSaving(true)
    try {
      await api.settings.update({
        hotkeys,
        backup_enabled: backupEnabled,
        backup_url: backupUrl || null,
        ai_provider: aiProvider,
        ai_model: aiModel.trim(),
        openai_api_key: openaiKey || null,
        anthropic_api_key: anthropicKey || null,
        gemini_api_key: geminiKey || null,
        qwen_api_key: qwenKey || null,
        qwen_base_url: qwenBaseUrl.trim() || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        language: selectedLanguage,
        auto_advance_date_range: autoAdvanceDateRange,
        fixed_start_date: fixedStartDate,
        trash_retention_days: trashRetentionDays
      })
      // Electron에도 단축키 업데이트
      const localSettings = await window.electronAPI?.getSettings()
      await window.electronAPI?.saveSettings({ ...(localSettings ?? {}), hotkeys, language: selectedLanguage })
      setLanguage(selectedLanguage)
      setStoreDateNavigation({ autoAdvanceDateRange, fixedStartDate })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const resetHotkeys = () => setHotkeys(resolveHotkeys())

  const chooseDataPath = async () => {
    setDataPathError('')
    try {
      const directory = await window.electronAPI?.chooseDataLocation()
      if (directory) setPendingDataPath(directory)
    } catch { setDataPathError('dataLocationUnavailable') }
  }

  const changeDataPath = async () => {
    if (!pendingDataPath || changingDataPath) return
    const directory = pendingDataPath
    setPendingDataPath(null)
    setChangingDataPath(true)
    try {
      const result = await window.electronAPI?.changeDataLocation(directory)
      if (result?.status === 'restarting') return
      setDataPathError(dataStorageErrorKey(result?.error))
    } catch { setDataPathError('dataLocationFailed') }
    setChangingDataPath(false)
  }


  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="settings-page flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex h-20 shrink-0 items-center justify-between px-6 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)' }}>
        <h1 className="text-lg font-semibold text-white">{t('settings')}</h1>
        <button
          onClick={handleSave}
          disabled={saving || saved || !aiModel.trim()}
          className="btn-primary -translate-y-px flex items-center gap-1.5"
        >
          {saving
            ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <Save className="w-4 h-4" />
          }
          {saved ? t('settingsSaved') : t('save')}
        </button>
      </div>

      <div className="settings-scroll-area flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">

          <section className="card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-white">{t('general')}</h2>
            </div>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-200 mb-1">{t('language')}</h3>
                <p className="text-xs text-gray-400 mb-4">{t('languageDescription')}</p>
                <div ref={languageMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setLanguageMenuOpen(open => !open)
                  setModelMenuOpen(false)
                }}
                aria-haspopup="listbox"
                aria-expanded={languageMenuOpen}
                className="settings-select-trigger input flex items-center justify-between py-2.5 text-left hover:border-violet-400/50"
              >
                <span className="text-sm text-gray-200">{{
                  en: t('english'), ko: t('korean'), ja: t('japanese'), zh: t('chinese')
                }[selectedLanguage]}</span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${languageMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {languageMenuOpen && (
                <div role="listbox" className="absolute z-20 left-0 right-0 mt-1.5 p-1.5 rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
                  {([
                    { value: 'en' as const, label: t('english') },
                    { value: 'ko' as const, label: t('korean') },
                    { value: 'ja' as const, label: t('japanese') },
                    { value: 'zh' as const, label: t('chinese') }
                  ]).map(({ value, label }) => {
                    const selected = selectedLanguage === value
                    return (
                      <button
                        key={value}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setSelectedLanguage(value)
                          setLanguageMenuOpen(false)
                        }}
                        className={`settings-select-option w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-left transition-colors ${
                          selected
                            ? 'bg-violet-500/15 text-violet-300'
                            : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                        }`}
                      >
                        {label}
                        {selected && <Check className="w-4 h-4" />}
                      </button>
                    )
                  })}
                </div>
              )}
                </div>
              </div>
              <div className="border-t border-gray-800 pt-4 flex items-center justify-between gap-5">
                <div className="min-w-0">
                  <label htmlFor="trash-retention-days" className="text-sm font-medium text-gray-200">{t('trashRetention')}</label>
                  <p id="trash-retention-description" className="text-xs text-gray-400 mt-1">{t('trashRetentionDescription')}</p>
                </div>
                <div className="relative shrink-0">
                  <select
                    id="trash-retention-days"
                    aria-describedby="trash-retention-description"
                    value={trashRetentionDays}
                    onChange={event => setTrashRetentionDays(normalizeTrashRetentionDays(Number(event.target.value)))}
                    className="settings-select-trigger input w-28 appearance-none pr-8 py-2 cursor-pointer hover:border-violet-400/50"
                  >
                    {TRASH_RETENTION_OPTIONS.map(days => <option key={days} value={days} style={{ background: 'var(--modal-bg)', color: 'var(--title-text)' }}>{t('retentionDays', { days })}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                </div>
              </div>
              <div className="border-t border-gray-800 pt-4 flex items-center justify-between gap-5">
                <div className="min-w-0">
                  <h3 id="auto-advance-date-range-label" className="text-sm font-medium text-gray-200">{t('autoAdvanceDateRange')}</h3>
                  <p id="auto-advance-date-range-description" className="text-xs text-gray-400 mt-1">{t('autoAdvanceDateRangeDescription')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-labelledby="auto-advance-date-range-label"
                  aria-describedby="auto-advance-date-range-description"
                  aria-checked={autoAdvanceDateRange}
                  onClick={() => setAutoAdvanceDateRange(value => !value)}
                  className={`settings-date-toggle relative shrink-0 w-12 h-6 rounded-full transition-all ${autoAdvanceDateRange ? 'bg-violet-500 ring-1 ring-violet-300/50 shadow-[0_0_10px_rgba(139,92,246,0.28)]' : 'bg-gray-700 ring-1 ring-gray-600'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full shadow-sm transition-[left] ${autoAdvanceDateRange ? 'left-6 bg-white' : 'left-0.5 bg-gray-300'}`} />
                </button>
              </div>
              <div className="border-t border-gray-800 pt-4 flex items-center justify-between gap-5">
                <div className="min-w-0">
                  <h3 id="fixed-start-date-label" className="text-sm font-medium text-gray-200">{t('fixedStartDate')}</h3>
                  <p id="fixed-start-date-description" className="text-xs text-gray-400 mt-1">{t('fixedStartDateDescription')}</p>
                </div>
                <button type="button" role="switch" aria-labelledby="fixed-start-date-label" aria-describedby="fixed-start-date-description"
                  aria-checked={fixedStartDate} onClick={() => setFixedStartDate(value => !value)}
                  className={`settings-date-toggle relative shrink-0 w-12 h-6 rounded-full transition-all ${fixedStartDate ? 'bg-violet-500 ring-1 ring-violet-300/50 shadow-[0_0_10px_rgba(139,92,246,0.28)]' : 'bg-gray-700 ring-1 ring-gray-600'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full shadow-sm transition-[left] ${fixedStartDate ? 'left-6 bg-white' : 'left-0.5 bg-gray-300'}`} />
                </button>
              </div>
            </div>
          </section>

          <section className="card p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <Lock className="w-4 h-4 shrink-0 text-violet-400" />
                <h2 className="text-sm font-semibold text-white">{secretSettingsCopy.title}</h2>
              </div>
              <button type="button" onClick={() => setShowSecretPasswordModal(true)} className="btn-secondary shrink-0 text-xs">{secretPasswordSet ? secretSettingsCopy.actionChange : secretSettingsCopy.actionSet}</button>
            </div>
            <p className="text-xs text-gray-400">{secretPasswordSet ? secretSettingsCopy.active : secretSettingsCopy.set}</p>
          </section>

          {/* 단축키 설정 */}
          <section className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-violet-400" />
                <h2 className="text-sm font-semibold text-white">{t('globalShortcuts')}</h2>
              </div>
              <button
                onClick={resetHotkeys}
                className="settings-ghost-button btn-ghost flex items-center gap-1.5 text-xs"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('resetDefaults')}
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              {t('shortcutDescription')}
            </p>
            <div className="space-y-3">
              {Object.entries({ openMain: t('shortcutOpenMain'), openFavorites: t('shortcutOpenFavorites'), openOverlay: t('shortcutOpenOverlay'), takeScreenshot: t('shortcutCaptureScreenshot'), startRecording: t('shortcutStartRecording'), stopRecording: t('shortcutStopRecording'), quickSwitch: t('quickSwitch'), quickSwitchPrevious: t('quickSwitchPrevious') }).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                  <div>
                    <p className="text-sm text-gray-200">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {key === 'openMain' && t('shortcutOpenMainDescription')}
                      {key === 'openFavorites' && t('shortcutOpenFavoritesDescription')}
                      {key === 'openOverlay' && t('shortcutOpenOverlayDescription')}
                      {key === 'takeScreenshot' && t('shortcutCaptureScreenshotDescription')}
                      {key === 'startRecording' && t('shortcutStartRecordingDescription')}
                      {key === 'stopRecording' && t('shortcutStopRecordingDescription')}
                      {key === 'quickSwitch' && t('recentRecords')}
                      {key === 'quickSwitchPrevious' && t('recentRecordsPrevious')}
                    </p>
                  </div>
                  <HotkeyInput
                    value={hotkeys[key as HotkeyAction]}
                    label={label}
                    disabled={hotkeys.disabled?.[key as HotkeyAction] === true}
                    onChange={v => setHotkeys(prev => ({ ...prev, [key]: v }))}
                    onDisabledChange={disabled => setHotkeys(prev => ({ ...prev, disabled: { ...prev.disabled, [key]: disabled } }))}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* 백업 설정 */}
          <section className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Cloud className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-white">{t('cloudBackup')}</h2>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-blue-300 border border-blue-400/20 bg-blue-400/10">{t('comingSoon')}</span>
            </div>
            <p className="text-sm text-gray-400">{t('backupComingSoonDescription')}</p>
          </section>

          {/* AI 설정 */}
          <section className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-white">{t('aiSettings')}</h2>
            </div>
            <div className="space-y-4">
              {/* 프로바이더 선택 */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-2">{t('aiProvider')}</label>
                <div className="flex gap-2">
                  {([
                    { value: 'openai', label: 'OpenAI' },
                    { value: 'anthropic', label: 'Claude' },
                    { value: 'gemini', label: 'Gemini' },
                    { value: 'qwen', label: 'Qwen' }
                  ] as const).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      data-active={aiProvider === value}
                      onClick={() => {
                        if (value === aiProvider) return
                        setAiProvider(value)
                        setAiModel(DEFAULT_AI_MODELS[value])
                        setCustomAiModel(false)
                        setModelMenuOpen(false)
                      }}
                      className={`settings-provider-button flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${
                        aiProvider === value
                          ? 'bg-violet-600/20 text-violet-300 border-violet-500/40'
                          : 'text-gray-400 border-gray-700 hover:border-gray-600 hover:text-gray-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label id="ai-model-label" className="block text-xs font-medium text-gray-400 mb-2">{t('aiModel')}</label>
                <div ref={modelMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setModelMenuOpen(open => !open)
                      setLanguageMenuOpen(false)
                    }}
                    aria-haspopup="listbox"
                    aria-labelledby="ai-model-label ai-model-value"
                    aria-expanded={modelMenuOpen}
                    className="settings-select-trigger input flex items-center justify-between py-2.5 text-left hover:border-violet-400/50"
                  >
                    <span id="ai-model-value" className="text-sm text-gray-200">
                      {customAiModel ? t('customAiModel') : AI_MODELS[aiProvider].find(model => model.value === aiModel)?.label}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${modelMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {modelMenuOpen && (
                    <div role="listbox" aria-labelledby="ai-model-label" className="absolute z-20 left-0 right-0 mt-1.5 p-1.5 max-h-64 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
                      {AI_MODELS[aiProvider].map(({ value, label }) => {
                        const selected = !customAiModel && aiModel === value
                        return (
                          <button
                            key={value}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              setAiModel(value)
                              setCustomAiModel(false)
                              setModelMenuOpen(false)
                            }}
                            className={`settings-select-option w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-left transition-colors ${
                              selected
                                ? 'bg-violet-500/15 text-violet-300'
                                : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                            }`}
                          >
                            {label}
                            {selected && <Check className="w-4 h-4" />}
                          </button>
                        )
                      })}
                      <button
                        type="button"
                        role="option"
                        aria-selected={customAiModel}
                        onClick={() => {
                          setCustomAiModel(true)
                          setModelMenuOpen(false)
                          customModelInputRef.current?.focus()
                        }}
                        className={`settings-select-option w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-left transition-colors ${customAiModel ? 'bg-violet-500/15 text-violet-300' : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'}`}
                      >
                        {t('customAiModel')}
                        {customAiModel && <Check className="w-4 h-4" />}
                      </button>
                    </div>
                  )}
                </div>
                {customAiModel && (
                  <div className="mt-2">
                    <label htmlFor="custom-ai-model" className="sr-only">{t('customAiModelId')}</label>
                    <input
                      id="custom-ai-model"
                      ref={customModelInputRef}
                      type="text"
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      className="input w-full font-mono text-xs"
                      value={aiModel}
                      placeholder={t('customAiModelId')}
                      onFocus={event => event.currentTarget.select()}
                      onChange={event => setAiModel(event.target.value)}
                      aria-invalid={!aiModel.trim()}
                      aria-describedby="custom-ai-model-hint"
                    />
                    <p id="custom-ai-model-hint" className="text-xs text-gray-400 mt-1.5">
                      {t(aiModel.trim() ? 'customAiModelHint' : 'customAiModelRequired')}
                    </p>
                  </div>
                )}
              </div>

              {/* API 키 입력 */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  {t('apiKey', { provider: aiProvider === 'anthropic' ? 'Anthropic' : aiProvider === 'gemini' ? 'Gemini' : aiProvider === 'qwen' ? 'Qwen' : 'OpenAI' })}
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="input pr-9 w-full font-mono text-xs"
                    placeholder={
                      aiProvider === 'openai' ? 'sk-...' :
                      aiProvider === 'anthropic' ? 'sk-ant-...' :
                      aiProvider === 'gemini' ? 'AIza...' :
                      'sk-...'
                    }
                    value={
                      aiProvider === 'openai' ? openaiKey :
                      aiProvider === 'anthropic' ? anthropicKey :
                      aiProvider === 'gemini' ? geminiKey :
                      qwenKey
                    }
                    onChange={e => {
                      if (aiProvider === 'openai') setOpenaiKey(e.target.value)
                      else if (aiProvider === 'anthropic') setAnthropicKey(e.target.value)
                      else if (aiProvider === 'gemini') setGeminiKey(e.target.value)
                      else setQwenKey(e.target.value)
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(v => !v)}
                    className="settings-icon-button absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {t('keyStorage')}
                </p>
              </div>
              {aiProvider === 'qwen' && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">{t('qwenEndpoint')}</label>
                  <input
                    type="url"
                    className="input w-full font-mono text-xs"
                    value={qwenBaseUrl}
                    onChange={e => setQwenBaseUrl(e.target.value)}
                    placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">{t('qwenEndpointHint')}</p>
                </div>
              )}
            </div>
          </section>

          {/* 앱 정보 */}
          <section className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-white">{t('appInfo')}</h2>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1.5 border-b border-gray-800">
                <span className="text-gray-400">{t('version')}</span>
                <span className="text-gray-300">{appVersion || '–'}</span>
              </div>
              <div className="py-2 border-b border-gray-800">
                <DataLocationField directory={dataPath} usage={dataUsage} usageError={dataUsageError}
                  changing={changingDataPath} disabled={!window.electronAPI?.chooseDataLocation || saving} onChoose={chooseDataPath} />
                <p className="mt-2 text-xs text-gray-400 leading-relaxed">{t('dataLocationHint')}</p>
                {dataPathError && <p role="alert" className="mt-2 text-xs text-red-400">{t(dataPathError)}</p>}
              </div>
            </div>
            <UpdatePanel />
          </section>
        </div>
      </div>
      {showSecretPasswordModal && (
        <SecretPasswordModal
          mode="set"
          requireCurrent={secretPasswordSet}
          onSuccess={() => { setSecretPasswordSet(true); setShowSecretPasswordModal(false) }}
          onCancel={() => setShowSecretPasswordModal(false)}
        />
      )}
      {pendingDataPath && <ConfirmModal title={t('dataLocationConfirmTitle')} message={t('dataLocationConfirm').replace('{path}', pendingDataPath)}
        confirmLabel={t('dataLocationRestart')} danger={false} onConfirm={changeDataPath} onCancel={() => setPendingDataPath(null)} />}
    </div>
  )
}
