import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ApiError, ApiSuccess, OrderSummary } from '../../shared/contracts'
import type { ProductInput } from '../services/catalog.service'
import type { CoruEnv } from '../env'
import { requireAdmin } from '../middleware/access'
import { state } from '../state'
import { cancelSale, confirmOrder, discardOrder, expirePendingOrders, markPreorderDelivered, markPreorderReady, recordPreorderBalance, recordPreorderDeposit, OrderServiceError, refreshOrderRate } from '../services/order.service'
import { adjustStock, InventoryServiceError, setStock } from '../services/inventory.service'
import { getPublicRate, refreshRate, setManualRate, setManualRateMicros, setRateMode, ExchangeRateError } from '../services/exchange-rate.service'
import { createAutomaticRateProvider } from '../services/automatic-rate-provider'
import { CatalogServiceError, createCategory, createProduct, deleteProduct, listAdminProducts, listCategories, removeCategory, updateCategory, updateProduct } from '../services/catalog.service'
import { getSettings, SettingsServiceError, updateSettings, type StoreSettings } from '../services/settings.service'
import { resolveAnalyticsDateRange, summarizeAnalytics, summarizeAnalyticsV2, summarizeProductInterest, summarizeTraffic, toCaracasDateString } from '../services/analytics.service'
import { createPromotion, deactivatePromotion, deletePromotion, listPromotions, PromotionServiceError, updatePromotion, type PromotionInput } from '../services/promotion.service'
import { archiveDeliveryPoint, createDeliveryPoint, DeliveryPointServiceError, listDeliveryPoints, reorderDeliveryPoints, updateDeliveryPoint } from '../services/delivery-points.service'
import { approveImage, ImageServiceError, orderProductImages, reorderProductImages, retryProductImage, uploadProductImage, type ImageProcessingProvider } from '../services/image.service'
import { MemoryMediaStore, R2MediaStore, type R2BucketLike } from '../adapters/r2'
import { PhotoroomImageProcessingProvider } from '../adapters/photoroom'
import { clearPersistedCartAddAnalytics, confirmPersistedOrder, captureOrderExpectation, DurableOrderError, hydrateAnalyticsFromDatabase, hydrateCatalogFromDatabase, hydrateOrdersFromDatabase, hydrateStateFromDatabase, deleteCategory, deletePersistedProduct, deletePersistedPromotion, loadSessionsAvailableFrom, persistCategory, persistDeliveryPoint, persistImage, persistInventorySnapshot, persistOrderTransition, persistProduct, persistProductAndMovement, persistPromotion, persistRate, persistRateRefreshStatus, persistSettings, type OrderExpectation } from '../persistence'
import type { SqlClient } from '../../db/client'
import type { Order } from '../../shared/types'

function adminRatePayload(environment?: string, updated?: boolean) {
  const publicRate = getPublicRate(state)
  const hiddenBootstrap = environment === 'production' && state.rateSource === 'DEFAULT'
  return {
    ...publicRate,
    ...(hiddenBootstrap ? { available: false, rateMicros: null, updatedAt: null } : {}),
    validUntil: state.rateValidUntil,
    lastRefreshError: state.rateRefreshError,
    lastRefreshAttemptedAt: state.rateRefreshAttemptedAt,
    ...(updated !== undefined ? { updated } : {}),
  }
}

function summary(order: typeof state.orders[number]): OrderSummary {
  return { id: order.id, reference: order.reference, status: order.status, currency: order.currency, totalCents: order.quote.totalCents, createdAt: order.createdAt, itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0), fulfillmentType: order.fulfillmentTypeSnapshot ?? 'STOCK', expiresAt: order.expiresAt, preorderStage: order.preorderStage, paymentStatus: order.paymentStatus }
}

function fail(c: Context<CoruEnv>, error: unknown) {
  if (error instanceof OrderServiceError) return c.json({ error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) } } satisfies ApiError, error.code === 'PRODUCT_UNAVAILABLE' ? 404 : 409)
  if (error instanceof InventoryServiceError) return c.json({ error: { code: error.code, message: error.message } } satisfies ApiError, error.code === 'PRODUCT_NOT_FOUND' ? 404 : error.code === 'INVALID_QUANTITY' ? 422 : 409)
  if (error instanceof ExchangeRateError) return c.json({ error: { code: error.code, message: error.message } } satisfies ApiError, error.code === 'RATE_INVALID' ? 422 : 503)
  if (error instanceof CatalogServiceError) return c.json({ error: { code: error.code, message: error.message } } satisfies ApiError, error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 422)
  if (error instanceof SettingsServiceError) return c.json({ error: { code: error.code, message: error.message } } satisfies ApiError, 422)
  if (error instanceof ImageServiceError) return c.json({ error: { code: error.code, message: error.message } } satisfies ApiError, error.code === 'IMAGE_TOO_LARGE' || error.code === 'IMAGE_INVALID' || error.code === 'IMAGE_APPROVAL_INVALID' || error.code === 'IMAGE_ORDER_INVALID' ? 422 : 503)
  if (error instanceof PromotionServiceError) return c.json({ error: { code: error.code, message: error.message } } satisfies ApiError, error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 422)
  if (error instanceof DeliveryPointServiceError) return c.json({ error: { code: error.code, message: error.message } } satisfies ApiError, error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 422)
  if (error instanceof DurableOrderError) return c.json({ error: { code: error.code, message: error.message } } satisfies ApiError, error.code === 'NOT_FOUND' ? 404 : 409)
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado.' } } satisfies ApiError, 500)
}

