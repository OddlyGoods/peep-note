import { Download, Loader2, RefreshCw, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { checkForUpdates, downloadUpdate, installUpdate, useUpdateStore } from '../stores/updateStore'
import type { UpdateState } from '../../shared/updates'

export default function UpdatePanel({ banner = false }: { banner?: boolean }) {
  const { state, dismissedVersion, dismiss } = useUpdateStore()
  return <UpdatePanelView state={state} banner={banner} dismissedVersion={dismissedVersion} dismiss={dismiss} />
}

export function UpdatePanelView({ state, banner = false, dismissedVersion = null, dismiss = () => {} }: {
  state: UpdateState | null; banner?: boolean; dismissedVersion?: string | null; dismiss?: () => void
}) {
  const { t, language } = useI18n()
  if (!state) return null
  const { status, version, percent, downloaded } = state
  if (banner && (!version || ['idle', 'checking', 'up-to-date', 'unsupported'].includes(status)
    || (status === 'available' && dismissedVersion === version))) return null
  const busy = ['checking', 'downloading', 'installing'].includes(status)
  const statusKey = {
    idle: 'updates', checking: 'updateChecking', 'up-to-date': 'updateCurrent',
    available: 'updateAvailable', downloading: 'updateDownloading', downloaded: 'updateReady',
    installing: 'updateInstalling', error: 'updateFailed', unsupported: 'updateUnsupported'
  } as const
  const canInstall = downloaded && !busy
  const canDownload = !!version && !downloaded && !busy && status !== 'unsupported'

  return (
    <section className={banner ? 'shrink-0 border-b px-4 py-2' : 'mt-4 rounded-lg border p-3'}
      style={{ background: 'var(--side-panel-bg)', borderColor: 'var(--medium-border)', color: 'var(--title-text)' }}
      aria-label={t('updates')}>
      {!banner && <h3 className="mb-2 text-sm font-semibold">{t('updates')}</h3>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-xs" aria-live="polite">
          <p className="flex items-center gap-2" role={status === 'error' ? 'alert' : 'status'}>
            {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Download className="h-3.5 w-3.5 shrink-0" />}
            <span>{t(statusKey[status], { version: version ?? '', percent: Math.floor(percent) })}</span>
          </p>
          {!banner && <p className="mt-2 opacity-75">{t('version')}: {state.currentVersion}{version ? ` · ${t('latestVersion')}: ${version}` : ''}</p>}
          {!banner && state.checkedAt && <p className="mt-1 opacity-75">{t('updateLastChecked')}: {new Date(state.checkedAt).toLocaleString(language)}</p>}
          {state.platform === 'linux' && status !== 'unsupported' && (downloaded || canDownload) && <p className="mt-1 opacity-75">{t('updateAdmin')}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canInstall && <button type="button" className="btn-primary text-xs" onClick={() => void installUpdate()}>{t('updateInstall')}</button>}
          {canDownload && <button type="button" className="btn-primary text-xs" onClick={() => void downloadUpdate()}>{t(status === 'error' ? 'retry' : 'updateDownload')}</button>}
          {!banner && status !== 'unsupported' && <button type="button" className="btn-secondary flex items-center gap-1.5 text-xs" disabled={busy || downloaded} onClick={() => void checkForUpdates()}><RefreshCw className={`h-3.5 w-3.5 ${status === 'checking' ? 'animate-spin' : ''}`} />{t('checkUpdates')}</button>}
          {banner && status === 'available' && <button type="button" className="btn-ghost p-1" onClick={dismiss} title={t('updateLater')} aria-label={t('updateLater')}><X className="h-4 w-4" /></button>}
        </div>
      </div>
      {status === 'downloading' && <div role="progressbar" aria-label={t('updateDownload')} aria-valuenow={Math.floor(percent)} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-500/15"><div className="h-full bg-violet-500 transition-all" style={{ width: `${percent}%` }} /></div>}
      {!banner && status === 'error' && state.error && <details className="mt-2 text-xs"><summary className="cursor-pointer">{t('updateDetails')}</summary><p className="mt-1 break-words whitespace-pre-wrap opacity-75">{state.error}</p></details>}
    </section>
  )
}
