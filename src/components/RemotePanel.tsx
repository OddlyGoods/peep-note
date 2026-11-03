import { useState } from 'react'
import { Check, Copy, ExternalLink, Monitor, Plug } from 'lucide-react'
import { useI18n } from '../i18n'
import { REMOTE_PROVIDERS, remoteConnections, remoteMessages, type RemoteProvider } from '../remoteGuides'

const providerStorageKey = 'openpeepnote_remote_provider'

function initialProvider(): RemoteProvider {
  try {
    const saved = localStorage.getItem(providerStorageKey)
    const provider = REMOTE_PROVIDERS.find(option => option.id === saved)
    if (provider) return provider.id
  } catch {}
  return 'openai'
}

export default function RemotePanel({ onOpenMcp }: { onOpenMcp: () => void }) {
  const { language, t } = useI18n()
  const text = remoteMessages[language]
  const [provider, setProvider] = useState<RemoteProvider>(initialProvider)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const connection = remoteConnections[provider]
  const guide = text.guides[provider]

  async function copyCommand() {
    if (!connection.command) return
    try {
      await navigator.clipboard.writeText(connection.command)
      setCopyStatus('copied')
    } catch { setCopyStatus('error') }
  }

  return <section className="card p-5" aria-labelledby="remote-panel-title">
    <h2 id="remote-panel-title" className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-200">
      <Monitor className="h-4 w-4 text-violet-400" aria-hidden="true" />{t('remote')}
    </h2>
    <p className="text-xs leading-relaxed text-gray-400">{text.description}</p>
    <div className="mt-4 rounded-lg border p-3" style={{ background: 'var(--side-panel-bg)', borderColor: 'var(--soft-border)' }}>
      <p className="text-xs leading-relaxed text-gray-400">{text.prerequisite}</p>
      <button type="button" onClick={onOpenMcp} className="btn-secondary mt-3 flex items-center gap-1.5 text-xs">
        <Plug className="h-3.5 w-3.5" aria-hidden="true" />{text.mcpSettings}
      </button>
    </div>
    <p id="remote-provider-label" className="mb-2 mt-5 text-xs text-gray-400">{text.provider}</p>
    <div role="group" aria-labelledby="remote-provider-label" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {REMOTE_PROVIDERS.map(option => <button key={option.id} type="button" aria-pressed={provider === option.id}
        data-active={provider === option.id}
        onClick={() => {
          setProvider(option.id); setCopyStatus('idle')
          try { localStorage.setItem(providerStorageKey, option.id) } catch {}
        }}
        className={`settings-provider-button rounded-lg border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 ${provider === option.id ? 'border-violet-500/40 bg-violet-600/20 text-violet-300' : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'}`}>
        {option.label}
      </button>)}
    </div>
    <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--soft-border)' }}>
      <h3 className="text-sm font-medium text-gray-200">{connection.title}</h3>
      <ol className="mt-3 list-decimal space-y-2.5 pl-5 text-xs leading-relaxed text-gray-300">
        {guide.steps.map(step => <li key={step} className="pl-1">{step}</li>)}
      </ol>
      {connection.command && <div className="input mt-4 flex items-center justify-between gap-3 px-3 py-2">
        <code className="min-w-0 break-all font-mono text-xs" style={{ color: 'var(--title-text)' }}>{connection.command}</code>
        <button type="button" onClick={copyCommand} className="btn-ghost flex shrink-0 items-center gap-1.5 px-2 py-1 text-xs">
          {copyStatus === 'copied' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {t(copyStatus === 'copied' ? 'copied' : 'copy')}
        </button>
      </div>}
      {copyStatus === 'error' && <p role="alert" className="mt-2 text-xs text-red-400">{t('copyFailed')}</p>}
      <p className="mt-4 text-xs leading-relaxed text-gray-400">{guide.note}</p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {[{ url: connection.docs, label: text.documentation }, ...(connection.mcpDocs ? [{ url: connection.mcpDocs, label: text.mcpDocumentation }] : [])].map(({ url, label }) =>
          <a key={url} href={url} target="_blank" rel="noopener noreferrer"
            onClick={event => {
              if (window.electronAPI?.openExternal) { event.preventDefault(); void window.electronAPI.openExternal(url) }
            }}
            className="flex items-center gap-1.5 text-xs text-violet-400 transition-colors hover:text-violet-300 hover:underline">
            {label}<ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>)}
      </div>
    </div>
  </section>
}
