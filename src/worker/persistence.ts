import type { SqlClient } from '../db/client'
import { createTursoClient } from '../db/client'
import type { AnalyticsEvent, Category, Order, Product, Promotion, FulfillmentType, PreorderStage, PaymentStatus, ShippingSnapshot, PersonalDeliveryPoint } from '../shared/types'
import type { CoruBindings } from './env'
import type { CoruState, InventoryMovement } from './state'
import { CatalogRepository } from '../db/repositories/catalog.repository'
import { OrderRepository, type PendingOrderRecord } from '../db/repositories/orders.repository'
import type { StoreSettings } from './services/settings.service'
import type { ProductImageRecord } from './services/image.service'

/**
 * Persistence is deliberately optional. A local checkout has no database
 * bindings and keeps using the in-memory adapter; a Worker with Turso
 * bindings hydrates once per isolate and schedules durable writes for the
 * mutations that have a direct SQL representation.
 */
export type PersistenceMode = 'memory' | 'turso'

export type DurableOrderErrorCode = 'NOT_FOUND' | 'ORDER_TERMINAL' | 'RATE_EXPIRED' | 'STOCK_CONFLICT'

/** A database-backed transition could not be applied. */
export class DurableOrderError extends Error {
  constructor(public readonly code: DurableOrderErrorCode, message: string) {
    super(message)
    this.name = 'DurableOrderError'
  }
}

type HydrationRecord = { key: string; promise: Promise<void> }

const clientCache = new Map<string, SqlClient>()
const hydrationCache = new WeakMap<object, HydrationRecord>()

function bindingKey(env: CoruBindings): string | null {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) return null
  return `${env.TURSO_DATABASE_URL}\u0000${env.TURSO_AUTH_TOKEN}`
}

/** Returns null in local/demo mode. The client is cached per binding pair so
 * every request in a Worker isolate reuses the same lightweight HTTP adapter.
 */
export function databaseFromEnv(env: CoruBindings): SqlClient | null {
  const key = bindingKey(env)
  if (!key) return null
  const cached = clientCache.get(key)
  if (cached) return cached
  const client = createTursoClient(env.TURSO_DATABASE_URL!, env.TURSO_AUTH_TOKEN!)
  clientCache.set(key, client)
  return client
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : value === undefined || value === null ? undefined : String(value)
}

function persistedTimestamp(value: unknown): string | undefined {
  const timestamp = text(value)
  if (!timestamp) return undefined
  const milliseconds = Date.parse(timestamp)
  // A zero/epoch timestamp is a legacy placeholder, not a usable rate date.
  return Number.isFinite(milliseconds) && milliseconds > 0 ? timestamp : undefined
}

function integer(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
}

function asCategory(row: Record<string, unknown>): Category | undefined {
  const id = text(row.id)
  const slug = text(row.slug)
  const name = text(row.name)
  if (!id || !slug || !name) return undefined
  return { id, slug, name, sortOrder: integer(row.sort_order) ?? 0, active: bool(row.is_active) }
}

function asPromotion(row: Record<string, unknown>): Promotion | undefined {
  const id = text(row.id)
  const name = text(row.name)
  const kind = row.kind === 'BUNDLE' || row.kind === 'FIXED_DISCOUNT' ? row.kind : undefined
  if (!id || !name || !kind) return undefined
  const targetCategory = text(row.target_category)
  const bundleQuantity = integer(row.bundle_quantity)
  const bundlePriceCents = integer(row.bundle_price_cents)
  const fixedDiscountCents = integer(row.fixed_discount_cents)
  const startsAt = text(row.starts_at)
  const endsAt = text(row.ends_at)
  return {
    id,
    name,
    kind,
    ...(targetCategory ? { targetCategory } : {}),
    ...(bundleQuantity !== undefined ? { bundleQuantity } : {}),
    ...(bundlePriceCents !== undefined ? { bundlePriceCents } : {}),
    ...(fixedDiscountCents !== undefined ? { fixedDiscountCents } : {}),
    active: bool(row.is_active),
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
  }
}

/** Read the currently active promotion from the durable source of truth. */
export async function findActivePromotion(db: SqlClient, now = new Date()): Promise<Promotion | undefined> {
  const timestamp = now.toISOString()
  const result = await db.execute<Record<string, unknown>>(`SELECT p.id, p.name, p.kind, c.name AS target_category, p.bundle_quantity, p.bundle_price_cents, p.fixed_discount_cents, p.is_active, p.starts_at, p.ends_at FROM promotions p LEFT JOIN categories c ON c.id = p.target_category_id WHERE p.is_active = 1 AND (p.starts_at IS NULL OR p.starts_at <= ?) AND (p.ends_at IS NULL OR p.ends_at >= ?) ORDER BY p.created_at DESC LIMIT 1`, [timestamp, timestamp])
  return asPromotion(result.rows[0] ?? {})
}

