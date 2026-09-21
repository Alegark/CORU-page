import { beforeEach, describe, expect, it } from 'vitest'
import { demoProducts } from '../src/shared/catalog'
import { endOfCaracasDay, getPublicRate, parseRateToMicros, refreshRate, setManualRate } from '../src/worker/services/exchange-rate.service'
import { adjustStock, consumeForOrder, setStock } from '../src/worker/services/inventory.service'
import { resetState, state } from '../src/worker/state'
import type { Order } from '../src/shared/types'
import { scheduled } from '../src/worker/scheduled'
import { confirmOrder, createPendingOrder, refreshOrderRate } from '../src/worker/services/order.service'
import { recordAnalytics, summarizeAnalyticsV2, summarizeProductInterest, summarizeTraffic, resolveAnalyticsDateRange } from '../src/worker/services/analytics.service'
import type { AnalyticsEvent } from '../src/shared/types'

describe('inventory service', () => {
  beforeEach(() => resetState())

  it('records a delta for absolute stock changes', () => {
    const result = setStock(state, 'orbita-oscura', 3, 'Conteo físico')
    expect(result.product.stockQuantity).toBe(3)
    expect(result.movement).toMatchObject({ type: 'MANUAL_SET', delta: -5, note: 'Conteo físico' })
  })

  it('rejects an adjustment that would make stock negative', () => {
    expect(() => adjustStock(state, 'orbita-oscura', -9)).toThrowError(/negativo/)
    expect(state.products.find((product) => product.id === 'orbita-oscura')?.stockQuantity).toBe(8)
  })

  it('checks every line before consuming order stock', () => {
    const order = { reference: 'CORU-000001', items: [{ productId: 'orbita-oscura', quantity: 2, name: 'Órbita oscura', sizeLabel: 'Talla única', unitPriceCents: 400, lineTotalCents: 800 }, { productId: 'calavera-orbital', quantity: 99, name: 'Calavera orbital', sizeLabel: 'Talla única', unitPriceCents: 400, lineTotalCents: 39600 }] } as Order
    expect(() => consumeForOrder(state, order)).toThrowError(/stock cambió/)
    expect(state.products.find((product) => product.id === 'orbita-oscura')?.stockQuantity).toBe(8)
    expect(state.movements).toHaveLength(0)
  })
})

describe('exchange-rate service', () => {
  beforeEach(() => resetState())

  it('parses decimal rates exactly into micros', () => {
    expect(parseRateToMicros('36.42')).toBe(36_420_000)
    expect(parseRateToMicros('0')).toBeNull()
    expect(parseRateToMicros('36.1234567')).toBeNull()
  })

  it('accepts Binance quote responses wrapped at data.price', async () => {
    const provider = (await import('../src/worker/services/exchange-rate.service')).createHttpRateProvider('https://example.test/rate', async () => new Response(JSON.stringify({ code: '000000', data: { price: 950.125 } }), { status: 200 }))
    await expect(provider.getRate()).resolves.toBe(950.125)
  })

  it('accepts the approved relay envelope around Binance JSON', async () => {
    const provider = (await import('../src/worker/services/exchange-rate.service')).createHttpRateProvider('https://example.test/rate', async () => new Response(JSON.stringify({ data: { content: JSON.stringify({ code: '000000', data: { price: 950.75 } }) } }), { status: 200 }))
    await expect(provider.getRate()).resolves.toBe(950.75)
  })

  it('keeps the previous value after an invalid provider response', async () => {
    state.rateMode = 'AUTOMATIC'
    const previous = state.currentRateMicros
    const result = await refreshRate(state, { getRate: async () => 'not-a-rate' })
    expect(result.updated).toBe(false)
    expect(state.currentRateMicros).toBe(previous)
  })

  it('sets a positive manual rate and a Caracas validity boundary', () => {
    const result = setManualRate(state, '40.5', new Date('2026-09-15T16:00:00Z'))
    expect(result.rateMicros).toBe(40_500_000)
    expect(result.mode).toBe('MANUAL')
    expect(new Date(result.validUntil).getUTCHours()).toBe(3)
  })

  it('repairs epoch placeholders before exposing the public rate', () => {
    state.rateUpdatedAt = '1970-01-01T00:00:00.000Z'
    state.rateValidUntil = '1970-01-01T00:00:00.000Z'
    const result = getPublicRate(state, new Date('2026-09-16T16:00:00.000Z'))
    expect(result.available).toBe(true)
    expect(result.updatedAt).toBe('2026-09-16T16:00:00.000Z')
    expect(result.rateMicros).toBe(36_420_000)
  })
})

