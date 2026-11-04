import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Pencil } from 'lucide-react'
import { CAPTURE_CODEX_MODELS, isCaptureCodexModel, type CaptureCodexModel } from '../../shared/codexModels'
import { useI18n } from '../i18n'
import { useScreenActive } from '../lib/screenActivity'

const messages = {
  en: { title: 'Magic Pen', label: 'Model', hint: 'Draw around anything on your screen to get an AI explanation.', requirement: 'Uses your signed-in Codex CLI account.', invalid: 'Enter a valid model ID.' },
  ko: { title: '매직펜', label: '모델', hint: '화면에서 궁금한 부분을 그려 선택하면 AI가 바로 설명해 줍니다.', requirement: 'Codex CLI에 로그인한 계정을 사용합니다.', invalid: '올바른 모델 ID를 입력해 주세요.' },
  ja: { title: 'マジックペン', label: 'モデル', hint: '画面の気になる部分を囲むと、AIがその内容を説明します。', requirement: 'Codex CLIにログインしたアカウントを使用します。', invalid: '有効なモデルIDを入力してください。' },
  zh: { title: '魔法笔', label: '模型', hint: '圈选屏幕上想了解的内容，AI 即可为你解答。', requirement: '使用已登录的 Codex CLI 账号。', invalid: '请输入有效的模型 ID。' },
}

export default function CaptureCodexSettings({ value, customValue, onChange, modelOptions, requirement, controls }: { value: string; customValue?: string; onChange: (value: string, typing: boolean) => void; modelOptions?: readonly CaptureCodexModel[]; requirement?: string; controls?: ReactNode }) {
  const { language, t } = useI18n(), copy = messages[language]
  const active = useScreenActive()
  const id = useId()
  const [catalog, setModels] = useState<CaptureCodexModel[]>(CAPTURE_CODEX_MODELS)
  const models = modelOptions ?? catalog
  const [open, setOpen] = useState(false), [customOverride, setCustomOverride] = useState<boolean | null>(null)
  const menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const custom = customOverride ?? !models.some(item => item.value === value)
  useEffect(() => { if (!active) setOpen(false) }, [active])
  useEffect(() => {
    if (modelOptions) return
    let alive = true
    const request = window.electronAPI?.getCaptureCodexModels?.()
    if (request) void request.then(items => { if (alive && items.length) setModels(items) }).catch(() => {})
    return () => { alive = false }
  }, [modelOptions])
  useEffect(() => {
    if (!open || !active) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [open, active])
  return <section className="card p-5" aria-labelledby={`${id}-title`}>
    <div className="flex items-center gap-2 mb-4"><Pencil className="w-4 h-4 shrink-0 text-violet-400" aria-hidden="true" /><h2 id={`${id}-title`} className="text-sm font-semibold text-white">{copy.title}</h2></div>
    <p className="text-xs text-gray-400 leading-relaxed mb-4">{copy.hint}</p>
    {controls}
    <label id={`${id}-label`} className="block text-xs font-medium text-gray-400 mb-2">{copy.label}</label>
    <div ref={menu} className="relative">
      <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${id}-label ${id}-value`}
        className="settings-select-trigger input flex items-center justify-between py-[7px] text-left hover:border-violet-400/50"
        onClick={() => setOpen(previous => !previous)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}>
        <span id={`${id}-value`} className="text-[13px] text-gray-200">{custom ? t('customAiModel') : models.find(item => item.value === value)?.label ?? value}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div role="listbox" aria-labelledby={`${id}-label`} className="absolute z-20 left-0 right-0 mt-1.5 p-1.5 max-h-64 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl"
        onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]'))
          const index = options.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
          options[next]?.focus()
        }}>
        {models.map(model => <button key={model.value} type="button" role="option" aria-selected={!custom && value === model.value}
          className={`settings-select-option w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] text-left transition-colors ${!custom && value === model.value ? 'bg-violet-500/15 text-violet-300' : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'}`}
          onClick={() => { setCustomOverride(false); onChange(model.value, false); setOpen(false); trigger.current?.focus() }}>
          {model.label}{!custom && value === model.value && <Check className="w-4 h-4" />}
        </button>)}
        <button type="button" role="option" aria-selected={custom}
          className={`settings-select-option w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] text-left transition-colors ${custom ? 'bg-violet-500/15 text-violet-300' : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'}`}
          onClick={() => { setCustomOverride(true); onChange(customValue ?? (custom ? value : ''), true); setOpen(false) }}>{t('customAiModel')}{custom && <Check className="w-4 h-4" />}</button>
      </div>}
    </div>
    {custom && <input type="text" aria-label={t('customAiModelId')} value={value} onChange={event => onChange(event.target.value, true)}
      className="input w-full font-mono text-xs mt-2" placeholder={t('customAiModelId')} autoComplete="off" spellCheck={false} autoFocus
      aria-invalid={!isCaptureCodexModel(value)} onFocus={event => event.currentTarget.select()} />}
    <p className={`text-xs mt-2 leading-relaxed ${isCaptureCodexModel(value) ? 'text-gray-400' : 'text-red-400'}`}>{isCaptureCodexModel(value) ? (requirement ?? copy.requirement) : copy.invalid}</p>
  </section>
}
