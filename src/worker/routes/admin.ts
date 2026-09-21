import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ApiError, ApiSuccess, OrderSummary } from '../../shared/contracts'
import type { ProductInput } from '../services/catalog.service'
import type { CoruEnv } from '../env'
import { requireAdmin } from '../middleware/access'
import { state } from '../state'
import { cancelSale, confirmOrder, discardOrder, expirePendingOrders, markPreorderDelivered, markPreorderReady, recordPreorderBalance, recordPreorderDeposit, OrderServiceError, refreshOrderRate } from '../services/order.service'
import { adjustStock, InventoryServiceError, setStock } from '../services/inventory.service'
import { createHttpRateProvider, getPublicRate, refreshRate, setManualRate, setManualRateMicros, setRateMode, ExchangeRateError } from '../services/exchange-rate.service'
import { createBinanceP2pProvider } from '../services/exchange-rate/binance-p2p.adapter'
import { CatalogServiceError, createCategory, createProduct, listAdminProducts, listCategories, removeCategory, updateCategory, updateProduct } from '../services/catalog.service'
import { getSettings, SettingsServiceError, updateSettings, type StoreSettings } from '../services/settings.service'
import { resolveAnalyticsDateRange, summarizeAnalytics, summarizeAnalyticsV2, summarizeProductInterest, summarizeTraffic } from '../services/analytics.service'
import { createPromotion, deactivatePromotion, listPromotions, PromotionServiceError, updatePromotion, type PromotionInput } from '../services/promotion.service'
import { archiveDeliveryPoint, createDeliveryPoint, DeliveryPointServiceError, listDeliveryPoints, reorderDeliveryPoints, updateDeliveryPoint } from '../services/delivery-points.service'
import { approveImage, ImageServiceError, orderProductImages, reorderProductImages, retryProductImage, uploadProductImage, type ImageProcessingProvider } from '../services/image.service'
import { MemoryMediaStore, R2MediaStore, type R2BucketLike } from '../adapters/r2'
import { PhotoroomImageProcessingProvider } from '../adapters/photoroom'
import { confirmPersistedOrder, DurableOrderError, hydrateStateFromDatabase, deleteCategory, persistCategory, persistDeliveryPoint, persistImage, persistInventorySnapshot, persistOrderStatus, persistProduct, persistProductAndMovement, persistPromotion, persistRate, persistSettings, schedulePersistence } from '../persistence'

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

export const adminApi = new Hono<CoruEnv>()
adminApi.use('/api/admin/*', requireAdmin)

adminApi.get('/api/admin/products', (c) => c.json({ data: listAdminProducts(state) } satisfies ApiSuccess<typeof state.products>))

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
    const input = (body ?? {}) as Partial<ProductInput>
    const requestedStock = input.stockQuantity
    if (requestedStock !== undefined && (typeof requestedStock !== 'number' || !Number.isInteger(requestedStock) || requestedStock < 0)) return c.json({ error: { code: 'INVALID_QUANTITY', message: 'El stock debe ser un entero no negativo.' } } satisfies ApiError, 422)
    const { stockQuantity: _stockQuantity, ...catalogInput } = input
    const product = updateProduct(state, c.req.param('id'), catalogInput)
    const stockResult = requestedStock === undefined || requestedStock === product.stockQuantity ? undefined : setStock(state, product.id, requestedStock)
    const database = c.get('database')
    if (database) schedulePersistence(c, stockResult?.movement ? persistProductAndMovement(database, state, product, stockResult.movement) : persistProduct(database, state, product))
    return c.json({ data: product })
  } catch (error) { return fail(c, error) }
})

