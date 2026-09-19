import { describe, expect, it } from 'vitest'
import type { SqlClient, SqlResult, SqlValue } from '../src/db/client'
import { confirmPersistedOrder, findActivePromotion, hydrateStateFromDatabase, persistPendingOrder } from '../src/worker/persistence'
import { resetState, state } from '../src/worker/state'
import type { Order } from '../src/shared/types'

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
})
