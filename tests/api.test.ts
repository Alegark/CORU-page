import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/worker/app'
import { resetState, state } from '../src/worker/state'

describe('CORU Worker API contracts', () => {
  beforeEach(() => resetState())

  it('returns a public catalog without internal stock flags', async () => {
    const response = await app.request('/api/catalog')
    expect(response.status).toBe(200)
    const body = await response.json() as { data: Array<Record<string, unknown>> }
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data[0]).not.toHaveProperty('stockQuantity')
    expect(body.data[0]).not.toHaveProperty('promoEligible')
    expect(body.data[0]).toHaveProperty('promotionEligible', true)
  })

  it('keeps promotion eligibility aligned with the product rule', async () => {
    state.products.find((product) => product.id === 'orbita-oscura')!.promoEligible = false
    const response = await app.request('/api/catalog')
    expect(response.status).toBe(200)
    const body = await response.json() as { data: Array<{ id: string; promotionEligible: boolean }> }
    expect(body.data.find((product) => product.id === 'orbita-oscura')?.promotionEligible).toBe(false)
  })

  it('exposes only the active promotion rule to the storefront', async () => {
    const response = await app.request('/api/promotions/active')
    expect(response.status).toBe(200)
    const body = await response.json() as { data: Record<string, unknown> }
    expect(body.data).toMatchObject({ id: 'promo-3x10', kind: 'BUNDLE', bundleQuantity: 3, bundlePriceCents: 1000 })
    expect(body.data).not.toHaveProperty('active')
  })

  it('exposes active categories in operator-defined order', async () => {
    state.categories[1].active = false
    const response = await app.request('/api/categories')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [{ id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1 }] })
  })

  it('serves only an approved product image through a public proxy', async () => {
    const image = { id: 'image-1', productId: 'orbita-oscura', originalKey: 'products/orbita-oscura/original/image-1.jpg', processedKey: 'products/orbita-oscura/processed/image-1.webp', mimeType: 'image/jpeg' as const, byteSize: 2, processingStatus: 'FAILED' as const, approvedVariant: 'original' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    state.images.set(image.id, image)
    state.media.set(image.originalKey, new Uint8Array([1, 2]).buffer)
    const catalog = await (await app.request('/api/catalog')).json() as { data: Array<Record<string, unknown>> }
    expect(catalog.data[0].imageUrl).toBe('/api/products/orbita-oscura/image')
    const response = await app.request('/api/products/orbita-oscura/image')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/jpeg')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2]))
  })

  it('rejects malformed order intents with the stable validation envelope', async () => {
    const response = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'invalid-1' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 0 }], currency: 'USD' }) })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  it('exposes anonymous traffic statistics through the protected admin endpoint', async () => {
    state.analytics.push(
      { name: 'catalog_view', sessionId: 'traffic-a', source: 'directo', occurredAt: '2026-09-18T10:00:00.000Z' },
      { name: 'catalog_view', sessionId: 'traffic-b', source: 'instagram', occurredAt: '2026-09-18T11:00:00.000Z' },
      { name: 'product_view', sessionId: 'traffic-b', source: 'instagram', occurredAt: '2026-09-18T11:01:00.000Z' },
    )
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    const response = await app.request('/api/admin/analytics/traffic?from=2026-09-18&to=2026-09-18', {}, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { visits: 2, sessions: 2, pagesPerSession: 1 } })

    const invalid = await app.request('/api/admin/analytics/traffic?from=not-a-date', {}, env)
    expect(invalid.status).toBe(422)
  })

  it('creates an idempotent pending intent and confirms stock once', async () => {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'intent-api-1' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 3 }], currency: 'USD' }) }
    const first = await app.request('/api/orders/whatsapp', init)
    const firstBody = await first.json() as { data: { id: string; reference: string; status: string }; meta: { reused: boolean } }
    const replay = await app.request('/api/orders/whatsapp', init)
    const replayBody = await replay.json() as { data: { id: string }; meta: { reused: boolean } }
    expect(first.status).toBe(200)
    expect(firstBody.data.status).toBe('PENDING')
    expect(firstBody.data.reference).toBe('CORU-000001')
    expect(replayBody.data.id).toBe(firstBody.data.id)
    expect(replayBody.meta.reused).toBe(true)
    expect(state.products.find((product) => product.id === 'orbita-oscura')?.stockQuantity).toBe(8)

    const confirmed = await app.request(`/api/admin/orders/${firstBody.data.id}/confirm`, { method: 'POST' }, { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' })
    expect(confirmed.status).toBe(200)
    expect(state.products.find((product) => product.id === 'orbita-oscura')?.stockQuantity).toBe(5)
    const secondConfirmation = await app.request(`/api/admin/orders/${firstBody.data.id}/confirm`, { method: 'POST' }, { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' })
    expect(secondConfirmation.status).toBe(409)
    expect(state.products.find((product) => product.id === 'orbita-oscura')?.stockQuantity).toBe(5)
  })

  it('uses the Worker rate when a Bs client omits or stales its display hint', async () => {
    const response = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'intent-api-bs' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 3 }], currency: 'Bs', rateMicros: 1 }) })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { rateMicros?: number; whatsappUrl: string } }
    expect(body.data.rateMicros).toBe(state.currentRateMicros)
    expect(decodeURIComponent(body.data.whatsappUrl)).toContain('Promo: 3 anillos por $10')
  })

  it('does not create new intents while the store is inactive', async () => {
    state.settings.storeActive = false
    const response = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'store-closed' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD' }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'STORE_INACTIVE' } })
    expect(state.orders).toHaveLength(0)
  })

  it('does not create intents for products whose category was deactivated', async () => {
    state.categories.find((category) => category.name === 'Anillos')!.active = false
    const response = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'category-closed' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD' }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'PRODUCT_UNAVAILABLE' } })
    expect(state.orders).toHaveLength(0)
  })

  it('protects admin routes when Access assertion is missing', async () => {
    const response = await app.request('/api/admin/orders')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'ADMIN_AUTH_REQUIRED' } })
  })

  it('records manual stock changes and rejects a negative result', async () => {
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    const setResponse = await app.request('/api/admin/products/orbita-oscura/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'set', quantity: 3, note: 'Conteo físico' }) }, env)
    expect(setResponse.status).toBe(200)
    expect(state.products.find((product) => product.id === 'orbita-oscura')?.stockQuantity).toBe(3)
    expect(state.movements.at(-1)).toMatchObject({ type: 'MANUAL_SET', delta: -5 })
    const conflict = await app.request('/api/admin/products/orbita-oscura/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'adjust', delta: -4 }) }, env)
    expect(conflict.status).toBe(409)
    expect(state.products.find((product) => product.id === 'orbita-oscura')?.stockQuantity).toBe(3)
  })

  it('records a movement when the product editor changes stock', async () => {
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    const response = await app.request('/api/admin/products/orbita-oscura', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stockQuantity: 4 }) }, env)
    expect(response.status).toBe(200)
    expect(state.products.find((product) => product.id === 'orbita-oscura')?.stockQuantity).toBe(4)
    expect(state.movements.at(-1)).toMatchObject({ type: 'MANUAL_SET', delta: -4 })
  })

  it('supports admin catalog, category and settings mutations in the local adapter', async () => {
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    const categoryResponse = await app.request('/api/admin/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pulseras' }) }, env)
    expect(categoryResponse.status).toBe(201)
    const productResponse = await app.request('/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pulsera demo', category: 'Anillos', sizeLabel: 'Talla única', priceCents: 900, stockQuantity: 2, artwork: 'orbita' }) }, env)
    expect(productResponse.status).toBe(201)
    const settingsResponse = await app.request('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whatsappPhone: '+58 412 555 1212' }) }, env)
    expect(settingsResponse.status).toBe(200)
    expect((await settingsResponse.json() as { data: { whatsappPhone: string } }).data.whatsappPhone).toBe('584125551212')
    const rateResponse = await app.request('/api/admin/settings/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rateMicros: 40_500_000 }) }, env)
    expect(rateResponse.status).toBe(200)
    expect((await rateResponse.json() as { data: { rateMicros: number } }).data.rateMicros).toBe(40_500_000)
  })

  it('keeps product and promotion category references coherent after a rename', async () => {
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    const response = await app.request('/api/admin/categories/cat-anillos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Aros' }) }, env)
    expect(response.status).toBe(200)
    expect(state.products.filter((product) => product.category === 'Anillos')).toHaveLength(0)
    expect(state.products.some((product) => product.category === 'Aros')).toBe(true)
    expect(state.promotions.find((promotion) => promotion.id === 'promo-3x10')?.targetCategory).toBe('Aros')
  })

  it('rejects overlapping active promotion rules', async () => {
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    const response = await app.request('/api/admin/promotions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Otro combo', kind: 'BUNDLE', targetCategory: 'Anillos', bundleQuantity: 3, bundlePriceCents: 900, active: true }) }, env)
    expect(response.status).toBe(409)
    expect((await response.json() as { error: { code: string } }).error.code).toBe('CONFLICT')
  })
})
