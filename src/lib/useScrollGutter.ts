import { useLayoutEffect, useRef, useState } from 'react'
import { useScreenActive } from './screenActivity'

// Keep controls outside a scrolling list aligned with its content, including
// theme-dependent scrollbar widths and overlay scrollbars that use no space.
export function useScrollGutter() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollbarWidth, setScrollbarWidth] = useState(0)
  const active = useScreenActive()
  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!active || !container) return
    const measure = () => setScrollbarWidth(Math.max(0, container.offsetWidth - container.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [active])
  return { scrollRef, scrollbarWidth }
}
