import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useScreenActive } from '../lib/screenActivity'

export default function ModalLayer({ children, onClose, className = '', container, topInset = 40 }: {
  children: ReactNode
  onClose: () => void
  className?: string
  container?: HTMLElement | null
  topInset?: number
}) {
  const active = useScreenActive()
  if (!active) return null
  return createPortal(
    <div className={`modal-layer ${container ? 'absolute inset-0' : 'fixed inset-x-0 bottom-0'} flex items-center justify-center ${className}`}
      style={{ zIndex: 100, ...(!container ? { top: topInset } : {}) }} onClick={event => event.stopPropagation()}>
      <div className="modal-backdrop absolute inset-0" style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(1px)' }} onClick={onClose} />
      {children}
    </div>, container ?? document.body
  )
}
