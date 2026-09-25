import { describe, expect, it } from 'vitest'
import type { SqlClient, SqlResult, SqlValue } from '../src/db/client'
import { clearPersistedCartAddAnalytics, confirmPersistedOrder, findActivePromotion, findPersistedOrder, hydrateAnalyticsFromDatabase, hydrateCatalogFromDatabase, hydrateOrdersFromDatabase, hydrateStateFromDatabase, loadSessionsAvailableFrom, persistOrderTransition, persistPendingOrder, persistProductAndMovement, purgePersistedAnalyticsBefore } from '../src/worker/persistence'
import { resetState, state } from '../src/worker/state'
import type { Order } from '../src/shared/types'
import type { InventoryMovement } from '../src/worker/state'

function fakeDatabase(rateRow: Record<string, unknown> = { rate_micros: 41000000, mode: 'MANUAL', observed_at: '2026-09-15T10:00:00.000Z', valid_until: '2026-09-15T23:59:59.000Z' }) {
  const calls: Array<{ sql: string; args: SqlValue[] }> = []
  const result = <Row extends Record<string, unknown>>(rows: Record<string, unknown>[], rowsAffected = 0): SqlResult<Row> => ({ rows: rows as unknown as Row[], rowsAffected })
  const db: SqlClient = {
    execute: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
      calls.push({ sql, args })
      if (sql.startsWith('SELECT id, slug, name')) return result<Row>([{ id: 'cat-db', slug: 'anillos', name: 'Anillos', sort_order: 1, is_active: 1 }])
      if (sql.startsWith('SELECT p.id, p.name')) return result<Row>([{ id: 'promo-db', name: 'Combo DB', kind: 'BUNDLE', target_category: 'Anillos', bundle_quantity: 3, bundle_price_cents: 1000, is_active: 1 }])
      if (sql.includes('category_name')) return result<Row>([{ id: 'db-ring', slug: 'db-ring', name: 'DB Ring', category_name: 'Anillos', size_label: 'Talla única', price_cents: 700, stock_quantity: 4, is_active: 1, promo_eligible: 1, image_approved: 1, artwork: 'orbita', description: 'Persistido', material: 'Acero' }])
      if (sql.startsWith('SELECT key')) return result<Row>([{ key: 'storeName', value_json: '"DB CORU"' }])
      if (sql.startsWith('SELECT rate_micros')) return result<Row>([rateRow])
      if (sql.startsWith('SELECT o.id')) return result<Row>([])
      return { rows: [], rowsAffected: 1 } as { rows: Row[]; rowsAffected: number }
    },
    transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
  }
  return { db, calls }
}

