import { useScreenActive } from '../lib/screenActivity'
import { useEffect, useRef, useState } from 'react'
import { Lock, X } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../i18n'
import ModalLayer from './ModalLayer'

type Props = {
  mode: 'unlock' | 'set'
  requireCurrent?: boolean
  onSuccess: () => void
  onCancel: () => void
}

export default function SecretPasswordModal({ mode, requireCurrent = false, onSuccess, onCancel }: Props) {
  const active = useScreenActive()
  const { t, language } = useI18n()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const completingRef = useRef(false)
  const checkingCurrentRef = useRef(false)
  const mountedRef = useRef(true)
  const isUnlock = mode === 'unlock'

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => { if (active) inputRef.current?.focus() }, [active, step])
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, onCancel])

  const activePin = isUnlock ? password : requireCurrent && step === 0 ? current : step === (requireCurrent ? 1 : 0) ? password : confirm
  const activeLabel = isUnlock ? t('enterSecretPassword') : requireCurrent && step === 0 ? t('currentSecretPassword') : step === (requireCurrent ? 1 : 0) ? t('newSecretPassword') : t('confirmSecretPassword')
  const lastStep = isUnlock ? 0 : requireCurrent ? 2 : 1
  const complete = async (finalPin: string) => {
    if (!mountedRef.current || completingRef.current) return
    completingRef.current = true
    setSaving(true)
    try {
      if (isUnlock) await api.settings.verifySecretPassword(finalPin)
      else {
        if (password !== finalPin) { setError(t('passwordMismatch')); return }
        await api.settings.setSecretPassword(password, requireCurrent ? current : undefined)
      }
      if (mountedRef.current) onSuccess()
    } catch (error: any) {
      if (!mountedRef.current) return
      setPassword('')
      setConfirm('')
      inputRef.current?.focus()
      if (error?.message === 'SECRET_PASSWORD_INCORRECT') setError(t('passwordIncorrect'))
      else if (error?.message === 'INVALID_SECRET_PASSWORD') setError(t('newSecretPassword'))
      else setError(error?.message || t('passwordIncorrect'))
    } finally { completingRef.current = false; setSaving(false) }
  }
  const pinInput = (value: string) => {
    const next = value.replace(/\D/g, '').slice(0, 4)
    const setter = requireCurrent && step === 0 ? setCurrent : step === (requireCurrent ? 1 : 0) ? setPassword : setConfirm
    setter(next)
    setError('')
    if (next.length !== 4) return
    window.setTimeout(() => {
      if (!mountedRef.current) return
      if (requireCurrent && step === 0) {
        if (checkingCurrentRef.current) return
        checkingCurrentRef.current = true
        void api.settings.verifySecretPassword(next)
          .then(() => { if (mountedRef.current) setStep(1) })
          .catch(error => {
            if (!mountedRef.current) return
            setCurrent('')
            setError(error?.message === 'SECRET_PASSWORD_INCORRECT' ? t('passwordIncorrect') : (error?.message || t('passwordIncorrect')))
            window.setTimeout(() => inputRef.current?.focus(), 0)
          })
          .finally(() => { checkingCurrentRef.current = false })
        return
      }
      if (step < lastStep) setStep(value => value + 1)
      else void complete(next)
    }, 0)
  }

  return (
    <ModalLayer className="secret-password-overlay p-4" onClose={onCancel}>
      <div role="dialog" aria-modal="true" aria-label={isUnlock ? t('secretPassword') : requireCurrent ? t('changeSecretPassword') : t('setSecretPassword')} className="relative w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 shadow-2xl" style={{ background: 'var(--modal-bg)', borderColor: 'var(--medium-border)' }}>
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--soft-border)' }}>
          <div className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10"><Lock className="h-3.5 w-3.5 text-violet-400" /></span><h3 className="text-sm font-semibold text-gray-100">{isUnlock ? t('secretPassword') : requireCurrent ? t('changeSecretPassword') : t('setSecretPassword')}</h3></div>
          <button type="button" onClick={onCancel} className="btn-ghost p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 px-5 py-6">
          <p className="text-center text-xs text-gray-400">{activeLabel}</p>
          <div className="relative mx-auto flex w-fit cursor-text items-center justify-center gap-4" onClick={() => inputRef.current?.focus()}>
            <input key={step} ref={inputRef} className="absolute inset-0 h-full w-full cursor-text opacity-0" type="password" inputMode="numeric" autoComplete="off" value={activePin} onChange={e => pinInput(e.target.value)} />
            {[0, 1, 2, 3].map(index => <span key={index} className={`flex h-12 w-8 items-center justify-center border-b-2 text-3xl leading-none transition-colors ${activePin[index] ? 'border-violet-400 text-violet-300' : 'border-gray-600 text-gray-600'}`}>{activePin[index] ? '•' : ''}</span>)}
          </div>
          {error && <p className="text-center text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end border-t px-5 py-3" style={{ borderColor: 'var(--soft-border)' }}>
          <button type="button" onClick={onCancel} className="btn-ghost">{t('cancel')}</button>
        </div>
      </div>
    </ModalLayer>
  )
}
