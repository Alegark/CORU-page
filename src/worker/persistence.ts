import type { SqlClient, SqlValue } from '../db/client'
import { createTursoClient } from '../db/client'
import { ANALYTICS_EVENT_NAMES } from '../shared/analytics-events'
import type { AnalyticsEvent, Category, Order, OrderAuditEntry, OrderPayment, Product, Promotion, FulfillmentType, PreorderStage, PaymentStatus, ShippingSnapshot, PersonalDeliveryPoint } from '../shared/types'
import type { CoruBindings } from './env'
import type { CoruState, InventoryMovement } from './state'
import { CatalogRepository } from '../db/repositories/catalog.repository'
import { OrderRepository, type PendingOrderRecord } from '../db/repositories/orders.repository'
import type { StoreSettings } from './services/settings.service'
import { orderProductImages, type ProductImageRecord } from './services/image.service'
import { defaultPersonalDeliveryPoints } from '../shared/delivery-points'

/**
 * Persistence is deliberately optional. A local checkout has no database
 * bindings and keeps using the in-memory adapter; a Worker with Turso
 * bindings hydrates once per isolate and schedules durable writes for the
 * mutations that have a direct SQL representation.
 */
export type PersistenceMode = 'memory' | 'turso'

export type DurableOrderErrorCode = 'NOT_FOUND' | 'ORDER_TERMINAL' | 'RATE_EXPIRED' | 'STOCK_CONFLICT' | 'ORDER_CONFLICT'

/** Pre-mutation order markers used by conditional Turso writers. */
export type OrderExpectation = {
  status: Order['status']
  preorderStage?: PreorderStage | null
  paymentStatus?: PaymentStatus | null
}

const RATE_REFRESH_STATUS_SETTING = 'exchangeRateRefreshStatus'

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

/**
 * The image ordering migration is also guarded at hydration time. This keeps
 * a Worker deployment safe when the production Turso token exists only as a
 * Wrangler secret (and therefore cannot be used by the local migration CLI).
 * The check is cheap, and every statement is idempotent after the first
 * isolate has completed it.
 */
async function ensureProductImageOrderSchema(db: SqlClient): Promise<void> {
  const columns = async (): Promise<Set<string>> => {
    const result = await db.execute<Record<string, unknown>>('PRAGMA table_info(product_images)')
    return new Set(result.rows.map((row) => text(row.name)).filter((name): name is string => Boolean(name)))
  }

  let current = await columns()
  const additions: Array<[string, string]> = [
    ['sort_order', 'INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0)'],
    ['thumb_320_key', 'TEXT'],
    ['thumb_640_key', 'TEXT'],
    ['detail_1200_key', 'TEXT'],
  ]
  for (const [column, definition] of additions) {
    if (current.has(column)) continue
    try {
      await db.execute(`ALTER TABLE product_images ADD COLUMN ${column} ${definition}`)
    } catch (error) {
      // Another isolate may have won the race between PRAGMA and ALTER TABLE.
      current = await columns()
      if (!current.has(column)) throw error
    }
    current.add(column)
  }

  if (current.has('sort_order')) {
    const sortOrderResult = await db.execute<Record<string, unknown>>('SELECT COUNT(*) AS count FROM product_images WHERE sort_order = 0')
    const zeroSortOrders = integer(sortOrderResult.rows[0]?.count) ?? 0
    if (zeroSortOrders > 0) {
      await db.execute(`UPDATE product_images
        SET sort_order = (
          SELECT COUNT(*)
          FROM product_images previous
          WHERE previous.product_id = product_images.product_id
            AND (previous.created_at < product_images.created_at
              OR (previous.created_at = product_images.created_at AND previous.id <= product_images.id))
        )`)
    }
  }
  await db.execute('CREATE INDEX IF NOT EXISTS idx_product_images_order ON product_images(product_id, sort_order, created_at)')
}

/**
 * Product measurements were introduced after the first production schema.
 * Keep hydration self-healing when an operator deploys before running the
 * additive migration through the Turso CLI; every addition is nullable or has
 * a safe legacy default and is retried idempotently across isolates.
 */
