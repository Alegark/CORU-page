import { Hono } from 'hono'
import type { Context } from 'hono'
import { getPublicProducts, getProductBySlug } from '../../shared/catalog'
import type { ApiError, ApiSuccess, PublicProduct, PublicPromotion } from '../../shared/contracts'
import { isBotUserAgent } from '../../shared/analytics-bots'
import { clampAnalyticsTimestamps } from '../../shared/analytics-time'
import { parseAnalyticsInput, parseOrderIntentInput } from '../../shared/validation'
import type { CoruEnv } from '../env'
import { state } from '../state'
import { createPendingOrder, OrderServiceError, reassignOrderReference, validateOrderIntent } from '../services/order.service'
import { checkAndReserveOrderIntent, resolveAbuseSecret } from '../services/order-abuse.service'
import { quoteYummyDelivery } from '../services/yummy.service'
import { getPublicRate, refreshRate } from '../services/exchange-rate.service'
import { createAutomaticRateProvider } from '../services/automatic-rate-provider'
import { recordAnalytics } from '../services/analytics.service'
import { imageVariantKeyFor, orderProductImages, type ImageVariant, type ProductImageRecord } from '../services/image.service'
import { findActivePromotion, findPersistedOrder, hydrateCatalogFromDatabase, persistAnalytics, persistPendingOrder, persistRate, persistRateRefreshStatus, schedulePersistence } from '../persistence'
import { MemoryMediaStore, R2MediaStore, type R2BucketLike } from '../adapters/r2'
import { OrderRepository } from '../../db/repositories/orders.repository'

function activePromotion(now = new Date()) {
  return state.settings.storeActive ? state.promotions.find((candidate) => candidate.active && (!candidate.startsAt || now >= new Date(candidate.startsAt)) && (!candidate.endsAt || now <= new Date(candidate.endsAt))) : undefined
}

export async function activePromotionForRequest(c: Context<CoruEnv>, now = new Date()) {
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

const PUBLIC_STATE_REFRESH_MS = 30_000
let catalogRefreshedAt = 0

export async function refreshCatalogForRequest(c: Context<CoruEnv>): Promise<void> {
  const database = c.get('database')
  const forceRefresh = Boolean(c.req.query('fresh'))
  if (!database || (!forceRefresh && Date.now() - catalogRefreshedAt < PUBLIC_STATE_REFRESH_MS)) return
  await hydrateCatalogFromDatabase(state, database)
  catalogRefreshedAt = Date.now()
}

export function toPublicProduct(product: ReturnType<typeof getPublicProducts>[number], promotion = activePromotion()): PublicProduct {
  const { stockQuantity: _stock, active: _active, primaryImageApproved: _approved, promoEligible: _promo, ...publicProduct } = product
  const approvedImages = orderProductImages([...state.images.values()].filter((image) => image.productId === product.id && Boolean(image.approvedVariant)))
  const imageUrls = approvedImages.map((image) => `/api/products/${encodeURIComponent(product.slug)}/images/${encodeURIComponent(image.id)}`)
  const imageSources = approvedImages.map((image) => {
    const base = `/media/products/${encodeURIComponent(image.id)}`
    return { id: image.id, src: `${base}/detail-1200.webp`, thumb320: `${base}/thumb-320.webp`, thumb640: `${base}/thumb-640.webp`, detail1200: `${base}/detail-1200.webp`, og1200: `${base}/og-1200.jpg` }
  })
  return { ...publicProduct, promotionEligible: Boolean(promotion && product.promoEligible && (!promotion.targetCategory || product.category === promotion.targetCategory)), ...(imageUrls.length ? { imageUrl: `/api/products/${encodeURIComponent(product.slug)}/image`, imageUrls, imageSources } : {}) }
}

const PUBLIC_READ_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=60'
const MEDIA_CACHE = 'public, max-age=31536000, immutable'

function mediaVariant(value: string): ImageVariant | undefined {
  return value === 'thumb-320.webp' ? 'thumb-320' : value === 'thumb-640.webp' ? 'thumb-640' : value === 'detail-1200.webp' ? 'detail-1200' : value === 'og-1200.jpg' ? 'og-1200' : undefined
}

function mediaResponse(body: ArrayBuffer, contentType: string, variant: string, fallback: boolean): Response {
  const etag = `"coru-${variant}-${body.byteLength}"`
  return new Response(body, { status: 200, headers: { 'Content-Type': contentType, 'Cache-Control': fallback ? PUBLIC_READ_CACHE : MEDIA_CACHE, ETag: etag, 'X-Coru-Media-Variant': fallback ? 'fallback-original' : variant, 'X-Content-Type-Options': 'nosniff' } })
}

function mediaStorage(env: CoruEnv['Bindings']): MemoryMediaStore | R2MediaStore {
  const bindings = env ?? {}
  if (bindings.CORU_MEDIA && typeof bindings.CORU_MEDIA === 'object' && 'put' in bindings.CORU_MEDIA) return new R2MediaStore(bindings.CORU_MEDIA as R2BucketLike)
  return new MemoryMediaStore(state.media)
}

export function publicProductForSlug(slug: string) {
  const product = getProductBySlug(state.products, slug)
  if (!state.settings.storeActive || !product || !product.active || !product.primaryImageApproved || ((product.fulfillmentType ?? 'STOCK') === 'STOCK' && product.stockQuantity <= 0) || !state.categories.some((category) => category.active && category.name === product.category)) return undefined
  return product
}

export function publicProducts() {
  const activeCategories = new Set(state.categories.filter((category) => category.active).map((category) => category.name))
  return getPublicProducts(state.products).filter((product) => activeCategories.has(product.category))
}

function errorResponse(c: Context<CoruEnv>, error: unknown) {
  if (error instanceof OrderServiceError) {
    const status: 409 | 503 = error.code === 'RATE_UNAVAILABLE' ? 503 : 409
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
    const provider = createAutomaticRateProvider(c.env?.EXCHANGE_RATE_URL)
    const result = await refreshRate(state, provider)
    const database = c.get('database')
    if (database) schedulePersistence(c, Promise.all([
      ...(result.updated ? [persistRate(database, state)] : []),
      persistRateRefreshStatus(database, state),
    ]))
    return result.updated
  })().catch(() => false).finally(() => { rateRefreshInFlight = null })
  return rateRefreshInFlight
}

