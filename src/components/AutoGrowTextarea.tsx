import { useLayoutEffect, useRef, type RefObject, type TextareaHTMLAttributes } from 'react'
import { useScreenActive } from '../lib/screenActivity'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { maxHeight?: number; extraLine?: boolean; inputRef?: RefObject<HTMLTextAreaElement> }

export default function AutoGrowTextarea({ value, className, style, maxHeight = 700, extraLine = true, inputRef, ...props }: Props) {
  const ownInput = useRef<HTMLTextAreaElement>(null)
  const input = inputRef ?? ownInput
  const active = useScreenActive()

  useLayoutEffect(() => {
    const element = input.current
    if (!active || !element) return
    let width = element.getBoundingClientRect().width
    const resize = () => {
      if (!element.isConnected || !element.getClientRects().length) return
      const scrollTop = element.scrollTop
      element.style.overflowY = 'hidden'
      // Restore the CSS padding before measuring, so the spare line does not accumulate.
      element.style.paddingBottom = typeof style?.paddingBottom === 'number' ? `${style.paddingBottom}px` : style?.paddingBottom ?? ''
      const computed = getComputedStyle(element)
      if (extraLine) {
        const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.5
        element.style.paddingBottom = `${parseFloat(computed.paddingBottom) + lineHeight}px`
      }
      element.style.height = '0px'
      const height = element.scrollHeight + parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth)
      element.style.height = `${Math.min(maxHeight, Math.ceil(height))}px`
      element.style.overflowY = height > maxHeight ? 'auto' : 'hidden'
      const caretAtEnd = document.activeElement === element && element.selectionEnd === element.value.length
      element.scrollTop = height > maxHeight ? (caretAtEnd ? element.scrollHeight : scrollTop) : 0
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
  }, [value, className, maxHeight, extraLine, active, input, style?.paddingBottom])

  return <textarea {...props} ref={input} value={value} rows={1} className={className}
    style={{ ...style, maxHeight, resize: 'none' }} />
}
