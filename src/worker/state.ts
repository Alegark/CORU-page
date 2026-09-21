import { demoProducts } from '../shared/catalog'
import type { AnalyticsEvent, Category, Order, Product, Promotion, PersonalDeliveryPoint } from '../shared/types'
import { defaultSettings, type StoreSettings } from './services/settings.service'
import type { ProductImageRecord } from './services/image.service'
import { clearHydrationCache } from './persistence'
import { defaultPersonalDeliveryPoints } from '../shared/delivery-points'

export type InventoryMovement = {
  id: string
  productId: string
  type: 'SALE' | 'SALE_REVERSAL' | 'MANUAL_SET' | 'MANUAL_ADJUST'
  delta: number
  note?: string
  reversesMovementId?: string
  orderId?: string
  createdAt: string
}

export type AbuseCounter = { digest: string; windowStartedAt: number; count: number }

export type YummyQuoteRecord = {
  amountMinor: number
  currency: 'USD' | 'Bs'
  quotedAt: string
  addressText: string
  latitude?: number
  longitude?: number
}

export type CoruState = {
  categories: Category[]
  products: Product[]
  promotions: Promotion[]
  images: Map<string, ProductImageRecord>
  media: Map<string, ArrayBuffer>
  settings: StoreSettings
  orders: Order[]
  movements: InventoryMovement[]
  analytics: AnalyticsEvent[]
  idempotency: Map<string, Order>
  actionIdempotency: Map<string, Order>
  deliveryPoints: PersonalDeliveryPoint[]
  /** Short-lived server-owned referential Yummy quotes keyed by quote id. */
  yummyQuotes: Map<string, YummyQuoteRecord>
  abuseCounters: Map<string, AbuseCounter>
  abuseSecret?: string
  currentRateMicros: number
  rateUpdatedAt: string
  rateMode: 'AUTOMATIC' | 'MANUAL'
  /** Distinguishes the approved bootstrap rate from a database observation. */
  rateSource: 'DEFAULT' | 'PERSISTED'
  rateValidUntil: string
}

const initialRate = 36_420_000
const initialCategories: Category[] = [
  { id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true },
  { id: 'cat-accesorios', slug: 'accesorios', name: 'Accesorios', sortOrder: 2, active: true },
]
const initialPromotions: Promotion[] = [{ id: 'promo-3x10', name: '3 anillos por $10', kind: 'BUNDLE', targetCategory: 'Anillos', bundleQuantity: 3, bundlePriceCents: 1000, active: true }]
const initialDeliveryPoints: PersonalDeliveryPoint[] = defaultPersonalDeliveryPoints

function initialRateExpiry(now = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = Object.fromEntries(formatter.formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
  return new Date(`${parts.year}-${parts.month}-${parts.day}T23:59:59-04:00`).toISOString()
}

export const state: CoruState = {
  categories: initialCategories.map((category) => ({ ...category })),
  products: demoProducts.map((product) => ({ ...product })),
  promotions: initialPromotions.map((promotion) => ({ ...promotion })),
  images: new Map(),
  media: new Map(),
  settings: { ...defaultSettings },
  orders: [],
  movements: [],
  analytics: [],
  idempotency: new Map(),
  actionIdempotency: new Map(),
  deliveryPoints: initialDeliveryPoints.map((point) => ({ ...point })),
  yummyQuotes: new Map(),
  abuseCounters: new Map(),
  abuseSecret: undefined,
  currentRateMicros: initialRate,
  rateUpdatedAt: new Date().toISOString(),
  rateMode: 'AUTOMATIC',
  rateSource: 'DEFAULT',
  rateValidUntil: initialRateExpiry(),
}

export function resetState(): void {
  state.categories = initialCategories.map((category) => ({ ...category }))
  state.products = demoProducts.map((product) => ({ ...product }))
  state.promotions = initialPromotions.map((promotion) => ({ ...promotion }))
  state.images.clear()
  state.media.clear()
  state.settings = { ...defaultSettings }
  state.orders = []
  state.movements = []
  state.analytics = []
  state.idempotency.clear()
  state.actionIdempotency.clear()
  state.deliveryPoints = initialDeliveryPoints.map((point) => ({ ...point }))
  state.yummyQuotes.clear()
  state.abuseCounters.clear()
  state.currentRateMicros = initialRate
  state.rateUpdatedAt = new Date().toISOString()
  state.rateMode = 'AUTOMATIC'
  state.rateSource = 'DEFAULT'
  state.rateValidUntil = initialRateExpiry()
  clearHydrationCache(state)
}