export const publicApi = new Hono<CoruEnv>()

publicApi.get('/api/catalog', async (c) => {
  await refreshCatalogForRequest(c)
  c.header('Cache-Control', PUBLIC_READ_CACHE)
  const promotion = await activePromotionForRequest(c)
  return c.json({ data: state.settings.storeActive ? publicProducts().map((product) => toPublicProduct(product, promotion)) : [] } satisfies ApiSuccess<PublicProduct[]>)
})

publicApi.get('/api/categories', async (c) => {
  await refreshCatalogForRequest(c)
  c.header('Cache-Control', PUBLIC_READ_CACHE)
  return c.json({ data: state.settings.storeActive ? state.categories.filter((category) => category.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(({ id, slug, name, sortOrder }) => ({ id, slug, name, sortOrder })) : [] })
})

publicApi.get('/api/personal-delivery-points', (c) => {
  c.header('Cache-Control', PUBLIC_READ_CACHE)
  return c.json({ data: state.settings.storeActive ? state.deliveryPoints.filter((point) => point.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(({ id, name, address, shortDescription, latitude, longitude, scheduleText, sortOrder }) => ({ id, name, address, ...(shortDescription ? { shortDescription } : {}), ...(latitude !== undefined ? { latitude } : {}), ...(longitude !== undefined ? { longitude } : {}), ...(scheduleText ? { scheduleText } : {}), sortOrder })) : [] })
})

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
  c.header('Cache-Control', PUBLIC_READ_CACHE)
  const promotion = await activePromotionForRequest(c)
  if (!promotion) return c.json({ data: null } satisfies ApiSuccess<PublicPromotion | null>)
  const { id, name, kind, targetCategory, bundleQuantity, bundlePriceCents, fixedDiscountCents } = promotion
  return c.json({ data: { id, name, kind, ...(targetCategory ? { targetCategory } : {}), ...(bundleQuantity !== undefined ? { bundleQuantity } : {}), ...(bundlePriceCents !== undefined ? { bundlePriceCents } : {}), ...(fixedDiscountCents !== undefined ? { fixedDiscountCents } : {}) } } satisfies ApiSuccess<PublicPromotion>)
})

publicApi.get('/api/products/:slug', async (c) => {
  await refreshCatalogForRequest(c)
  c.header('Cache-Control', PUBLIC_READ_CACHE)
  const product = publicProductForSlug(c.req.param('slug'))
  if (!product) return c.json({ error: { code: 'NOT_FOUND', message: 'Producto no encontrado.' } } satisfies ApiError, 404)
  return c.json({ data: toPublicProduct(product, await activePromotionForRequest(c)) } satisfies ApiSuccess<PublicProduct>)
})

async function readApprovedImage(c: Context<CoruEnv>, image: ProductImageRecord, requestedVariant?: ImageVariant): Promise<Response> {
  const storage = mediaStorage(c.env)
  let key: string
  let contentType: string
  let servedVariant = requestedVariant ?? 'original'
  let fallback = false
  if (requestedVariant) {
    key = imageVariantKeyFor(image, requestedVariant)
    contentType = requestedVariant === 'og-1200' ? 'image/jpeg' : 'image/webp'
    const optimized = await storage.get?.(key)
    if (optimized) return mediaResponse(optimized, contentType, requestedVariant, false)
    if (requestedVariant === 'og-1200') {
      return new Response(null, { status: 302, headers: { Location: `/media/products/${encodeURIComponent(image.id)}/detail-1200.webp` } })
    }
    fallback = true
  }
  const processedKey = image.approvedVariant === 'processed' ? image.processedKey : undefined
  key = processedKey ?? image.originalKey
  contentType = processedKey ? 'image/webp' : image.mimeType
  servedVariant = processedKey ? 'processed' : 'original'
  const body = await storage.get?.(key)
  if (!body) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  return mediaResponse(body, contentType, servedVariant, fallback)
}

