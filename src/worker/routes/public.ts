import { Hono } from 'hono'
import type { Context } from 'hono'
import { getPublicProducts, getProductBySlug } from '../../shared/catalog'
import type { ApiError, ApiSuccess, PublicProduct, PublicPromotion } from '../../shared/contracts'
import { parseAnalyticsInput, parseOrderIntentInput } from '../../shared/validation'
import type { CoruEnv } from '../env'
import { state } from '../state'
import { createPendingOrder, OrderServiceError, reassignOrderReference, validateOrderIntent } from '../services/order.service'
import { checkAndReserveOrderIntent } from '../services/order-abuse.service'
import { quoteYummyDelivery } from '../services/yummy.service'
import { createHttpRateProvider, getPublicRate, refreshRate } from '../services/exchange-rate.service'
import { createBinanceP2pProvider } from '../services/exchange-rate/binance-p2p.adapter'
import { recordAnalytics } from '../services/analytics.service'
import { findActivePromotion, findPersistedOrder, hydrateCatalogFromDatabase, persistAnalytics, persistPendingOrder, persistRate, schedulePersistence } from '../persistence'
import { MemoryMediaStore, R2MediaStore, type R2BucketLike } from '../adapters/r2'
import { OrderRepository } from '../../db/repositories/orders.repository'

function activePromotion(now = new Date()) {
  return state.settings.storeActive ? state.promotions.find((candidate) => candidate.active && (!candidate.startsAt || now >= new Date(candidate.startsAt)) && (!candidate.endsAt || now <= new Date(candidate.endsAt))) : undefined
}

async function activePromotionForRequest(c: Context<CoruEnv>, now = new Date()) {
  const database = c.get('database')
  if (!database) return activePromotion(now)
  try {
    // Public reads must not depend on a stale isolate-local promotion list.
    // Turso is the durable source of truth for configured Workers.
    return await findActivePromotion(database, now)
  } catch {
    return activePromotion(now)
  }
}

async function refreshCatalogForRequest(c: Context<CoruEnv>): Promise<void> {
  const database = c.get('database')
  if (database) await hydrateCatalogFromDatabase(state, database)
}

function toPublicProduct(product: ReturnType<typeof getPublicProducts>[number], promotion = activePromotion()): PublicProduct {
  const { stockQuantity: _stock, active: _active, primaryImageApproved: _approved, promoEligible: _promo, ...publicProduct } = product
  const hasApprovedImage = [...state.images.values()].some((image) => image.productId === product.id && Boolean(image.approvedVariant))
  return { ...publicProduct, promotionEligible: Boolean(promotion && product.promoEligible && (!promotion.targetCategory || product.category === promotion.targetCategory)), ...(hasApprovedImage ? { imageUrl: `/api/products/${encodeURIComponent(product.slug)}/image` } : {}) }
}

function mediaStorage(env: CoruEnv['Bindings']): MemoryMediaStore | R2MediaStore {
  const bindings = env ?? {}
  if (bindings.CORU_MEDIA && typeof bindings.CORU_MEDIA === 'object' && 'put' in bindings.CORU_MEDIA) return new R2MediaStore(bindings.CORU_MEDIA as R2BucketLike)
  return new MemoryMediaStore(state.media)
}

function publicProductForSlug(slug: string) {
  const product = getProductBySlug(state.products, slug)
  if (!state.settings.storeActive || !product || !product.active || !product.primaryImageApproved || ((product.fulfillmentType ?? 'STOCK') === 'STOCK' && product.stockQuantity <= 0) || !state.categories.some((category) => category.active && category.name === product.category)) return undefined
  return product
}

function publicProducts() {
  const activeCategories = new Set(state.categories.filter((category) => category.active).map((category) => category.name))
  return getPublicProducts(state.products).filter((product) => activeCategories.has(product.category))
}