function parseSettings(rows: Array<Record<string, unknown>>, current: StoreSettings): StoreSettings {
  const next: StoreSettings = { ...current }
  for (const row of rows) {
    const key = text(row.key)
    if (!key || typeof row.value_json !== 'string') continue
    try {
      const value: unknown = JSON.parse(row.value_json)
      if (key === 'whatsappPhone' && typeof value === 'string') next.whatsappPhone = value
      if (key === 'whatsappIntro' && typeof value === 'string') next.whatsappIntro = value
      if (key === 'storeName' && typeof value === 'string') next.storeName = value
      if (key === 'instagramUrl' && typeof value === 'string') next.instagramUrl = value
      if (key === 'facebookUrl' && typeof value === 'string') next.facebookUrl = value
      if (key === 'privacyUrl' && typeof value === 'string') next.privacyUrl = value
      if (key === 'storeActive' && typeof value === 'boolean') next.storeActive = value
    } catch {
      // Ignore one malformed optional setting; the rest of the store can load.
    }
  }
  return next
}

function asImage(row: Record<string, unknown>): ProductImageRecord | undefined {
  const id = text(row.id)
  const productId = text(row.product_id)
  const originalKey = text(row.original_key)
  const mimeType = row.mime_type === 'image/jpeg' || row.mime_type === 'image/png' || row.mime_type === 'image/webp' ? row.mime_type : undefined
  const processingStatus = row.processing_status === 'PENDING' || row.processing_status === 'PROCESSING' || row.processing_status === 'READY' || row.processing_status === 'FAILED' ? row.processing_status : undefined
  if (!id || !productId || !originalKey || !mimeType || !processingStatus) return undefined
  const processedKey = text(row.processed_key)
  const approved = bool(row.is_approved)
  return {
    id,
    productId,
    originalKey,
    ...(processedKey ? { processedKey } : {}),
    mimeType,
    byteSize: integer(row.byte_size) ?? 0,
    processingStatus,
    ...(approved ? { approvedVariant: processingStatus === 'READY' && processedKey ? 'processed' as const : 'original' as const } : {}),
    ...(text(row.error_code) ? { errorCode: text(row.error_code) } : {}),
    createdAt: text(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: text(row.updated_at) ?? new Date(0).toISOString(),
  }
}

function asMovement(row: Record<string, unknown>): InventoryMovement | undefined {
  const id = text(row.id)
  const productId = text(row.product_id)
  const type = row.movement_type === 'SALE' || row.movement_type === 'SALE_REVERSAL' || row.movement_type === 'MANUAL_SET' || row.movement_type === 'MANUAL_ADJUST' ? row.movement_type : undefined
  const delta = integer(row.delta)
  if (!id || !productId || !type || delta === undefined || delta === 0) return undefined
  const note = text(row.note)
  return { id, productId, type, delta, ...(text(row.order_id) ? { orderId: text(row.order_id) } : {}), ...(text(row.reverses_movement_id) ? { reversesMovementId: text(row.reverses_movement_id) } : {}), ...(note ? { note } : {}), createdAt: text(row.created_at) ?? new Date(0).toISOString() }
}

function asAnalytics(row: Record<string, unknown>): AnalyticsEvent | undefined {
  const names = new Set(['catalog_view', 'product_view', 'cart_add', 'order_intent', 'order_confirmed', 'size_guide_view', 'shipping_method_selected', 'yummy_quote_requested', 'yummy_quote_succeeded', 'yummy_quote_failed', 'preorder_intent_created', 'preorder_deposit_recorded', 'preorder_ready', 'preorder_completed'])
  const name = typeof row.name === 'string' && names.has(row.name) ? row.name as AnalyticsEvent['name'] : undefined
  const sessionId = text(row.session_id)
  const source = text(row.source)
  const occurredAt = text(row.occurred_at)
  if (!name || !sessionId || !source || !occurredAt) return undefined
  let properties: Record<string, string | number | boolean> | undefined
  if (typeof row.properties_json === 'string') {
    try {
      const parsed: unknown = JSON.parse(row.properties_json)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const safeEntries = Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        if (safeEntries.length) properties = Object.fromEntries(safeEntries) as Record<string, string | number | boolean>
      }
    } catch {
      // Keep the event; malformed optional properties must not hide it.
    }
  }
  return { name, sessionId, source, occurredAt, ...(properties ? { properties } : {}) }
}

type JoinedOrderRow = Record<string, unknown> & {
  order_id?: string
  item_id?: string
  product_id?: string
  name_snapshot?: string
  size_label_snapshot?: string
  unit_price_cents?: number
  quantity?: number
  line_total_cents?: number
}

