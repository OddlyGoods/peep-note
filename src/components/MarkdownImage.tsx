import { useEffect, useState, type ComponentPropsWithoutRef } from 'react'
import { ImageOff } from 'lucide-react'
import { defaultUrlTransform, type ExtraProps, type UrlTransform } from 'react-markdown'
import { localMarkdownImagePath, markdownImageSource } from '../../shared/markdownImages'
import { useI18n } from '../i18n'
import { useTheme } from '../theme'

// Keep ReactMarkdown's protocol filtering for links. Only images can carry a
// local path through to the dedicated, raster-only Electron reader.
export const markdownUrlTransform: UrlTransform = (url, key, node) =>
  key === 'src' && node.tagName === 'img' ? markdownImageSource(url) ?? '' : defaultUrlTransform(url)

export default function MarkdownImage({ src, alt, title }: ComponentPropsWithoutRef<'img'> & ExtraProps) {
  const { t } = useI18n()
  const { theme } = useTheme()
  const [loaded, setLoaded] = useState<{ source: string; url: string | null } | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const [openFailed, setOpenFailed] = useState(false)
  const source = markdownImageSource(src)
  const local = localMarkdownImagePath(source)
  const url = local ? loaded?.source === source ? loaded.url : undefined : source

  useEffect(() => {
    setFailedSource(null)
    setOpenFailed(false)
    if (!local || !source) return
    let active = true
    void Promise.resolve().then(() => window.electronAPI?.readMarkdownImage?.(source) ?? null)
      .catch(() => null).then(url => { if (active) setLoaded({ source, url }) })
    return () => { active = false }
  }, [source, local])

  if (url === undefined) return <span role="status" className="text-xs text-gray-400">{alt || t('loading')}</span>
  if (!url || failedSource === source) return (
    <span role="status" title={src} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-500/20 px-3 py-2 text-xs text-gray-400">
      <ImageOff className="h-4 w-4 shrink-0" />
      <span>{alt ? `${alt} — ` : ''}{t('imageLoadFailed')}</span>
    </span>
  )
  const openImage = () => {
    setOpenFailed(false)
    void Promise.resolve().then(() => window.electronAPI?.openMarkdownImageViewer?.(source!, alt ?? '', theme) ?? false)
      .then(opened => { if (!opened) setOpenFailed(true) }).catch(() => setOpenFailed(true))
  }
  return <>
    <img src={url} alt={alt ?? ''} title={title} referrerPolicy="no-referrer"
      role="button" tabIndex={0} aria-label={alt ? `${t('enlarge')}: ${alt}` : t('enlarge')}
      className="my-3 block h-auto max-w-full cursor-pointer rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
      onClick={event => { event.preventDefault(); event.stopPropagation(); openImage() }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openImage() }
      }}
      onError={() => setFailedSource(source)} />
    {openFailed && <span role="status" className="text-xs text-red-400">{t('operationFailed')}</span>}
  </>
}
