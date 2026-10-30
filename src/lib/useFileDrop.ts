import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useScreenActive } from './screenActivity'

export function useFileDrop(onFiles: (files: File[]) => void, disabled = false) {
  const active = useScreenActive()
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const reset = () => { depth.current = 0; setDragging(false) }
  useEffect(() => { if (!active) reset() }, [active])
  useEffect(() => {
    window.addEventListener('dragend', reset)
    return () => window.removeEventListener('dragend', reset)
  }, [])
  const accept = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  return { dragging, handlers: {
    onDragEnter: (event: DragEvent) => { if (accept(event) && !disabled) { depth.current++; setDragging(true) } },
    onDragOver: (event: DragEvent) => { if (accept(event)) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy' },
    onDragLeave: (event: DragEvent) => {
      if (depth.current > 0) { event.preventDefault(); event.stopPropagation(); if (--depth.current <= 0) reset() }
    },
    onDrop: (event: DragEvent) => {
      if (!accept(event)) return
      reset()
      if (!disabled) onFiles(Array.from(event.dataTransfer.files))
    }
  } }
}
