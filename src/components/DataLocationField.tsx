import { FolderOpen, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { formatBytes } from '../../shared/attachments'

export default function DataLocationField({ directory, usage, usageError, changing, disabled, onChoose }: {
  directory: string
  usage: { bytes: number; partial: boolean } | null
  usageError: boolean
  changing: boolean
  disabled: boolean
  onChoose: () => void
}) {
  const { t } = useI18n()
  return <>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <label htmlFor="data-location-path" className="text-gray-400">{t('dataLocation')}</label>
      <span className="flex items-center gap-1.5 text-xs text-gray-400" aria-live="polite"
        title={usage?.partial ? t('dataUsagePartial') : undefined}>
        <span>{t('dataUsage')}:</span>
        {usage ? <span>{formatBytes(usage.bytes)}{usage.partial ? ' *' : ''}</span>
          : usageError ? <span>{t('dataUsageUnavailable')}</span>
          : <Loader2 className="h-3 w-3 animate-spin" aria-label={t('loading')} />}
      </span>
    </div>
    <div className="relative">
      <input id="data-location-path" readOnly value={directory || ''} title={directory}
        className="input w-full py-2.5 pr-11 font-mono text-xs" />
      <button type="button" onClick={onChoose} disabled={disabled || changing}
        title={t(changing ? 'dataLocationRestarting' : 'changeDataLocation')}
        aria-label={t(changing ? 'dataLocationRestarting' : 'changeDataLocation')}
        className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-violet-500/15 hover:text-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-50 disabled:cursor-not-allowed">
        {changing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
      </button>
    </div>
  </>
}
