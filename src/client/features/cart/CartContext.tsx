import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadCart, loadCurrency, saveCart, saveCurrency } from '../../../shared/storage'
import type { CartLine, Currency, Product } from '../../../shared/types'
import { ApiClientError, fetchExchangeRate } from '../../api/public'
import { demoProducts } from '../../../shared/catalog'
import type { PromotionRule } from '../../../shared/commerce'
import { analytics } from '../../analytics/client'

const DEFAULT_RATE_MICROS = 36_420_000

type CartContextValue = {
  lines: CartLine[]
  currency: Currency
  setCurrency: (currency: Currency) => void
  rateMicros: number | null
  rateAvailable: boolean
  rateLoading: boolean
  refreshRate: () => Promise<void>
  add: (product: Product) => void
  setQuantity: (productId: string, quantity: number) => void
  remove: (productId: string) => void
  clear: () => void
  itemCount: number
  promotion: PromotionRule | null | undefined
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children, products = demoProducts, promotion, catalogReady = false }: { children: ReactNode; products?: Product[]; promotion?: PromotionRule | null; catalogReady?: boolean }) {
  const [lines, setLines] = useState<CartLine[]>(() => loadCart())
  const [currency, setCurrencyState] = useState<Currency>(() => loadCurrency())
  const [rateMicros, setRateMicros] = useState<number | null>(DEFAULT_RATE_MICROS)
  const [rateAvailable, setRateAvailable] = useState(true)
  const [rateLoading, setRateLoading] = useState(false)
  const linesRef = useRef(lines)

  useEffect(() => { linesRef.current = lines }, [lines])

  useEffect(() => saveCart(lines), [lines])

  useEffect(() => {
    if (!catalogReady) return
    setLines((current) => {
      const next = current.map((line) => {
      const product = products.find((candidate) => candidate.id === line.productId)
      const stock = product && (product.fulfillmentType ?? 'STOCK') === 'STOCK' ? product.stockQuantity : undefined
      return stock === undefined ? line : { ...line, quantity: Math.min(line.quantity, stock) }
      }).filter((line) => products.some((product) => product.id === line.productId) && line.quantity > 0)
      linesRef.current = next
      return next
    })
  }, [catalogReady, products])

  function updateLines(next: CartLine[]): void {
    linesRef.current = next
    setLines(next)
  }

  function trackIncrement(product: Product, quantityDelta: number): void {
    if (quantityDelta <= 0) return
    analytics.track('cart_add', {
      productId: product.id,
      productName: product.name,
      category: product.category,
      fulfillment_type: product.fulfillmentType ?? 'STOCK',
      unitPriceCents: product.priceCents,
      quantityDelta,
      promoEligible: product.promoEligible,
    })
  }

  async function refreshRate() {
    if (typeof fetch !== 'function') return
    setRateLoading(true)
    try {
      const result = await fetchExchangeRate()
      const available = result.available && Boolean(result.rateMicros)
      setRateAvailable(available)
      setRateMicros(available && result.rateMicros ? result.rateMicros : null)
      if (!available && currency === 'Bs') { setCurrencyState('USD'); saveCurrency('USD') }
    } catch (error) {
      // A local Vite session has no Worker mounted at /api. Keep the demo
      // rate in that case; an explicit API unavailability response still
      // disables Bs through the branch above.
      const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
      const port = typeof window !== 'undefined' ? window.location.port : ''
      const localPreview = (hostname === 'localhost' || hostname === '127.0.0.1') && (port === '' || port === '4173' || port === '4174')
      // Any failed Worker response means the public rate cannot be trusted.
      // Keep the local demo fallback limited to Vite preview, but disable Bs
      // for every HTTP failure in a real origin (including 4xx responses).
      const serverUnavailable = error instanceof ApiClientError && (error.code === 'NETWORK_ERROR' || error.code === 'HTTP_ERROR' || error.status >= 400)
      if (!localPreview && serverUnavailable) { setRateAvailable(false); setRateMicros(null); if (currency === 'Bs') { setCurrencyState('USD'); saveCurrency('USD') } }
    } finally { setRateLoading(false) }
  }

  useEffect(() => { void refreshRate() }, [])

  const value = useMemo<CartContextValue>(() => ({
    lines,
    currency,
    setCurrency: (next) => {
      if (next === 'Bs' && !rateAvailable) return
      setCurrencyState(next)
      saveCurrency(next)
    },
    add: (product) => {
      const current = linesRef.current
      const existing = current.find((line) => line.productId === product.id)
      const previousQuantity = existing?.quantity ?? 0
      const requestedQuantity = previousQuantity + 1
      const nextQuantity = (product.fulfillmentType ?? 'STOCK') === 'PREORDER' ? requestedQuantity : Math.min(product.stockQuantity, requestedQuantity)
      const quantityDelta = nextQuantity - previousQuantity
      if (quantityDelta <= 0) return
      const next = existing ? current.map((line) => line.productId === product.id ? { ...line, quantity: nextQuantity } : line) : [...current, { productId: product.id, quantity: nextQuantity }]
      updateLines(next)
      trackIncrement(product, quantityDelta)
    },
    setQuantity: (productId, quantity) => {
      const current = linesRef.current
      const existing = current.find((line) => line.productId === productId)
      if (!existing) return
      if (quantity <= 0) { updateLines(current.filter((line) => line.productId !== productId)); return }
      const product = products.find((candidate) => candidate.id === productId)
      const stock = product && (product.fulfillmentType ?? 'STOCK') === 'STOCK' ? product.stockQuantity : undefined
      const requestedQuantity = Math.floor(quantity)
      const nextQuantity = stock === undefined ? requestedQuantity : Math.min(stock, requestedQuantity)
      if (nextQuantity <= 0) { updateLines(current.filter((line) => line.productId !== productId)); return }
      const quantityDelta = nextQuantity - existing.quantity
      if (quantityDelta === 0) return
      updateLines(current.map((line) => line.productId === productId ? { ...line, quantity: nextQuantity } : line))
      if (product && quantityDelta > 0) trackIncrement(product, quantityDelta)
    },
    remove: (productId) => updateLines(linesRef.current.filter((line) => line.productId !== productId)),
    clear: () => updateLines([]),
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    promotion,
    rateMicros, rateAvailable, rateLoading, refreshRate,
  }), [currency, lines, products, promotion, rateAvailable, rateLoading, rateMicros])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart debe usarse dentro de CartProvider')
  return context
}