describe('Turso persistence bridge', () => {
  it('finds the active promotion from durable rows for public reads', async () => {
    const { db } = fakeDatabase()
    const promotion = await findActivePromotion(db, new Date('2026-09-18T12:00:00.000Z'))
    expect(promotion).toMatchObject({ id: 'promo-db', name: 'Combo DB', active: true, bundleQuantity: 3, bundlePriceCents: 1000 })
  })

  it('hydrates catalog, promotion, settings and rate state from SQL rows', async () => {
    resetState()
    const { db } = fakeDatabase()
    await hydrateStateFromDatabase(state, db)
    expect(state.categories).toEqual([{ id: 'cat-db', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true }])
    expect(state.products[0]).toMatchObject({ id: 'db-ring', stockQuantity: 4, primaryImageApproved: true })
    expect(state.promotions[0]).toMatchObject({ id: 'promo-db', bundleQuantity: 3 })
    expect(state.settings.storeName).toBe('DB CORU')
    expect(state.currentRateMicros).toBe(41_000_000)
  })

  it('refreshes the catalog from durable rows after an isolate already has stale state', async () => {
    resetState()
    state.categories = [{ id: 'stale-category', slug: 'stale', name: 'Stale', sortOrder: 1, active: true }]
    state.products = []
    const { db } = fakeDatabase()

    await hydrateCatalogFromDatabase(state, db)

    expect(state.categories).toEqual([{ id: 'cat-db', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true }])
    expect(state.products[0]).toMatchObject({ id: 'db-ring', category: 'Anillos', stockQuantity: 4 })
  })

  it('ignores epoch placeholder rate metadata so the default rate remains usable', async () => {
    resetState()
    const { db } = fakeDatabase({ rate_micros: 41000000, mode: 'AUTOMATIC', observed_at: '1970-01-01T00:00:00.000Z', valid_until: '1970-01-01T00:00:00.000Z' })
    await hydrateStateFromDatabase(state, db)
    expect(state.currentRateMicros).toBe(36_420_000)
    expect(Date.parse(state.rateValidUntil)).toBeGreaterThan(0)
  })

  it('writes a pending order and preserves its idempotency key', async () => {
    const { db, calls } = fakeDatabase()
    const order: Order = {
      id: 'order-db', reference: 'CORU-000001', createdAt: '2026-09-15T10:00:00.000Z', status: 'PENDING', currency: 'USD',
      items: [{ productId: 'db-ring', quantity: 1, name: 'DB Ring', sizeLabel: 'Talla única', unitPriceCents: 700, lineTotalCents: 700 }],
      quote: { subtotalCents: 700, discountCents: 0, totalCents: 700 }, whatsappUrl: 'https://wa.me/1',
    }
    await persistPendingOrder(db, order, 'client-idempotency-key')
    expect(calls.some((call) => call.sql.includes('INSERT INTO orders') && call.args.includes('client-idempotency-key'))).toBe(true)
    expect(calls.some((call) => call.sql.includes('INSERT INTO order_items'))).toBe(true)
  })

  it('confirms persisted orders with an atomic inventory transaction marker', async () => {
    const calls: Array<{ sql: string; args: SqlValue[] }> = []
    let confirmedAt = ''
    const db: SqlClient = {
      execute: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
        calls.push({ sql, args })
        if (sql.startsWith('UPDATE orders')) {
          confirmedAt = String(args[0])
          return { rows: [], rowsAffected: 1 } as SqlResult<Row>
        }
        if (sql.startsWith('SELECT o.id AS order_id')) {
          return {
            rows: [{ order_id: 'order-atomic', reference: 'CORU-000001', status: confirmedAt ? 'CONFIRMED' : 'PENDING', currency: 'USD', idempotency_key: 'atomic-key', subtotal_cents: 400, discount_cents: 0, total_cents: 400, whatsapp_url: 'https://wa.me/1', created_at: '2026-09-16T10:00:00.000Z', confirmed_at: confirmedAt, item_id: 'item-1', product_id: 'orbita-oscura', name_snapshot: 'Órbita oscura', size_label_snapshot: 'Talla única', unit_price_cents: 400, quantity: 1, line_total_cents: 400 }], rowsAffected: 0,
          } as unknown as SqlResult<Row>
        }
        return { rows: [], rowsAffected: 1 } as SqlResult<Row>
      },
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
    }

    const order = await confirmPersistedOrder(db, 'order-atomic', new Date('2026-09-16T10:00:00.000Z'))
    expect(order.status).toBe('CONFIRMED')
    expect(calls.filter((call) => call.sql.startsWith('UPDATE orders')).length).toBe(1)
    expect(calls.some((call) => call.sql.startsWith('UPDATE products') && call.sql.includes("o.confirmed_at = ?"))).toBe(true)
    expect(calls.some((call) => call.sql.startsWith('INSERT INTO inventory_movements') && call.sql.includes('order_id'))).toBe(true)
  })

  it('deletes only analytics events before the requested cutoff', async () => {
    const calls: Array<{ sql: string; args: SqlValue[] }> = []
    const db: SqlClient = {
      execute: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
        calls.push({ sql, args })
        return { rows: [], rowsAffected: 4 } as SqlResult<Row>
      },
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
    }

    await expect(purgePersistedAnalyticsBefore(db, '2026-09-20T04:00:00.000Z')).resolves.toBe(4)
    expect(calls).toEqual([{ sql: 'DELETE FROM analytics_events WHERE occurred_at < ?', args: ['2026-09-20T04:00:00.000Z'] }])
  })

  it('clears only cart-add analytics from Turso and the current isolate', async () => {
    resetState()
    state.analytics = [
      { name: 'catalog_view', sessionId: 'keep-view', source: 'direct', occurredAt: '2026-09-22T12:00:00.000Z' },
      { name: 'cart_add', sessionId: 'remove-cart-add', source: 'direct', occurredAt: '2026-09-22T12:01:00.000Z', properties: { productId: 'test-ring', quantityDelta: 2 } },
      { name: 'order_intent', sessionId: 'keep-order-intent', source: 'direct', occurredAt: '2026-09-22T12:02:00.000Z' },
    ]
    const calls: Array<{ sql: string; args: SqlValue[] }> = []
    const db: SqlClient = {
      execute: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
        calls.push({ sql, args })
        return { rows: [], rowsAffected: 7 } as SqlResult<Row>
      },
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
    }

    await expect(clearPersistedCartAddAnalytics(state, db)).resolves.toBe(7)
    expect(calls).toEqual([{ sql: 'DELETE FROM analytics_events WHERE name = ?', args: ['cart_add'] }])
    expect(state.analytics.map((event) => event.name)).toEqual(['catalog_view', 'order_intent'])
  })

  it('refreshes analytics from Turso instead of retaining a stale isolate snapshot', async () => {
    resetState()
    state.analytics = [{ name: 'cart_add', sessionId: 'stale', source: 'direct', occurredAt: '2026-09-22T12:00:00.000Z' }]
    const db: SqlClient = {
      execute: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
        expect(sql).toBe('SELECT name, session_id, source, properties_json, occurred_at FROM analytics_events ORDER BY occurred_at ASC')
        expect(args).toEqual([])
        return { rows: [{ name: 'catalog_view', session_id: 'fresh', source: 'direct', properties_json: null, occurred_at: '2026-09-22T12:01:00.000Z' }], rowsAffected: 0 } as unknown as SqlResult<Row>
      },
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
    }

    await hydrateAnalyticsFromDatabase(state, db)
    expect(state.analytics).toEqual([{ name: 'catalog_view', sessionId: 'fresh', source: 'direct', occurredAt: '2026-09-22T12:01:00.000Z' }])
  })

  it('loads analytics for a date range with a one-day lookback and reports sessionsAvailableFrom', async () => {
    resetState()
    const calls: Array<{ sql: string; args: SqlValue[] }> = []
    const db: SqlClient = {
      execute: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
        calls.push({ sql, args })
        if (sql.includes('WHERE occurred_at >= ?')) {
          return { rows: [{ name: 'catalog_view', session_id: 'ranged', source: 'direct', properties_json: '{"sessionModel":"idle30-v1"}', occurred_at: '2026-09-21T12:00:00.000Z' }], rowsAffected: 0 } as unknown as SqlResult<Row>
        }
        return { rows: [{ occurred_at: '2026-09-19T08:00:00.000Z' }], rowsAffected: 0 } as unknown as SqlResult<Row>
      },
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
    }

    await hydrateAnalyticsFromDatabase(state, db, { fromIso: '2026-09-22T04:00:00.000Z', toIso: '2026-09-22T23:59:59.999Z' })
    expect(calls[0]?.sql).toContain('WHERE occurred_at >= ? AND occurred_at <= ?')
    expect(calls[0]?.args[0]).toBe('2026-09-21T04:00:00.000Z')
    expect(calls[0]?.args[1]).toBe('2026-09-22T23:59:59.999Z')
    expect(state.analytics).toHaveLength(1)

    await expect(loadSessionsAvailableFrom(db)).resolves.toBe('2026-09-19T08:00:00.000Z')
  })

  it('hydrates privacy and not-found page views persisted by the expanded analytics schema', async () => {
    resetState()
    const db: SqlClient = {
      execute: async <Row extends Record<string, unknown> = Record<string, unknown>>() => ({
        rows: [
          { name: 'privacy_view', session_id: 'privacy-session', source: 'direct', properties_json: null, occurred_at: '2026-09-22T12:01:00.000Z' },
          { name: 'not_found_view', session_id: 'not-found-session', source: 'direct', properties_json: null, occurred_at: '2026-09-22T12:02:00.000Z' },
        ],
        rowsAffected: 0,
      } as unknown as SqlResult<Row>),
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
    }

    await hydrateAnalyticsFromDatabase(state, db)

    expect(state.analytics.map((event) => event.name)).toEqual(['privacy_view', 'not_found_view'])
  })

  it('hydrates order payments and audits alongside the order row', async () => {
    resetState()
    const db: SqlClient = {
      execute: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string) => {
        if (sql.includes('FROM orders o')) {
          return {
            rows: [{
              order_id: 'order-pay', reference: 'CORU-000010', status: 'CONFIRMED', currency: 'USD', idempotency_key: 'pay-key',
              subtotal_cents: 800, discount_cents: 0, total_cents: 800, whatsapp_url: 'https://wa.me/1', created_at: '2026-09-22T10:00:00.000Z',
              confirmed_at: '2026-09-22T10:05:00.000Z', fulfillment_type_snapshot: 'PREORDER', preorder_stage: 'IN_PROCESS', payment_status: 'DEPOSIT_PAID',
              item_id: 'item-1', product_id: 'ring-1', name_snapshot: 'Ring', size_label_snapshot: '7', unit_price_cents: 800, quantity: 1, line_total_cents: 800,
            }],
            rowsAffected: 0,
          } as unknown as SqlResult<Row>
        }
        if (sql.includes('FROM order_payments')) {
          return {
            rows: [{ id: 'pay-1', order_id: 'order-pay', payment_kind: 'DEPOSIT', usd_amount_cents: 400, paid_currency: 'USD', paid_amount_minor: 400, recorded_at: '2026-09-22T10:05:00.000Z' }],
            rowsAffected: 0,
          } as unknown as SqlResult<Row>
        }
        if (sql.includes('FROM order_audits')) {
          return {
            rows: [{ id: 'audit-1', order_id: 'order-pay', action: 'RECORD_DEPOSIT', actor: 'admin', created_at: '2026-09-22T10:05:00.000Z' }],
            rowsAffected: 0,
          } as unknown as SqlResult<Row>
        }
        if (sql.includes('FROM inventory_movements') || sql.startsWith('SELECT id, stock_quantity')) return { rows: [], rowsAffected: 0 } as SqlResult<Row>
        return { rows: [], rowsAffected: 0 } as SqlResult<Row>
      },
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
    }

    await hydrateOrdersFromDatabase(state, db)
    expect(state.orders[0]?.payments).toEqual([{ id: 'pay-1', kind: 'DEPOSIT', usdAmountCents: 400, paidCurrency: 'USD', paidAmountMinor: 400, recordedAt: '2026-09-22T10:05:00.000Z' }])
    expect(state.orders[0]?.audit).toEqual([{ id: 'audit-1', action: 'RECORD_DEPOSIT', actor: 'admin', createdAt: '2026-09-22T10:05:00.000Z' }])

    const found = await findPersistedOrder(db, 'order-pay')
    expect(found?.payments?.[0]?.id).toBe('pay-1')
    expect(found?.audit?.[0]?.action).toBe('RECORD_DEPOSIT')
  })

  it('refuses a conditional transition when the durable status no longer matches', async () => {
    const calls: Array<{ sql: string; args: SqlValue[] }> = []
    const db: SqlClient = {
      execute: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
        calls.push({ sql, args })
        if (sql.startsWith('UPDATE orders')) return { rows: [], rowsAffected: 0 } as SqlResult<Row>
        if (sql.includes('FROM orders o')) {
          return {
            rows: [{
              order_id: 'order-conflict', reference: 'CORU-000011', status: 'CONFIRMED', currency: 'USD', idempotency_key: 'conflict-key',
              subtotal_cents: 400, discount_cents: 0, total_cents: 400, whatsapp_url: 'https://wa.me/1', created_at: '2026-09-22T10:00:00.000Z',
              confirmed_at: '2026-09-22T10:01:00.000Z', item_id: 'item-1', product_id: 'ring-1', name_snapshot: 'Ring', size_label_snapshot: '7',
              unit_price_cents: 400, quantity: 1, line_total_cents: 400,
            }],
            rowsAffected: 0,
          } as unknown as SqlResult<Row>
        }
        return { rows: [], rowsAffected: 0 } as SqlResult<Row>
      },
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
    }

    const intended: Order = {
      id: 'order-conflict', reference: 'CORU-000011', createdAt: '2026-09-22T10:00:00.000Z', status: 'DISCARDED', currency: 'USD',
      items: [{ productId: 'ring-1', quantity: 1, name: 'Ring', sizeLabel: '7', unitPriceCents: 400, lineTotalCents: 400 }],
      quote: { subtotalCents: 400, discountCents: 0, totalCents: 400 }, whatsappUrl: 'https://wa.me/1',
      discardedAt: '2026-09-22T11:00:00.000Z', discardReason: 'Descartado por administración',
    }
    const result = await persistOrderTransition(db, intended, { status: 'PENDING', preorderStage: null, paymentStatus: null }, [])
    expect(result.applied).toBe(false)
    expect(calls.some((call) => call.sql.startsWith('UPDATE orders') && call.sql.includes('AND status = ?') && call.args.includes('PENDING'))).toBe(true)
  })

  it('writes stock changes as deltas guarded by the transition marker', async () => {
    const calls: Array<{ sql: string; args: SqlValue[] }> = []
    const discardedAt = '2026-09-22T11:00:00.000Z'
    const db: SqlClient = {
      execute: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
        calls.push({ sql, args })
        if (sql.includes('FROM orders o')) {
          return {
            rows: [{
              order_id: 'order-delta', reference: 'CORU-000012', status: 'CANCELLED', currency: 'USD', idempotency_key: 'delta-key',
              subtotal_cents: 400, discount_cents: 0, total_cents: 400, whatsapp_url: 'https://wa.me/1', created_at: '2026-09-22T10:00:00.000Z',
              cancelled_at: discardedAt, cancel_reason: 'Cliente desistió', item_id: 'item-1', product_id: 'ring-1', name_snapshot: 'Ring',
              size_label_snapshot: '7', unit_price_cents: 400, quantity: 1, line_total_cents: 400,
            }],
            rowsAffected: 0,
          } as unknown as SqlResult<Row>
        }
        return { rows: [], rowsAffected: 1 } as SqlResult<Row>
      },
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
    }

    const order: Order = {
      id: 'order-delta', reference: 'CORU-000012', createdAt: '2026-09-22T10:00:00.000Z', status: 'CANCELLED', currency: 'USD',
      items: [{ productId: 'ring-1', quantity: 1, name: 'Ring', sizeLabel: '7', unitPriceCents: 400, lineTotalCents: 400 }],
      quote: { subtotalCents: 400, discountCents: 0, totalCents: 400 }, whatsappUrl: 'https://wa.me/1',
      cancelledAt: discardedAt, cancelReason: 'Cliente desistió',
    }
    const movement: InventoryMovement = { id: 'mov-1', productId: 'ring-1', type: 'SALE_REVERSAL', delta: 1, orderId: 'order-delta', createdAt: discardedAt }
    const result = await persistOrderTransition(db, order, { status: 'CONFIRMED', preorderStage: null, paymentStatus: null }, [movement])
    expect(result.applied).toBe(true)
    expect(calls.some((call) => call.sql.includes('stock_quantity = stock_quantity + ?') && call.args[0] === 1)).toBe(true)
    expect(calls.some((call) => call.sql.includes('INSERT INTO inventory_movements') && call.sql.includes('WHERE EXISTS'))).toBe(true)
  })

  it('persists product stock adjustments with a delta instead of an absolute overwrite', async () => {
    resetState()
    state.categories = [{ id: 'cat-1', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true }]
    state.products = [{ id: 'ring-1', slug: 'ring-1', name: 'Ring', category: 'Anillos', sizeLabel: '7', priceCents: 400, stockQuantity: 5, active: true, primaryImageApproved: false, promoEligible: true, artwork: 'orbita', description: 'x', material: 'Acero' }]
    const calls: Array<{ sql: string; args: SqlValue[] }> = []
    const db: SqlClient = {
      execute: async <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
        calls.push({ sql, args })
        return { rows: [], rowsAffected: 1 } as SqlResult<Row>
      },
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(db),
    }
    const movement: InventoryMovement = { id: 'mov-set', productId: 'ring-1', type: 'MANUAL_SET', delta: 2, createdAt: '2026-09-22T12:00:00.000Z' }
    await persistProductAndMovement(db, state, state.products[0]!, movement)
    expect(calls.some((call) => call.sql.includes('stock_quantity = stock_quantity + ?') && call.args[0] === 2)).toBe(true)
    expect(calls.every((call) => !(call.sql.includes('ON CONFLICT') && call.sql.includes('stock_quantity = excluded.stock_quantity')))).toBe(true)
  })
})
