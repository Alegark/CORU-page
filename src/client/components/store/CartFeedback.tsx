import { useEffect, useRef, useState } from 'react'
import { Icon, icons } from '../ui/Icon'

export const CART_ADDED_EVENT = 'coru:cart-added'
export const CART_OPENED_EVENT = 'coru:cart-opened'

export function announceCartAdded(productName: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CART_ADDED_EVENT, { detail: { productName } }))
}

export function announceCartOpened(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CART_OPENED_EVENT))
}

type CartToastState = {
  productName: string
  sequence: number
}

export function CartToastHost() {
  const [toast, setToast] = useState<CartToastState | null>(null)
  const sequence = useRef(0)

  useEffect(() => {
    const handleCartAdded = (event: Event) => {
      const productName = (event as CustomEvent<{ productName?: unknown }>).detail?.productName
      if (typeof productName !== 'string' || !productName.trim()) return
      sequence.current += 1
      setToast({ productName: productName.trim(), sequence: sequence.current })
    }

    window.addEventListener(CART_ADDED_EVENT, handleCartAdded)
    const handleCartOpened = () => setToast(null)
    window.addEventListener(CART_OPENED_EVENT, handleCartOpened)
    return () => {
      window.removeEventListener(CART_ADDED_EVENT, handleCartAdded)
      window.removeEventListener(CART_OPENED_EVENT, handleCartOpened)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (!toast) return null

  return (
    <div className="cart-toast" aria-live="polite" aria-atomic="true" key={toast.sequence}>
      <span className="cart-toast-icon" aria-hidden="true"><Icon icon={icons.check} /></span>
      <span className="cart-toast-copy"><strong>Agregado al carrito</strong><span>{toast.productName}</span></span>
    </div>
  )
}
