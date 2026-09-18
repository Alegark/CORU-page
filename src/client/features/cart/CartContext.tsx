import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadCart, loadCurrency, saveCart, saveCurrency } from '../../../shared/storage'
import type { CartLine, Currency, Product } from '../../../shared/types'
import { ApiClientError, fetchExchangeRate } from '../../api/client'
import { demoProducts } from '../../../shared/catalog'
import type { PromotionRule } from '../../../shared/commerce'

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

  useEffect(() => saveCart(lines), [lines])

  useEffect(() => {
    if (!catalogReady) return
    setLines((current) => current.map((line) => {
      const product = products.find((candidate) => candidate.id === line.productId)
      const stock = product && (product.fulfillmentType ?? 'STOCK') === 'STOCK' ? product.stockQuantity : undefined
      return stock === undefined ? line : { ...line, quantity: Math.min(line.quantity, stock) }
    }).filter((line) => products.some((product) => product.id === line.productId) && line.quantity > 0))
  }, [catalogReady, products])

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
      setLines((current) => {
        const existing = current.find((line) => line.productId === product.id)
        if (existing) return current.map((line) => line.productId === product.id ? { ...line, quantity: (product.fulfillmentType ?? 'STOCK') === 'PREORDER' ? line.quantity + 1 : Math.min(product.stockQuantity, line.quantity + 1) } : line)
        return [...current, { productId: product.id, quantity: 1 }]
      })
    },
    setQuantity: (productId, quantity) => {
      setLines((current) => {
        if (quantity <= 0) return current.filter((line) => line.productId !== productId)
        const product = products.find((candidate) => candidate.id === productId)
        const stock = product && (product.fulfillmentType ?? 'STOCK') === 'STOCK' ? product.stockQuantity : undefined
        const nextQuantity = Math.floor(quantity)
        return current.map((line) => line.productId === productId ? { ...line, quantity: stock === undefined ? nextQuantity : Math.min(stock, nextQuantity) } : line).filter((line) => line.quantity > 0)
      })
    },
    remove: (productId) => setLines((current) => current.filter((line) => line.productId !== productId)),
    clear: () => setLines([]),
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
