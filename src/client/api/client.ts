import type { ApiError, ApiSuccess, OrderIntentInput, OrderIntentResponse, OrderSummary, PublicCategory, PublicProduct, PublicPromotion, YummyQuoteRequest, YummyQuoteResponse } from '../../shared/contracts'
import type { AnalyticsEvent, Category, Currency, Order, Product, Promotion, StoreSettings, PersonalDeliveryPoint, ShippingSelection } from '../../shared/types'

export class ApiClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly details?: unknown) {
    super(message)
    this.name = 'ApiClientError'
  }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(input, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } }) } catch { throw new ApiClientError('NETWORK_ERROR', 'No pudimos conectar con la tienda.', 0) }
  const payload = await response.json().catch(() => null) as ApiSuccess<T> | ApiError | null
  if (!response.ok || !payload || !('data' in payload)) {
    const error = payload && 'error' in payload ? payload.error : undefined
    throw new ApiClientError(error?.code ?? 'HTTP_ERROR', error?.message ?? 'La solicitud no pudo completarse.', response.status, error?.details)
  }
  return payload.data
}

export type PublicRateResponse = { available: boolean; rateMicros: number | null; mode: 'AUTOMATIC' | 'MANUAL'; updatedAt: string | null }

export function fetchCatalog(signal?: AbortSignal): Promise<PublicProduct[]> {
  return requestJson<PublicProduct[]>('/api/catalog', { signal })
}

export function fetchPublicCategories(signal?: AbortSignal): Promise<PublicCategory[]> {
  return requestJson<PublicCategory[]>('/api/categories', { signal })
}

export function fetchActivePromotion(signal?: AbortSignal): Promise<PublicPromotion | null> {
  return requestJson<PublicPromotion | null>('/api/promotions/active', { signal })
}

export function fetchProduct(slug: string, signal?: AbortSignal): Promise<PublicProduct> {
  return requestJson<PublicProduct>(`/api/products/${encodeURIComponent(slug)}`, { signal })
}

export function fetchExchangeRate(signal?: AbortSignal): Promise<PublicRateResponse> {
  return requestJson<PublicRateResponse>('/api/exchange-rate', { signal })
}

export function fetchPersonalDeliveryPoints(signal?: AbortSignal): Promise<PersonalDeliveryPoint[]> {
  return requestJson<PersonalDeliveryPoint[]>('/api/personal-delivery-points', { signal })
}

export function requestYummyQuote(input: YummyQuoteRequest, signal?: AbortSignal): Promise<YummyQuoteResponse> {
  return requestJson<YummyQuoteResponse>('/api/shipping/yummy/quote', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function createWhatsappOrder(input: OrderIntentInput, idempotencyKey: string, signal?: AbortSignal): Promise<OrderIntentResponse> {
  return requestJson<OrderIntentResponse>('/api/orders/whatsapp', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) })
}

export type PublicShippingSelection = ShippingSelection

export function fetchAdminProducts(signal?: AbortSignal): Promise<Product[]> {
  return requestJson<Product[]>('/api/admin/products', { signal })
}

export type AdminProductInput = {
  name: string
  slug?: string
  category: string
  sizeLabel: string
  priceCents: number
  stockQuantity?: number
  active?: boolean
  primaryImageApproved?: boolean
  promoEligible?: boolean
  artwork: Product['artwork']
  description?: string
  material?: string
  fulfillmentType?: Product['fulfillmentType']
  measurementsText?: string
  innerDiameterMm?: number
  circumferenceMm?: number
  leadTime?: string
}

