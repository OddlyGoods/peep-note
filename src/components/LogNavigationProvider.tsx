import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, type NavigateOptions } from 'react-router-dom'
import { api } from '../lib/api'
import { hasActiveSecretUnlock, rememberSecretUnlock } from '../lib/secretUnlock'
import { useI18n } from '../i18n'
import ConfirmModal from './ConfirmModal'
import SecretPasswordModal from './SecretPasswordModal'

type OpenLog = (id: string, basePath?: string, options?: NavigateOptions) => void
type PendingNavigation = {
  request: number
  path: string
  options?: NavigateOptions
  stage: 'loading' | 'unlock' | 'missing' | 'error'
  error?: string
}

const LogNavigationContext = createContext<OpenLog | null>(null)

export function useOpenLog() {
  const openLog = useContext(LogNavigationContext)
  if (!openLog) throw new Error('useOpenLog requires LogNavigationProvider')
  return openLog
}

export default function LogNavigationProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const [pending, setPending] = useState<PendingNavigation | null>(null)
  const requestRef = useRef(0)

  const cancel = useCallback(() => {
    requestRef.current += 1
    setPending(null)
  }, [])

  useEffect(() => {
    cancel()
    return () => { requestRef.current += 1 }
  }, [location.key, cancel])

  const openLog = useCallback<OpenLog>((id, basePath = '/log', options) => {
    const request = ++requestRef.current
    const target: PendingNavigation = { request, path: `${basePath}/${id}`, options, stage: 'loading' }
    setPending(target)
    void (async () => {
      try {
        const log = await api.logs.get(id)
        if (request !== requestRef.current) return
        if (!log.is_secret || hasActiveSecretUnlock()) {
          setPending(null)
          navigate(target.path, options)
          return
        }
        const status = await api.settings.secretPasswordStatus()
        if (request !== requestRef.current) return
        setPending({ ...target, stage: status.is_set ? 'unlock' : 'missing' })
      } catch (error) {
        if (request !== requestRef.current) return
        setPending({ ...target, stage: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    })()
  }, [navigate])

  return (
    <LogNavigationContext.Provider value={openLog}>
      {children}
      {pending?.stage === 'loading' && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-xl p-6" style={{ background: 'var(--modal-bg)' }}>
            <p className="text-sm text-gray-400" role="status">{t('loading')}</p>
            <button onClick={cancel} className="btn-ghost">{t('cancel')}</button>
          </div>
        </div>
      )}
      {pending?.stage === 'unlock' && (
        <SecretPasswordModal key={pending.request} mode="unlock" onCancel={cancel} onSuccess={() => {
          if (pending.request !== requestRef.current) return
          rememberSecretUnlock()
          cancel()
          navigate(pending.path, pending.options)
        }} />
      )}
      {pending?.stage === 'missing' && (
        <ConfirmModal title={t('secretPassword')} message={t('secretPasswordNotSet')} danger={false}
          confirmLabel={t('goToSettings')} onCancel={cancel}
          onConfirm={() => { cancel(); navigate('/settings') }} />
      )}
      {pending?.stage === 'error' && (
        <ConfirmModal title={t('confirm')} message={pending.error ?? ''} danger={false}
          confirmLabel={t('confirm')} onCancel={cancel} onConfirm={cancel} />
      )}
    </LogNavigationContext.Provider>
  )
}
