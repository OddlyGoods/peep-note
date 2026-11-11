import { useEffect, useRef, useState } from 'react'
import type { MapNote } from '../../shared/knowledgeMap'
import { api } from './api'

export const mapThumbnailKey = (note: MapNote) => `${note.id}:${note.imageVersion ?? ''}`

export function useMapThumbnails(notes: MapNote[], active: boolean) {
  const cache = useRef(new Map<string, HTMLImageElement | null>())
  const [images, setImages] = useState(new Map<string, HTMLImageElement | null>())
  const key = JSON.stringify(notes.filter(note => note.imageVersion).map(note => [note.id, note.imageVersion]).sort())
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const items = JSON.parse(key) as [string, string][]
    let next = 0
    const load = async () => {
      while (next < items.length && !controller.signal.aborted) {
        const [id, version] = items[next++], cacheKey = `${id}:${version}`
        if (cache.current.has(cacheKey)) continue
        try {
          const { image } = await api.mapThumbnail(id, version, controller.signal)
          if (controller.signal.aborted) return
          const element = new Image()
          element.src = image
          await element.decode()
          if (controller.signal.aborted) return
          cache.current.set(cacheKey, element)
        } catch {
          if (controller.signal.aborted) return
          cache.current.set(cacheKey, null)
        }
        if (cache.current.size > 128) cache.current.delete(cache.current.keys().next().value!)
        setImages(new Map(cache.current))
      }
    }
    for (let i = 0; i < 4; i++) void load()
    return () => controller.abort()
  }, [key, active])
  return images
}