const ORDER_CONFLICT = { error: { code: 'ORDER_CONFLICT', message: 'El pedido cambió en otra sesión; recarga e inténtalo de nuevo.' } } satisfies ApiError
const PERSISTENCE_UNAVAILABLE = { error: { code: 'PERSISTENCE_UNAVAILABLE', message: 'La persistencia no está disponible.' } } satisfies ApiError

async function awaitPersistence(c: Context<CoruEnv>, work: Promise<unknown>): Promise<Response | null> {
  try {
    await work
    return null
  } catch (error) {
    console.error('Admin persistence failed', error)
    return c.json(PERSISTENCE_UNAVAILABLE, 503)
  }
}

async function persistExpiredIfNeeded(database: SqlClient, order: Order, expected: OrderExpectation): Promise<'ok' | 'conflict' | 'unavailable'> {
  if (!(expected.status === 'PENDING' && order.status === 'DISCARDED' && order.discardReason === 'EXPIRED_UNREVIEWED')) return 'ok'
  try {
    const result = await persistOrderTransition(database, order, expected, [])
    if (!result.applied) {
      await hydrateOrdersFromDatabase(state, database)
      return 'conflict'
    }
    return 'ok'
  } catch (error) {
    console.error('Order expiry persistence failed', error)
    await hydrateOrdersFromDatabase(state, database).catch(() => undefined)
    return 'unavailable'
  }
}

async function runOrderMutation(c: Context<CoruEnv>, orderId: string, mutate: () => Order): Promise<Response> {
  const database = c.get('database')
  if (database) await hydrateOrdersFromDatabase(state, database)
  const before = state.orders.find((candidate) => candidate.id === orderId || candidate.reference === orderId)
  if (!before) return c.json({ error: { code: 'NOT_FOUND', message: 'Pedido no encontrado.' } } satisfies ApiError, 404)
  const expected = captureOrderExpectation(before)
  const knownMovementIds = new Set(state.movements.map((movement) => movement.id))
  try {
    const order = mutate()
    if (!database) return c.json({ data: order } satisfies ApiSuccess<typeof order>)
    const movements = state.movements.filter((movement) => !knownMovementIds.has(movement.id) && (movement.orderId === order.id || movement.note === order.reference))
    try {
      const result = await persistOrderTransition(database, order, expected, movements)
      if (!result.applied) {
        await hydrateOrdersFromDatabase(state, database)
        return c.json(ORDER_CONFLICT, 409)
      }
      if (result.order) {
        const index = state.orders.findIndex((candidate) => candidate.id === result.order!.id)
        if (index >= 0) state.orders[index] = result.order
      }
      return c.json({ data: result.order ?? order } satisfies ApiSuccess<Order>)
    } catch (error) {
      console.error('Order transition persistence failed', error)
      await hydrateOrdersFromDatabase(state, database).catch(() => undefined)
      return c.json(PERSISTENCE_UNAVAILABLE, 503)
    }
  } catch (error) {
    if (database) {
      const current = state.orders.find((candidate) => candidate.id === before.id)
      if (current) {
        const expiry = await persistExpiredIfNeeded(database, current, expected)
        if (expiry === 'unavailable') return c.json(PERSISTENCE_UNAVAILABLE, 503)
      }
    }
    return fail(c, error)
  }
}

async function expireAndPersistPending(database: SqlClient | null | undefined): Promise<void> {
  if (!database) {
    expirePendingOrders(state)
    return
  }
  await hydrateOrdersFromDatabase(state, database)
  const pending = state.orders.filter((order) => order.status === 'PENDING')
  const expectations = new Map(pending.map((order) => [order.id, captureOrderExpectation(order)]))
  const expired = expirePendingOrders(state)
  for (const order of expired) {
    const expected = expectations.get(order.id) ?? { status: 'PENDING' as const, preorderStage: null, paymentStatus: null }
    try {
      const result = await persistOrderTransition(database, order, expected, [])
      if (!result.applied) await hydrateOrdersFromDatabase(state, database)
    } catch (error) {
      console.error('Pending order expiry persistence failed', error)
      await hydrateOrdersFromDatabase(state, database).catch(() => undefined)
    }
  }
}

