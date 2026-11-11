import type { MapNote } from '../../shared/knowledgeMap'
import { mapThumbnailKey, useMapThumbnails } from '../lib/useMapThumbnails'
import { useScreenActive } from '../lib/screenActivity'
import { useI18n } from '../i18n'

export default function MapNoteThumbnail({ note, onOpen, className = '' }: { note: MapNote; onOpen: () => void; className?: string }) {
  const { t } = useI18n()
  const images = useMapThumbnails([note], useScreenActive())
  const image = images.get(mapThumbnailKey(note))
  return image ? <button type="button" className={`knowledge-thumbnail-button ${className}`} aria-label={t('enlarge')} title={t('enlarge')}
    onClick={event => { event.stopPropagation(); onOpen() }}><img className="knowledge-note-thumbnail" src={image.src} alt="" draggable={false} /></button> : null
}
