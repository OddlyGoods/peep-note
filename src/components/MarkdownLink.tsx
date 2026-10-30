import { useState, type ComponentPropsWithoutRef } from 'react'
import type { ExtraProps } from 'react-markdown'
import { externalWebUrl } from '../../shared/noteLinks'
import { useI18n } from '../i18n'

export default function MarkdownLink({ href, title, children }: ComponentPropsWithoutRef<'a'> & ExtraProps) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)
  const url = externalWebUrl(href)
  if (!url) return <span className="cursor-help underline decoration-dotted underline-offset-2"
    title={`${t('localPathLinkHint')}${href ? `\n${href}` : ''}`}>{children}</span>

  return <>
    <a href={url} title={title} target="_blank" rel="noopener noreferrer"
      onClick={event => {
        const openExternal = window.electronAPI?.openExternal
        if (!openExternal) return
        event.preventDefault()
        setFailed(false)
        void Promise.resolve().then(() => openExternal(url)).catch(() => setFailed(true))
      }}>{children}</a>
    {failed && <span role="status" className="ml-1 text-xs text-red-400">{t('openLinkFailed')}</span>}
  </>
}