function errorResponse(c: Context<CoruEnv>, error: unknown) {
  if (error instanceof OrderServiceError) {
    const status = error.code === 'RATE_UNAVAILABLE' ? 503 : error.code === 'MIXED_FULFILLMENT' || error.code === 'FULFILLMENT_CHANGED' || error.code === 'DELIVERY_POINT_UNAVAILABLE' ? 409 : error.code === 'PRODUCT_UNAVAILABLE' || error.code === 'STORE_INACTIVE' ? 409 : 409
    return c.json({ error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) } } satisfies ApiError, status)
  }
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado.' } } satisfies ApiError, 500)
}

const AUTOMATIC_RATE_MAX_AGE_MS = 12 * 60 * 1000
let rateRefreshInFlight: Promise<boolean> | null = null

function automaticRateNeedsRefresh(now = new Date()): boolean {
  if (state.rateMode !== 'AUTOMATIC') return false
  if (state.rateSource === 'DEFAULT') return true
  const updatedAt = Date.parse(state.rateUpdatedAt)
  return !Number.isFinite(updatedAt) || now.getTime() - updatedAt >= AUTOMATIC_RATE_MAX_AGE_MS
}

/**
 * Cron is the normal refresh path. The public endpoint also repairs a stale
 * automatic value on demand so a missed/blocked cron cannot expose the
 * bootstrap rate as if it were a live Binance quote. Requests are coalesced
 * per isolate to avoid a burst of visitors creating duplicate provider calls.
 */
async function refreshAutomaticRateIfNeeded(c: Context<CoruEnv>): Promise<boolean> {
  if (c.env?.ENVIRONMENT !== 'production' || !automaticRateNeedsRefresh()) return false
  if (rateRefreshInFlight) return rateRefreshInFlight
  rateRefreshInFlight = (async () => {
    const provider = c.env?.EXCHANGE_RATE_URL ? createHttpRateProvider(c.env.EXCHANGE_RATE_URL) : createBinanceP2pProvider()
    const result = await refreshRate(state, provider)
    if (result.updated) {
      const database = c.get('database')
      if (database) schedulePersistence(c, persistRate(database, state))
    }
    return result.updated
  })().catch(() => false).finally(() => { rateRefreshInFlight = null })
  return rateRefreshInFlight
}

export const publicApi = new Hono<CoruEnv>()

publicApi.get('/api/catalog', async (c) => {
  await refreshCatalogForRequest(c)
  c.header('Cache-Control', 'no-store')
  const promotion = await activePromotionForRequest(c)
  return c.json({ data: state.settings.storeActive ? publicProducts().map((product) => toPublicProduct(product, promotion)) : [] } satisfies ApiSuccess<PublicProduct[]>)
})