function hydrateOrders(rows: JoinedOrderRow[]): { orders: Order[]; idempotency: Map<string, Order> } {
  const grouped = new Map<string, Order>()
  for (const row of rows) {
    const id = text(row.order_id ?? row.id)
    const reference = text(row.reference)
    const status = row.status === 'PENDING' || row.status === 'CONFIRMED' || row.status === 'DISCARDED' || row.status === 'CANCELLED' ? row.status : undefined
    const currency = row.currency === 'Bs' ? 'Bs' : row.currency === 'USD' ? 'USD' : undefined
    if (!id || !reference || !status || !currency) continue
    let order = grouped.get(id)
    if (!order) {
      const subtotalCents = integer(row.subtotal_cents) ?? 0
      const discountCents = integer(row.discount_cents) ?? 0
      const totalCents = integer(row.total_cents) ?? Math.max(0, subtotalCents - discountCents)
      const promotionId = text(row.promotion_id)
      const promotionName = text(row.promotion_name)
      const groups = integer(row.promotion_groups)
      order = {
        id,
        reference,
        status,
        currency,
        ...(integer(row.rate_micros) ? { rateMicros: integer(row.rate_micros) } : {}),
        ...(text(row.rate_valid_until) ? { rateValidUntil: text(row.rate_valid_until) } : {}),
        items: [],
        quote: {
          subtotalCents,
          discountCents,
          totalCents,
          ...(promotionId && promotionName && groups ? { appliedPromotion: { id: promotionId, name: promotionName, groupsApplied: groups } } : {}),
        },
        whatsappUrl: text(row.whatsapp_url) ?? '',
        createdAt: text(row.created_at) ?? new Date(0).toISOString(),
        ...(text(row.confirmed_at) ? { confirmedAt: text(row.confirmed_at) } : {}),
        ...(text(row.expires_at) ? { expiresAt: text(row.expires_at) } : {}),
        ...(text(row.discarded_at) ? { discardedAt: text(row.discarded_at) } : {}),
        ...(text(row.cancelled_at) ? { cancelledAt: text(row.cancelled_at) } : {}),
        ...(text(row.discard_reason) ? { discardReason: text(row.discard_reason) } : {}),
        ...(text(row.cancel_reason) ? { cancelReason: text(row.cancel_reason) } : {}),
        fulfillmentTypeSnapshot: row.fulfillment_type_snapshot === 'PREORDER' ? 'PREORDER' : 'STOCK',
        ...(text(row.lead_time_snapshot) ? { leadTimeSnapshot: text(row.lead_time_snapshot) } : {}),
        ...(integer(row.deposit_usd_cents) !== undefined ? { depositUsdCents: integer(row.deposit_usd_cents) } : {}),
        ...(integer(row.balance_usd_cents) !== undefined ? { balanceUsdCents: integer(row.balance_usd_cents) } : {}),
        ...(typeof row.preorder_stage === 'string' ? { preorderStage: row.preorder_stage as PreorderStage } : {}),
        ...(typeof row.payment_status === 'string' ? { paymentStatus: row.payment_status as PaymentStatus } : {}),
      }
      if (row.shipping_method === 'PERSONAL' && text(row.personal_delivery_point_id)) order.shipping = { method: 'PERSONAL', deliveryPointId: text(row.personal_delivery_point_id)! }
      if (row.shipping_method === 'YUMMY' && text(row.delivery_address_text)) {
        const quoteCurrency = row.delivery_quote_currency === 'USD' || row.delivery_quote_currency === 'Bs' ? row.delivery_quote_currency : undefined
        order.shipping = { method: 'YUMMY', addressText: text(row.delivery_address_text)!, ...(typeof row.delivery_lat === 'number' ? { latitude: row.delivery_lat } : {}), ...(typeof row.delivery_lng === 'number' ? { longitude: row.delivery_lng } : {}), ...(integer(row.delivery_quote_amount_minor) !== undefined ? { quoteAmountMinor: integer(row.delivery_quote_amount_minor) } : {}), ...(quoteCurrency ? { quoteCurrency } : {}), ...(text(row.delivery_quote_quoted_at) ? { quoteQuotedAt: text(row.delivery_quote_quoted_at) } : {}), ...(text(row.delivery_quote_external_id) ? { quoteExternalId: text(row.delivery_quote_external_id) } : {}) }
      }
      if (row.shipping_method === 'NATIONAL' && (row.national_carrier === 'MRW' || row.national_carrier === 'ZOOM') && text(row.national_state) && text(row.national_city)) order.shipping = { method: 'NATIONAL', carrier: row.national_carrier, state: text(row.national_state)!, city: text(row.national_city)!, ...(text(row.national_office_text) ? { officeText: text(row.national_office_text) } : {}) }
      grouped.set(id, order)
    }
    const productId = text(row.product_id)
    const itemId = text(row.item_id)
    const quantity = integer(row.quantity)
    if (productId && itemId && quantity && quantity > 0) {
      order.items.push({
        productId,
        quantity,
        name: text(row.name_snapshot) ?? productId,
        sizeLabel: text(row.size_label_snapshot) ?? '',
        unitPriceCents: integer(row.unit_price_cents) ?? 0,
        lineTotalCents: integer(row.line_total_cents) ?? 0,
        ...(text(row.material_snapshot) ? { material: text(row.material_snapshot) } : {}),
        fulfillmentTypeSnapshot: row.fulfillment_type_snapshot === 'PREORDER' ? 'PREORDER' : 'STOCK',
      })
    }
  }
  const orders = [...grouped.values()]
  const idempotency = new Map<string, Order>()
  for (const row of rows) {
    const id = text(row.order_id ?? row.id)
    const key = text(row.idempotency_key)
    const order = id ? grouped.get(id) : undefined
    if (key && order) idempotency.set(key, order)
  }
  return { orders, idempotency }
}