adminApi.delete('/api/admin/products/:id', (c) => {
  try {
    const product = updateProduct(state, c.req.param('id'), { active: false })
    const database = c.get('database')
    if (database) schedulePersistence(c, persistProduct(database, state, product))
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
    if (database) schedulePersistence(c, Promise.all([persistCategory(database, category), ...state.products.filter((product) => product.category === category.name).map((product) => persistProduct(database, state, product)), ...state.promotions.filter((promotion) => promotion.targetCategory === category.name).map((promotion) => persistPromotion(database, state, promotion))]))
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
  if (database) schedulePersistence(c, Promise.all(state.categories.map((category) => persistCategory(database, category))))
  return c.json({ data: listCategories(state) })
})
adminApi.delete('/api/admin/categories/:id', (c) => {
  try {
    const existing = state.categories.find((category) => category.id === c.req.param('id'))
    if (!existing) throw new CatalogServiceError('NOT_FOUND', 'Categoría no encontrada.')
    const hasProducts = state.products.some((product) => product.category === existing.name)
    const category = hasProducts ? updateCategory(state, existing.id, { active: false }) : removeCategory(state, existing.id)
    const database = c.get('database')
    if (database) schedulePersistence(c, hasProducts ? persistCategory(database, category) : deleteCategory(database, category.id))
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
    const database = c.get('database'); if (database) schedulePersistence(c, persistDeliveryPoint(database, point))
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
    const database = c.get('database'); if (database) schedulePersistence(c, persistDeliveryPoint(database, point))
    return c.json({ data: point })
  } catch (error) { return fail(c, error) }
})
adminApi.delete('/api/admin/delivery-points/:id', (c) => {
  try {
    const point = archiveDeliveryPoint(state, c.req.param('id'))
    const database = c.get('database'); if (database) schedulePersistence(c, persistDeliveryPoint(database, point))
    return c.json({ data: point })
  } catch (error) { return fail(c, error) }
})
adminApi.post('/api/admin/delivery-points/reorder', async (c) => {
  const body = await jsonBody(c)
  try {
    if (!Array.isArray(body.ids) || body.ids.some((value) => typeof value !== 'string')) throw new DeliveryPointServiceError('VALIDATION_ERROR', 'La lista de puntos no es válida.')
    const points = reorderDeliveryPoints(state, body.ids as string[])
    const database = c.get('database')
    if (database) for (const point of points) schedulePersistence(c, persistDeliveryPoint(database, point))
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
    if (database) schedulePersistence(c, persistPromotion(database, state, promotion))
    return c.json({ data: promotion }, 201)
  } catch (error) { return fail(c, error) }
})
adminApi.patch('/api/admin/promotions/:id', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  try {
    const promotion = updatePromotion(state, c.req.param('id'), (body ?? {}) as Partial<PromotionInput>)
    const database = c.get('database')
    if (database) schedulePersistence(c, persistPromotion(database, state, promotion))
    return c.json({ data: promotion })
  } catch (error) { return fail(c, error) }
})
adminApi.delete('/api/admin/promotions/:id', (c) => {
  try {
    const promotion = deactivatePromotion(state, c.req.param('id'))
    const database = c.get('database')
    if (database) schedulePersistence(c, persistPromotion(database, state, promotion))
    return c.json({ data: promotion })
  } catch (error) { return fail(c, error) }
})
adminApi.post('/api/admin/products/:id/stock', async (c) => {
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
    const database = c.get('database')
    if (database && result.movement) schedulePersistence(c, persistInventorySnapshot(database, state, product.id, result.movement))
    return c.json({ data: result.product })
  } catch (error) { return fail(c, error) }
})
adminApi.get('/api/admin/orders', (c) => { expirePendingOrders(state); return c.json({ data: state.orders.map(summary) } satisfies ApiSuccess<OrderSummary[]>) })
adminApi.get('/api/admin/orders/:id', (c) => {
  const order = state.orders.find((candidate) => candidate.id === c.req.param('id') || candidate.reference === c.req.param('id'))
  if (!order) return c.json({ error: { code: 'NOT_FOUND', message: 'Pedido no encontrado.' } } satisfies ApiError, 404)
  expirePendingOrders(state)
  return c.json({ data: order } satisfies ApiSuccess<typeof order>)
})
adminApi.post('/api/admin/orders/:id/confirm', async (c) => {
  try {
    const requested = state.orders.find((candidate) => candidate.id === c.req.param('id') || candidate.reference === c.req.param('id'))
    if (requested?.fulfillmentTypeSnapshot === 'PREORDER') throw new OrderServiceError('INVALID_TRANSITION', 'Un pedido bajo pedido se confirma al registrar el anticipo.')
    const database = c.get('database')
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
adminApi.post('/api/admin/orders/:id/discard', (c) => {
  try {
    const order = discardOrder(state, c.req.param('id'), 'Descartado por administración', new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin')
    const database = c.get('database')
    if (database) schedulePersistence(c, persistOrderStatus(database, order, state))
    return c.json({ data: order } satisfies ApiSuccess<ReturnType<typeof discardOrder>>)
  } catch (error) { return fail(c, error) }
})

async function jsonBody(c: Context<CoruEnv>): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' ? body as Record<string, unknown> : {}
  } catch { return {} }
}

adminApi.post('/api/admin/orders/:id/cancel-sale', async (c) => {
  const body = await jsonBody(c)
  const reason = typeof body.reason === 'string' ? body.reason : ''
  try {
    const order = cancelSale(state, c.req.param('id'), reason, c.req.header('Idempotency-Key')?.trim(), new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin')
    const database = c.get('database')
    if (database) schedulePersistence(c, persistOrderStatus(database, order, state))
    return c.json({ data: order } satisfies ApiSuccess<typeof order>)
  } catch (error) { return fail(c, error) }
})

adminApi.post('/api/admin/orders/:id/record-deposit', async (c) => {
  const body = await jsonBody(c)
  try {
    const order = recordPreorderDeposit(state, c.req.param('id'), { currency: body.currency === 'Bs' ? 'Bs' : 'USD', ...(typeof body.paidAmountMinor === 'number' ? { paidAmountMinor: body.paidAmountMinor } : {}), ...(typeof body.rateMicros === 'number' ? { rateMicros: body.rateMicros } : {}), ...(typeof body.note === 'string' ? { note: body.note } : {}) }, c.req.header('Idempotency-Key')?.trim(), new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin')
    const database = c.get('database'); if (database) schedulePersistence(c, persistOrderStatus(database, order, state)); return c.json({ data: order } satisfies ApiSuccess<typeof order>)
  } catch (error) { return fail(c, error) }
})

adminApi.post('/api/admin/orders/:id/mark-ready', (c) => { try { const order = markPreorderReady(state, c.req.param('id'), new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin'); const database = c.get('database'); if (database) schedulePersistence(c, persistOrderStatus(database, order, state)); return c.json({ data: order } satisfies ApiSuccess<typeof order>) } catch (error) { return fail(c, error) } })

adminApi.post('/api/admin/orders/:id/record-balance', async (c) => {
  const body = await jsonBody(c)
  try {
    const order = recordPreorderBalance(state, c.req.param('id'), { currency: body.currency === 'Bs' ? 'Bs' : 'USD', ...(typeof body.paidAmountMinor === 'number' ? { paidAmountMinor: body.paidAmountMinor } : {}), ...(typeof body.rateMicros === 'number' ? { rateMicros: body.rateMicros } : {}), ...(typeof body.note === 'string' ? { note: body.note } : {}) }, c.req.header('Idempotency-Key')?.trim(), new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin')
    const database = c.get('database'); if (database) schedulePersistence(c, persistOrderStatus(database, order, state)); return c.json({ data: order } satisfies ApiSuccess<typeof order>)
  } catch (error) { return fail(c, error) }
})

adminApi.post('/api/admin/orders/:id/mark-delivered', (c) => { try { const order = markPreorderDelivered(state, c.req.param('id'), new Date(), c.req.header('CF-Access-Authenticated-User-Email') ?? 'admin'); const database = c.get('database'); if (database) schedulePersistence(c, persistOrderStatus(database, order, state)); return c.json({ data: order } satisfies ApiSuccess<typeof order>) } catch (error) { return fail(c, error) } })
adminApi.post('/api/admin/orders/:id/refresh-rate', (c) => {
  try {
    const order = refreshOrderRate(state, c.req.param('id'))
    const database = c.get('database')
    if (database) schedulePersistence(c, persistOrderStatus(database, order, state))
    return c.json({ data: order } satisfies ApiSuccess<ReturnType<typeof refreshOrderRate>>)
  } catch (error) { return fail(c, error) }
})

adminApi.get('/api/admin/settings/rate', (c) => c.json({ data: { ...getPublicRate(state), validUntil: state.rateValidUntil } }))

adminApi.get('/api/admin/settings', (c) => c.json({ data: getSettings(state) }))
adminApi.patch('/api/admin/settings', async (c) => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido.' } } satisfies ApiError, 422) }
  try {
    const settings = updateSettings(state, (body ?? {}) as Partial<StoreSettings>)
    const database = c.get('database')
    if (database) schedulePersistence(c, persistSettings(database, settings))
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
    if (database) schedulePersistence(c, persistRate(database, state))
    return c.json({ data: { ...getPublicRate(state), validUntil: state.rateValidUntil } })
  }
  try {
    const result = input.rateMicros !== undefined ? setManualRateMicros(state, input.rateMicros) : setManualRate(state, input.rate)
    const database = c.get('database')
    if (database) schedulePersistence(c, persistRate(database, state))
    return c.json({ data: result })
  } catch (error) { return fail(c, error) }
})

adminApi.post('/api/admin/settings/rate/refresh', async (c) => {
  if (state.rateMode === 'MANUAL') return c.json({ data: { ...getPublicRate(state), validUntil: state.rateValidUntil, updated: false } })
  const provider = c.env?.EXCHANGE_RATE_URL ? createHttpRateProvider(c.env.EXCHANGE_RATE_URL) : createBinanceP2pProvider()
  const result = await refreshRate(state, provider)
  if (!result.updated) return c.json({ error: { code: 'RATE_UNAVAILABLE', message: 'No se pudo obtener una tasa válida.' } } satisfies ApiError, 503)
  const database = c.get('database')
  if (database) schedulePersistence(c, persistRate(database, state))
  return c.json({ data: result })
})

adminApi.get('/api/admin/analytics', (c) => c.json({ data: summarizeAnalytics(state) }))

function analyticsRange(c: Context<CoruEnv>): { value: import('../services/analytics.service').ResolvedAnalyticsRange } | { error: Response } {
  const result = resolveAnalyticsDateRange(c.req.query('from'), c.req.query('to'))
  if (!result.ok) return { error: c.json({ error: { code: 'VALIDATION_ERROR', message: 'El intervalo de analítica no es válido.', details: result.details } } satisfies ApiError, 422) as Response }
  return { value: result.value }
}

adminApi.get('/api/admin/analytics/summary', (c) => {
  const range = analyticsRange(c)
  if ('error' in range) return range.error
  return c.json({ data: summarizeAnalyticsV2(state, state.orders, range.value) })
})

adminApi.get('/api/admin/analytics/products', (c) => {
  const range = analyticsRange(c)
  if ('error' in range) return range.error
  return c.json({ data: { products: summarizeProductInterest(state, range.value) } })
})

adminApi.get('/api/admin/analytics/traffic', (c) => {
  const fromRaw = c.req.query('from')
  const toRaw = c.req.query('to')
  if (!fromRaw && !toRaw) return c.json({ data: summarizeTraffic(state) })
  const range = analyticsRange(c)
  if ('error' in range) return range.error
  return c.json({ data: summarizeTraffic(state, range.value) })
})
