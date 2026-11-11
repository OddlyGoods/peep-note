import { useLayoutEffect, useRef, useState } from 'react'
import { useScreenActive } from './screenActivity'

// Keep controls outside a scrolling list aligned with its content, including
// theme-dependent scrollbar widths and overlay scrollbars that use no space.
export function useScrollGutter(reserve = false) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollbarWidth, setScrollbarWidth] = useState(0)
  const active = useScreenActive()
  useLayoutEffect(() => {
    if (!active) return
    // Screens without a scrolling list can reserve the same native gutter.
    const container = reserve ? document.createElement('div') : scrollRef.current
    if (!container) return
    if (reserve) {
      container.className = 'dashboard-scroll-area'
      container.style.cssText = 'position:fixed;left:-10000px;top:0;width:100px;height:100px;overflow-y:scroll;visibility:hidden;pointer-events:none'
      document.body.appendChild(container)
    }
    const measure = () => setScrollbarWidth(Math.max(0, container.offsetWidth - container.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => { observer.disconnect(); if (reserve) container.remove() }
  }, [active, reserve])
  return { scrollRef, scrollbarWidth }
}
