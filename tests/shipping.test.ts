import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/worker/app'
import { resetState, state } from '../src/worker/state'

describe('shipping and delivery points', () => {
  beforeEach(() => resetState())

  it('publishes active points in operator order and keeps the map metadata optional', async () => {
    state.deliveryPoints.push({ id: 'point-second', name: 'Punto Sur', address: 'Av. 2', active: true, sortOrder: 4, latitude: 10.1, longitude: -71.6 })
    state.deliveryPoints.push({ id: 'point-hidden', name: 'Punto oculto', address: 'No mostrar', active: false, sortOrder: 0 })
    const response = await app.request('/api/personal-delivery-points')
    expect(response.status).toBe(200)
    const body = await response.json() as { data: Array<Record<string, unknown>> }
    expect(body.data.map((point) => point.id)).toEqual(['coru-punto-central', 'coru-la-paragua', 'coru-la-campana', 'point-second'])
    expect(body.data[3]).toMatchObject({ latitude: 10.1, longitude: -71.6 })
    expect(body.data[0]).not.toHaveProperty('active')
  })

  it('returns a fresh active list when a selected point becomes stale', async () => {
    state.deliveryPoints.forEach((point) => { point.active = false })
    const response = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'stale-point-1' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD', shipping: { method: 'PERSONAL', deliveryPointId: 'coru-punto-central' } }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'DELIVERY_POINT_UNAVAILABLE', details: { points: [] } } })
    expect(state.orders).toHaveLength(0)
  })

  it('requires an explicit shipping method in a configured Worker environment', async () => {
    const response = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'shipping-required-1' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD' }) }, { ENVIRONMENT: 'local' })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'DELIVERY_METHOD_REQUIRED' } })
  })

  it('keeps Yummy non-blocking until an official adapter is configured', async () => {
    const response = await app.request('/api/shipping/yummy/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addressText: 'Av. Bella Vista, Maracaibo' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { status: 'unavailable', fallbackCopy: 'Costo de delivery a confirmar por WhatsApp.' } })
  })

  it('supports authenticated point CRUD and preserves historical references on archive', async () => {
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    const created = await app.request('/api/admin/delivery-points', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Punto Norte', address: 'Calle 1', latitude: 10.7, longitude: -71.6, active: true, sortOrder: 2 }) }, env)
    expect(created.status).toBe(201)
    const point = (await created.json() as { data: { id: string; active: boolean } }).data
    expect(point.active).toBe(true)
    const archived = await app.request(`/api/admin/delivery-points/${point.id}`, { method: 'DELETE' }, env)
    expect(archived.status).toBe(200)
    expect((await archived.json() as { data: { active: boolean } }).data.active).toBe(false)
    const publicPoints = await app.request('/api/personal-delivery-points')
    expect((await publicPoints.json() as { data: Array<{ id: string }> }).data.some((entry) => entry.id === point.id)).toBe(false)
  })

  it('snapshots national and referential Yummy shipping without changing merchandise totals', async () => {
    const national = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'national-1' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD', shipping: { method: 'NATIONAL', carrier: 'ZOOM', state: 'Zulia', city: 'Maracaibo', officeText: 'Agencia Centro' } }) })
    expect(national.status).toBe(200)
    const nationalOrder = (await national.json() as { data: { shipping?: Record<string, unknown>; whatsappUrl: string; quote: { totalCents: number } } }).data
    expect(nationalOrder.shipping).toMatchObject({ method: 'NATIONAL', carrier: 'ZOOM', state: 'Zulia', city: 'Maracaibo', officeText: 'Agencia Centro' })
    expect(decodeURIComponent(nationalOrder.whatsappUrl)).toContain('- Cobro: a destino')

    const yummy = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'yummy-1' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD', shipping: { method: 'YUMMY', addressText: 'Av. Bella Vista, Maracaibo', quoteReference: 'quote-42' } }) })
    expect(yummy.status).toBe(200)
    const yummyOrder = (await yummy.json() as { data: { shipping?: Record<string, unknown>; quote: { totalCents: number }; whatsappUrl: string } }).data
    expect(yummyOrder.shipping).toMatchObject({ method: 'YUMMY', quoteExternalId: 'quote-42' })
    expect(yummyOrder.quote.totalCents).toBe(nationalOrder.quote.totalCents)
    expect(decodeURIComponent(yummyOrder.whatsappUrl)).toContain('📝 *NOTAS*')
    expect(decodeURIComponent(yummyOrder.whatsappUrl)).toContain('Envía tu ubicación por WhatsApp para cotizar el delivery.')
    expect(decodeURIComponent(yummyOrder.whatsappUrl)).toContain('La tarifa de Yummy puede variar según la hora y disponibilidad')
    expect(decodeURIComponent(yummyOrder.whatsappUrl)).not.toContain('Costo del delivery: por confirmar')
  })

  it('accepts a new National order with carrier only and coordinates destination in WhatsApp', async () => {
    const response = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'national-carrier-only-1' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD', shipping: { method: 'NATIONAL', carrier: 'MRW' } }) })
    expect(response.status).toBe(200)
    const order = (await response.json() as { data: { shipping?: Record<string, unknown>; whatsappUrl: string } }).data
    expect(order.shipping).toMatchObject({ method: 'NATIONAL', carrier: 'MRW' })
    expect(order.shipping).not.toHaveProperty('state')
    expect(order.shipping).not.toHaveProperty('city')
    const whatsapp = decodeURIComponent(order.whatsappUrl)
    expect(whatsapp).toContain('Entrega: Envío nacional · MRW')
    expect(whatsapp).toContain('Datos del destinatario y oficina: por coordinar por WhatsApp')
    expect(whatsapp).toContain('- Cobro: a destino')
  })

  it('keeps a verified Yummy quote server-owned and referential', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ amountMinor: 375, currency: 'Bs', quotedAt: '2026-09-18T12:00:00.000Z', externalId: 'provider-quote-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    try {
      const env = { YUMMY_ADAPTER_ENABLED: 'true', YUMMY_API_URL: 'https://provider.invalid/quote', YUMMY_API_TOKEN: 'server-only' }
      const quote = await app.request('/api/shipping/yummy/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addressText: 'Av. Bella Vista, Maracaibo' }) }, env)
      expect(quote.status).toBe(200)
      expect(await quote.json()).toMatchObject({ data: { status: 'quoted', externalId: 'provider-quote-1', amountMinor: 375 } })
      const orderResponse = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'yummy-verified-1' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD', shipping: { method: 'YUMMY', addressText: 'Av. Bella Vista, Maracaibo', quoteReference: 'provider-quote-1' } }) })
      expect(orderResponse.status).toBe(200)
      const order = (await orderResponse.json() as { data: { shipping?: Record<string, unknown>; whatsappUrl: string } }).data
      expect(order.shipping).toMatchObject({ quoteExternalId: 'provider-quote-1', quoteAmountMinor: 375, quoteCurrency: 'Bs', quoteQuotedAt: '2026-09-18T12:00:00.000Z' })
      expect(decodeURIComponent(order.whatsappUrl)).toContain('📝 *NOTAS*')
      expect(decodeURIComponent(order.whatsappUrl)).not.toContain('Delivery estimado al generar el pedido: Bs 3.75')
      const staleResponse = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'yummy-verified-stale' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD', shipping: { method: 'YUMMY', addressText: 'Calle 72, Maracaibo', quoteReference: 'provider-quote-1' } }) })
      expect(staleResponse.status).toBe(200)
      const stale = (await staleResponse.json() as { data: { shipping?: Record<string, unknown>; whatsappUrl: string } }).data
      expect(stale.shipping).not.toHaveProperty('quoteAmountMinor')
      expect(decodeURIComponent(stale.whatsappUrl)).toContain('Envía tu ubicación por WhatsApp para cotizar el delivery.')
      expect(decodeURIComponent(stale.whatsappUrl)).not.toContain('Costo del delivery: por confirmar')
    } finally { vi.unstubAllGlobals() }
  })
})