publicApi.get('/media/products/:imageId/:variant', async (c) => {
  const image = state.images.get(c.req.param('imageId'))
  const variant = mediaVariant(c.req.param('variant'))
  const product = image ? state.products.find((candidate) => candidate.id === image.productId) : undefined
  if (!image || !variant || !image.approvedVariant || !product || !publicProductForSlug(product.slug)) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  return readApprovedImage(c, image, variant)
})

publicApi.get('/api/products/:slug/image', async (c) => {
  await refreshCatalogForRequest(c)
  const product = publicProductForSlug(c.req.param('slug'))
  if (!product) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  const image = orderProductImages([...state.images.values()].filter((candidate) => candidate.productId === product.id && candidate.approvedVariant))[0]
  if (!image) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  const response = await readApprovedImage(c, image)
  if (response instanceof Response && response.status === 200) response.headers.set('Cache-Control', 'public, max-age=3600')
  return response
})

publicApi.get('/api/products/:slug/images/:imageId', async (c) => {
  await refreshCatalogForRequest(c)
  const product = publicProductForSlug(c.req.param('slug'))
  if (!product) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  const image = state.images.get(c.req.param('imageId'))
  if (!image || image.productId !== product.id || !image.approvedVariant) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  const response = await readApprovedImage(c, image)
  if (response instanceof Response && response.status === 200) response.headers.set('Cache-Control', 'public, max-age=3600')
  return response
})

publicApi.get('/api/exchange-rate', async (c) => {
  // The rate is public and may be cached briefly at the edge. This prevents
  // every storefront visit from issuing a new relay request while keeping the
  // quote fresh well inside the ten-minute Worker refresh cadence.
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=60')
  const needsRefresh = c.env?.ENVIRONMENT === 'production' && automaticRateNeedsRefresh()
  const refreshed = await refreshAutomaticRateIfNeeded(c)
  const publicRate = getPublicRate(state)
  // Never expose the bootstrap rate in production, but keep the last persisted
  // observation available if today's automatic refresh failed.
  if (needsRefresh && !refreshed && state.rateMode === 'AUTOMATIC' && state.rateSource === 'DEFAULT') {
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
  const database = c.get('database')
  if (database) {
    try {
      const persisted = await findPersistedOrder(database, key)
      if (persisted) {
        state.idempotency.set(key, persisted)
        return c.json({ data: persisted, meta: { reused: true } })
      }
    } catch {
      // Durable replay is best-effort; fall through to validation + guard.
    }
  }
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
    const guard = await checkAndReserveOrderIntent(state, c.req.raw, new Date(), resolveAbuseSecret(c.env))
    if (!guard.allowed) {
      if (guard.setCookie) c.header('Set-Cookie', guard.setCookie)
      if (guard.code === 'ORDER_INTENT_GUARD_UNAVAILABLE') return c.json({ error: { code: guard.code, message: 'No se pudo verificar la protección del pedido.' } } satisfies ApiError, 503)
      return c.json({ error: { code: guard.code, message: 'Alcanzaste el límite temporal de solicitudes.', details: { retryAfterSeconds: guard.retryAfterSeconds } } } satisfies ApiError, 429, guard.retryAfterSeconds ? { 'Retry-After': String(guard.retryAfterSeconds) } : undefined)
    }
    if (guard.setCookie) c.header('Set-Cookie', guard.setCookie)
    const promotion = validated.fulfillmentType === 'STOCK' ? (await activePromotionForRequest(c)) ?? null : null
    const result = createPendingOrder(state, parsed.value.lines, parsed.value.currency, parsed.value.rateMicros, key, new Date(), { shipping: parsed.value.shipping, sessionId: parsed.value.sessionId, source: parsed.value.source, promotion })
    if (!result.reused) {
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

function hasCloudflareAccessCookie(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false
  return cookieHeader.split(';').some((part) => part.trim().startsWith('CF_Authorization='))
}

publicApi.post('/api/analytics', async (c) => {
  if (hasCloudflareAccessCookie(c.req.header('Cookie'))) return c.json({ data: { accepted: 0 } })
  if (isBotUserAgent(c.req.header('User-Agent'))) return c.json({ data: { accepted: 0 } })
  const bodyBytes = await c.req.raw.clone().arrayBuffer()
  if (bodyBytes.byteLength > 32_768) return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'El lote de analítica es demasiado grande.' } } satisfies ApiError, 413)
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bodyBytes)) } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  const parsed = parseAnalyticsInput(body)
  if (!parsed.ok) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Revisa los eventos enviados.', details: parsed.details } } satisfies ApiError, 422)
  const events = clampAnalyticsTimestamps(parsed.value.events)
  const database = c.get('database')
  if (database) {
    if (events.length) schedulePersistence(c, persistAnalytics(database, events.map((event) => ({ ...event, ...(event.properties ? { properties: { ...event.properties } } : {}) }))))
  } else {
    recordAnalytics(state, events)
  }
  return c.json({ data: { accepted: events.length } })
})
