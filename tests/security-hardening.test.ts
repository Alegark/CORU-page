import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/worker/app'
import { getCachedAccessJwksForTests, resetAccessJwksCacheForTests } from '../src/worker/middleware/access'
import * as persistence from '../src/worker/persistence'
import { checkAndReserveOrderIntent, ensureDeviceToken, resolveAbuseSecret, LOCAL_DEVELOPMENT_ABUSE_SECRET } from '../src/worker/services/order-abuse.service'
import { refreshRate, setManualRate } from '../src/worker/services/exchange-rate.service'
import { resetState, state } from '../src/worker/state'
import type { Order } from '../src/shared/types'

const persistedOrder = {
  id: 'order-persisted-replay',
  reference: 'CORU-000042',
  createdAt: '2026-09-22T12:00:00.000Z',
  status: 'PENDING',
  currency: 'USD',
  items: [{ productId: 'orbita-oscura', quantity: 1, name: 'Órbita oscura', sizeLabel: 'Talla única', unitPriceCents: 400, lineTotalCents: 400 }],
  quote: { subtotalCents: 400, discountCents: 0, totalCents: 400 },
  whatsappUrl: 'https://wa.me/584120000000',
} as Order

describe('security hardening', () => {
  beforeEach(() => {
    resetState()
    resetAccessJwksCacheForTests()
    vi.restoreAllMocks()
  })

  describe('abuse secret resolution', () => {
    it('uses the local development secret when env is missing or non-production', () => {
      expect(resolveAbuseSecret(undefined)).toBe(LOCAL_DEVELOPMENT_ABUSE_SECRET)
      expect(resolveAbuseSecret({ ENVIRONMENT: 'local' })).toBe(LOCAL_DEVELOPMENT_ABUSE_SECRET)
      expect(resolveAbuseSecret({ ENVIRONMENT: 'production', CORU_ABUSE_SECRET: 'too-short' })).toBeUndefined()
      expect(resolveAbuseSecret({ ENVIRONMENT: 'production' })).toBeUndefined()
      expect(resolveAbuseSecret({ ENVIRONMENT: 'production', CORU_ABUSE_SECRET: 'x'.repeat(32) })).toBe('x'.repeat(32))
    })

    it('fails closed in production when the abuse secret is missing', async () => {
      const response = await app.request('/api/orders/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'prod-guard-1' },
        body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD', shipping: { method: 'PERSONAL', deliveryPointId: 'coru-punto-central' } }),
      }, { ENVIRONMENT: 'production' })
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: { code: 'ORDER_INTENT_GUARD_UNAVAILABLE' } })
      expect(state.orders).toHaveLength(0)
    })

    it('rejects a tampered device cookie signature without accepting it', async () => {
      const secret = LOCAL_DEVELOPMENT_ABUSE_SECRET
      const device = await ensureDeviceToken(new Request('https://coru.test/'), secret)
      const [value] = device.token.split('.')
      const tampered = new Request('https://coru.test/', { headers: { Cookie: `coru_device=${value}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` } })
      const decision = await checkAndReserveOrderIntent(state, tampered, new Date(), secret)
      expect(decision.allowed).toBe(true)
      expect(decision.setCookie).toBeTruthy()
    })
  })

  describe('cross-isolate idempotency replay', () => {
    it('returns a durable order before the anti-abuse guard runs', async () => {
      const database = { execute: async () => ({ rows: [], rowsAffected: 0 }) }
      vi.spyOn(persistence, 'ensureStateHydrated').mockResolvedValue(database as never)
      vi.spyOn(persistence, 'hydrateCatalogFromDatabase').mockResolvedValue(undefined)
      const find = vi.spyOn(persistence, 'findPersistedOrder').mockResolvedValue(persistedOrder)
      const countersBefore = state.abuseCounters.size

      const response = await app.request('/api/orders/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'durable-replay-1' },
        body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD' }),
      }, { ENVIRONMENT: 'local', TURSO_DATABASE_URL: 'https://coru-replay.turso.io', TURSO_AUTH_TOKEN: 'token' })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: persistedOrder, meta: { reused: true } })
      expect(find).toHaveBeenCalledWith(database, 'durable-replay-1')
      expect(state.idempotency.get('durable-replay-1')).toEqual(persistedOrder)
      expect(state.abuseCounters.size).toBe(countersBefore)
      expect(state.orders).toHaveLength(0)
    })
  })

  describe('Access JWKS cache', () => {
    it('reuses the same JWKS instance across requests for one issuer', async () => {
      const originalFetch = globalThis.fetch
      vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }))
      try {
        const env = { ENVIRONMENT: 'production', TEAM_DOMAIN: 'https://auth.example.com', POLICY_AUD: 'coru-audience' }
        const headers = { 'Cf-Access-Jwt-Assertion': 'not.a.valid.jwt' }
        const first = await app.request('/api/admin/products', { headers }, env)
        const second = await app.request('/api/admin/products', { headers }, env)
        expect(first.status).toBe(403)
        expect(second.status).toBe(403)
        const cached = getCachedAccessJwksForTests('https://auth.example.com')
        expect(cached).toBeDefined()
        expect(getCachedAccessJwksForTests('https://auth.example.com')).toBe(cached)
      } finally {
        vi.unstubAllGlobals()
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('security headers', () => {
    it('sets baseline headers on API responses and HSTS only in production', async () => {
      const local = await app.request('/api/health')
      expect(local.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(local.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
      expect(local.headers.get('X-Frame-Options')).toBe('DENY')
      expect(local.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=()')
      expect(local.headers.get('Strict-Transport-Security')).toBeNull()

      const production = await app.request('/api/health', {}, { ENVIRONMENT: 'production' })
      expect(production.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains')
    })

    it('does not overwrite an existing media nosniff header', async () => {
      const image = {
        id: 'image-sec',
        productId: 'orbita-oscura',
        originalKey: 'products/orbita-oscura/original/image-sec.jpg',
        processedKey: undefined,
        mimeType: 'image/jpeg' as const,
        byteSize: 2,
        sortOrder: 1,
        processingStatus: 'FAILED' as const,
        approvedVariant: 'original' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      state.images.set(image.id, image)
      state.media.set(image.originalKey, new Uint8Array([1, 2]).buffer)
      state.media.set('products/orbita-oscura/variants/image-sec/thumb-320.webp', new Uint8Array([3]).buffer)
      const response = await app.request('/media/products/image-sec/thumb-320.webp')
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    })
  })

  describe('exchange-rate plausibility', () => {
    it('rejects an automatic observation that jumps more than 25% within 24h', async () => {
      state.rateMode = 'AUTOMATIC'
      state.rateSource = 'PERSISTED'
      state.currentRateMicros = 1_000_000_000
      state.rateUpdatedAt = '2026-09-22T12:00:00.000Z'
      const now = new Date('2026-09-22T18:00:00.000Z')
      const result = await refreshRate(state, { getRate: async () => '1300' }, now)
      expect(result.updated).toBe(false)
      expect(state.currentRateMicros).toBe(1_000_000_000)
      expect(state.rateRefreshError).toBe('La tasa recibida varió más de 25% y se descartó.')
    })

    it('accepts a plausible automatic refresh and still allows large bootstrap jumps', async () => {
      state.rateMode = 'AUTOMATIC'
      state.rateSource = 'PERSISTED'
      state.currentRateMicros = 1_000_000_000
      state.rateUpdatedAt = '2026-09-22T12:00:00.000Z'
      const ok = await refreshRate(state, { getRate: async () => '1100' }, new Date('2026-09-22T18:00:00.000Z'))
      expect(ok.updated).toBe(true)
      expect(state.currentRateMicros).toBe(1_100_000_000)

      resetState()
      state.rateMode = 'AUTOMATIC'
      const bootstrap = await refreshRate(state, { getRate: async () => '990.75' }, new Date('2026-09-22T19:00:00.000Z'))
      expect(bootstrap.updated).toBe(true)
      expect(state.currentRateMicros).toBe(990_750_000)
    })

    it('does not apply the plausibility guard to manual rates', () => {
      state.rateMode = 'AUTOMATIC'
      state.rateSource = 'PERSISTED'
      state.currentRateMicros = 1_000_000_000
      state.rateUpdatedAt = '2026-09-22T12:00:00.000Z'
      const result = setManualRate(state, '2000', new Date('2026-09-22T18:00:00.000Z'))
      expect(result.rateMicros).toBe(2_000_000_000)
      expect(state.rateMode).toBe('MANUAL')
    })
  })
})