publicApi.get('/api/categories', async (c) => {
  await refreshCatalogForRequest(c)
  c.header('Cache-Control', 'no-store')
  return c.json({ data: state.settings.storeActive ? state.categories.filter((category) => category.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(({ id, slug, name, sortOrder }) => ({ id, slug, name, sortOrder })) : [] })
})

publicApi.get('/api/personal-delivery-points', (c) => c.json({ data: state.settings.storeActive ? state.deliveryPoints.filter((point) => point.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(({ id, name, address, shortDescription, latitude, longitude, scheduleText, sortOrder }) => ({ id, name, address, ...(shortDescription ? { shortDescription } : {}), ...(latitude !== undefined ? { latitude } : {}), ...(longitude !== undefined ? { longitude } : {}), ...(scheduleText ? { scheduleText } : {}), sortOrder })) : [] }))

publicApi.post('/api/shipping/yummy/quote', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ data: { status: 'error', fallbackCopy: 'Costo de delivery a confirmar por WhatsApp.' as const } }) }
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const request = { addressText: typeof value.addressText === 'string' ? value.addressText : '', ...(typeof value.latitude === 'number' ? { latitude: value.latitude } : {}), ...(typeof value.longitude === 'number' ? { longitude: value.longitude } : {}) }
  const response = await quoteYummyDelivery(c.env ?? {}, request)
  if (response.status === 'quoted') {
    const externalId = response.externalId ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? `coru-yummy-${crypto.randomUUID()}` : `coru-yummy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
    if (state.yummyQuotes.size >= 500) {
      const oldest = state.yummyQuotes.keys().next().value
      if (typeof oldest === 'string') state.yummyQuotes.delete(oldest)
    }
    state.yummyQuotes.set(externalId, { amountMinor: response.amountMinor, currency: response.currency, quotedAt: response.quotedAt, addressText: request.addressText.trim(), ...(request.latitude !== undefined ? { latitude: request.latitude } : {}), ...(request.longitude !== undefined ? { longitude: request.longitude } : {}) })
    return c.json({ data: { ...response, externalId } })
  }
  return c.json({ data: response })
})

publicApi.get('/api/promotions/active', async (c) => {
  c.header('Cache-Control', 'no-store')
  const promotion = await activePromotionForRequest(c)
  if (!promotion) return c.json({ data: null } satisfies ApiSuccess<PublicPromotion | null>)
  const { id, name, kind, targetCategory, bundleQuantity, bundlePriceCents, fixedDiscountCents } = promotion
  return c.json({ data: { id, name, kind, ...(targetCategory ? { targetCategory } : {}), ...(bundleQuantity !== undefined ? { bundleQuantity } : {}), ...(bundlePriceCents !== undefined ? { bundlePriceCents } : {}), ...(fixedDiscountCents !== undefined ? { fixedDiscountCents } : {}) } } satisfies ApiSuccess<PublicPromotion>)
})

publicApi.get('/api/products/:slug', async (c) => {
  await refreshCatalogForRequest(c)
  c.header('Cache-Control', 'no-store')
  const product = publicProductForSlug(c.req.param('slug'))
  if (!product) return c.json({ error: { code: 'NOT_FOUND', message: 'Producto no encontrado.' } } satisfies ApiError, 404)
  return c.json({ data: toPublicProduct(product, await activePromotionForRequest(c)) } satisfies ApiSuccess<PublicProduct>)
})

publicApi.get('/api/products/:slug/image', async (c) => {
  await refreshCatalogForRequest(c)
  const product = publicProductForSlug(c.req.param('slug'))
  if (!product) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  const image = [...state.images.values()].find((candidate) => candidate.productId === product.id && candidate.approvedVariant)
  if (!image) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  const variant = image.approvedVariant === 'processed' && image.processedKey ? 'processed' : 'original'
  const key = variant === 'processed' ? image.processedKey! : image.originalKey
  const body = await mediaStorage(c.env).get?.(key)
  if (!body) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  return new Response(body, { status: 200, headers: { 'Content-Type': variant === 'processed' ? 'image/webp' : image.mimeType, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } })
})

publicApi.get('/api/exchange-rate', async (c) => {
  // The rate is public and may be cached briefly at the edge. This prevents
  // every storefront visit from issuing a new relay request while keeping the
  // quote fresh well inside the ten-minute Worker refresh cadence.
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=60')
  const needsRefresh = c.env?.ENVIRONMENT === 'production' && automaticRateNeedsRefresh()
  const refreshed = await refreshAutomaticRateIfNeeded(c)
  const publicRate = getPublicRate(state)
  // A failed automatic refresh must fail closed. Showing the bootstrap or an
  // old persisted quote would make a Bs total look current when it is not.
  if (needsRefresh && !refreshed && state.rateMode === 'AUTOMATIC') {
    return c.json({ data: { ...publicRate, available: false, rateMicros: null, updatedAt: null } })
  }
  return c.json({ data: publicRate })
})

publicApi.post('/api/orders/whatsapp', async (c) => {
  await refreshCatalogForRequest(c)
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key || key.length > 120) return c.json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Se requiere Idempotency-Key.' } } satisfies ApiError, 422)
  const replay = state.idempotency.get(key)
  if (replay) return c.json({ data: replay, meta: { reused: true } })
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  const parsed = parseOrderIntentInput(body)
  if (!parsed.ok) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Revisa los datos enviados.', details: parsed.details } } satisfies ApiError, 422)
  try {
    const validated = validateOrderIntent(state, parsed.value.lines, parsed.value.shipping)
    // New storefront clients always submit an explicit shipping selection. A
    // request made directly against the no-bindings in-memory adapter retains
    // the seeded PERSONAL fallback for legacy local fixtures; configured
    // Worker environments enforce the public contract strictly.
    if (c.env !== undefined && validated.fulfillmentType === 'STOCK' && !parsed.value.shipping) return c.json({ error: { code: 'DELIVERY_METHOD_REQUIRED', message: 'Selecciona una modalidad de entrega.' } } satisfies ApiError, 422)
    const guard = await checkAndReserveOrderIntent(state, c.req.raw, new Date(), c.env?.CORU_ABUSE_SECRET ?? state.abuseSecret)
    if (!guard.allowed) {
      if (guard.setCookie) c.header('Set-Cookie', guard.setCookie)
      if (guard.code === 'ORDER_INTENT_GUARD_UNAVAILABLE') return c.json({ error: { code: guard.code, message: 'No se pudo verificar la protección del pedido.' } } satisfies ApiError, 503)
      return c.json({ error: { code: guard.code, message: 'Alcanzaste el límite temporal de solicitudes.', details: { retryAfterSeconds: guard.retryAfterSeconds } } } satisfies ApiError, 429, guard.retryAfterSeconds ? { 'Retry-After': String(guard.retryAfterSeconds) } : undefined)
    }
    if (guard.setCookie) c.header('Set-Cookie', guard.setCookie)
    const promotion = validated.fulfillmentType === 'STOCK' ? (await activePromotionForRequest(c)) ?? null : null
    const result = createPendingOrder(state, parsed.value.lines, parsed.value.currency, parsed.value.rateMicros, key, new Date(), { shipping: parsed.value.shipping, sessionId: parsed.value.sessionId, source: parsed.value.source, promotion })
    if (!result.reused) {
      const database = c.get('database')
      if (database) {
        let persisted = false
        for (let attempt = 0; attempt < 3 && !persisted; attempt += 1) {
          try {
            // Reserve the next visible number from the durable order set. A
            // concurrent reference collision is retried against the new max.
            reassignOrderReference(state, result.order, await new OrderRepository(database).nextReference())
            await persistPendingOrder(database, result.order, key)
            persisted = true
          } catch {
            try {
              const existing = await findPersistedOrder(database, key)
              if (existing) {
                const index = state.orders.findIndex((order) => order.id === result.order.id)
                if (index >= 0) state.orders.splice(index, 1)
                state.idempotency.set(key, existing)
                return c.json({ data: existing, meta: { reused: true } })
              }
            } catch {
              // Preserve the stable persistence error below when the lookup is
              // unavailable as well.
            }
          }
        }
        if (!persisted) {
          const index = state.orders.findIndex((order) => order.id === result.order.id)
          if (index >= 0) state.orders.splice(index, 1)
          state.idempotency.delete(key)
          return c.json({ error: { code: 'PERSISTENCE_UNAVAILABLE', message: 'No se pudo guardar el pedido. Inténtalo de nuevo.' } } satisfies ApiError, 503)
        }
      }
    }
    return c.json({ data: result.order, meta: { reused: result.reused } })
  } catch (error) { return errorResponse(c, error) }
})

publicApi.post('/api/analytics', async (c) => {
  const bodyBytes = await c.req.raw.clone().arrayBuffer()
  if (bodyBytes.byteLength > 32_768) return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'El lote de analítica es demasiado grande.' } } satisfies ApiError, 413)
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bodyBytes)) } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  const parsed = parseAnalyticsInput(body)
  if (!parsed.ok) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Revisa los eventos enviados.', details: parsed.details } } satisfies ApiError, 422)
  const before = state.analytics.length
  const accepted = recordAnalytics(state, parsed.value.events)
  const database = c.get('database')
  if (database && accepted > 0) schedulePersistence(c, persistAnalytics(database, state.analytics.slice(before, before + accepted)))
  return c.json({ data: { accepted } })
})