/** Hydrate all state that has a stable representation in the v1 migration. */
export async function hydrateStateFromDatabase(state: CoruState, db: SqlClient): Promise<void> {
  const categoriesResult = await db.execute<Record<string, unknown>>('SELECT id, slug, name, sort_order, is_active FROM categories ORDER BY sort_order, name')
  state.categories = categoriesResult.rows.map(asCategory).filter((entry): entry is Category => Boolean(entry))

  const catalog = new CatalogRepository(db)
  state.products = await catalog.listAll()

  const imagesResult = await db.execute<Record<string, unknown>>('SELECT id, product_id, original_key, processed_key, mime_type, byte_size, processing_status, is_approved, error_code, created_at, updated_at FROM product_images ORDER BY created_at ASC')
  state.images = new Map(imagesResult.rows.map(asImage).filter((entry): entry is ProductImageRecord => Boolean(entry)).map((image) => [image.id, image]))

  const promotionsResult = await db.execute<Record<string, unknown>>('SELECT p.id, p.name, p.kind, c.name AS target_category, p.bundle_quantity, p.bundle_price_cents, p.fixed_discount_cents, p.is_active, p.starts_at, p.ends_at FROM promotions p LEFT JOIN categories c ON c.id = p.target_category_id ORDER BY p.created_at DESC')
  state.promotions = promotionsResult.rows.map(asPromotion).filter((entry): entry is Promotion => Boolean(entry))

  const settingsResult = await db.execute<Record<string, unknown>>('SELECT key, value_json FROM store_settings')
  state.settings = parseSettings(settingsResult.rows, state.settings)

  try {
    const pointsResult = await db.execute<Record<string, unknown>>('SELECT id, name, address, short_description, latitude, longitude, schedule_text, is_active, sort_order FROM personal_delivery_points ORDER BY sort_order, name')
    const points = pointsResult.rows.map((row) => ({ id: text(row.id) ?? '', name: text(row.name) ?? '', address: text(row.address) ?? '', ...(text(row.short_description) ? { shortDescription: text(row.short_description) } : {}), ...(typeof row.latitude === 'number' ? { latitude: row.latitude } : {}), ...(typeof row.longitude === 'number' ? { longitude: row.longitude } : {}), ...(text(row.schedule_text) ? { scheduleText: text(row.schedule_text) } : {}), active: bool(row.is_active), sortOrder: integer(row.sort_order) ?? 0 })).filter((point) => point.id && point.name && point.address)
    if (points.length) state.deliveryPoints = points
  } catch {
    // The table is added by the v1.1 migration; keep seeded points if an
    // older database is still being upgraded.
  }

  const rateResult = await db.execute<Record<string, unknown>>('SELECT rate_micros, mode, observed_at, valid_until FROM exchange_rates ORDER BY observed_at DESC LIMIT 1')
  const rate = rateResult.rows[0]
  if (rate) {
    const rateMicros = integer(rate.rate_micros)
    const observedAt = persistedTimestamp(rate.observed_at)
    const validUntil = persistedTimestamp(rate.valid_until)
    if (rateMicros && rateMicros > 0 && observedAt && validUntil) {
      state.currentRateMicros = rateMicros
      if (rate.mode === 'AUTOMATIC' || rate.mode === 'MANUAL') state.rateMode = rate.mode
      state.rateUpdatedAt = observedAt
      state.rateSource = 'PERSISTED'
      state.rateValidUntil = validUntil
    }
  }

  const ordersResult = await db.execute<JoinedOrderRow>(`SELECT o.id AS order_id, o.reference, o.status, o.currency, o.idempotency_key, o.rate_micros, o.rate_valid_until, o.subtotal_cents, o.discount_cents, o.total_cents, o.promotion_id, o.promotion_name, o.promotion_groups, o.whatsapp_url, o.created_at, o.expires_at, o.confirmed_at, o.discarded_at, o.cancelled_at, o.discard_reason, o.cancel_reason, o.fulfillment_type_snapshot, o.lead_time_snapshot, o.deposit_usd_cents, o.balance_usd_cents, o.preorder_stage, o.payment_status, o.shipping_method, o.personal_delivery_point_id, o.delivery_address_text, o.delivery_lat, o.delivery_lng, o.delivery_quote_amount_minor, o.delivery_quote_currency, o.delivery_quote_quoted_at, o.delivery_quote_external_id, o.national_carrier, o.national_state, o.national_city, o.national_office_text, oi.id AS item_id, oi.product_id, oi.name_snapshot, oi.size_label_snapshot, oi.material_snapshot, oi.fulfillment_type_snapshot, oi.unit_price_cents, oi.quantity, oi.line_total_cents FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id ORDER BY o.created_at ASC`)
  const hydratedOrders = hydrateOrders(ordersResult.rows)
  state.orders = hydratedOrders.orders
  state.idempotency = hydratedOrders.idempotency
  state.actionIdempotency.clear()

  const movementsResult = await db.execute<Record<string, unknown>>('SELECT id, product_id, order_id, movement_type, delta, reverses_movement_id, note, created_at FROM inventory_movements ORDER BY created_at ASC')
  state.movements = movementsResult.rows.map(asMovement).filter((entry): entry is InventoryMovement => Boolean(entry))

  const analyticsResult = await db.execute<Record<string, unknown>>('SELECT name, session_id, source, properties_json, occurred_at FROM analytics_events ORDER BY occurred_at ASC')
  state.analytics = analyticsResult.rows.map(asAnalytics).filter((entry): entry is AnalyticsEvent => Boolean(entry))
}

