import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../i18n'

export default function TagInput({ value, onChange, disabled = false, inputId }: {
  value: string[]
  onChange: (tags: string[]) => void
  disabled?: boolean
  inputId?: string
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)

  const commit = () => {
    const tag = (inputRef.current?.value ?? draft).trim()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }

  return (
    <div className="input tag-input" onClick={() => inputRef.current?.focus()} data-disabled={disabled}>
      {value.map((tag, index) => (
        <span className="tag-input-badge" key={`${tag}-${index}`}>
          <span className="min-w-0 truncate" title={tag}>#{tag}</span>
          <button type="button" disabled={disabled} aria-label={t('removeTag', { tag })}
            className="tag-input-remove" onMouseDown={event => event.preventDefault()}
            onClick={() => {
              onChange(value.filter((_, position) => position !== index))
              inputRef.current?.focus()
            }}>
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <input id={inputId} ref={inputRef} type="text" className="tag-input-field" value={draft} disabled={disabled}
        aria-label={t('tags')} placeholder={t(value.length ? 'addTag' : 'tagInputPlaceholder')}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => { if (!disabled) commit() }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={event => {
          if (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            commit()
          } else if (event.key === 'Backspace' && !draft && value.length) {
            event.preventDefault()
            onChange(value.slice(0, -1))
          }
        }}
      />
    </div>
  )
}
