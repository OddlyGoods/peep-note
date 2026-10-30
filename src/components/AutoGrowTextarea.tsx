import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'
import { useScreenActive } from '../lib/screenActivity'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { maxHeight?: number }

export default function AutoGrowTextarea({ value, className, style, maxHeight = 700, ...props }: Props) {
  const input = useRef<HTMLTextAreaElement>(null)
  const active = useScreenActive()

  useLayoutEffect(() => {
    const element = input.current
    if (!active || !element) return
    let width = element.getBoundingClientRect().width
    const resize = () => {
      if (!element.isConnected || !element.getClientRects().length) return
      const scrollTop = element.scrollTop
      element.style.overflowY = 'hidden'
      element.style.height = '0px'
      const computed = getComputedStyle(element)
      const height = element.scrollHeight + parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth)
      element.style.height = `${Math.min(maxHeight, Math.ceil(height))}px`
      element.style.overflowY = height > maxHeight ? 'auto' : 'hidden'
      element.scrollTop = height > maxHeight ? scrollTop : 0
    }
    resize()
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width
      if (Math.abs(nextWidth - width) < 0.5) return
      width = nextWidth
      resize()
    })
    observer.observe(element)
    let cancelled = false
    void document.fonts.ready.then(() => { if (!cancelled) resize() })
    return () => { cancelled = true; observer.disconnect() }
  }, [value, className, maxHeight, active])

  return <textarea {...props} ref={input} value={value} rows={1} className={className}
    style={{ ...style, maxHeight, paddingBottom: 'calc(1lh + 0.5rem)', resize: 'none' }} />
}