/** Hydrate at most once per state object and Turso binding pair. */
export async function ensureStateHydrated(state: CoruState, env: CoruBindings): Promise<SqlClient | null> {
  const db = databaseFromEnv(env)
  const key = bindingKey(env)
  if (!db || !key) return null
  const cached = hydrationCache.get(state)
  if (!cached || cached.key !== key) {
    const promise = hydrateStateFromDatabase(state, db)
    hydrationCache.set(state, { key, promise })
    try {
      await promise
    } catch (error) {
      hydrationCache.delete(state)
      throw error
    }
  } else {
    await cached.promise
  }
  return db
}

/** Used by local tests/tools that reset the singleton state between runs. */
export function clearHydrationCache(state: CoruState): void {
  hydrationCache.delete(state)
}

function settingEntries(settings: StoreSettings): Array<[string, string]> {
  return Object.entries(settings).map(([key, value]) => [key, JSON.stringify(value)])
}

export async function persistSettings(db: SqlClient, settings: StoreSettings, updatedAt = new Date().toISOString()): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [key, value] of settingEntries(settings)) {
      await tx.execute('INSERT INTO store_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at', [key, value, updatedAt])
    }
  })
}

export async function persistCategory(db: SqlClient, category: Category, updatedAt = new Date().toISOString()): Promise<void> {
  await db.execute('INSERT INTO categories (id, slug, name, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, name = excluded.name, sort_order = excluded.sort_order, is_active = excluded.is_active, updated_at = excluded.updated_at', [category.id, category.slug, category.name, category.sortOrder, category.active ? 1 : 0, updatedAt, updatedAt])
}

export async function persistDeliveryPoint(db: SqlClient, point: PersonalDeliveryPoint, updatedAt = new Date().toISOString()): Promise<void> {
  await db.execute('INSERT INTO personal_delivery_points (id, name, address, short_description, latitude, longitude, schedule_text, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, address = excluded.address, short_description = excluded.short_description, latitude = excluded.latitude, longitude = excluded.longitude, schedule_text = excluded.schedule_text, is_active = excluded.is_active, sort_order = excluded.sort_order, updated_at = excluded.updated_at', [point.id, point.name, point.address, point.shortDescription ?? null, point.latitude ?? null, point.longitude ?? null, point.scheduleText ?? null, point.active ? 1 : 0, point.sortOrder, updatedAt, updatedAt])
}

export async function persistProduct(db: SqlClient, state: CoruState, product: Product, updatedAt = new Date().toISOString()): Promise<void> {
  const category = state.categories.find((candidate) => candidate.name === product.category)
  if (!category) return
  const image = [...state.images.values()].find((candidate) => candidate.productId === product.id && candidate.approvedVariant)
  await db.execute('INSERT INTO products (id, category_id, sku, slug, name, description, material, artwork, size_label, price_cents, stock_quantity, fulfillment_type, measurements_text, inner_diameter_mm, circumference_mm, lead_time, is_active, promo_eligible, primary_image_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, slug = excluded.slug, name = excluded.name, description = excluded.description, material = excluded.material, artwork = excluded.artwork, size_label = excluded.size_label, price_cents = excluded.price_cents, stock_quantity = excluded.stock_quantity, fulfillment_type = excluded.fulfillment_type, measurements_text = excluded.measurements_text, inner_diameter_mm = excluded.inner_diameter_mm, circumference_mm = excluded.circumference_mm, lead_time = excluded.lead_time, is_active = excluded.is_active, promo_eligible = excluded.promo_eligible, primary_image_id = excluded.primary_image_id, updated_at = excluded.updated_at', [product.id, category.id, product.id, product.slug, product.name, product.description, product.material, product.artwork, product.sizeLabel, product.priceCents, product.stockQuantity, product.fulfillmentType ?? 'STOCK', product.measurementsText ?? null, product.innerDiameterMm ?? null, product.circumferenceMm ?? null, product.leadTime ?? null, product.active ? 1 : 0, product.promoEligible ? 1 : 0, image?.id ?? null, updatedAt, updatedAt])
}

