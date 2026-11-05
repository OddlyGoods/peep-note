import { useState } from 'react'
import { Play } from 'lucide-react'
import { useI18n } from '../i18n'

export default function VideoPreview({ src, filePath, theme, className = '' }: {
  src: string; filePath: string | null; theme: 'light' | 'dark'; className?: string
}) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)
  const open = async () => {
    if (!filePath) return
    setFailed(false)
    try { if (!await window.electronAPI?.openVideoViewer(filePath, theme)) setFailed(true) }
    catch { setFailed(true) }
  }
  return <button type="button" aria-label={t('playVideo')} title={t('playVideo')} disabled={!filePath} onClick={() => void open()}
    className={`relative block overflow-hidden cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 ${className}`}>
    <video src={src} muted playsInline preload="metadata" className="h-full w-full object-contain bg-black/20" />
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white"><Play className="h-5 w-5" fill="currentColor" /></span>
    </span>
    {failed && <span role="alert" className="absolute inset-x-2 bottom-2 rounded bg-black/75 px-2 py-1 text-xs text-white">{t('videoPlaybackFailed')}</span>}
  </button>
}
