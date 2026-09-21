import { useEffect, useId, useRef, useState } from 'react'
import type { PersonalDeliveryPoint } from '../../../shared/types'

function compactAddress(address: string): string {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  return parts.slice(0, 2).join(' · ')
}

export function PersonalDeliveryPointList({ points, selectedId, onSelect }: { points: PersonalDeliveryPoint[]; selectedId?: string; onSelect: (point: PersonalDeliveryPoint) => void }) {
  const [open, setOpen] = useState(false)
  const listboxId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = points.find((point) => point.id === selectedId) ?? points[0]

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return <div ref={containerRef} className={`shipping-point-select-field${open ? ' is-open' : ''}`}>
    <span className="shipping-point-select-label">Punto de entrega personal</span>
    <button type="button" role="combobox" className={`shipping-point-trigger${open ? ' is-open' : ''}`} aria-label="Punto de entrega personal" aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} onClick={() => setOpen((current) => !current)}>
      <span className="shipping-point-trigger-copy"><strong>{selected?.name ?? 'Selecciona un punto'}</strong>{selected && <small>{compactAddress(selected.address)}</small>}</span>
      <span className="shipping-point-trigger-chevron" aria-hidden="true" />
    </button>
    {open && <div className="shipping-point-options" id={listboxId} role="listbox" aria-label="Puntos de entrega personales">
      {points.map((point) => <button key={point.id} type="button" role="option" aria-selected={point.id === selectedId} className={`shipping-point-option${point.id === selectedId ? ' is-selected' : ''}`} onClick={() => { onSelect(point); setOpen(false) }}>
        <span className="shipping-point-option-copy"><strong>{point.name}</strong><small>{compactAddress(point.address)}</small></span>
        <span className="shipping-point-option-check" aria-hidden="true">{point.id === selectedId ? '✓' : ''}</span>
      </button>)}
    </div>}
  </div>
}