/** Persist a product edit and its inventory movement atomically. */
export async function persistProductAndMovement(db: SqlClient, state: CoruState, product: Product, movement: InventoryMovement, updatedAt = new Date().toISOString()): Promise<void> {
  const category = state.categories.find((candidate) => candidate.name === product.category)
  if (!category) return
  const image = [...state.images.values()].find((candidate) => candidate.productId === product.id && candidate.approvedVariant)
  await db.transaction(async (tx) => {
    await tx.execute('INSERT INTO products (id, category_id, sku, slug, name, description, material, artwork, size_label, price_cents, stock_quantity, fulfillment_type, measurements_text, inner_diameter_mm, circumference_mm, lead_time, is_active, promo_eligible, primary_image_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, slug = excluded.slug, name = excluded.name, description = excluded.description, material = excluded.material, artwork = excluded.artwork, size_label = excluded.size_label, price_cents = excluded.price_cents, stock_quantity = excluded.stock_quantity, fulfillment_type = excluded.fulfillment_type, measurements_text = excluded.measurements_text, inner_diameter_mm = excluded.inner_diameter_mm, circumference_mm = excluded.circumference_mm, lead_time = excluded.lead_time, is_active = excluded.is_active, promo_eligible = excluded.promo_eligible, primary_image_id = excluded.primary_image_id, updated_at = excluded.updated_at', [product.id, category.id, product.id, product.slug, product.name, product.description, product.material, product.artwork, product.sizeLabel, product.priceCents, product.stockQuantity, product.fulfillmentType ?? 'STOCK', product.measurementsText ?? null, product.innerDiameterMm ?? null, product.circumferenceMm ?? null, product.leadTime ?? null, product.active ? 1 : 0, product.promoEligible ? 1 : 0, image?.id ?? null, updatedAt, updatedAt])
    await tx.execute('INSERT INTO inventory_movements (id, product_id, order_id, movement_type, delta, reverses_movement_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [movement.id, product.id, movement.orderId ?? null, movement.type, movement.delta, movement.reversesMovementId ?? null, movement.note ?? null, movement.createdAt])
  })
}

export async function persistPromotion(db: SqlClient, state: CoruState, promotion: Promotion, updatedAt = new Date().toISOString()): Promise<void> {
  const targetCategoryId = promotion.targetCategory ? state.categories.find((category) => category.name === promotion.targetCategory)?.id : undefined
  await db.execute('INSERT INTO promotions (id, name, kind, target_category_id, bundle_quantity, bundle_price_cents, fixed_discount_cents, is_active, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, target_category_id = excluded.target_category_id, bundle_quantity = excluded.bundle_quantity, bundle_price_cents = excluded.bundle_price_cents, fixed_discount_cents = excluded.fixed_discount_cents, is_active = excluded.is_active, starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = excluded.updated_at', [promotion.id, promotion.name, promotion.kind, targetCategoryId ?? null, promotion.bundleQuantity ?? null, promotion.bundlePriceCents ?? null, promotion.fixedDiscountCents ?? null, promotion.active ? 1 : 0, promotion.startsAt ?? null, promotion.endsAt ?? null, updatedAt, updatedAt])
}

export async function persistImage(db: SqlClient, image: ProductImageRecord): Promise<void> {
  await db.execute('INSERT INTO product_images (id, product_id, original_key, processed_key, mime_type, byte_size, processing_status, is_approved, error_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET processed_key = excluded.processed_key, processing_status = excluded.processing_status, is_approved = excluded.is_approved, error_code = excluded.error_code, updated_at = excluded.updated_at', [image.id, image.productId, image.originalKey, image.processedKey ?? null, image.mimeType, image.byteSize, image.processingStatus, image.approvedVariant ? 1 : 0, image.errorCode ?? null, image.createdAt, image.updatedAt])
}

export async function persistRate(db: SqlClient, state: CoruState, observedAt = state.rateUpdatedAt): Promise<void> {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `rate-${Date.now()}`
  await db.execute('INSERT INTO exchange_rates (id, rate_micros, mode, observed_at, valid_until) VALUES (?, ?, ?, ?, ?)', [id, state.currentRateMicros, state.rateMode, observedAt, state.rateValidUntil])
}

export async function persistPendingOrder(db: SqlClient, order: Order, idempotencyKey: string): Promise<void> {
  const record: PendingOrderRecord = {
    id: order.id,
    reference: order.reference,
    currency: order.currency,
    idempotencyKey,
    ...(order.rateMicros ? { rateMicros: order.rateMicros } : {}),
    ...(order.rateValidUntil ? { rateValidUntil: order.rateValidUntil } : {}),
    quote: order.quote,
    whatsappUrl: order.whatsappUrl,
    createdAt: order.createdAt,
    ...(order.expiresAt ? { expiresAt: order.expiresAt } : {}),
    ...(order.fulfillmentTypeSnapshot ? { fulfillmentTypeSnapshot: order.fulfillmentTypeSnapshot } : {}),
    ...(order.leadTimeSnapshot ? { leadTimeSnapshot: order.leadTimeSnapshot } : {}),
    ...(order.depositUsdCents !== undefined ? { depositUsdCents: order.depositUsdCents } : {}),
    ...(order.balanceUsdCents !== undefined ? { balanceUsdCents: order.balanceUsdCents } : {}),
    ...(order.preorderStage ? { preorderStage: order.preorderStage } : {}),
    ...(order.paymentStatus ? { paymentStatus: order.paymentStatus } : {}),
    ...(order.shipping ? { shipping: order.shipping } : {}),
    items: order.items.map((item) => ({ id: `${order.id}:${item.productId}`, productId: item.productId, name: item.name, sizeLabel: item.sizeLabel, material: item.material, fulfillmentTypeSnapshot: item.fulfillmentTypeSnapshot, unitPriceCents: item.unitPriceCents, quantity: item.quantity, lineTotalCents: item.lineTotalCents })),
  }
  await new OrderRepository(db).insertPending(record)
}

export async function findPersistedOrder(db: SqlClient, idOrIdempotency: string): Promise<Order | undefined> {
  const result = await db.execute<JoinedOrderRow>(`SELECT o.id AS order_id, o.reference, o.status, o.currency, o.idempotency_key, o.rate_micros, o.rate_valid_until, o.subtotal_cents, o.discount_cents, o.total_cents, o.promotion_id, o.promotion_name, o.promotion_groups, o.whatsapp_url, o.created_at, o.expires_at, o.confirmed_at, o.discarded_at, o.cancelled_at, o.discard_reason, o.cancel_reason, o.fulfillment_type_snapshot, o.lead_time_snapshot, o.deposit_usd_cents, o.balance_usd_cents, o.preorder_stage, o.payment_status, o.shipping_method, o.personal_delivery_point_id, o.delivery_address_text, o.delivery_lat, o.delivery_lng, o.delivery_quote_amount_minor, o.delivery_quote_currency, o.delivery_quote_quoted_at, o.delivery_quote_external_id, o.national_carrier, o.national_state, o.national_city, o.national_office_text, oi.id AS item_id, oi.product_id, oi.name_snapshot, oi.size_label_snapshot, oi.material_snapshot, oi.fulfillment_type_snapshot, oi.unit_price_cents, oi.quantity, oi.line_total_cents FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id WHERE o.id = ? OR o.idempotency_key = ? ORDER BY o.created_at ASC`, [idOrIdempotency, idOrIdempotency])
  return hydrateOrders(result.rows).orders[0]
}

export async function persistOrderStatus(db: SqlClient, order: Order, state?: CoruState): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute('UPDATE orders SET status = ?, confirmed_at = ?, discarded_at = ?, cancelled_at = ?, discard_reason = ?, cancel_reason = ?, rate_micros = ?, rate_valid_until = ?, whatsapp_url = ?, preorder_stage = ?, payment_status = ? WHERE id = ?', [order.status, order.confirmedAt ?? null, order.discardedAt ?? null, order.cancelledAt ?? null, order.discardReason ?? null, order.cancelReason ?? null, order.rateMicros ?? null, order.rateValidUntil ?? null, order.whatsappUrl, order.preorderStage ?? null, order.paymentStatus ?? null, order.id])
    if (!state) return
    const orderProductIds = new Set(order.items.map((item) => item.productId))
    for (const product of state.products) {
      if (orderProductIds.has(product.id)) await tx.execute('UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?', [product.stockQuantity, new Date().toISOString(), product.id])
    }
    for (const movement of state.movements.filter((entry) => entry.orderId === order.id)) await tx.execute('INSERT OR IGNORE INTO inventory_movements (id, product_id, order_id, movement_type, delta, reverses_movement_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [movement.id, movement.productId, movement.orderId ?? null, movement.type, movement.delta, movement.reversesMovementId ?? null, movement.note ?? null, movement.createdAt])
    for (const payment of order.payments ?? []) await tx.execute('INSERT OR IGNORE INTO order_payments (id, order_id, payment_kind, usd_amount_cents, paid_currency, paid_amount_minor, rate_micros, recorded_at, note, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [payment.id, order.id, payment.kind, payment.usdAmountCents, payment.paidCurrency, payment.paidAmountMinor, payment.rateMicros ?? null, payment.recordedAt, payment.note ?? null, payment.idempotencyKey ?? null])
    for (const audit of order.audit ?? []) await tx.execute('INSERT OR IGNORE INTO order_audits (id, order_id, action, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)', [audit.id, order.id, audit.action, audit.actor ?? null, audit.reason ?? null, audit.createdAt])
  })
}

