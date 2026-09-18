import type { OrderIntentInput, OrderIntentResponse, PublicCategory, PublicProduct, PublicPromotion, YummyQuoteRequest, YummyQuoteResponse } from '../../shared/contracts'
import type { AnalyticsEvent, Currency, PersonalDeliveryPoint, ShippingSelection } from '../../shared/types'
import { ApiClientError, requestJson, type PublicRateResponse } from './core'

export { ApiClientError, type PublicRateResponse }

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

export function sendAnalytics(events: AnalyticsEvent[], signal?: AbortSignal): Promise<{ accepted: number }> {
  return requestJson<{ accepted: number }>('/api/analytics', { method: 'POST', signal, keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) })
}

export function currencySupportsRate(currency: Currency, rate: PublicRateResponse | null): boolean {
  return currency === 'USD' || Boolean(rate?.available && rate.rateMicros && rate.rateMicros > 0)
}
