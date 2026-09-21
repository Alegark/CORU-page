import type { OrderSummary } from '../../shared/contracts'
import type { Category, Currency, Order, PersonalDeliveryPoint, Product, Promotion, StoreSettings } from '../../shared/types'
import { ApiClientError, requestJson, type PublicRateResponse } from './core'

export { ApiClientError }

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
  sortOrder: number
  processingStatus: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'
  approvedVariant?: 'original' | 'processed'
  errorCode?: string
  createdAt: string
  updatedAt: string
}

export function fetchAdminImages(productId: string, signal?: AbortSignal): Promise<AdminImageRecord[]> {
  return requestJson<AdminImageRecord[]>(`/api/admin/products/${encodeURIComponent(productId)}/images`, { signal })
}

export function reorderAdminImages(productId: string, ids: string[], signal?: AbortSignal): Promise<AdminImageRecord[]> {
  return requestJson<AdminImageRecord[]>(`/api/admin/products/${encodeURIComponent(productId)}/images/reorder`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
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

export type AdminAnalyticsRange = { from?: string; to?: string }
export type AdminAnalyticsProductInterest = {
  productId: string
  name: string
  views: number
  unitsAdded: number
  addSessions: number
  interestScore: number
  relativeInterestPct: number
}
export type AdminAnalyticsSummaryV2 = {
  range: { from: string; to: string; timezone: 'America/Caracas' }
  kpis: { uniqueVisits: number; totalVisits: number; uniqueDevices: number; unitsAdded: number; whatsappIntents: number }
  commercial: { unitsAdded: number; potentialValueCents: number; potentialValueEstimated: boolean; whatsappPerAddPct: number }
  funnel: { catalogSessions: number; productViewSessions: number; addSessions: number; whatsappSessions: number; confirmedOrders: number }
  sources: Array<{ source: 'instagram' | 'facebook' | 'whatsapp' | 'direct' | 'other'; visits: number; percentage: number }>
  devices: Array<{ device: 'mobile' | 'tablet' | 'desktop' | 'unknown'; visits: number; percentage: number }>
  timeline: Array<{ bucket: string; uniqueVisits: number; unitsAdded: number; whatsappIntents: number }>
  realOrders: { pending: number; confirmed: number; discarded: number; cancelled: number; confirmedStockRevenueCents: number }
}

function analyticsQuery(range?: AdminAnalyticsRange): string {
  const params = new URLSearchParams()
  if (range?.from) params.set('from', range.from)
  if (range?.to) params.set('to', range.to)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function fetchAdminAnalyticsSummary(range?: AdminAnalyticsRange, signal?: AbortSignal): Promise<AdminAnalyticsSummaryV2> {
  return requestJson<AdminAnalyticsSummaryV2>(`/api/admin/analytics/summary${analyticsQuery(range)}`, { signal })
}

export function fetchAdminProductAnalytics(range?: AdminAnalyticsRange, signal?: AbortSignal): Promise<{ products: AdminAnalyticsProductInterest[] }> {
  return requestJson<{ products: AdminAnalyticsProductInterest[] }>(`/api/admin/analytics/products${analyticsQuery(range)}`, { signal })
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