export const adminApi = new Hono<CoruEnv>()
adminApi.use('/api/admin/*', requireAdmin)

adminApi.get('/api/admin/products', async (c) => {
  const database = c.get('database')
  // An isolate may have hydrated before another isolate committed an edit.
  // Refresh the admin catalog from Turso so reopening the editor never shows
  // an isolate-local snapshot that predates the last successful save.
  if (database) await hydrateCatalogFromDatabase(state, database)
  return c.json({ data: listAdminProducts(state) } satisfies ApiSuccess<typeof state.products>)
})

adminApi.post('/api/admin/products', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  try {
    const product = createProduct(state, (body ?? {}) as ProductInput)
    const database = c.get('database')
    // Product creation is a dependency for the next admin action (uploading
    // and approving its image). Await the durable write so another Worker
    // isolate cannot hydrate a catalog that is missing this product.
    if (database) await persistProduct(database, state, product)
    return c.json({ data: product }, 201)
  } catch (error) { return fail(c, error) }
})

adminApi.patch('/api/admin/products/:id', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  try {
    const database = c.get('database')
    if (database) await hydrateCatalogFromDatabase(state, database)
    const input = (body ?? {}) as Partial<ProductInput>
    const requestedStock = input.stockQuantity
    if (requestedStock !== undefined && (typeof requestedStock !== 'number' || !Number.isInteger(requestedStock) || requestedStock < 0)) return c.json({ error: { code: 'INVALID_QUANTITY', message: 'El stock debe ser un entero no negativo.' } } satisfies ApiError, 422)
    const { stockQuantity: _stockQuantity, ...catalogInput } = input
    const product = updateProduct(state, c.req.param('id'), catalogInput)
    const stockResult = requestedStock === undefined || requestedStock === product.stockQuantity ? undefined : setStock(state, product.id, requestedStock)
    // Product edits are immediately visible in the public catalog and in the
    // next admin read. Wait for Turso to commit before acknowledging the PATCH
    // so another Worker isolate cannot hydrate the previous product snapshot.
    if (database) {
      const failed = await awaitPersistence(c, stockResult?.movement ? persistProductAndMovement(database, state, product, stockResult.movement) : persistProduct(database, state, product))
      if (failed) return failed
    }
    return c.json({ data: product })
  } catch (error) { return fail(c, error) }
})

adminApi.delete('/api/admin/products/:id', async (c) => {
  try {
    const productId = c.req.param('id')
    const existing = state.products.find((candidate) => candidate.id === productId)
    if (!existing) throw new CatalogServiceError('NOT_FOUND', 'Producto no encontrado.')
    const database = c.get('database')
    if (existing.active) {
      const product = updateProduct(state, productId, { active: false })
      if (database) await persistProduct(database, state, product)
      return c.json({ data: product })
    }

    // Inventory movements are an audit trail and keep a database FK to the
    // product. Refuse only this destructive case while allowing unused,
    // deactivated products to be removed normally.
    if (state.movements.some((movement) => movement.productId === productId)) throw new CatalogServiceError('CONFLICT', 'No se puede eliminar un producto con movimientos de inventario.')
    const images = [...state.images.values()].filter((image) => image.productId === productId)
    if (database) await deletePersistedProduct(database, productId)
    const product = deleteProduct(state, productId)
    const storage = imageStorage(c.env)
    const keys = new Set(images.flatMap((image) => [image.originalKey, image.processedKey, image.thumb320Key, image.thumb640Key, image.detail1200Key].filter((key): key is string => Boolean(key))))
    await Promise.all([...keys].map(async (key) => {
      state.media.delete(key)
      try { await storage.delete?.(key) } catch (error) { console.error('CORU product media cleanup failed', { productId, key, error }) }
    }))
    for (const image of images) state.images.delete(image.id)
    return c.json({ data: product })
  } catch (error) { return fail(c, error) }
})

function imageProvider(env: CoruEnv['Bindings']): ImageProcessingProvider {
  if (env.PHOTOROOM_API_KEY) return new PhotoroomImageProcessingProvider({ apiKey: env.PHOTOROOM_API_KEY })
  return { process: async () => { throw new Error('IMAGE_PROCESSOR_NOT_CONFIGURED') } }
}

function imageStorage(env: CoruEnv['Bindings']): MemoryMediaStore | R2MediaStore {
  const bindings = env ?? {}
  if (bindings.CORU_MEDIA && typeof bindings.CORU_MEDIA === 'object' && 'put' in bindings.CORU_MEDIA) return new R2MediaStore(bindings.CORU_MEDIA as R2BucketLike)
  return new MemoryMediaStore(state.media)
}