describe('order stock and rate races', () => {
  beforeEach(() => resetState())

  it('lets only the first pending order consume the last unit', () => {
    const product = state.products.find((entry) => entry.id === 'orbita-oscura')!
    product.stockQuantity = 1
    const now = new Date('2026-09-15T16:00:00.000Z')
    const first = createPendingOrder(state, [{ productId: product.id, quantity: 1 }], 'USD', undefined, 'race-a', now).order
    const second = createPendingOrder(state, [{ productId: product.id, quantity: 1 }], 'USD', undefined, 'race-b', now).order

    confirmOrder(state, first.id, now)
    expect(() => confirmOrder(state, second.id, now)).toThrowError(/stock cambió/)
    expect(product.stockQuantity).toBe(0)
    expect(state.movements).toHaveLength(1)
  })

  it('blocks an expired Bs intent until the operator refreshes its rate', () => {
    const dayOne = new Date('2026-09-15T16:00:00.000Z')
    const nextDay = new Date('2026-09-16T16:00:00.000Z')
    setManualRate(state, '250', dayOne)
    const order = createPendingOrder(state, [{ productId: 'orbita-oscura', quantity: 1 }], 'Bs', undefined, 'rate-race', dayOne).order
    setManualRate(state, '260', nextDay)

    expect(order.rateValidUntil).toBe(endOfCaracasDay(dayOne).toISOString())
    expect(() => confirmOrder(state, order.id, nextDay)).toThrowError(/expiró/)
    const refreshed = refreshOrderRate(state, order.id, nextDay)
    expect(refreshed.rateMicros).toBe(260_000_000)
    expect(refreshed.rateValidUntil).toBe(endOfCaracasDay(nextDay).toISOString())
    expect(confirmOrder(state, order.id, nextDay).status).toBe('CONFIRMED')
  })
})

