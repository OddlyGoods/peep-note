import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, type Location } from 'react-router-dom'
import { screenForPath, type ScreenKey } from '../lib/menuMemory'
import { ScreenActivity } from '../lib/screenActivity'
import { useMenuMemoryStore } from '../stores/menuMemoryStore'

type Screen = { key: ScreenKey; path: string; element: ReactNode }
type ScrollPosition = { identity: string; top: number; left: number }

function CachedScreen({ active, children }: { active: boolean; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, ScrollPosition>())
  const restoring = useRef(false)
  const targets = () => Array.from(container.current?.querySelectorAll<HTMLElement>('[data-screen-scroll], textarea') ?? [])
  const name = (element: HTMLElement, index: number) => element.dataset.screenScroll ?? `textarea-${index}`
  const save = () => {
    if (restoring.current || !container.current?.getClientRects().length) return
    targets().forEach((element, index) => {
      if (element.closest('[aria-busy="true"]')) return
      positions.current.set(name(element, index), { identity: element.dataset.screenScrollKey ?? '', top: element.scrollTop, left: element.scrollLeft })
    })
  }

  useLayoutEffect(() => {
    if (!container.current) return
    container.current.inert = !active
    if (!active) {
      container.current.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => media.pause())
      return
    }
    restoring.current = positions.current.size > 0
    let frame = 0
    const restore = () => {
      if (!restoring.current) return
      let waiting = false
      const elements = targets()
      if (!elements.length) return
      elements.forEach((element, index) => {
        const saved = positions.current.get(name(element, index))
        if (!saved) return
        if (saved.identity !== (element.dataset.screenScrollKey ?? '')) return
        if (element.dataset.screenScrollRestore === 'skip') return
        if (element.closest('[aria-busy="true"]')) { waiting = true; return }
        element.scrollTop = saved.top
        element.scrollLeft = saved.left
      })
      if (!waiting) restoring.current = false
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore) }
    const observer = new MutationObserver(schedule)
    observer.observe(container.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'data-screen-scroll-key'] })
    schedule()
    return () => { save(); observer.disconnect(); cancelAnimationFrame(frame) }
  }, [active])

  return <div ref={container} className="absolute inset-0 min-w-0 overflow-hidden" style={{ display: active ? 'block' : 'none' }}
    aria-hidden={!active || undefined}
    onScrollCapture={() => { if (active) save() }}
    onWheelCapture={event => { if ((event.target as Element).closest('[data-screen-scroll],textarea')) restoring.current = false }}
    onPointerDownCapture={event => { if ((event.target as Element).closest('[data-screen-scroll],textarea')) restoring.current = false }}>
    <ScreenActivity.Provider value={active}>{children}</ScreenActivity.Provider>
  </div>
}

export default function ScreenCache({ screens }: { screens: Screen[] }) {
  const location = useLocation()
  const active = screenForPath(location.pathname)
  const locations = useRef(new Map<ScreenKey, Location>())
  useLayoutEffect(() => {
    if (!active) return
    locations.current.set(active, location)
    useMenuMemoryStore.getState().remember(location)
  }, [location, active])

  return <div className="relative h-full min-w-0">
    {screens.map(screen => {
      const saved = screen.key === active ? location : locations.current.get(screen.key)
      if (!saved) return null
      return <CachedScreen key={screen.key} active={screen.key === active}>
        <Routes location={saved}><Route path={screen.path} element={screen.element} /></Routes>
      </CachedScreen>
    })}
    {!active && <Navigate to="/" replace />}
  </div>
}