adminApi.get('/api/admin/products/:id/images', (c) => {
  if (!state.products.some((product) => product.id === c.req.param('id'))) return c.json({ error: { code: 'NOT_FOUND', message: 'Producto no encontrado.' } } satisfies ApiError, 404)
  return c.json({ data: orderProductImages([...state.images.values()].filter((image) => image.productId === c.req.param('id'))) })
})

adminApi.get('/api/admin/products/:id/images/:imageId/preview', async (c) => {
  const image = state.images.get(c.req.param('imageId'))
  if (!image || image.productId !== c.req.param('id')) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  const variant = image.approvedVariant === 'processed' && image.processedKey ? 'processed' : 'original'
  const key = variant === 'processed' ? image.processedKey! : image.originalKey
  const body = await imageStorage(c.env).get?.(key)
  if (!body) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  return new Response(body, { status: 200, headers: { 'Content-Type': variant === 'processed' ? 'image/webp' : image.mimeType, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } })
})

adminApi.post('/api/admin/products/:id/images', async (c) => {
  const productId = c.req.param('id')
  if (!state.products.some((product) => product.id === productId)) return c.json({ error: { code: 'NOT_FOUND', message: 'Producto no encontrado.' } } satisfies ApiError, 404)
  let body: ArrayBuffer
  let mimeType = c.req.header('Content-Type') ?? ''
  try {
    if (mimeType.startsWith('multipart/form-data')) {
      const form = await c.req.parseBody()
      const file = form.file ?? form.image
      // Hono/Workers may expose multipart files as a File from a different
      // realm. Blob is the stable contract we need here; relying only on
      // `instanceof File` made valid uploads fail in production.
      if (!(file instanceof Blob)) throw new ImageServiceError('IMAGE_INVALID', 'Adjunta un archivo de imagen.')
      mimeType = file.type
      body = await file.arrayBuffer()
    } else {
      body = await c.req.raw.arrayBuffer()
      mimeType = c.req.header('X-Image-Mime') ?? mimeType.split(';')[0]
    }
    const currentImages = orderProductImages([...state.images.values()].filter((image) => image.productId === productId))
    const result = await uploadProductImage({ productId, body, mimeType, sortOrder: currentImages.length + 1, storage: imageStorage(c.env) })
    state.images.set(result.id, result)
    const product = state.products.find((entry) => entry.id === productId)
    if (product) product.primaryImageApproved = true
    const database = c.get('database')
    // Normal uploads are immediately visible. Persist the image and the
    // product's first-image pointer together so a refresh keeps the order.
    if (database) await Promise.all([persistImage(database, result), ...(product ? [persistProduct(database, state, product)] : [])])
    return c.json({ data: result }, 201)
  } catch (error) { return fail(c, error) }
})

adminApi.post('/api/admin/products/:id/images/reorder', async (c) => {
  const productId = c.req.param('id')
  const product = state.products.find((entry) => entry.id === productId)
  if (!product) return c.json({ error: { code: 'NOT_FOUND', message: 'Producto no encontrado.' } } satisfies ApiError, 404)
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  const ids = body && typeof body === 'object' && Array.isArray((body as { ids?: unknown }).ids) ? (body as { ids: unknown[] }).ids.filter((value): value is string => typeof value === 'string') : []
  try {
    const current = orderProductImages([...state.images.values()].filter((image) => image.productId === productId))
    const reordered = reorderProductImages(current, ids)
    reordered.forEach((image) => state.images.set(image.id, image))
    const database = c.get('database')
    if (database) await Promise.all([...reordered.map((image) => persistImage(database, image)), persistProduct(database, state, product)])
    return c.json({ data: orderProductImages(reordered) })
  } catch (error) { return fail(c, error) }
})

adminApi.post('/api/admin/products/:id/images/:imageId/approve', async (c) => {
  const image = state.images.get(c.req.param('imageId'))
  if (!image || image.productId !== c.req.param('id')) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  const variant = c.req.query('variant') === 'processed' ? 'processed' : 'original'
  try {
    const approved = approveImage(image, variant)
    const product = state.products.find((entry) => entry.id === image.productId)
    if (product) product.primaryImageApproved = true
    const database = c.get('database')
    if (database) await Promise.all([persistImage(database, approved), ...(product ? [persistProduct(database, state, product)] : [])])
    return c.json({ data: approved })
  } catch (error) { return fail(c, error) }
})