/**
 * Confirm a persisted order and consume inventory in one Turso transaction.
 *
 * The HTTP libSQL client queues statements inside a transaction, so the
 * transition uses a unique confirmation timestamp as its transaction marker:
 * the order update succeeds only for a pending order with valid rate/stock;
 * product and movement writes require that marker. A second concurrent
 * confirmation therefore cannot decrement inventory twice.
 */
export async function confirmPersistedOrder(db: SqlClient, orderId: string, now = new Date()): Promise<Order> {
  const confirmationStamp = now.toISOString()
  const movementTimestamp = confirmationStamp
  await db.transaction(async (tx) => {
    await tx.execute(`UPDATE orders
      SET status = 'CONFIRMED', confirmed_at = ?
      WHERE id = ?
        AND status = 'PENDING'
        AND (currency = 'USD' OR (currency = 'Bs' AND rate_valid_until IS NOT NULL AND rate_valid_until >= ?))
        AND NOT EXISTS (
          SELECT 1
          FROM order_items oi
          LEFT JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = ?
            AND (p.id IS NULL OR p.stock_quantity < oi.quantity)
        )`, [confirmationStamp, orderId, confirmationStamp, orderId])

    await tx.execute(`UPDATE products
      SET stock_quantity = stock_quantity - (
        SELECT COALESCE(SUM(oi.quantity), 0)
        FROM order_items oi
        WHERE oi.order_id = ? AND oi.product_id = products.id
      ), updated_at = ?
      WHERE id IN (SELECT product_id FROM order_items WHERE order_id = ?)
        AND EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = ? AND o.status = 'CONFIRMED' AND o.confirmed_at = ?
        )
        AND stock_quantity >= (
          SELECT COALESCE(SUM(oi.quantity), 0)
          FROM order_items oi
          WHERE oi.order_id = ? AND oi.product_id = products.id
        )`, [orderId, movementTimestamp, orderId, orderId, confirmationStamp, orderId])

    await tx.execute(`INSERT INTO inventory_movements
      (id, product_id, order_id, movement_type, delta, note, created_at)
      SELECT lower(hex(randomblob(16))), oi.product_id, oi.order_id, 'SALE', -oi.quantity, o.reference, ?
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.order_id = ? AND o.status = 'CONFIRMED' AND o.confirmed_at = ?`, [movementTimestamp, orderId, confirmationStamp])
  })

  const persisted = await findPersistedOrder(db, orderId)
  if (!persisted) throw new DurableOrderError('NOT_FOUND', 'Pedido no encontrado.')
  if (persisted.status === 'CONFIRMED') {
    // A matching timestamp means this request performed the transition. A
    // different timestamp means another admin request already completed it.
    if (persisted.confirmedAt === confirmationStamp) return persisted
    throw new DurableOrderError('ORDER_TERMINAL', 'El pedido ya no está pendiente.')
  }
  if (persisted.status !== 'PENDING') throw new DurableOrderError('ORDER_TERMINAL', 'El pedido ya no está pendiente.')
  if (persisted.currency === 'Bs' && (!persisted.rateValidUntil || now > new Date(persisted.rateValidUntil))) throw new DurableOrderError('RATE_EXPIRED', 'La tasa del pedido expiró; actualízala antes de confirmar.')

  const stockConflict = await db.execute(`SELECT oi.product_id
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ? AND (p.id IS NULL OR p.stock_quantity < oi.quantity)
    LIMIT 1`, [orderId])
  if (stockConflict.rows.length) throw new DurableOrderError('STOCK_CONFLICT', 'El stock cambió; revisa el pedido antes de confirmar.')
  throw new DurableOrderError('STOCK_CONFLICT', 'No se pudo confirmar el pedido; inténtalo de nuevo.')
}