export function createAdminProduct(input: AdminProductInput, signal?: AbortSignal): Promise<Product> {
  return requestJson<Product>('/api/admin/products', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function updateAdminProduct(id: string, input: Partial<AdminProductInput>, signal?: AbortSignal): Promise<Product> {
  return requestJson<Product>(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function archiveAdminProduct(id: string, signal?: AbortSignal): Promise<Product> {
  return requestJson<Product>(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE', signal })
}

export function fetchAdminCategories(signal?: AbortSignal): Promise<Category[]> {
  return requestJson<Category[]>('/api/admin/categories', { signal })
}

export function createAdminCategory(input: { name: string; slug?: string; sortOrder?: number; active?: boolean }, signal?: AbortSignal): Promise<Category> {
  return requestJson<Category>('/api/admin/categories', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function updateAdminCategory(id: string, input: Partial<{ name: string; slug: string; sortOrder: number; active: boolean }>, signal?: AbortSignal): Promise<Category> {
  return requestJson<Category>(`/api/admin/categories/${encodeURIComponent(id)}`, { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function reorderAdminCategories(ids: string[], signal?: AbortSignal): Promise<Category[]> {
  return requestJson<Category[]>('/api/admin/categories/reorder', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
}

export function archiveAdminCategory(id: string, signal?: AbortSignal): Promise<Category> {
  return requestJson<Category>(`/api/admin/categories/${encodeURIComponent(id)}`, { method: 'DELETE', signal })
}

export type AdminDeliveryPointInput = Omit<PersonalDeliveryPoint, 'id'>

export function fetchAdminDeliveryPoints(signal?: AbortSignal): Promise<PersonalDeliveryPoint[]> {
  return requestJson<PersonalDeliveryPoint[]>('/api/admin/delivery-points', { signal })
}

export function createAdminDeliveryPoint(input: AdminDeliveryPointInput, signal?: AbortSignal): Promise<PersonalDeliveryPoint> {
  return requestJson<PersonalDeliveryPoint>('/api/admin/delivery-points', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function updateAdminDeliveryPoint(id: string, input: Partial<AdminDeliveryPointInput>, signal?: AbortSignal): Promise<PersonalDeliveryPoint> {
  return requestJson<PersonalDeliveryPoint>(`/api/admin/delivery-points/${encodeURIComponent(id)}`, { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function archiveAdminDeliveryPoint(id: string, signal?: AbortSignal): Promise<PersonalDeliveryPoint> {
  return requestJson<PersonalDeliveryPoint>(`/api/admin/delivery-points/${encodeURIComponent(id)}`, { method: 'DELETE', signal })
}

export function reorderAdminDeliveryPoints(ids: string[], signal?: AbortSignal): Promise<PersonalDeliveryPoint[]> {
  return requestJson<PersonalDeliveryPoint[]>('/api/admin/delivery-points/reorder', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
}

export function fetchAdminPromotions(signal?: AbortSignal): Promise<Promotion[]> {
  return requestJson<Promotion[]>('/api/admin/promotions', { signal })
}

export type AdminPromotionInput = {
  name: string
  kind: Promotion['kind']
  targetCategory?: string
  bundleQuantity?: number
  bundlePriceCents?: number
  fixedDiscountCents?: number
  active?: boolean
  startsAt?: string
  endsAt?: string
}

export function createAdminPromotion(input: AdminPromotionInput, signal?: AbortSignal): Promise<Promotion> {
  return requestJson<Promotion>('/api/admin/promotions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function updateAdminPromotion(id: string, input: Partial<AdminPromotionInput>, signal?: AbortSignal): Promise<Promotion> {
  return requestJson<Promotion>(`/api/admin/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function archiveAdminPromotion(id: string, signal?: AbortSignal): Promise<Promotion> {
  return requestJson<Promotion>(`/api/admin/promotions/${encodeURIComponent(id)}`, { method: 'DELETE', signal })
}

export function fetchAdminSettings(signal?: AbortSignal): Promise<StoreSettings> {
  return requestJson<StoreSettings>('/api/admin/settings', { signal })
}

export function fetchAdminRate(signal?: AbortSignal): Promise<AdminRateResponse> {
  return requestJson<AdminRateResponse>('/api/admin/settings/rate', { signal })
}

export function updateAdminSettings(input: Partial<StoreSettings>, signal?: AbortSignal): Promise<StoreSettings> {
  return requestJson<StoreSettings>('/api/admin/settings', { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export type AdminRateResponse = PublicRateResponse & { validUntil: string; updated?: boolean }

export function updateAdminRate(input: { mode: 'AUTOMATIC' } | { rate: string | number } | { rateMicros: number }, signal?: AbortSignal): Promise<AdminRateResponse> {
  return requestJson<AdminRateResponse>('/api/admin/settings/rate', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function refreshAdminRate(signal?: AbortSignal): Promise<AdminRateResponse> {
  return requestJson<AdminRateResponse>('/api/admin/settings/rate/refresh', { method: 'POST', signal })
}

export type AdminImageRecord = {
  id: string
  productId: string
  originalKey: string
  processedKey?: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  byteSize: number
  processingStatus: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'
  approvedVariant?: 'original' | 'processed'
  errorCode?: string
  createdAt: string
  updatedAt: string
}

export function fetchAdminImages(productId: string, signal?: AbortSignal): Promise<AdminImageRecord[]> {
  return requestJson<AdminImageRecord[]>(`/api/admin/products/${encodeURIComponent(productId)}/images`, { signal })
}

export async function uploadAdminImage(productId: string, file: File, signal?: AbortSignal): Promise<AdminImageRecord> {
  // Send the bytes directly instead of multipart. Cloudflare Access can
  // challenge multipart browser requests before they reach the Worker;
  // the Worker already supports a raw image body with an explicit MIME.
  const body = await file.arrayBuffer()
  return requestJson<AdminImageRecord>(`/api/admin/products/${encodeURIComponent(productId)}/images`, { method: 'POST', signal, headers: { 'Content-Type': file.type, 'X-Image-Mime': file.type }, body })
}

export function retryAdminImage(productId: string, imageId: string, signal?: AbortSignal): Promise<AdminImageRecord> {
  return requestJson<AdminImageRecord>(`/api/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}/retry`, { method: 'POST', signal })
}

export function approveAdminImage(productId: string, imageId: string, variant: 'original' | 'processed', signal?: AbortSignal): Promise<AdminImageRecord> {
  return requestJson<AdminImageRecord>(`/api/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}/approve?variant=${variant}`, { method: 'POST', signal })
}

export type AdminAnalyticsSummary = {
  events: number
  funnel: Record<'catalog_view' | 'product_view' | 'cart_add' | 'order_intent' | 'order_confirmed', number>
  sources: Record<string, number>
  devices: Record<string, number>
  traffic: { visits: number; sessions: number; pagesPerSession: number }
  promo: { started: number; completed: number; confirmed: number }
  confirmedOrders: number
  pendingOrders: number
  discardedOrders: number
  confirmedRevenueCents: number
}

export type AdminTrafficSummary = AdminAnalyticsSummary['traffic']

export function fetchAdminAnalytics(signal?: AbortSignal): Promise<AdminAnalyticsSummary> {
  return requestJson<AdminAnalyticsSummary>('/api/admin/analytics', { signal })
}

export function fetchAdminTraffic(range?: { from?: string; to?: string }, signal?: AbortSignal): Promise<AdminTrafficSummary> {
  const params = new URLSearchParams()
  if (range?.from) params.set('from', range.from)
  if (range?.to) params.set('to', range.to)
  const query = params.toString()
  return requestJson<AdminTrafficSummary>(`/api/admin/analytics/traffic${query ? `?${query}` : ''}`, { signal })
}

export function fetchAdminOrders(signal?: AbortSignal): Promise<OrderSummary[]> {
  return requestJson<OrderSummary[]>('/api/admin/orders', { signal })
}

export function fetchAdminOrder(id: string, signal?: AbortSignal): Promise<Order> {
  return requestJson<Order>(`/api/admin/orders/${encodeURIComponent(id)}`, { signal })
}

export function confirmAdminOrder(id: string, signal?: AbortSignal): Promise<Order> {
  return requestJson<Order>(`/api/admin/orders/${encodeURIComponent(id)}/confirm`, { method: 'POST', signal })
}

export function discardAdminOrder(id: string, signal?: AbortSignal): Promise<Order> {
  return requestJson<Order>(`/api/admin/orders/${encodeURIComponent(id)}/discard`, { method: 'POST', signal })
}

export function refreshAdminOrderRate(id: string, signal?: AbortSignal): Promise<Order> {
  return requestJson<Order>(`/api/admin/orders/${encodeURIComponent(id)}/refresh-rate`, { method: 'POST', signal })
}

export function cancelAdminOrder(id: string, reason: string, idempotencyKey: string, signal?: AbortSignal): Promise<Order> {
  return requestJson<Order>(`/api/admin/orders/${encodeURIComponent(id)}/cancel-sale`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ reason }) })
}

export function recordAdminPreorderDeposit(id: string, input: { currency: Currency; paidAmountMinor?: number; rateMicros?: number; note?: string }, idempotencyKey: string, signal?: AbortSignal): Promise<Order> {
  return requestJson<Order>(`/api/admin/orders/${encodeURIComponent(id)}/record-deposit`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) })
}

export function markAdminPreorderReady(id: string, signal?: AbortSignal): Promise<Order> { return requestJson<Order>(`/api/admin/orders/${encodeURIComponent(id)}/mark-ready`, { method: 'POST', signal }) }
export function recordAdminPreorderBalance(id: string, input: { currency: Currency; paidAmountMinor?: number; rateMicros?: number; note?: string }, idempotencyKey: string, signal?: AbortSignal): Promise<Order> {
  return requestJson<Order>(`/api/admin/orders/${encodeURIComponent(id)}/record-balance`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) })
}
export function markAdminPreorderDelivered(id: string, signal?: AbortSignal): Promise<Order> { return requestJson<Order>(`/api/admin/orders/${encodeURIComponent(id)}/mark-delivered`, { method: 'POST', signal }) }

export function sendAnalytics(events: AnalyticsEvent[], signal?: AbortSignal): Promise<{ accepted: number }> {
  return requestJson<{ accepted: number }>('/api/analytics', { method: 'POST', signal, keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) })
}

export function currencySupportsRate(currency: Currency, rate: PublicRateResponse | null): boolean {
  return currency === 'USD' || Boolean(rate?.available && rate.rateMicros && rate.rateMicros > 0)
}
