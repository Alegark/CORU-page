import type { OrderIntentInput, OrderIntentResponse, PublicCategory, PublicProduct, PublicPromotion, YummyQuoteRequest, YummyQuoteResponse } from '../../shared/contracts'
import type { AnalyticsEvent, Currency, PersonalDeliveryPoint, ShippingSelection } from '../../shared/types'
import { ApiClientError, requestJson, type PublicRateResponse } from './core'

export { ApiClientError, type PublicRateResponse }

function publicPath(path: string, freshKey?: string): string {
  return freshKey ? `${path}${path.includes('?') ? '&' : '?'}fresh=${encodeURIComponent(freshKey)}` : path
}

export function fetchCatalog(signal?: AbortSignal, freshKey?: string): Promise<PublicProduct[]> {
  return requestJson<PublicProduct[]>(publicPath('/api/catalog', freshKey), { signal, cache: freshKey ? 'no-store' : 'default' })
}

export function fetchPublicCategories(signal?: AbortSignal, freshKey?: string): Promise<PublicCategory[]> {
  return requestJson<PublicCategory[]>(publicPath('/api/categories', freshKey), { signal, cache: freshKey ? 'no-store' : 'default' })
}

export function fetchActivePromotion(signal?: AbortSignal, freshKey?: string): Promise<PublicPromotion | null> {
  return requestJson<PublicPromotion | null>(publicPath('/api/promotions/active', freshKey), { signal, cache: freshKey ? 'no-store' : 'default' })
}

export function fetchProduct(slug: string, signal?: AbortSignal): Promise<PublicProduct> {
  return requestJson<PublicProduct>(`/api/products/${encodeURIComponent(slug)}`, { signal, cache: 'default' })
}

export function fetchExchangeRate(signal?: AbortSignal): Promise<PublicRateResponse> {
  return requestJson<PublicRateResponse>('/api/exchange-rate', { signal, cache: 'default' })
}

export function fetchPersonalDeliveryPoints(signal?: AbortSignal): Promise<PersonalDeliveryPoint[]> {
  return requestJson<PersonalDeliveryPoint[]>('/api/personal-delivery-points', { signal, cache: 'default' })
}

export function requestYummyQuote(input: YummyQuoteRequest, signal?: AbortSignal): Promise<YummyQuoteResponse> {
  return requestJson<YummyQuoteResponse>('/api/shipping/yummy/quote', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function createWhatsappOrder(input: OrderIntentInput, idempotencyKey: string, signal?: AbortSignal): Promise<OrderIntentResponse> {
  return requestJson<OrderIntentResponse>('/api/orders/whatsapp', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) })
}

export type PublicShippingSelection = ShippingSelection

export function sendAnalytics(events: AnalyticsEvent[], signal?: AbortSignal): Promise<{ accepted: number }> {
  return requestJson<{ accepted: number }>('/api/analytics', { method: 'POST', signal, keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) })
}

export function currencySupportsRate(currency: Currency, rate: PublicRateResponse | null): boolean {
  return currency === 'USD' || Boolean(rate?.available && rate.rateMicros && rate.rateMicros > 0)
}