export async function persistInventorySnapshot(db: SqlClient, state: CoruState, productId: string, movement?: { type: string; delta: number; note?: string; createdAt?: string }): Promise<void> {
  const product = state.products.find((candidate) => candidate.id === productId)
  if (!product) return
  await db.transaction(async (tx) => {
    await tx.execute('UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?', [product.stockQuantity, new Date().toISOString(), product.id])
    if (movement) await tx.execute('INSERT INTO inventory_movements (id, product_id, order_id, movement_type, delta, reverses_movement_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `movement-${Date.now()}`, product.id, (movement as InventoryMovement).orderId ?? null, movement.type, movement.delta, (movement as InventoryMovement).reversesMovementId ?? null, movement.note ?? null, movement.createdAt ?? new Date().toISOString()])
  })
}

export async function persistAnalytics(db: SqlClient, events: AnalyticsEvent[]): Promise<void> {
  if (!events.length) return
  await db.transaction(async (tx) => {
    for (const event of events) {
      await tx.execute('INSERT INTO analytics_events (id, name, session_id, source, properties_json, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `analytics-${Date.now()}`, event.name, event.sessionId, event.source, event.properties ? JSON.stringify(event.properties) : null, event.occurredAt, new Date().toISOString()])
    }
  })
}

export async function purgePersistedAnalytics(db: SqlClient, cutoff: string): Promise<void> {
  await db.execute('DELETE FROM analytics_events WHERE occurred_at < ?', [cutoff])
}

export function schedulePersistence(c: { executionCtx?: { waitUntil(promise: Promise<unknown>): void } }, work: Promise<unknown>): void {
  const safe = work.catch(() => undefined)
  if (c.executionCtx) c.executionCtx.waitUntil(safe)
  else void safe
}
