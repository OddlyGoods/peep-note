import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { INITIAL_MAP_CAMERA, projectMapNode, type KnowledgeGraph, type MapNode } from '../../shared/knowledgeMap'
import { useTheme } from '../theme'
import { useI18n } from '../i18n'
import { useScreenActive } from '../lib/screenActivity'

export function mapNodeColor(node: MapNode, dark: boolean) {
  const seed = [...(node.note?.workspaceId ?? '')].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0)
  return `hsl(${[224, 270, 190, 32, 330][seed % 5]} 78% ${dark ? 76 : 43}%)`
}

export default function KnowledgeMapCanvas({ graph, selected, onSelect }: {
  graph: KnowledgeGraph; selected: string | null; onSelect: (id: string | null) => void
}) {
  const { theme } = useTheme(), { t } = useI18n(), active = useScreenActive()
  const canvas = useRef<HTMLCanvasElement>(null), container = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState({ ...INITIAL_MAP_CAMERA })
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [hovered, setHovered] = useState<string | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; pan: boolean } | null>(null)
  const labelHits = useRef<{ id: string; x: number; y: number; width: number; height: number }[]>([])
  const dark = theme === 'dark'
  const extent = useMemo(() => Math.max(160, ...graph.nodes.map(node => Math.hypot(node.x, node.y, node.z))), [graph])
  const projected = useMemo(() => graph.nodes.map(node => ({ node, ...projectMapNode(node, camera, size.width, size.height, extent) })).sort((a, b) => b.z - a.z), [graph, camera, size, extent])
  const highlighted = useMemo(() => {
    const id = hovered ?? selected
    const ids = new Set<string>()
    if (!id) return ids
    ids.add(id)
    for (const edge of graph.edges) {
      if (edge.source === id) ids.add(edge.target)
      if (edge.target === id) ids.add(edge.source)
    }
    return ids
  }, [graph, selected, hovered])

  useEffect(() => {
    if (!active || !container.current) return
    const resize = () => {
      const { width, height } = container.current!.getBoundingClientRect()
      setSize({ width: Math.max(1, width), height: Math.max(1, height) })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container.current); resize()
    return () => observer.disconnect()
  }, [active])

  useEffect(() => {
    if (!active || !canvas.current) return
    const element = canvas.current, ctx = element.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    element.width = Math.round(size.width * dpr); element.height = Math.round(size.height * dpr)
    ctx.scale(dpr, dpr)
    const { width, height } = size
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = dark ? '#10152f' : '#e2e5f4'
    for (let x = 24; x < width; x += 32) for (let y = 24; y < height; y += 32) { ctx.beginPath(); ctx.arc(x, y, 0.7, 0, Math.PI * 2); ctx.fill() }
    const byId = new Map(projected.map(point => [point.node.id, point]))
    for (const edge of graph.edges) {
      const a = byId.get(edge.source)!, b = byId.get(edge.target)!
      const strong = highlighted.has(a.node.id) && highlighted.has(b.node.id)
      ctx.globalAlpha = highlighted.size ? strong ? 0.85 : 0.06 : 0.18 + edge.similarity * 0.25
      ctx.strokeStyle = dark ? '#a78bfa' : '#7c3aed'; ctx.lineWidth = strong ? 1.6 : 0.5 + edge.similarity
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    }
    const labels: { x: number; y: number; width: number; height: number }[] = []
    labelHits.current = []
    for (const point of projected) {
      const { node, x, y, depth } = point
      if (x < -40 || y < -40 || x > width + 40 || y > height + 40) continue
      const focused = node.id === selected || node.id === hovered
      const related = highlighted.has(node.id)
      const color = mapNodeColor(node, dark)
      const radius = 6 * Math.min(1.5, depth) + (focused ? 2 : 0)
      ctx.globalAlpha = highlighted.size && !related ? 0.35 : Math.max(0.5, Math.min(1, depth))
      if (focused) { ctx.beginPath(); ctx.arc(x, y, radius + 6, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke() }
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill()
    }
    // Keep the selected note and its closest neighbours readable.
    const labelPriority = (node: MapNode) => node.id === selected || node.id === hovered ? 0 : highlighted.has(node.id) ? 1 : 2
    for (const { node, x, y, depth } of [...projected].sort((a, b) => labelPriority(a.node) - labelPriority(b.node))) {
      if (x < -40 || y < -40 || x > width + 40 || y > height + 40) continue
      const focused = node.id === selected || node.id === hovered, related = highlighted.has(node.id)
      const color = mapNodeColor(node, dark)
      const radius = 6 * Math.min(1.5, depth) + (focused ? 2 : 0)
      if (!focused && labels.length >= 60) continue
      const raw = node.label || t('mapUntitled')
      const label = raw.length > 28 ? raw.slice(0, 27) + '…' : raw
      ctx.font = `${focused ? 600 : 400} 12px sans-serif`
      const labelWidth = ctx.measureText(label).width + 12
      const lx = Math.min(width - labelWidth - 6, Math.max(6, x - labelWidth / 2)), ly = y + radius + 6
      if (!focused && labels.some(rect => lx < rect.x + rect.width && lx + labelWidth > rect.x && ly < rect.y + rect.height && ly + 22 > rect.y)) continue
      labels.push({ x: lx, y: ly, width: labelWidth, height: 22 })
      labelHits.current.push({ id: node.id, x: lx, y: ly, width: labelWidth, height: 22 })
      ctx.globalAlpha = highlighted.size && !related ? 0.5 : 1
      ctx.fillStyle = dark ? '#10152f' : '#ffffff'; ctx.beginPath(); ctx.roundRect(lx, ly, labelWidth, 22, 5); ctx.fill()
      ctx.fillStyle = focused ? color : dark ? '#d2d8ee' : '#475569'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, lx + 6, ly + 11)
    }
    ctx.globalAlpha = 1
  }, [graph, projected, size, dark, active, selected, hovered, highlighted, t])

  const hit = (x: number, y: number) => {
    let best: string | null = null, distance = 18
    // Frontmost wins for coincident points; otherwise choose the nearest.
    for (const point of [...projected].reverse()) {
      const d = Math.hypot(point.x - x, point.y - y)
      if (d < distance) { distance = d; best = point.node.id }
    }
    if (best) return best
    return [...labelHits.current].reverse().find(rect => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height)?.id ?? null
  }
  const zoom = (factor: number) => setCamera(value => ({ ...value, zoom: Math.min(4, Math.max(0.35, value.zoom * factor)) }))
  const reset = () => { setCamera({ ...INITIAL_MAP_CAMERA }); setHovered(null) }
  const hoverNode = graph.nodes.find(node => node.id === hovered)
  useEffect(() => {
    const element = canvas.current
    if (!active || !element) return
    // React's delegated wheel listener is passive; bind directly so zooming
    // the graph cannot also scroll its surrounding screen.
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002)) }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [active])
  return <div className="knowledge-canvas-wrap" ref={container}>
    <canvas ref={canvas} tabIndex={0} role="img" aria-label={`${t('knowledgeMap')}. ${t('mapHint')}. ${t('mapKeyboard')}`} data-testid="knowledge-canvas"
      style={{ cursor: drag.current ? 'grabbing' : hovered ? 'pointer' : 'grab', touchAction: 'none' }}
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (event.button !== 0 && event.button !== 2) return
        event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, pan: event.shiftKey || event.button === 2 }
      }}
      onPointerMove={event => {
        const previous = drag.current
        if (previous?.id === event.pointerId) {
          const dx = event.clientX - previous.x, dy = event.clientY - previous.y
          if (!previous.moved && Math.hypot(dx, dy) < 4) return
          previous.moved = true; previous.x = event.clientX; previous.y = event.clientY
          setHovered(null)
          setCamera(value => previous.pan ? { ...value, panX: value.panX + dx, panY: value.panY + dy } : { ...value, yaw: value.yaw - dx * 0.007, pitch: Math.max(-1.4, Math.min(1.4, value.pitch + dy * 0.007)) })
        } else { const rect = event.currentTarget.getBoundingClientRect(); setHovered(hit(event.clientX - rect.left, event.clientY - rect.top)) }
      }}
      onPointerUp={event => {
        const previous = drag.current
        if (!previous || previous.id !== event.pointerId) return
        drag.current = null
        if (!previous.moved && event.button === 0) { const rect = event.currentTarget.getBoundingClientRect(); onSelect(hit(event.clientX - rect.left, event.clientY - rect.top)) }
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onPointerLeave={() => setHovered(null)}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return
        event.preventDefault()
        if (event.key === 'Home') reset()
        else if (event.key === '+' || event.key === '=') zoom(1.2)
        else if (event.key === '-') zoom(1 / 1.2)
        else setCamera(value => ({ ...value, yaw: value.yaw + (event.key === 'ArrowLeft' ? 0.12 : event.key === 'ArrowRight' ? -0.12 : 0), pitch: Math.max(-1.4, Math.min(1.4, value.pitch + (event.key === 'ArrowUp' ? -0.12 : event.key === 'ArrowDown' ? 0.12 : 0))) }))
      }} />
    <div className="knowledge-view-controls">
      <button type="button" onClick={() => zoom(1.2)} title={t('mapZoomIn')} aria-label={t('mapZoomIn')}><Plus size={15} /></button>
      <button type="button" onClick={() => zoom(1 / 1.2)} title={t('mapZoomOut')} aria-label={t('mapZoomOut')}><Minus size={15} /></button>
      <button type="button" onClick={reset} title={t('mapReset')} aria-label={t('mapReset')}><RotateCcw size={14} /></button>
    </div>
    <div className="knowledge-gesture-hint">{t('mapHint')}</div>
    {hoverNode && <div className="knowledge-hover" role="status">{hoverNode.label || t('mapUntitled')}</div>}
  </div>
}