adminApi.post('/api/admin/products/:id/images/:imageId/retry', async (c) => {
  const image = state.images.get(c.req.param('imageId'))
  if (!image || image.productId !== c.req.param('id')) return c.json({ error: { code: 'NOT_FOUND', message: 'Imagen no encontrada.' } } satisfies ApiError, 404)
  try {
    const retried = await retryProductImage({ record: image, storage: imageStorage(c.env), provider: imageProvider(c.env) })
    state.images.set(retried.id, retried)
    const product = state.products.find((entry) => entry.id === retried.productId)
    if (product && !retried.approvedVariant) product.primaryImageApproved = [...state.images.values()].some((candidate) => candidate.productId === product.id && Boolean(candidate.approvedVariant))
    const database = c.get('database')
    if (database) await Promise.all([persistImage(database, retried), ...(product ? [persistProduct(database, state, product)] : [])])
    return c.json({ data: retried })
  } catch (error) { return fail(c, error) }
})

adminApi.get('/api/admin/categories', (c) => c.json({ data: listCategories(state) }))
adminApi.post('/api/admin/categories', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  try {
    const category = createCategory(state, (body ?? {}) as { name: string; slug?: string; sortOrder?: number; active?: boolean } )
    const database = c.get('database')
    // Products may be created immediately after this response. Write the
    // category through before returning so another isolate cannot reject that
    // product against a stale hydrated category list.
    if (database) await persistCategory(database, category)
    return c.json({ data: category }, 201)
  } catch (error) { return fail(c, error) }
})
adminApi.patch('/api/admin/categories/:id', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  try {
    const category = updateCategory(state, c.req.param('id'), (body ?? {}) as Partial<{ name: string; slug: string; sortOrder: number; active: boolean }> )
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, Promise.all([persistCategory(database, category), ...state.products.filter((product) => product.category === category.name).map((product) => persistProduct(database, state, product)), ...state.promotions.filter((promotion) => promotion.targetCategory === category.name).map((promotion) => persistPromotion(database, state, promotion))]))
      if (failed) return failed
    }
    return c.json({ data: category })
  } catch (error) { return fail(c, error) }
})
adminApi.post('/api/admin/categories/reorder', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  const rawIds: unknown = body && typeof body === 'object' ? (body as Record<string, unknown>).ids : undefined
  const ids = Array.isArray(rawIds) ? rawIds : null
  if (!ids || ids.length !== state.categories.length || ids.some((id: unknown) => typeof id !== 'string') || new Set(ids as string[]).size !== ids.length || (ids as string[]).some((id) => !state.categories.some((category) => category.id === id))) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Incluye todas las categorías una sola vez.' } } satisfies ApiError, 422)
  ;(ids as string[]).forEach((id, index) => { state.categories.find((category) => category.id === id)!.sortOrder = index + 1 })
  const database = c.get('database')
  if (database) {
    const failed = await awaitPersistence(c, Promise.all(state.categories.map((category) => persistCategory(database, category))))
    if (failed) return failed
  }
  return c.json({ data: listCategories(state) })
})
adminApi.delete('/api/admin/categories/:id', async (c) => {
  try {
    const existing = state.categories.find((category) => category.id === c.req.param('id'))
    if (!existing) throw new CatalogServiceError('NOT_FOUND', 'Categoría no encontrada.')
    const hasProducts = state.products.some((product) => product.category === existing.name)
    const category = hasProducts ? updateCategory(state, existing.id, { active: false }) : removeCategory(state, existing.id)
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, hasProducts ? persistCategory(database, category) : deleteCategory(database, category.id))
      if (failed) return failed
    }
    return c.json({ data: category })
  } catch (error) { return fail(c, error) }
})
adminApi.get('/api/admin/delivery-points', (c) => c.json({ data: listDeliveryPoints(state, true) }))
adminApi.post('/api/admin/delivery-points', async (c) => {
  const body = await jsonBody(c)
  try {
    const point = createDeliveryPoint(state, {
      name: body.name as string, address: body.address as string,
      ...(typeof body.shortDescription === 'string' ? { shortDescription: body.shortDescription } : {}),
      ...(typeof body.latitude === 'number' ? { latitude: body.latitude } : {}),
      ...(typeof body.longitude === 'number' ? { longitude: body.longitude } : {}),
      ...(typeof body.scheduleText === 'string' ? { scheduleText: body.scheduleText } : {}),
      ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
      ...(typeof body.sortOrder === 'number' ? { sortOrder: body.sortOrder } : {}),
    })
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, persistDeliveryPoint(database, point))
      if (failed) return failed
    }
    return c.json({ data: point }, 201)
  } catch (error) { return fail(c, error) }
})
adminApi.patch('/api/admin/delivery-points/:id', async (c) => {
  const body = await jsonBody(c)
  try {
    const point = updateDeliveryPoint(state, c.req.param('id'), {
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.address === 'string' ? { address: body.address } : {}),
      ...(typeof body.shortDescription === 'string' ? { shortDescription: body.shortDescription } : {}),
      ...(typeof body.latitude === 'number' ? { latitude: body.latitude } : body.latitude === null ? { latitude: undefined } : {}),
      ...(typeof body.longitude === 'number' ? { longitude: body.longitude } : body.longitude === null ? { longitude: undefined } : {}),
      ...(typeof body.scheduleText === 'string' ? { scheduleText: body.scheduleText } : {}),
      ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
      ...(typeof body.sortOrder === 'number' ? { sortOrder: body.sortOrder } : {}),
    })
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, persistDeliveryPoint(database, point))
      if (failed) return failed
    }
    return c.json({ data: point })
  } catch (error) { return fail(c, error) }
})
adminApi.delete('/api/admin/delivery-points/:id', async (c) => {
  try {
    const point = archiveDeliveryPoint(state, c.req.param('id'))
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, persistDeliveryPoint(database, point))
      if (failed) return failed
    }
    return c.json({ data: point })
  } catch (error) { return fail(c, error) }
})
adminApi.post('/api/admin/delivery-points/reorder', async (c) => {
  const body = await jsonBody(c)
  try {
    if (!Array.isArray(body.ids) || body.ids.some((value) => typeof value !== 'string')) throw new DeliveryPointServiceError('VALIDATION_ERROR', 'La lista de puntos no es válida.')
    const points = reorderDeliveryPoints(state, body.ids as string[])
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, Promise.all(points.map((point) => persistDeliveryPoint(database, point))))
      if (failed) return failed
    }
    return c.json({ data: points })
  } catch (error) { return fail(c, error) }
})
adminApi.get('/api/admin/promotions', (c) => c.json({ data: listPromotions(state) }))
adminApi.post('/api/admin/promotions', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  try {
    const promotion = createPromotion(state, (body ?? {}) as PromotionInput)
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, persistPromotion(database, state, promotion))
      if (failed) return failed
    }
    return c.json({ data: promotion }, 201)
  } catch (error) { return fail(c, error) }
})
adminApi.patch('/api/admin/promotions/:id', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  try {
    const promotion = updatePromotion(state, c.req.param('id'), (body ?? {}) as Partial<PromotionInput>)
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, persistPromotion(database, state, promotion))
      if (failed) return failed
    }
    return c.json({ data: promotion })
  } catch (error) { return fail(c, error) }
})
adminApi.delete('/api/admin/promotions/:id', async (c) => {
  try {
    const database = c.get('database')
    const promotionId = c.req.param('id')
    const existing = state.promotions.find((candidate) => candidate.id === promotionId)
    if (!existing) throw new PromotionServiceError('NOT_FOUND', 'Promoción no encontrada.')
    if (existing.active) {
      const promotion = deactivatePromotion(state, promotionId)
      if (database) await persistPromotion(database, state, promotion)
      return c.json({ data: promotion })
    }
    if (database) await deletePersistedPromotion(database, promotionId)
    const promotion = deletePromotion(state, promotionId)
    return c.json({ data: promotion })
  } catch (error) { return fail(c, error) }
})
adminApi.post('/api/admin/products/:id/stock', async (c) => {
  const database = c.get('database')
  if (database) await hydrateCatalogFromDatabase(state, database)
  const product = state.products.find((candidate) => candidate.id === c.req.param('id'))
  if (!product) return c.json({ error: { code: 'NOT_FOUND', message: 'Producto no encontrado.' } } satisfies ApiError, 404)
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  if (!body || typeof body !== 'object') return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Revisa el ajuste de stock.' } } satisfies ApiError, 422)
  const input = body as Record<string, unknown>
  const mode = input.mode
  const amount = input.quantity ?? input.delta
  if ((mode !== 'set' && mode !== 'adjust') || typeof amount !== 'number' || !Number.isInteger(amount)) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Usa mode set/adjust y una cantidad entera.' } } satisfies ApiError, 422)
  try {
    const note = typeof input.note === 'string' ? input.note : undefined
    const result = mode === 'set' ? setStock(state, product.id, amount, note) : adjustStock(state, product.id, amount, note)
    if (database && result.movement) {
      const failed = await awaitPersistence(c, persistInventorySnapshot(database, state, product.id, result.movement))
      if (failed) return failed
    }
    return c.json({ data: result.product })
  } catch (error) { return fail(c, error) }
})
adminApi.get('/api/admin/orders', async (c) => {
  await expireAndPersistPending(c.get('database'))
  return c.json({ data: state.orders.map(summary) } satisfies ApiSuccess<OrderSummary[]>)
})
adminApi.get('/api/admin/orders/:id', async (c) => {
  const database = c.get('database')
  if (database) await hydrateOrdersFromDatabase(state, database)
  const order = state.orders.find((candidate) => candidate.id === c.req.param('id') || candidate.reference === c.req.param('id'))
  if (!order) return c.json({ error: { code: 'NOT_FOUND', message: 'Pedido no encontrado.' } } satisfies ApiError, 404)
  await expireAndPersistPending(database)
  const refreshed = state.orders.find((candidate) => candidate.id === order.id) ?? order
  return c.json({ data: refreshed } satisfies ApiSuccess<typeof refreshed>)
})
adminApi.post('/api/admin/orders/:id/confirm', async (c) => {
  try {
    const database = c.get('database')
    if (database) await hydrateOrdersFromDatabase(state, database)
    const requested = state.orders.find((candidate) => candidate.id === c.req.param('id') || candidate.reference === c.req.param('id'))
    if (requested?.fulfillmentTypeSnapshot === 'PREORDER') throw new OrderServiceError('INVALID_TRANSITION', 'Un pedido bajo pedido se confirma al registrar el anticipo.')
    if (database) {
      const order = await confirmPersistedOrder(database, c.req.param('id'))
      // Refresh the in-memory view after the committed transaction so later
      // requests in this isolate observe the same stock/order state.
      await hydrateStateFromDatabase(state, database)
      const hydrated = state.orders.find((candidate) => candidate.id === order.id) ?? order
      return c.json({ data: hydrated } satisfies ApiSuccess<typeof hydrated>)
    }
    const order = confirmOrder(state, c.req.param('id'))
    return c.json({ data: order } satisfies ApiSuccess<ReturnType<typeof confirmOrder>>)
  } catch (error) { return fail(c, error) }
})
adminApi.post('/api/admin/orders/:id/discard', (c) => runOrderMutation(c, c.req.param('id'), () => discardOrder(state, c.req.param('id'), 'Descartado por administración', new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin')))

async function jsonBody(c: Context<CoruEnv>): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' ? body as Record<string, unknown> : {}
  } catch { return {} }
}

adminApi.post('/api/admin/orders/:id/cancel-sale', async (c) => {
  const body = await jsonBody(c)
  const reason = typeof body.reason === 'string' ? body.reason : ''
  return runOrderMutation(c, c.req.param('id'), () => cancelSale(state, c.req.param('id'), reason, c.req.header('Idempotency-Key')?.trim(), new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin'))
})

adminApi.post('/api/admin/orders/:id/record-deposit', async (c) => {
  const body = await jsonBody(c)
  return runOrderMutation(c, c.req.param('id'), () => recordPreorderDeposit(state, c.req.param('id'), { currency: body.currency === 'Bs' ? 'Bs' : 'USD', ...(typeof body.paidAmountMinor === 'number' ? { paidAmountMinor: body.paidAmountMinor } : {}), ...(typeof body.rateMicros === 'number' ? { rateMicros: body.rateMicros } : {}), ...(typeof body.note === 'string' ? { note: body.note } : {}) }, c.req.header('Idempotency-Key')?.trim(), new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin'))
})

adminApi.post('/api/admin/orders/:id/mark-ready', (c) => runOrderMutation(c, c.req.param('id'), () => markPreorderReady(state, c.req.param('id'), new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin')))

adminApi.post('/api/admin/orders/:id/record-balance', async (c) => {
  const body = await jsonBody(c)
  return runOrderMutation(c, c.req.param('id'), () => recordPreorderBalance(state, c.req.param('id'), { currency: body.currency === 'Bs' ? 'Bs' : 'USD', ...(typeof body.paidAmountMinor === 'number' ? { paidAmountMinor: body.paidAmountMinor } : {}), ...(typeof body.rateMicros === 'number' ? { rateMicros: body.rateMicros } : {}), ...(typeof body.note === 'string' ? { note: body.note } : {}) }, c.req.header('Idempotency-Key')?.trim(), new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin'))
})

adminApi.post('/api/admin/orders/:id/mark-delivered', (c) => runOrderMutation(c, c.req.param('id'), () => markPreorderDelivered(state, c.req.param('id'), new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin')))
adminApi.post('/api/admin/orders/:id/refresh-rate', (c) => runOrderMutation(c, c.req.param('id'), () => refreshOrderRate(state, c.req.param('id'))))

adminApi.get('/api/admin/settings/rate', (c) => c.json({ data: adminRatePayload(c.env?.ENVIRONMENT) }))

adminApi.get('/api/admin/settings', (c) => c.json({ data: getSettings(state) }))
adminApi.patch('/api/admin/settings', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  try {
    const settings = updateSettings(state, (body ?? {}) as Partial<StoreSettings>)
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, persistSettings(database, settings))
      if (failed) return failed
    }
    return c.json({ data: settings })
  } catch (error) { return fail(c, error) }
})

adminApi.post('/api/admin/settings/rate', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  if (input.mode === 'AUTOMATIC') {
    setRateMode(state, 'AUTOMATIC')
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, persistRate(database, state))
      if (failed) return failed
    }
    return c.json({ data: adminRatePayload(c.env?.ENVIRONMENT) })
  }
  try {
    const result = input.rateMicros !== undefined ? setManualRateMicros(state, input.rateMicros) : setManualRate(state, input.rate)
    const database = c.get('database')
    if (database) {
      const failed = await awaitPersistence(c, persistRate(database, state))
      if (failed) return failed
    }
    return c.json({ data: { ...adminRatePayload(c.env?.ENVIRONMENT), ...result } })
  } catch (error) { return fail(c, error) }
})

adminApi.post('/api/admin/settings/rate/refresh', async (c) => {
  if (state.rateMode === 'MANUAL') return c.json({ data: adminRatePayload(c.env?.ENVIRONMENT, false) })
  const provider = createAutomaticRateProvider(c.env?.EXCHANGE_RATE_URL)
  const result = await refreshRate(state, provider)
  const database = c.get('database')
  if (database) {
    const failed = await awaitPersistence(c, Promise.all([
      ...(result.updated ? [persistRate(database, state)] : []),
      persistRateRefreshStatus(database, state),
    ]))
    if (failed) return failed
  }
  return c.json({ data: adminRatePayload(c.env?.ENVIRONMENT, result.updated) })
})

adminApi.get('/api/admin/analytics', async (c) => {
  const database = c.get('database')
  if (database) {
    await hydrateOrdersFromDatabase(state, database)
    await hydrateAnalyticsFromDatabase(state, database)
  }
  return c.json({ data: summarizeAnalytics(state) })
})

adminApi.delete('/api/admin/analytics/cart-add', async (c) => {
  const database = c.get('database')
  if (!database) return c.json({ error: { code: 'PERSISTENCE_UNAVAILABLE', message: 'La persistencia no está disponible.' } }, 503)
  const deletedEvents = await clearPersistedCartAddAnalytics(state, database)
  return c.json({ data: { deletedEvents } })
})

function analyticsRange(c: Context<CoruEnv>): { value: import('../services/analytics.service').ResolvedAnalyticsRange } | { error: Response } {
  const result = resolveAnalyticsDateRange(c.req.query('from'), c.req.query('to'))
  if (!result.ok) return { error: c.json({ error: { code: 'VALIDATION_ERROR', message: 'El intervalo de analítica no es válido.', details: result.details } } satisfies ApiError, 422) as Response }
  return { value: result.value }
}

function analyticsHydrateRange(range: import('../services/analytics.service').ResolvedAnalyticsRange): { fromIso: string; toIso: string } {
  return { fromIso: new Date(range.fromMs).toISOString(), toIso: new Date(range.toMs).toISOString() }
}

adminApi.get('/api/admin/analytics/summary', async (c) => {
  const range = analyticsRange(c)
  if ('error' in range) return range.error
  const database = c.get('database')
  let sessionsAvailableFrom: string | null | undefined
  if (database) {
    await hydrateOrdersFromDatabase(state, database)
    await hydrateAnalyticsFromDatabase(state, database, analyticsHydrateRange(range.value))
    const earliest = await loadSessionsAvailableFrom(database)
    sessionsAvailableFrom = earliest ? toCaracasDateString(earliest) : null
  }
  return c.json({ data: summarizeAnalyticsV2(state, state.orders, range.value, sessionsAvailableFrom !== undefined ? { sessionsAvailableFrom } : undefined) })
})

adminApi.get('/api/admin/analytics/products', async (c) => {
  const range = analyticsRange(c)
  if ('error' in range) return range.error
  const database = c.get('database')
  if (database) {
    await hydrateOrdersFromDatabase(state, database)
    await hydrateAnalyticsFromDatabase(state, database, analyticsHydrateRange(range.value))
  }
  return c.json({ data: { products: summarizeProductInterest(state, range.value) } })
})

adminApi.get('/api/admin/analytics/traffic', async (c) => {
  const database = c.get('database')
  const fromRaw = c.req.query('from')
  const toRaw = c.req.query('to')
  if (!fromRaw && !toRaw) {
    if (database) {
      await hydrateOrdersFromDatabase(state, database)
      await hydrateAnalyticsFromDatabase(state, database)
    }
    return c.json({ data: summarizeTraffic(state) })
  }
  const range = analyticsRange(c)
  if ('error' in range) return range.error
  if (database) {
    await hydrateOrdersFromDatabase(state, database)
    await hydrateAnalyticsFromDatabase(state, database, analyticsHydrateRange(range.value))
  }
  return c.json({ data: summarizeTraffic(state, range.value) })
})
