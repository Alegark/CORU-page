import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/worker/app'
import { createPendingOrder } from '../src/worker/services/order.service'
import { resetState, state } from '../src/worker/state'

describe('CORU Worker API contracts', () => {
  beforeEach(() => resetState())

  it('returns a public catalog without internal stock flags', async () => {
    const response = await app.request('/api/catalog')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=30, stale-while-revalidate=60')
    const body = await response.json() as { data: Array<Record<string, unknown>> }
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data[0]).not.toHaveProperty('stockQuantity')
    expect(body.data[0]).not.toHaveProperty('promoEligible')
    expect(body.data[0]).toHaveProperty('promotionEligible', true)
  })

  it('keeps public SPA routes outside the administrative auth boundary', async () => {
    const requested: string[] = []
    const assets = {
      fetch: async (request: Request) => {
        requested.push(new URL(request.url).pathname)
        return new Response('<!doctype html><html><head><title>CORU</title><meta name="description" content="x" /></head><body><div id="root"></div></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
      },
    }

    for (const path of ['/guia-de-tallas', '/privacidad']) {
      const response = await app.request(path, {}, { ENVIRONMENT: 'production', TEAM_DOMAIN: 'https://auth.example.com', POLICY_AUD: 'coru', ASSETS: assets })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      const html = await response.text()
      expect(html).toContain('<title>')
      expect(html).toContain('rel="canonical"')
    }

    // SEO injection fetches the SPA shell from `/`, not the navigation path.
    expect(requested.every((path) => path === '/')).toBe(true)
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

  it('removes empty admin categories but archives categories with products', async () => {
    state.categories.push({ id: 'empty-category', slug: 'empty-category', name: 'Vacía', sortOrder: 3, active: false })
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }

    const removed = await app.request('/api/admin/categories/empty-category', { method: 'DELETE' }, env)
    expect(removed.status).toBe(200)
    expect((await removed.json() as { data: { active: boolean } }).data.active).toBe(false)
    expect(state.categories.some((category) => category.id === 'empty-category')).toBe(false)

    const archived = await app.request('/api/admin/categories/cat-anillos', { method: 'DELETE' }, env)
    expect(archived.status).toBe(200)
    expect(state.categories.find((category) => category.id === 'cat-anillos')?.active).toBe(false)
  })

  it('serves only an approved product image through a public proxy', async () => {
    const image = { id: 'image-1', productId: 'orbita-oscura', originalKey: 'products/orbita-oscura/original/image-1.jpg', processedKey: 'products/orbita-oscura/processed/image-1.webp', mimeType: 'image/jpeg' as const, byteSize: 2, sortOrder: 1, processingStatus: 'FAILED' as const, approvedVariant: 'original' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    state.images.set(image.id, image)
    state.media.set(image.originalKey, new Uint8Array([1, 2]).buffer)
    const catalog = await (await app.request('/api/catalog')).json() as { data: Array<Record<string, unknown>> }
    expect(catalog.data[0].imageUrl).toBe('/api/products/orbita-oscura/image')
    expect(catalog.data[0].imageUrls).toEqual(['/api/products/orbita-oscura/images/image-1'])
    expect(catalog.data[0].imageSources).toEqual([{
      id: 'image-1',
      src: '/media/products/image-1/detail-1200.webp',
      thumb320: '/media/products/image-1/thumb-320.webp',
      thumb640: '/media/products/image-1/thumb-640.webp',
      detail1200: '/media/products/image-1/detail-1200.webp',
      og1200: '/media/products/image-1/og-1200.jpg',
    }])
    const fallbackVariant = await app.request('/media/products/image-1/thumb-320.webp')
    expect(fallbackVariant.status).toBe(200)
    expect(fallbackVariant.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=30, stale-while-revalidate=60')
    expect(fallbackVariant.headers.get('x-coru-media-variant')).toBe('fallback-original')
    expect(new Uint8Array(await fallbackVariant.arrayBuffer())).toEqual(new Uint8Array([1, 2]))
    state.media.set('products/orbita-oscura/variants/image-1/thumb-320.webp', new Uint8Array([3, 4, 5]).buffer)
    const optimizedVariant = await app.request('/media/products/image-1/thumb-320.webp')
    expect(optimizedVariant.headers.get('content-type')).toContain('image/webp')
    expect(optimizedVariant.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(optimizedVariant.headers.get('x-coru-media-variant')).toBe('thumb-320')
    expect(new Uint8Array(await optimizedVariant.arrayBuffer())).toEqual(new Uint8Array([3, 4, 5]))
    const response = await app.request('/api/products/orbita-oscura/image')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/jpeg')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2]))
    const specific = await app.request('/api/products/orbita-oscura/images/image-1')
    expect(specific.status).toBe(200)
    expect(new Uint8Array(await specific.arrayBuffer())).toEqual(new Uint8Array([1, 2]))
  })

  it('includes a private preview URL for product photos in the admin catalog', async () => {
    const image = { id: 'admin-image-1', productId: 'orbita-oscura', originalKey: 'products/orbita-oscura/original/admin-image-1.jpg', mimeType: 'image/jpeg' as const, byteSize: 2, sortOrder: 1, processingStatus: 'READY' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    state.images.set(image.id, image)

    const response = await app.request('/api/admin/products', {}, { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: Array<{ id: string; imageUrl?: string; imageSources?: Array<{ src: string }> }> }
    const product = body.data.find((entry) => entry.id === 'orbita-oscura')
    expect(product).toMatchObject({
      imageUrl: '/api/admin/products/orbita-oscura/images/admin-image-1/preview',
      imageSources: [{ src: '/api/admin/products/orbita-oscura/images/admin-image-1/preview' }],
    })
  })

  it('stores normal product uploads and persists their explicit gallery order', async () => {
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    const upload = (body: number[]) => app.request('/api/admin/products/orbita-oscura/images', { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Image-Mime': 'image/png' }, body: new Uint8Array(body) }, env)
    const first = await upload([1, 2])
    const second = await upload([3, 4])
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const firstImage = (await first.json() as { data: { id: string; processingStatus: string; approvedVariant: string; sortOrder: number } }).data
    const secondImage = (await second.json() as { data: { id: string; processingStatus: string; approvedVariant: string; sortOrder: number } }).data
    expect(firstImage).toMatchObject({ processingStatus: 'READY', approvedVariant: 'original', sortOrder: 1 })
    expect(secondImage.sortOrder).toBe(2)
    const preview = await app.request(`/api/admin/products/orbita-oscura/images/${firstImage.id}/preview`, {}, env)
    expect(preview.status).toBe(200)
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(new Uint8Array([1, 2]))

    const reordered = await app.request('/api/admin/products/orbita-oscura/images/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [secondImage.id, firstImage.id] }) }, env)
    expect(reordered.status).toBe(200)
    expect((await reordered.json() as { data: Array<{ id: string; sortOrder: number }> }).data.map((image) => [image.id, image.sortOrder])).toEqual([[secondImage.id, 1], [firstImage.id, 2]])
  })

  it('rejects malformed order intents with the stable validation envelope', async () => {
    const response = await app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'invalid-1' }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 0 }], currency: 'USD' }) })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  it('exposes anonymous traffic statistics through the protected admin endpoint', async () => {
    state.analytics.push(
      { name: 'catalog_view', sessionId: 'traffic-a', source: 'directo', occurredAt: '2026-09-18T10:00:00.000Z', properties: { visitorId: 'visitor-a', sessionModel: 'idle30-v1' } },
      { name: 'catalog_view', sessionId: 'traffic-a', source: 'directo', occurredAt: '2026-09-18T10:01:00.000Z', properties: { visitorId: 'visitor-a', sessionModel: 'idle30-v1' } },
      { name: 'catalog_view', sessionId: 'traffic-b', source: 'instagram', occurredAt: '2026-09-18T11:00:00.000Z', properties: { visitorId: 'visitor-b', sessionModel: 'idle30-v1' } },
      { name: 'product_view', sessionId: 'traffic-b', source: 'instagram', occurredAt: '2026-09-18T11:01:00.000Z', properties: { visitorId: 'visitor-b', sessionModel: 'idle30-v1' } },
    )
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    const response = await app.request('/api/admin/analytics/traffic?from=2026-09-18&to=2026-09-18', {}, env)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { visits: 2, pageViews: 4, sessions: 2, uniqueVisitors: 2, pagesPerSession: 2 } })

    const invalid = await app.request('/api/admin/analytics/traffic?from=not-a-date', {}, env)
    expect(invalid.status).toBe(422)
  })

  it('accepts privacy and not-found page views with the new session model', async () => {
    const response = await app.request('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [
        { name: 'privacy_view', sessionId: 'tracked-session', source: 'directo', occurredAt: new Date().toISOString(), properties: { visitorId: 'visitor-a', device: 'mobile', sessionModel: 'idle30-v1' } },
        { name: 'not_found_view', sessionId: 'tracked-session', source: 'directo', occurredAt: new Date().toISOString(), properties: { visitorId: 'visitor-a', device: 'mobile', sessionModel: 'idle30-v1' } },
      ] }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { accepted: 2 } })
    expect(state.analytics.map((event) => event.name)).toEqual(['privacy_view', 'not_found_view'])
  })

  it('silently drops analytics from Cloudflare Access browsers and bots', async () => {
    const payload = {
      events: [{ name: 'catalog_view', sessionId: 'internal-session', source: 'directo', occurredAt: new Date().toISOString(), properties: { visitorId: 'visitor-a', device: 'mobile', sessionModel: 'idle30-v1' } }],
    }
    const access = await app.request('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'CF_Authorization=eyJhbGciOiJSUzI1NiJ9.example' },
      body: JSON.stringify(payload),
    })
    expect(access.status).toBe(200)
    expect(await access.json()).toEqual({ data: { accepted: 0 } })
    expect(state.analytics).toHaveLength(0)

    const bot = await app.request('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'facebookexternalhit/1.1' },
      body: JSON.stringify(payload),
    })
    expect(bot.status).toBe(200)
    expect(await bot.json()).toEqual({ data: { accepted: 0 } })
    expect(state.analytics).toHaveLength(0)
  })

  it('clamps skewed client timestamps on ingest', async () => {
    const response = await app.request('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [
        { name: 'catalog_view', sessionId: 'skew-session', source: 'directo', occurredAt: '2020-01-01T00:00:00.000Z', properties: { visitorId: 'visitor-skew', device: 'mobile', sessionModel: 'idle30-v1' } },
      ] }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { accepted: 1 } })
    const occurredAt = Date.parse(state.analytics[0]!.occurredAt)
    expect(Math.abs(occurredAt - Date.now())).toBeLessThan(5_000)
  })

  it('exposes the V2 summary and product interest behind the admin guard', async () => {
    state.analytics.push(
      { name: 'catalog_view', sessionId: 'summary-a', source: 'ig', occurredAt: '2026-09-18T10:00:00.000Z', properties: { visitorId: 'summary-visitor', device: 'mobile', sessionModel: 'idle30-v1' } },
      { name: 'product_view', sessionId: 'summary-a', source: 'instagram', occurredAt: '2026-09-18T10:01:00.000Z', properties: { visitorId: 'summary-visitor', productId: 'orbita-oscura', productName: 'Órbita oscura', unitPriceCents: 400, device: 'mobile', sessionModel: 'idle30-v1' } },
      { name: 'cart_add', sessionId: 'summary-a', source: 'instagram', occurredAt: '2026-09-18T10:02:00.000Z', properties: { visitorId: 'summary-visitor', productId: 'orbita-oscura', quantityDelta: 2, unitPriceCents: 400, device: 'mobile', sessionModel: 'idle30-v1' } },
      { name: 'order_intent', sessionId: 'summary-a', source: 'instagram', occurredAt: '2026-09-18T10:03:00.000Z', properties: { visitorId: 'summary-visitor', device: 'mobile', sessionModel: 'idle30-v1' } },
    )
    createPendingOrder(state, [{ productId: 'orbita-oscura', quantity: 1 }], 'USD', undefined, 'summary-wa-1', new Date('2026-09-18T10:04:00.000Z'))
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    const summary = await app.request('/api/admin/analytics/summary?from=2026-09-18&to=2026-09-18', {}, env)
    expect(summary.status).toBe(200)
    expect(await summary.json()).toMatchObject({ data: { kpis: { pageViews: 2, sessions: 1, uniqueVisitors: 1, unitsAdded: 2, whatsappIntents: 1 }, commercial: { potentialValueCents: 800 } } })
    const products = await app.request('/api/admin/analytics/products?from=2026-09-18&to=2026-09-18', {}, env)
    expect(products.status).toBe(200)
    expect(await products.json()).toMatchObject({ data: { products: [{ productId: 'orbita-oscura', interestScore: 7, unitsAdded: 2 }] } })
    const publicResponse = await app.request('/api/admin/analytics/summary?from=2026-09-18&to=2026-09-18')
    expect(publicResponse.status).toBe(403)
  })

  it('protects cart-add analytics deletion and refuses without durable storage', async () => {
    const forbidden = await app.request('/api/admin/analytics/cart-add', { method: 'DELETE' })
    expect(forbidden.status).toBe(403)

    const unavailable = await app.request('/api/admin/analytics/cart-add', { method: 'DELETE' }, { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' })
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ error: { code: 'PERSISTENCE_UNAVAILABLE' } })
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
    const whatsapp = decodeURIComponent(body.data.whatsappUrl)
    expect(whatsapp).not.toContain('- Promoción:')
    expect(whatsapp.endsWith('NOTA: Tasa asegurada hasta finalizar hoy.')).toBe(true)
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

  it('uses Binance P2P when the configured rate relay returns an error', async () => {
    state.rateMode = 'AUTOMATIC'
    state.rateSource = 'PERSISTED'
    state.currentRateMicros = 950_000_000
    state.rateUpdatedAt = new Date(Date.now() - 13 * 60 * 1000).toISOString()
    state.rateValidUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const requested: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      requested.push(url)
      if (url === 'https://relay.example.test/rate') return new Response('{}', { status: 502 })
      return new Response(JSON.stringify({ code: '000000', data: [{ adv: { asset: 'USDT', fiatUnit: 'VES', price: '985.5' } }] }), { status: 200 })
    })
    try {
      const response = await app.request('/api/exchange-rate', {}, { ENVIRONMENT: 'production', EXCHANGE_RATE_URL: 'https://relay.example.test/rate' })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ data: { available: true, rateMicros: 985_500_000 } })
      expect(requested).toHaveLength(2)
      expect(requested[0]).toBe('https://relay.example.test/rate')
      expect(requested[1]).toContain('/bapi/c2c/v2/friendly/c2c/adv/search')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the last valid rate and returns an admin-visible emergency status when all providers fail', async () => {
    state.rateMode = 'AUTOMATIC'
    state.rateSource = 'PERSISTED'
    state.currentRateMicros = 962_999_000
    state.rateUpdatedAt = '2026-09-22T18:00:00.000Z'
    state.rateValidUntil = '2099-09-22T23:59:59.000Z'
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 502 }))
    try {
      const response = await app.request('/api/admin/settings/rate/refresh', { method: 'POST' }, { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local', EXCHANGE_RATE_URL: 'https://relay.example.test/rate' })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ data: {
        available: true,
        rateMicros: 962_999_000,
        updated: false,
        lastRefreshError: expect.stringContaining('HTTP 502'),
        lastRefreshAttemptedAt: expect.any(String),
      } })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('continues serving the last persisted public rate when refresh and fallback both fail', async () => {
    state.rateMode = 'AUTOMATIC'
    state.rateSource = 'PERSISTED'
    state.currentRateMicros = 962_999_000
    state.rateUpdatedAt = new Date(Date.now() - 13 * 60 * 1000).toISOString()
    state.rateValidUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 502 }))
    try {
      const response = await app.request('/api/exchange-rate', {}, { ENVIRONMENT: 'production', EXCHANGE_RATE_URL: 'https://relay.example.test/rate' })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ data: { available: true, rateMicros: 962_999_000, updatedAt: state.rateUpdatedAt } })
      expect(state.rateRefreshError).toContain('HTTP 502')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('derives ring measurements when an admin product only supplies the diameter', async () => {
    const response = await app.request('/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Anillo medido', category: 'Anillos', sizeLabel: 'Talla única', priceCents: 1200, stockQuantity: 1, artwork: 'orbita', innerDiameterMm: 17.3 }) }, { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' })
    expect(response.status).toBe(201)
    expect((await response.json() as { data: { innerDiameterMm: number; circumferenceMm: number; usSize: string } }).data).toMatchObject({ innerDiameterMm: 17.3, circumferenceMm: 54.4, usSize: '7' })
  })

  it('does not acknowledge a product edit before Turso confirms the durable write', async () => {
    const originalFetch = globalThis.fetch
    const capturedProductArgs: unknown[] = []
    const seenSql: string[] = []
    let resolveProductWrite: (() => void) | undefined
    let productWriteStarted = false
    let productWriteResponse: Promise<Response> | undefined
    let productWriteCommitted = false
    let request: Promise<Response> | undefined
    const names = new Set(['fulfillment_type', 'measurements_text', 'inner_diameter_mm', 'circumference_mm', 'us_size', 'lead_time'])
    const result = (rows: Record<string, unknown>[] = [], rowsAffected = 0) => ({ rows, rowsAffected })
    const responseFor = (value: { rows: Record<string, unknown>[]; rowsAffected: number }) => {
      const cols = Object.keys(value.rows[0] ?? {}).map((name) => ({ name }))
      const rows = value.rows.map((row) => cols.map((column) => row[column.name] ?? null))
      return new Response(JSON.stringify({ results: [{ type: 'ok', response: { result: { cols, rows, affected_row_count: value.rowsAffected } } }, { type: 'ok', response: { type: 'close' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { requests: Array<{ stmt?: { sql: string; args: unknown[] } }> }
      const sql = body.requests[0]?.stmt?.sql ?? ''
      seenSql.push(sql)
      if (sql.includes('INSERT INTO products')) {
        productWriteStarted = true
        capturedProductArgs.push(...(body.requests[0]?.stmt?.args ?? []))
        productWriteResponse = new Promise<Response>((resolve) => { resolveProductWrite = () => { productWriteCommitted = true; resolve(responseFor(result([], 1))) } })
        return productWriteResponse
      }
      if (sql === 'PRAGMA table_info(products)') return responseFor(result([...names].map((name) => ({ name }))))
      if (sql === 'PRAGMA table_info(product_images)') return responseFor(result([{ name: 'sort_order' }, { name: 'thumb_320_key' }, { name: 'thumb_640_key' }, { name: 'detail_1200_key' }]))
      if (sql.includes('SELECT COUNT(*) AS count')) return responseFor(result([{ count: 0 }]))
      if (sql.startsWith('SELECT id, slug, name, sort_order')) return responseFor(result([{ id: 'cat-db', slug: 'anillos', name: 'Anillos', sort_order: 1, is_active: 1 }]))
      if (sql.includes('FROM products p JOIN categories')) return responseFor(result([{ id: 'prod-1', slug: 'anillo-persistido', name: 'Anillo persistido', category_name: 'Anillos', size_label: 'Talla única', price_cents: 400, stock_quantity: 1, is_active: 1, promo_eligible: 1, fulfillment_type: 'STOCK', image_approved: 1, artwork: 'orbita', description: 'Persistido', material: 'Acero', inner_diameter_mm: productWriteCommitted ? 17.3 : null, circumference_mm: productWriteCommitted ? 54.4 : null, us_size: productWriteCommitted ? '7' : null }]))
      return responseFor(result())
    })

    try {
      const executionCtx = { waitUntil: (_promise: Promise<unknown>) => undefined } as Parameters<typeof app.request>[3]
      const currentRequest = Promise.resolve(app.request('/api/admin/products/prod-1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ innerDiameterMm: 17.3, circumferenceMm: 54.4, usSize: '7' }) }, { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local', TURSO_DATABASE_URL: 'https://coru-save-test.turso.io', TURSO_AUTH_TOKEN: 'test-token' }, executionCtx))
      request = currentRequest
      for (let attempt = 0; attempt < 100 && !productWriteStarted; attempt += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(productWriteStarted, seenSql.join(' | ')).toBe(true)
      let settled = false
      void currentRequest.then(() => { settled = true })
      await Promise.resolve()
      expect(settled).toBe(false)
      resolveProductWrite?.()
      const response = await currentRequest
      expect(response.status).toBe(200)
      expect(JSON.stringify(capturedProductArgs)).toContain('17.3')
      expect(JSON.stringify(capturedProductArgs)).toContain('54.4')
      expect(JSON.stringify(capturedProductArgs)).toContain('7')

      state.products[0].innerDiameterMm = undefined
      state.products[0].circumferenceMm = undefined
      state.products[0].usSize = undefined
      const refreshed = await app.request('/api/admin/products', {}, { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local', TURSO_DATABASE_URL: 'https://coru-save-test.turso.io', TURSO_AUTH_TOKEN: 'test-token' })
      expect(refreshed.status).toBe(200)
      expect((await refreshed.json() as { data: Array<{ innerDiameterMm?: number; circumferenceMm?: number; usSize?: string }> }).data[0]).toMatchObject({ innerDiameterMm: 17.3, circumferenceMm: 54.4, usSize: '7' })
    } finally {
      resolveProductWrite?.()
      vi.unstubAllGlobals()
      globalThis.fetch = originalFetch
      await request?.catch(() => undefined)
    }
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

  it('deactivates active promotions and permanently removes inactive ones', async () => {
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    state.promotions.push({ id: 'old-promo', name: 'Promoción vencida', kind: 'FIXED_DISCOUNT', fixedDiscountCents: 200, active: false })

    const deactivated = await app.request('/api/admin/promotions/promo-3x10', { method: 'DELETE' }, env)
    expect(deactivated.status).toBe(200)
    expect((await deactivated.json() as { data: { active: boolean } }).data.active).toBe(false)

    const removed = await app.request('/api/admin/promotions/old-promo', { method: 'DELETE' }, env)
    expect(removed.status).toBe(200)
    expect((await removed.json() as { data: { id: string; active: boolean } }).data).toMatchObject({ id: 'old-promo', active: false })
    expect(state.promotions.some((promotion) => promotion.id === 'old-promo')).toBe(false)

    const missing = await app.request('/api/admin/promotions/old-promo', { method: 'DELETE' }, env)
    expect(missing.status).toBe(404)
  })

  it('deactivates active products and permanently removes inactive ones', async () => {
    const env = { DEV_ADMIN_BYPASS: 'true', ENVIRONMENT: 'local' }
    state.products.push({ ...state.products[0], id: 'retired-product', slug: 'retired-product', name: 'Producto retirado', active: false })

    const deactivated = await app.request('/api/admin/products/orbita-oscura', { method: 'DELETE' }, env)
    expect(deactivated.status).toBe(200)
    expect((await deactivated.json() as { data: { active: boolean } }).data.active).toBe(false)

    const removed = await app.request('/api/admin/products/retired-product', { method: 'DELETE' }, env)
    expect(removed.status).toBe(200)
    expect((await removed.json() as { data: { id: string; active: boolean } }).data).toMatchObject({ id: 'retired-product', active: false })
    expect(state.products.some((product) => product.id === 'retired-product')).toBe(false)

    const missing = await app.request('/api/admin/products/retired-product', { method: 'DELETE' }, env)
    expect(missing.status).toBe(404)
  })
})