describe('anonymous traffic analytics', () => {
  beforeEach(() => resetState())

  it('counts one catalog visit per anonymous visitor in the selected range', () => {
    const events: AnalyticsEvent[] = [
      { name: 'catalog_view', sessionId: 'session-a', source: 'directo', occurredAt: '2026-09-18T10:00:00.000Z', properties: { visitorId: 'visitor-mobile', device: 'mobile' } },
      { name: 'catalog_view', sessionId: 'session-a-new-tab', source: 'directo', occurredAt: '2026-09-18T10:02:00.000Z', properties: { visitorId: 'visitor-mobile', device: 'mobile' } },
      { name: 'catalog_view', sessionId: 'session-a-next-day', source: 'directo', occurredAt: '2026-09-19T10:00:00.000Z', properties: { visitorId: 'visitor-mobile', device: 'mobile' } },
      { name: 'catalog_view', sessionId: 'session-b', source: 'instagram', occurredAt: '2026-09-18T11:00:00.000Z', properties: { visitorId: 'visitor-desktop', device: 'desktop' } },
      { name: 'catalog_view', sessionId: 'legacy-session', source: 'directo', occurredAt: '2026-09-18T12:00:00.000Z', properties: { device: 'mobile' } },
      { name: 'product_view', sessionId: 'session-b', source: 'instagram', occurredAt: '2026-09-18T11:01:00.000Z', properties: { visitorId: 'visitor-desktop', device: 'desktop' } },
    ]
    recordAnalytics(state, events)

    expect(summarizeTraffic(state)).toEqual({ visits: 2, sessions: 2, pagesPerSession: 1 })
    expect(summarizeTraffic(state, { fromMs: Date.parse('2026-09-18T10:01:00.000Z'), toMs: Date.parse('2026-09-18T10:59:59.999Z') })).toEqual({ visits: 1, sessions: 1, pagesPerSession: 1 })
  })

  it('builds the V2 summary from unique catalog visits and keeps product views out of the global visit count', () => {
    const from = Date.parse('2026-09-20T04:00:00.000Z')
    const to = Date.parse('2026-09-20T23:59:59.999Z')
    state.analytics.push(
      { name: 'catalog_view', sessionId: 'session-a', source: 'src=ig', occurredAt: '2026-09-20T05:00:00.000Z', properties: { visitorId: 'visitor-mobile', device: 'mobile' } },
      { name: 'catalog_view', sessionId: 'session-a-new-tab', source: 'instagram', occurredAt: '2026-09-20T05:01:00.000Z', properties: { visitorId: 'visitor-mobile', device: 'mobile' } },
      { name: 'product_view', sessionId: 'session-a', source: 'instagram', occurredAt: '2026-09-20T05:01:30.000Z', properties: { visitorId: 'visitor-mobile', productId: 'orbita-oscura', productName: 'Órbita oscura', category: 'Anillos', unitPriceCents: 1000, promoEligible: true, fulfillment_type: 'STOCK', device: 'mobile' } },
      { name: 'cart_add', sessionId: 'session-a', source: 'instagram', occurredAt: '2026-09-20T05:02:00.000Z', properties: { visitorId: 'visitor-mobile', productId: 'orbita-oscura', productName: 'Órbita oscura', category: 'Anillos', unitPriceCents: 1000, quantityDelta: 2, promoEligible: true, fulfillment_type: 'STOCK', device: 'mobile' } },
      { name: 'order_intent', sessionId: 'session-a', source: 'instagram', occurredAt: '2026-09-20T05:03:00.000Z', properties: { visitorId: 'visitor-mobile', device: 'mobile' } },
      { name: 'catalog_view', sessionId: 'session-b', source: 'facebook', occurredAt: '2026-09-20T06:00:00.000Z', properties: { visitorId: 'visitor-desktop', device: 'desktop' } },
      { name: 'product_view', sessionId: 'session-b', source: 'facebook', occurredAt: '2026-09-20T06:00:30.000Z', properties: { visitorId: 'visitor-desktop', productId: 'coru-dark', productName: 'CORU DARK', category: 'Anillos', unitPriceCents: 700, promoEligible: false, fulfillment_type: 'STOCK', device: 'desktop' } },
      { name: 'size_guide_view', sessionId: 'session-b', source: 'facebook', occurredAt: '2026-09-20T06:01:00.000Z', properties: { visitorId: 'visitor-desktop', device: 'desktop' } },
    )

    const summary = summarizeAnalyticsV2(state, state.orders, { fromMs: from, toMs: to, from: '2026-09-20', to: '2026-09-20', timezone: 'America/Caracas' })
    expect(summary.kpis).toMatchObject({ uniqueVisits: 2, totalVisits: 3, unitsAdded: 2, whatsappIntents: 1 })
    expect(summary.commercial).toMatchObject({ unitsAdded: 2, potentialValueCents: 2000, potentialValueEstimated: false, whatsappPerAddPct: 100 })
    expect(summary.funnel).toMatchObject({ catalogSessions: 2, productViewSessions: 2, addSessions: 1, whatsappSessions: 1, confirmedOrders: 0 })
    expect(summary.sources).toEqual(expect.arrayContaining([{ source: 'instagram', visits: 1, percentage: 50 }, { source: 'facebook', visits: 1, percentage: 50 }]))
    expect(summary.devices).toEqual(expect.arrayContaining([{ device: 'mobile', visits: 1, percentage: 50 }, { device: 'desktop', visits: 1, percentage: 50 }]))
    expect(summary.timeline.reduce((sum, bucket) => sum + bucket.uniqueVisits, 0)).toBe(2)
  })

  it('ranks products by views plus weighted units and marks estimated historical values', () => {
    state.analytics.push(
      ...Array.from({ length: 3 }, (_, index) => ({ name: 'product_view' as const, sessionId: `view-a-${index}`, source: 'directo', occurredAt: '2026-09-20T05:00:00.000Z', properties: { productId: 'orbita-oscura', productName: 'Órbita oscura' } })),
      { name: 'cart_add', sessionId: 'add-a', source: 'directo', occurredAt: '2026-09-20T05:10:00.000Z', properties: { productId: 'orbita-oscura', quantityDelta: 2 } },
      ...Array.from({ length: 6 }, (_, index) => ({ name: 'product_view' as const, sessionId: `view-b-${index}`, source: 'directo', occurredAt: '2026-09-20T05:00:00.000Z', properties: { productId: 'coru-dark', productName: 'CORU DARK' } })),
    )
    const rows = summarizeProductInterest(state, { fromMs: Date.parse('2026-09-20T04:00:00.000Z'), toMs: Date.parse('2026-09-20T23:59:59.999Z') })
    expect(rows[0]).toMatchObject({ productId: 'orbita-oscura', views: 3, unitsAdded: 2, addSessions: 1, interestScore: 9, relativeInterestPct: 100 })
    expect(rows[1]).toMatchObject({ productId: 'coru-dark', views: 6, unitsAdded: 0, interestScore: 6 })
  })

  it('resolves date-only ranges at America/Caracas boundaries and max 180 days', () => {
    const today = new Date('2026-09-20T12:00:00.000Z')
    const range = resolveAnalyticsDateRange('2026-09-20', '2026-09-20', today)
    expect(range.ok).toBe(true)
    if (range.ok) {
      expect(range.value.fromMs).toBe(Date.parse('2026-09-20T04:00:00.000Z'))
      expect(range.value.toMs).toBe(Date.parse('2026-09-20T12:00:00.000Z'))
    }
    expect(resolveAnalyticsDateRange('2026-09-20', '2026-09-19', today).ok).toBe(false)
    expect(resolveAnalyticsDateRange('2026-03-01', '2026-09-20', today).ok).toBe(false)
  })
})

describe('image and catalog fixtures remain isolated', () => {
  it('keeps demo product objects independent from Worker state', () => {
    resetState()
    state.products[0].stockQuantity = 1
    expect(demoProducts[0].stockQuantity).toBe(8)
  })
})

describe('scheduled operations', () => {
  it('runs retention cleanup without requiring external bindings', async () => {
    resetState()
    state.rateMode = 'MANUAL'
    await scheduled({ scheduledTime: Date.parse('2026-09-15T16:00:00Z') }, {}, {})
    expect(state.currentRateMicros).toBe(36_420_000)
  })
})