async function ensureProductMeasurementSchema(db: SqlClient): Promise<void> {
  const result = await db.execute<Record<string, unknown>>('PRAGMA table_info(products)')
  const columns = new Set(result.rows.map((row) => text(row.name)).filter((name): name is string => Boolean(name)))
  const additions: Array<[string, string]> = [
    ['fulfillment_type', "TEXT NOT NULL DEFAULT 'STOCK' CHECK (fulfillment_type IN ('STOCK', 'PREORDER'))"],
    ['measurements_text', 'TEXT'],
    ['inner_diameter_mm', 'REAL'],
    ['circumference_mm', 'REAL'],
    ['us_size', 'TEXT'],
    ['lead_time', 'TEXT'],
  ]
  for (const [column, definition] of additions) {
    if (columns.has(column)) continue
    try {
      await db.execute(`ALTER TABLE products ADD COLUMN ${column} ${definition}`)
    } catch (error) {
      const refreshed = await db.execute<Record<string, unknown>>('PRAGMA table_info(products)')
      const exists = refreshed.rows.some((row) => text(row.name) === column)
      if (!exists) throw error
    }
    columns.add(column)
  }
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
    ...(text(row.thumb_320_key) ? { thumb320Key: text(row.thumb_320_key) } : {}),
    ...(text(row.thumb_640_key) ? { thumb640Key: text(row.thumb_640_key) } : {}),
    ...(text(row.detail_1200_key) ? { detail1200Key: text(row.detail_1200_key) } : {}),
    mimeType,
    byteSize: integer(row.byte_size) ?? 0,
    sortOrder: integer(row.sort_order) ?? 0,
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

const analyticsNameSet = new Set<string>(ANALYTICS_EVENT_NAMES)

function asAnalytics(row: Record<string, unknown>): AnalyticsEvent | undefined {
  const name = typeof row.name === 'string' && analyticsNameSet.has(row.name) ? row.name as AnalyticsEvent['name'] : undefined
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

/** Refresh analytics from Turso so admin reads cannot use another isolate's stale snapshot. */
export async function hydrateAnalyticsFromDatabase(state: CoruState, db: SqlClient, range?: { fromIso: string; toIso: string }): Promise<void> {
  const result = range
    ? await db.execute<Record<string, unknown>>(
      'SELECT name, session_id, source, properties_json, occurred_at FROM analytics_events WHERE occurred_at >= ? AND occurred_at <= ? ORDER BY occurred_at ASC',
      [new Date(Date.parse(range.fromIso) - 24 * 60 * 60 * 1000).toISOString(), range.toIso],
    )
    : await db.execute<Record<string, unknown>>('SELECT name, session_id, source, properties_json, occurred_at FROM analytics_events ORDER BY occurred_at ASC')
  state.analytics = result.rows.map(asAnalytics).filter((event): event is AnalyticsEvent => Boolean(event))
}

/** Earliest idle30-v1 navigation event timestamp; used for sessionsAvailableFrom without a full table scan into memory. */
export async function loadSessionsAvailableFrom(db: SqlClient): Promise<string | null> {
  const result = await db.execute<{ occurred_at?: unknown }>(
    `SELECT occurred_at FROM analytics_events WHERE name IN ('catalog_view', 'product_view', 'size_guide_view', 'privacy_view', 'not_found_view') AND properties_json LIKE '%"sessionModel":"idle30-v1"%' ORDER BY occurred_at ASC LIMIT 1`,
  )
  const occurredAt = result.rows[0]?.occurred_at
  return typeof occurredAt === 'string' && occurredAt ? occurredAt : null
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
      if (row.shipping_method === 'NATIONAL' && (row.national_carrier === 'MRW' || row.national_carrier === 'ZOOM')) order.shipping = { method: 'NATIONAL', carrier: row.national_carrier, ...(text(row.national_state) ? { state: text(row.national_state) } : {}), ...(text(row.national_city) ? { city: text(row.national_city) } : {}), ...(text(row.national_office_text) ? { officeText: text(row.national_office_text) } : {}) }
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

function asPayment(row: Record<string, unknown>): (OrderPayment & { orderId: string }) | undefined {
  const id = text(row.id)
  const orderId = text(row.order_id)
  const kind = row.payment_kind === 'DEPOSIT' || row.payment_kind === 'BALANCE' ? row.payment_kind : undefined
  const paidCurrency = row.paid_currency === 'USD' || row.paid_currency === 'Bs' ? row.paid_currency : undefined
  const usdAmountCents = integer(row.usd_amount_cents)
  const paidAmountMinor = integer(row.paid_amount_minor)
  const recordedAt = text(row.recorded_at)
  if (!id || !orderId || !kind || !paidCurrency || usdAmountCents === undefined || paidAmountMinor === undefined || !recordedAt) return undefined
  return {
    id,
    orderId,
    kind,
    usdAmountCents,
    paidCurrency,
    paidAmountMinor,
    ...(integer(row.rate_micros) ? { rateMicros: integer(row.rate_micros) } : {}),
    recordedAt,
    ...(text(row.note) ? { note: text(row.note) } : {}),
    ...(text(row.idempotency_key) ? { idempotencyKey: text(row.idempotency_key) } : {}),
  }
}

function asAudit(row: Record<string, unknown>): (OrderAuditEntry & { orderId: string }) | undefined {
  const actions = new Set(['CREATED', 'EXPIRED_UNREVIEWED', 'DISCARDED', 'CONFIRMED', 'RECORD_DEPOSIT', 'MARK_READY', 'RECORD_BALANCE', 'MARK_DELIVERED', 'CANCEL_SALE'])
  const id = text(row.id)
  const orderId = text(row.order_id)
  const action = typeof row.action === 'string' && actions.has(row.action) ? row.action as OrderAuditEntry['action'] : undefined
  const createdAt = text(row.created_at)
  if (!id || !orderId || !action || !createdAt) return undefined
  return { id, orderId, action, ...(text(row.actor) ? { actor: text(row.actor) } : {}), ...(text(row.reason) ? { reason: text(row.reason) } : {}), createdAt }
}

const ORDERS_SELECT = `SELECT o.id AS order_id, o.reference, o.status, o.currency, o.idempotency_key, o.rate_micros, o.rate_valid_until, o.subtotal_cents, o.discount_cents, o.total_cents, o.promotion_id, o.promotion_name, o.promotion_groups, o.whatsapp_url, o.created_at, o.expires_at, o.confirmed_at, o.discarded_at, o.cancelled_at, o.discard_reason, o.cancel_reason, o.fulfillment_type_snapshot, o.lead_time_snapshot, o.deposit_usd_cents, o.balance_usd_cents, o.preorder_stage, o.payment_status, o.shipping_method, o.personal_delivery_point_id, o.delivery_address_text, o.delivery_lat, o.delivery_lng, o.delivery_quote_amount_minor, o.delivery_quote_currency, o.delivery_quote_quoted_at, o.delivery_quote_external_id, o.national_carrier, o.national_state, o.national_city, o.national_office_text, oi.id AS item_id, oi.product_id, oi.name_snapshot, oi.size_label_snapshot, oi.material_snapshot, oi.fulfillment_type_snapshot, oi.unit_price_cents, oi.quantity, oi.line_total_cents FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id`

/** Attach payment/audit rows when the fulfillment tables exist (tolerate older DBs). */
async function attachPaymentsAndAudits(db: SqlClient, orders: Order[]): Promise<void> {
  if (!orders.length) return
  const byId = new Map(orders.map((order) => [order.id, order]))
  try {
    const result = await db.execute<Record<string, unknown>>('SELECT id, order_id, payment_kind, usd_amount_cents, paid_currency, paid_amount_minor, rate_micros, recorded_at, note, idempotency_key FROM order_payments ORDER BY recorded_at ASC')
    for (const row of result.rows) {
      const payment = asPayment(row)
      if (!payment) continue
      const order = byId.get(payment.orderId)
      if (!order) continue
      const { orderId: _orderId, ...entry } = payment
      order.payments ??= []
      order.payments.push(entry)
    }
  } catch {
    // order_payments arrives with the fulfillment migration.
  }
  try {
    const result = await db.execute<Record<string, unknown>>('SELECT id, order_id, action, actor, reason, created_at FROM order_audits ORDER BY created_at ASC')
    for (const row of result.rows) {
      const audit = asAudit(row)
      if (!audit) continue
      const order = byId.get(audit.orderId)
      if (!order) continue
      const { orderId: _orderId, ...entry } = audit
      order.audit ??= []
      order.audit.push(entry)
    }
  } catch {
    // order_audits arrives with the fulfillment migration.
  }
}

/** Refresh orders, movements and product stock from Turso without reloading analytics. */
export async function hydrateOrdersFromDatabase(state: CoruState, db: SqlClient): Promise<void> {
  const ordersResult = await db.execute<JoinedOrderRow>(`${ORDERS_SELECT} ORDER BY o.created_at ASC`)
  const hydratedOrders = hydrateOrders(ordersResult.rows)
  await attachPaymentsAndAudits(db, hydratedOrders.orders)
  state.orders = hydratedOrders.orders
  state.idempotency = hydratedOrders.idempotency
  state.actionIdempotency.clear()

  const movementsResult = await db.execute<Record<string, unknown>>('SELECT id, product_id, order_id, movement_type, delta, reverses_movement_id, note, created_at FROM inventory_movements ORDER BY created_at ASC')
  state.movements = movementsResult.rows.map(asMovement).filter((entry): entry is InventoryMovement => Boolean(entry))

  const stockResult = await db.execute<Record<string, unknown>>('SELECT id, stock_quantity FROM products')
  const stockById = new Map(stockResult.rows.map((row) => [text(row.id), integer(row.stock_quantity)] as const).filter((entry): entry is readonly [string, number] => Boolean(entry[0]) && entry[1] !== undefined))
  for (const product of state.products) {
    const stock = stockById.get(product.id)
    if (stock !== undefined) product.stockQuantity = stock
  }
}

export function captureOrderExpectation(order: Order): OrderExpectation {
  return {
    status: order.status,
    ...(order.preorderStage !== undefined ? { preorderStage: order.preorderStage } : { preorderStage: null }),
    ...(order.paymentStatus !== undefined ? { paymentStatus: order.paymentStatus } : { paymentStatus: null }),
  }
}

function transitionGuard(order: Order, expected: OrderExpectation): { sql: string; args: SqlValue[] } {
  if (order.status === 'DISCARDED' && order.discardedAt && expected.status === 'PENDING') {
    return { sql: 'status = ? AND discarded_at = ?', args: ['DISCARDED', order.discardedAt] }
  }
  if (order.status === 'CANCELLED' && order.cancelledAt) {
    return { sql: 'status = ? AND cancelled_at = ?', args: ['CANCELLED', order.cancelledAt] }
  }
  if (order.status === 'CONFIRMED' && order.confirmedAt && expected.status === 'PENDING') {
    return { sql: 'status = ? AND confirmed_at = ?', args: ['CONFIRMED', order.confirmedAt] }
  }
  const parts = ['status = ?']
  const args: SqlValue[] = [order.status]
  if (order.preorderStage) { parts.push('preorder_stage = ?'); args.push(order.preorderStage) }
  if (order.paymentStatus) { parts.push('payment_status = ?'); args.push(order.paymentStatus) }
  if (order.status === 'PENDING' && expected.status === 'PENDING' && order.rateValidUntil) {
    parts.push('rate_valid_until = ?')
    args.push(order.rateValidUntil)
  }
  return { sql: parts.join(' AND '), args }
}

function reflectsTransition(persisted: Order, intended: Order): boolean {
  if (persisted.status !== intended.status) return false
  if (intended.discardedAt && persisted.discardedAt !== intended.discardedAt) return false
  if (intended.cancelledAt && persisted.cancelledAt !== intended.cancelledAt) return false
  if (intended.status === 'CONFIRMED' && intended.confirmedAt && persisted.confirmedAt !== intended.confirmedAt) return false
  if (intended.preorderStage && persisted.preorderStage !== intended.preorderStage) return false
  if (intended.paymentStatus && persisted.paymentStatus !== intended.paymentStatus) return false
  if (intended.status === 'PENDING' && intended.rateValidUntil && persisted.rateValidUntil !== intended.rateValidUntil) return false
  return true
}

/**
 * Conditionally persist an in-memory order transition. Stock changes use deltas
 * guarded by the transition marker so a stale isolate cannot clobber another.
 */
export async function persistOrderTransition(db: SqlClient, order: Order, expected: OrderExpectation, movements: InventoryMovement[] = []): Promise<{ applied: boolean; order?: Order }> {
  const guard = transitionGuard(order, expected)
  const updatedAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    let updateSql = 'UPDATE orders SET status = ?, confirmed_at = ?, discarded_at = ?, cancelled_at = ?, discard_reason = ?, cancel_reason = ?, rate_micros = ?, rate_valid_until = ?, whatsapp_url = ?, preorder_stage = ?, payment_status = ? WHERE id = ? AND status = ?'
    const updateArgs: SqlValue[] = [order.status, order.confirmedAt ?? null, order.discardedAt ?? null, order.cancelledAt ?? null, order.discardReason ?? null, order.cancelReason ?? null, order.rateMicros ?? null, order.rateValidUntil ?? null, order.whatsappUrl, order.preorderStage ?? null, order.paymentStatus ?? null, order.id, expected.status]
    if (expected.preorderStage === null) updateSql += ' AND preorder_stage IS NULL'
    else if (expected.preorderStage !== undefined) { updateSql += ' AND preorder_stage = ?'; updateArgs.push(expected.preorderStage) }
    if (expected.paymentStatus === null) updateSql += ' AND payment_status IS NULL'
    else if (expected.paymentStatus !== undefined) { updateSql += ' AND payment_status = ?'; updateArgs.push(expected.paymentStatus) }
    await tx.execute(updateSql, updateArgs)

    for (const movement of movements) {
      await tx.execute(`UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND ${guard.sql})`, [movement.delta, updatedAt, movement.productId, order.id, ...guard.args])
      await tx.execute(`INSERT INTO inventory_movements (id, product_id, order_id, movement_type, delta, reverses_movement_id, note, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND ${guard.sql})`, [movement.id, movement.productId, movement.orderId ?? null, movement.type, movement.delta, movement.reversesMovementId ?? null, movement.note ?? null, movement.createdAt, order.id, ...guard.args])
    }

    for (const payment of order.payments ?? []) {
      await tx.execute(`INSERT OR IGNORE INTO order_payments (id, order_id, payment_kind, usd_amount_cents, paid_currency, paid_amount_minor, rate_micros, recorded_at, note, idempotency_key) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND ${guard.sql})`, [payment.id, order.id, payment.kind, payment.usdAmountCents, payment.paidCurrency, payment.paidAmountMinor, payment.rateMicros ?? null, payment.recordedAt, payment.note ?? null, payment.idempotencyKey ?? null, order.id, ...guard.args])
    }
    for (const audit of order.audit ?? []) {
      await tx.execute(`INSERT OR IGNORE INTO order_audits (id, order_id, action, actor, reason, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND ${guard.sql})`, [audit.id, order.id, audit.action, audit.actor ?? null, audit.reason ?? null, audit.createdAt, order.id, ...guard.args])
    }
  })

  const persisted = await findPersistedOrder(db, order.id)
  if (!persisted || !reflectsTransition(persisted, order)) return { applied: false }
  return { applied: true, order: persisted }
}

/** Refresh the catalog portion of an isolate from Turso's durable rows. */
export async function hydrateCatalogFromDatabase(state: CoruState, db: SqlClient): Promise<void> {
  const categoriesResult = await db.execute<Record<string, unknown>>('SELECT id, slug, name, sort_order, is_active FROM categories ORDER BY sort_order, name')
  state.categories = categoriesResult.rows.map(asCategory).filter((entry): entry is Category => Boolean(entry))

  const catalog = new CatalogRepository(db)
  state.products = await catalog.listAll()

  const imagesResult = await db.execute<Record<string, unknown>>('SELECT id, product_id, original_key, processed_key, thumb_320_key, thumb_640_key, detail_1200_key, mime_type, byte_size, sort_order, processing_status, is_approved, error_code, created_at, updated_at FROM product_images ORDER BY product_id ASC, sort_order ASC, created_at ASC')
  state.images = new Map(imagesResult.rows.map(asImage).filter((entry): entry is ProductImageRecord => Boolean(entry)).map((image) => [image.id, image]))

  const promotionsResult = await db.execute<Record<string, unknown>>('SELECT p.id, p.name, p.kind, c.name AS target_category, p.bundle_quantity, p.bundle_price_cents, p.fixed_discount_cents, p.is_active, p.starts_at, p.ends_at FROM promotions p LEFT JOIN categories c ON c.id = p.target_category_id ORDER BY p.created_at DESC')
  state.promotions = promotionsResult.rows.map(asPromotion).filter((entry): entry is Promotion => Boolean(entry))

  const settingsResult = await db.execute<Record<string, unknown>>('SELECT key, value_json FROM store_settings')
  state.settings = parseSettings(settingsResult.rows, state.settings)
}

/** Hydrate all state that has a stable representation in the v1 migration. */
export async function hydrateStateFromDatabase(state: CoruState, db: SqlClient): Promise<void> {
  await hydrateCatalogFromDatabase(state, db)

  try {
    const pointsResult = await db.execute<Record<string, unknown>>('SELECT id, name, address, short_description, latitude, longitude, schedule_text, is_active, sort_order FROM personal_delivery_points ORDER BY sort_order, name')
    const points = pointsResult.rows.map((row) => ({ id: text(row.id) ?? '', name: text(row.name) ?? '', address: text(row.address) ?? '', ...(text(row.short_description) ? { shortDescription: text(row.short_description) } : {}), ...(typeof row.latitude === 'number' ? { latitude: row.latitude } : {}), ...(typeof row.longitude === 'number' ? { longitude: row.longitude } : {}), ...(text(row.schedule_text) ? { scheduleText: text(row.schedule_text) } : {}), active: bool(row.is_active), sortOrder: integer(row.sort_order) ?? 0 })).filter((point) => point.id && point.name && point.address)

    // The first production bootstrap had one placeholder point without a
    // location. Upgrade that row and add the two newly agreed points once;
    // existing operator edits remain untouched after their ids exist.
    const byId = new Map(points.map((point) => [point.id, point]))
    for (const defaultPoint of defaultPersonalDeliveryPoints) {
      const current = byId.get(defaultPoint.id)
      const isLegacyPlaceholder = defaultPoint.id === 'coru-punto-central' && current?.address === 'Punto coordinado por CORU'
      if (!current || isLegacyPlaceholder) {
        await persistDeliveryPoint(db, defaultPoint)
        byId.set(defaultPoint.id, { ...defaultPoint })
      }
    }
    const hydratedPoints = [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    if (hydratedPoints.length) state.deliveryPoints = hydratedPoints
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

  await hydrateRateRefreshStatus(state, db)

  const ordersResult = await db.execute<JoinedOrderRow>(`${ORDERS_SELECT} ORDER BY o.created_at ASC`)
  const hydratedOrders = hydrateOrders(ordersResult.rows)
  await attachPaymentsAndAudits(db, hydratedOrders.orders)
  state.orders = hydratedOrders.orders
  state.idempotency = hydratedOrders.idempotency
  state.actionIdempotency.clear()

  const movementsResult = await db.execute<Record<string, unknown>>('SELECT id, product_id, order_id, movement_type, delta, reverses_movement_id, note, created_at FROM inventory_movements ORDER BY created_at ASC')
  state.movements = movementsResult.rows.map(asMovement).filter((entry): entry is InventoryMovement => Boolean(entry))
}

/** Hydrate at most once per state object and Turso binding pair. */
export async function ensureStateHydrated(state: CoruState, env: CoruBindings): Promise<SqlClient | null> {
  const db = databaseFromEnv(env)
  const key = bindingKey(env)
  if (!db || !key) return null
  const cached = hydrationCache.get(state)
  if (!cached || cached.key !== key) {
    const promise = (async () => {
      await ensureProductMeasurementSchema(db)
      await ensureProductImageOrderSchema(db)
      await hydrateStateFromDatabase(state, db)
    })()
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

export async function deleteCategory(db: SqlClient, categoryId: string): Promise<void> {
  await db.execute('DELETE FROM categories WHERE id = ?', [categoryId])
}

export async function persistDeliveryPoint(db: SqlClient, point: PersonalDeliveryPoint, updatedAt = new Date().toISOString()): Promise<void> {
  await db.execute('INSERT INTO personal_delivery_points (id, name, address, short_description, latitude, longitude, schedule_text, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, address = excluded.address, short_description = excluded.short_description, latitude = excluded.latitude, longitude = excluded.longitude, schedule_text = excluded.schedule_text, is_active = excluded.is_active, sort_order = excluded.sort_order, updated_at = excluded.updated_at', [point.id, point.name, point.address, point.shortDescription ?? null, point.latitude ?? null, point.longitude ?? null, point.scheduleText ?? null, point.active ? 1 : 0, point.sortOrder, updatedAt, updatedAt])
}

export async function persistProduct(db: SqlClient, state: CoruState, product: Product, updatedAt = new Date().toISOString()): Promise<void> {
  const category = state.categories.find((candidate) => candidate.name === product.category)
  if (!category) return
  const image = orderProductImages([...state.images.values()].filter((candidate) => candidate.productId === product.id && candidate.approvedVariant))[0]
  await db.execute('INSERT INTO products (id, category_id, sku, slug, name, description, material, artwork, size_label, price_cents, stock_quantity, fulfillment_type, measurements_text, inner_diameter_mm, circumference_mm, us_size, lead_time, is_active, promo_eligible, primary_image_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, slug = excluded.slug, name = excluded.name, description = excluded.description, material = excluded.material, artwork = excluded.artwork, size_label = excluded.size_label, price_cents = excluded.price_cents, stock_quantity = excluded.stock_quantity, fulfillment_type = excluded.fulfillment_type, measurements_text = excluded.measurements_text, inner_diameter_mm = excluded.inner_diameter_mm, circumference_mm = excluded.circumference_mm, us_size = excluded.us_size, lead_time = excluded.lead_time, is_active = excluded.is_active, promo_eligible = excluded.promo_eligible, primary_image_id = excluded.primary_image_id, updated_at = excluded.updated_at', [product.id, category.id, product.id, product.slug, product.name, product.description, product.material, product.artwork, product.sizeLabel, product.priceCents, product.stockQuantity, product.fulfillmentType ?? 'STOCK', product.measurementsText ?? null, product.innerDiameterMm ?? null, product.circumferenceMm ?? null, product.usSize ?? null, product.leadTime ?? null, product.active ? 1 : 0, product.promoEligible ? 1 : 0, image?.id ?? null, updatedAt, updatedAt])
}

export async function deletePersistedProduct(db: SqlClient, productId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Product snapshots in orders remain intact; only live catalog junctions
    // and image records are removed with the product itself.
    await tx.execute('DELETE FROM promotion_products WHERE product_id = ?', [productId])
    await tx.execute('DELETE FROM product_images WHERE product_id = ?', [productId])
    await tx.execute('DELETE FROM products WHERE id = ?', [productId])
  })
}

/** Persist a product edit and its inventory movement atomically. Stock uses a delta when a movement is present. */
export async function persistProductAndMovement(db: SqlClient, state: CoruState, product: Product, movement: InventoryMovement, updatedAt = new Date().toISOString()): Promise<void> {
  const category = state.categories.find((candidate) => candidate.name === product.category)
  if (!category) return
  const image = orderProductImages([...state.images.values()].filter((candidate) => candidate.productId === product.id && candidate.approvedVariant))[0]
  await db.transaction(async (tx) => {
    await tx.execute('INSERT INTO products (id, category_id, sku, slug, name, description, material, artwork, size_label, price_cents, stock_quantity, fulfillment_type, measurements_text, inner_diameter_mm, circumference_mm, us_size, lead_time, is_active, promo_eligible, primary_image_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, slug = excluded.slug, name = excluded.name, description = excluded.description, material = excluded.material, artwork = excluded.artwork, size_label = excluded.size_label, price_cents = excluded.price_cents, fulfillment_type = excluded.fulfillment_type, measurements_text = excluded.measurements_text, inner_diameter_mm = excluded.inner_diameter_mm, circumference_mm = excluded.circumference_mm, us_size = excluded.us_size, lead_time = excluded.lead_time, is_active = excluded.is_active, promo_eligible = excluded.promo_eligible, primary_image_id = excluded.primary_image_id, updated_at = excluded.updated_at', [product.id, category.id, product.id, product.slug, product.name, product.description, product.material, product.artwork, product.sizeLabel, product.priceCents, product.stockQuantity, product.fulfillmentType ?? 'STOCK', product.measurementsText ?? null, product.innerDiameterMm ?? null, product.circumferenceMm ?? null, product.usSize ?? null, product.leadTime ?? null, product.active ? 1 : 0, product.promoEligible ? 1 : 0, image?.id ?? null, updatedAt, updatedAt])
    await tx.execute('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?', [movement.delta, updatedAt, product.id])
    await tx.execute('INSERT INTO inventory_movements (id, product_id, order_id, movement_type, delta, reverses_movement_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [movement.id, product.id, movement.orderId ?? null, movement.type, movement.delta, movement.reversesMovementId ?? null, movement.note ?? null, movement.createdAt])
  })
}

export async function persistPromotion(db: SqlClient, state: CoruState, promotion: Promotion, updatedAt = new Date().toISOString()): Promise<void> {
  const targetCategoryId = promotion.targetCategory ? state.categories.find((category) => category.name === promotion.targetCategory)?.id : undefined
  await db.execute('INSERT INTO promotions (id, name, kind, target_category_id, bundle_quantity, bundle_price_cents, fixed_discount_cents, is_active, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, target_category_id = excluded.target_category_id, bundle_quantity = excluded.bundle_quantity, bundle_price_cents = excluded.bundle_price_cents, fixed_discount_cents = excluded.fixed_discount_cents, is_active = excluded.is_active, starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = excluded.updated_at', [promotion.id, promotion.name, promotion.kind, targetCategoryId ?? null, promotion.bundleQuantity ?? null, promotion.bundlePriceCents ?? null, promotion.fixedDiscountCents ?? null, promotion.active ? 1 : 0, promotion.startsAt ?? null, promotion.endsAt ?? null, updatedAt, updatedAt])
}

export async function deletePersistedPromotion(db: SqlClient, promotionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Keep the explicit junction cleanup even though the schema has a
    // cascading foreign key; it also protects databases created before that
    // constraint was applied.
    await tx.execute('DELETE FROM promotion_products WHERE promotion_id = ?', [promotionId])
    await tx.execute('DELETE FROM promotions WHERE id = ?', [promotionId])
  })
}

export async function persistImage(db: SqlClient, image: ProductImageRecord): Promise<void> {
  await db.execute('INSERT INTO product_images (id, product_id, original_key, processed_key, thumb_320_key, thumb_640_key, detail_1200_key, mime_type, byte_size, sort_order, processing_status, is_approved, error_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET processed_key = excluded.processed_key, thumb_320_key = excluded.thumb_320_key, thumb_640_key = excluded.thumb_640_key, detail_1200_key = excluded.detail_1200_key, sort_order = excluded.sort_order, processing_status = excluded.processing_status, is_approved = excluded.is_approved, error_code = excluded.error_code, updated_at = excluded.updated_at', [image.id, image.productId, image.originalKey, image.processedKey ?? null, image.thumb320Key ?? null, image.thumb640Key ?? null, image.detail1200Key ?? null, image.mimeType, image.byteSize, image.sortOrder, image.processingStatus, image.approvedVariant ? 1 : 0, image.errorCode ?? null, image.createdAt, image.updatedAt])
}

export async function persistRate(db: SqlClient, state: CoruState, observedAt = state.rateUpdatedAt): Promise<void> {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `rate-${Date.now()}`
  await db.execute('INSERT INTO exchange_rates (id, rate_micros, mode, observed_at, valid_until) VALUES (?, ?, ?, ?, ?)', [id, state.currentRateMicros, state.rateMode, observedAt, state.rateValidUntil])
}

/** Load the latest automatic-provider diagnostic from the existing settings KV table. */
export async function hydrateRateRefreshStatus(state: CoruState, db: SqlClient): Promise<void> {
  const result = await db.execute<Record<string, unknown>>('SELECT value_json FROM store_settings WHERE key = ?', [RATE_REFRESH_STATUS_SETTING])
  const encoded = text(result.rows[0]?.value_json)
  if (!encoded) return
  try {
    const value: unknown = JSON.parse(encoded)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const record = value as Record<string, unknown>
    state.rateRefreshAttemptedAt = persistedTimestamp(record.attemptedAt) ?? null
    state.rateRefreshError = typeof record.error === 'string' && record.error.trim() ? record.error.slice(0, 300) : null
  } catch {
    // Keep rate status optional: a malformed diagnostic must not block checkout.
  }
}

/** Persist provider diagnostics separately from rate observations and operator settings. */
export async function persistRateRefreshStatus(db: SqlClient, state: CoruState, updatedAt = new Date().toISOString()): Promise<void> {
  const value = JSON.stringify({ attemptedAt: state.rateRefreshAttemptedAt, error: state.rateRefreshError })
  await db.execute('INSERT INTO store_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at', [RATE_REFRESH_STATUS_SETTING, value, updatedAt])
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
  const result = await db.execute<JoinedOrderRow>(`${ORDERS_SELECT} WHERE o.id = ? OR o.idempotency_key = ? ORDER BY o.created_at ASC`, [idOrIdempotency, idOrIdempotency])
  const orders = hydrateOrders(result.rows).orders
  await attachPaymentsAndAudits(db, orders)
  return orders[0]
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
    if (movement) {
      await tx.execute('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?', [movement.delta, new Date().toISOString(), product.id])
      await tx.execute('INSERT INTO inventory_movements (id, product_id, order_id, movement_type, delta, reverses_movement_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `movement-${Date.now()}`, product.id, (movement as InventoryMovement).orderId ?? null, movement.type, movement.delta, (movement as InventoryMovement).reversesMovementId ?? null, movement.note ?? null, movement.createdAt ?? new Date().toISOString()])
    } else {
      await tx.execute('UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?', [product.stockQuantity, new Date().toISOString(), product.id])
    }
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

export async function purgePersistedAnalyticsBefore(db: SqlClient, cutoff: string): Promise<number> {
  const result = await db.execute('DELETE FROM analytics_events WHERE occurred_at < ?', [cutoff])
  return result.rowsAffected
}

export async function clearPersistedCartAddAnalytics(state: CoruState, db: SqlClient): Promise<number> {
  const result = await db.execute('DELETE FROM analytics_events WHERE name = ?', ['cart_add'])
  state.analytics = state.analytics.filter((event) => event.name !== 'cart_add')
  return result.rowsAffected
}

export function schedulePersistence(c: { executionCtx?: { waitUntil(promise: Promise<unknown>): void } }, work: Promise<unknown>): void {
  const safe = work.catch(() => undefined)
  if (c.executionCtx) c.executionCtx.waitUntil(safe)
  else void safe
}
