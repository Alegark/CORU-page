import type { CartLine, Category, Currency, CommerceQuote, Order, Product, Promotion, ShippingSelection, FulfillmentType, PreorderStage, PaymentStatus } from './types'

export type ApiSuccess<T> = { data: T }

export type ApiError = {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export type PublicProduct = Omit<Product, 'stockQuantity' | 'active' | 'primaryImageApproved' | 'promoEligible'> & {
  /** Safe, promotion-scoped eligibility used only to mirror the server quote. */
  promotionEligible: boolean
}

export type PublicCategory = Pick<Category, 'id' | 'slug' | 'name' | 'sortOrder'>

/** Public promotion rule needed to keep Store preview and server quote aligned. */
export type PublicPromotion = Pick<Promotion, 'id' | 'name' | 'kind' | 'targetCategory' | 'bundleQuantity' | 'bundlePriceCents' | 'fixedDiscountCents'>

export type OrderIntentInput = {
  lines: CartLine[]
  currency: Currency
  rateMicros?: number
  shipping?: ShippingSelection | null
  sessionId?: string
  source?: string
}

export type YummyQuoteRequest = {
  addressText: string
  latitude?: number
  longitude?: number
}

export type YummyQuoteResponse =
  | { status: 'quoted'; amountMinor: number; currency: Currency; quotedAt: string; externalId?: string }
  | { status: 'unavailable'; fallbackCopy: 'Costo de delivery a confirmar por WhatsApp.' }
  | { status: 'error'; fallbackCopy: 'Costo de delivery a confirmar por WhatsApp.' }

export type OrderIntentResponse = Pick<Order, 'id' | 'reference' | 'status' | 'currency' | 'items' | 'quote' | 'whatsappUrl' | 'rateMicros' | 'rateValidUntil' | 'createdAt' | 'expiresAt' | 'fulfillmentTypeSnapshot' | 'leadTimeSnapshot' | 'depositUsdCents' | 'balanceUsdCents' | 'preorderStage' | 'paymentStatus' | 'shipping'>

export type OrderSummary = {
  id: string
  reference: string
  status: Order['status']
  currency: Currency
  totalCents: CommerceQuote['totalCents']
  createdAt: string
  itemCount: number
  fulfillmentType?: FulfillmentType
  expiresAt?: string
  preorderStage?: PreorderStage
  paymentStatus?: PaymentStatus
}

export type AdminCategory = Category
