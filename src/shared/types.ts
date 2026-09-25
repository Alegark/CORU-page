import type { AnalyticsEventName } from './analytics-events'

export type Currency = 'USD' | 'Bs'

/** How a product is fulfilled. PREORDER never reserves or consumes stock. */
export type FulfillmentType = 'STOCK' | 'PREORDER'
export type PreorderStage = 'AWAITING_DEPOSIT' | 'IN_PROCESS' | 'READY' | 'DELIVERED' | 'CANCELLED'
export type PaymentStatus = 'UNPAID' | 'DEPOSIT_PAID' | 'PAID'
export type PaymentKind = 'DEPOSIT' | 'BALANCE'
export type ShippingMethod = 'PERSONAL' | 'YUMMY' | 'NATIONAL'
export type NationalCarrier = 'MRW' | 'ZOOM'

export type PersonalDeliveryPoint = {
  id: string
  name: string
  address: string
  shortDescription?: string
  latitude?: number
  longitude?: number
  scheduleText?: string
  active: boolean
  sortOrder: number
}

export type ShippingSelection =
  | { method: 'PERSONAL'; deliveryPointId: string }
  | { method: 'YUMMY'; addressText: string; latitude?: number; longitude?: number; quoteReference?: string }
  | { method: 'NATIONAL'; carrier: NationalCarrier; state?: string; city?: string; officeText?: string }

export type ShippingSnapshot = ShippingSelection & {
  deliveryPointName?: string
  deliveryPointAddress?: string
  quoteAmountMinor?: number
  quoteCurrency?: Currency
  quoteQuotedAt?: string
  quoteExternalId?: string
}

export type OrderPayment = {
  id: string
  kind: PaymentKind
  usdAmountCents: number
  paidCurrency: Currency
  paidAmountMinor: number
  rateMicros?: number
  recordedAt: string
  note?: string
  idempotencyKey?: string
}

/** Categories are operator-managed; these are the two seeded v1 values. */
export type ProductCategory = string

export type Category = {
  id: string
  slug: string
  name: string
  sortOrder: number
  active: boolean
}

export type PromotionKind = 'BUNDLE' | 'FIXED_DISCOUNT'

export type Promotion = {
  id: string
  name: string
  kind: PromotionKind
  targetCategory?: string
  bundleQuantity?: number
  bundlePriceCents?: number
  fixedDiscountCents?: number
  active: boolean
  startsAt?: string
  endsAt?: string
}

export type StoreSettings = {
  whatsappPhone: string
  whatsappIntro: string
  storeName: string
  instagramUrl: string
  facebookUrl: string
  privacyUrl: string
  storeActive: boolean
}

export type ProductArtwork = 'orbita' | 'star' | 'cross' | 'skull' | 'pearl' | 'chain'

/** Public, versioned image URLs. Missing derivatives intentionally fall back
 * to the immutable source through the media route. */
export type ProductImageSource = {
  id: string
  src: string
  thumb320?: string
  thumb640?: string
  detail1200?: string
  og1200?: string
}

export type Product = {
  id: string
  slug: string
  name: string
  category: ProductCategory
  sizeLabel: string
  priceCents: number
  stockQuantity: number
  active: boolean
  primaryImageApproved: boolean
  promoEligible: boolean
  artwork: ProductArtwork
  description: string
  material: string
  /** Defaults to STOCK for records created before v1.1. */
  fulfillmentType?: FulfillmentType
  measurementsText?: string
  innerDiameterMm?: number
  circumferenceMm?: number
  usSize?: string
  /** Fixed customer-facing lead time for PREORDER. */
  leadTime?: string
  /** Public proxy URL is present only when an approved R2 variant exists. */
  imageUrl?: string
  /** Ordered public image URLs; the first one is the product's primary image. */
  imageUrls?: string[]
  /** Ordered responsive image sources for the storefront. */
  imageSources?: ProductImageSource[]
}

export type CartLine = {
  productId: string
  quantity: number
}

export type CommerceQuote = {
  subtotalCents: number
  discountCents: number
  totalCents: number
  appliedPromotion?: {
    id: string
    name: string
    groupsApplied: number
  }
}

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'DISCARDED' | 'CANCELLED'

export type OrderItem = CartLine & {
  name: string
  sizeLabel: string
  unitPriceCents: number
  lineTotalCents: number
  material?: string
  fulfillmentTypeSnapshot?: FulfillmentType
}

export type Order = {
  id: string
  reference: string
  createdAt: string
  status: OrderStatus
  currency: Currency
  rateMicros?: number
  rateValidUntil?: string
  items: OrderItem[]
  quote: CommerceQuote
  whatsappUrl: string
  confirmedAt?: string
  expiresAt?: string
  discardedAt?: string
  cancelledAt?: string
  discardReason?: string
  cancelReason?: string
  fulfillmentTypeSnapshot?: FulfillmentType
  leadTimeSnapshot?: string
  depositUsdCents?: number
  balanceUsdCents?: number
  preorderStage?: PreorderStage
  paymentStatus?: PaymentStatus
  payments?: OrderPayment[]
  shipping?: ShippingSnapshot
  /** Operator/device actor used for audit, never exposed publicly. */
  lastActionActor?: string
  lastActionAt?: string
  audit?: OrderAuditEntry[]
}

export type OrderAuditEntry = {
  id: string
  action: 'CREATED' | 'EXPIRED_UNREVIEWED' | 'DISCARDED' | 'CONFIRMED' | 'RECORD_DEPOSIT' | 'MARK_READY' | 'RECORD_BALANCE' | 'MARK_DELIVERED' | 'CANCEL_SALE'
  actor?: string
  reason?: string
  createdAt: string
}

export type AnalyticsEvent = {
  name: AnalyticsEventName
  sessionId: string
  source: string
  occurredAt: string
  properties?: Record<string, string | number | boolean>
}
