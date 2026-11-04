import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { AI_RESPONSE_LANGUAGES, type AiResponseLanguagePreference } from '../../shared/aiResponseLanguage'
import { useI18n } from '../i18n'
import { useScreenActive } from '../lib/screenActivity'

const messages = {
  en: { label: 'Response language', auto: 'Match PeepNote language', hint: 'Applies to AI summaries and Magic Pen replies.' },
  ko: { label: '응답 언어', auto: '피프노트 언어에 맞춤', hint: 'AI 요약과 매직펜의 답변에 적용됩니다.' },
  ja: { label: '応答言語', auto: 'PeepNoteの言語に合わせる', hint: 'AI要約とマジックペンの応答に適用されます。' },
  zh: { label: '回复语言', auto: '与PeepNote语言一致', hint: '应用于AI摘要和魔法笔回复。' },
}
export default function AiResponseLanguageSelect({ value, onChange }: { value: AiResponseLanguagePreference; onChange: (value: AiResponseLanguagePreference) => void }) {
  const { language } = useI18n(), copy = messages[language], active = useScreenActive()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const options = [{ value: 'auto' as const, label: copy.auto }, ...AI_RESPONSE_LANGUAGES]
  useEffect(() => { if (!active) setOpen(false) }, [active])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true)
    menu.current?.querySelector<HTMLElement>('[aria-selected=true]')?.focus()
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [open])
  return <div>
    <label id="ai-response-language-label" className="block text-xs font-medium text-gray-400 mb-1.5">{copy.label}</label>
    <div className="relative" ref={menu}>
      <button ref={trigger} id="ai-response-language" type="button" aria-labelledby="ai-response-language-label ai-response-language-value"
        aria-haspopup="listbox" aria-expanded={open} className="settings-select-trigger input flex items-center justify-between py-[7px] text-left"
        onClick={() => setOpen(previous => !previous)} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true) } }}>
        <span id="ai-response-language-value" className="text-[13px] text-gray-200">{options.find(option => option.value === value)?.label}</span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div role="listbox" aria-labelledby="ai-response-language-label" className="absolute z-20 left-0 right-0 mt-1.5 rounded-lg border border-gray-700 bg-gray-900 p-1.5 shadow-xl max-h-64 overflow-y-auto"
        onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role=option]')), index = nodes.indexOf(document.activeElement as HTMLElement)
          nodes[event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus()
        }}>
        {options.map(option => <button key={option.value} type="button" role="option" aria-selected={value === option.value}
          className={`settings-select-option flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] transition-colors ${value === option.value ? 'bg-violet-500/15 text-violet-300' : 'text-gray-300 hover:bg-gray-800'}`}
          onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus() }}><span dir="auto">{option.label}</span>{value === option.value && <Check size={16} />}</button>)}
      </div>}
    </div>
    <p className="mt-1.5 text-xs text-gray-400">{copy.hint}</p>
  </div>
}
