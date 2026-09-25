import { useEffect, useRef, useState } from 'react'
import { Icon, icons } from '../ui/Icon'

export function FloatingCart({ itemCount, open, onCart }: { itemCount: number; open: boolean; onCart: () => void }) {
  const previousCount = useRef(itemCount)
  const [receiving, setReceiving] = useState(false)

  useEffect(() => {
    let timer: number | undefined
    if (itemCount > previousCount.current) {
      setReceiving(true)
      timer = window.setTimeout(() => setReceiving(false), 180)
    } else if (itemCount <= previousCount.current) {
      setReceiving(false)
    }
    previousCount.current = itemCount
    return () => { if (timer !== undefined) window.clearTimeout(timer) }
  }, [itemCount])

  if (open) return null

  const visibleCount = itemCount > 99 ? '99+' : String(itemCount)
  const label = itemCount > 0 ? `Abrir carrito, ${itemCount} ${itemCount === 1 ? 'producto' : 'productos'}` : 'Abrir carrito vacío'

  return (
    <button className={`floating-cart${receiving ? ' is-receiving' : ''}`} type="button" onClick={onCart} aria-label={label} title="Abrir carrito">
      <Icon icon={icons.bag} aria-hidden="true" />
      {itemCount > 0 && <span className="t-badge" data-open="true" aria-hidden="true"><span className="floating-cart-count">{visibleCount}</span></span>}
    </button>
  )
}
