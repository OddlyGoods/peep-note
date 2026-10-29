import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, RotateCw, X } from 'lucide-react'
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
  const StatusIcon = busy ? Loader2 : status === 'up-to-date' ? CheckCircle2 : status === 'error' ? AlertCircle : Download

  return (
    <section className={banner ? 'shrink-0 border-b px-4 py-2' : 'mt-4 rounded-xl border p-4'}
      style={{ background: 'var(--side-panel-bg)', borderColor: 'var(--medium-border)', color: 'var(--title-text)' }}
      aria-label={t('updates')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3" aria-live="polite">
          {!banner && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-400"><StatusIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></span>}
          <div className="min-w-0 flex-1 text-xs">
            {!banner && <h3 className="mb-1.5 text-sm font-semibold">{t('updates')}</h3>}
            <p role={status === 'error' ? 'alert' : 'status'}>
              {t(statusKey[status], { version: version ?? '', percent: Math.floor(percent) })}
            </p>
            {state.platform === 'linux' && status !== 'unsupported' && (downloaded || canDownload) && <p className="mt-1 opacity-75">{t('updateAdmin')}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canInstall && <button type="button" className="btn-primary flex !h-9 !w-9 items-center justify-center !p-0" title={t('updateInstall')} aria-label={t('updateInstall')} onClick={() => void installUpdate()}><RotateCw className="h-4 w-4" /></button>}
          {canDownload && <button type="button" className="btn-primary flex !h-9 !w-9 items-center justify-center !p-0" title={t(status === 'error' ? 'retry' : 'updateDownload')} aria-label={t(status === 'error' ? 'retry' : 'updateDownload')} onClick={() => void downloadUpdate()}><Download className="h-4 w-4" /></button>}
          {!banner && status !== 'unsupported' && <button type="button" className="btn-secondary flex !h-9 !w-9 items-center justify-center !p-0" title={t('checkUpdates')} aria-label={t('checkUpdates')} disabled={busy || downloaded} onClick={() => void checkForUpdates()}><RefreshCw className={`h-4 w-4 ${status === 'checking' ? 'animate-spin' : ''}`} /></button>}
          {banner && status === 'available' && <button type="button" className="btn-ghost p-1" onClick={dismiss} title={t('updateLater')} aria-label={t('updateLater')}><X className="h-4 w-4" /></button>}
        </div>
      </div>
      {!banner && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-xs opacity-75" style={{ borderColor: 'var(--medium-border)' }}>
        <span>{t('version')}: {state.currentVersion}{version ? ` · ${t('latestVersion')}: ${version}` : ''}</span>
        {state.checkedAt && <span>{t('updateLastChecked')}: {new Date(state.checkedAt).toLocaleString(language)}</span>}
      </div>}
      {status === 'downloading' && <div role="progressbar" aria-label={t('updateDownload')} aria-valuenow={Math.floor(percent)} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-500/15"><div className="h-full bg-violet-500 transition-all" style={{ width: `${percent}%` }} /></div>}
      {!banner && status === 'error' && state.error && <details className="mt-2 text-xs"><summary className="cursor-pointer">{t('updateDetails')}</summary><p className="mt-1 break-words whitespace-pre-wrap opacity-75">{state.error}</p></details>}
    </section>
  )
}
