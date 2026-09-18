import type { CommerceQuote, FulfillmentType, PreorderStage, PaymentStatus, ShippingSnapshot } from '../../shared/types'
import type { SqlClient } from '../client'

export type PendingOrderRecord = {
  id: string
  reference: string
  currency: 'USD' | 'Bs'
  idempotencyKey: string
  rateMicros?: number
  rateValidUntil?: string
  quote: CommerceQuote
  whatsappUrl: string
  createdAt: string
  expiresAt?: string
  fulfillmentTypeSnapshot?: FulfillmentType
  leadTimeSnapshot?: string
  depositUsdCents?: number
  balanceUsdCents?: number
  preorderStage?: PreorderStage
  paymentStatus?: PaymentStatus
  shipping?: ShippingSnapshot
  items: Array<{ id: string; productId: string; name: string; sizeLabel: string; material?: string; fulfillmentTypeSnapshot?: FulfillmentType; unitPriceCents: number; quantity: number; lineTotalCents: number }>
}

export class OrderRepository {
  constructor(private readonly db: SqlClient) {}

  async findByIdOrIdempotency(idOrKey: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.db.execute(`${orderSelect} WHERE o.id = ? OR o.idempotency_key = ? LIMIT 1`, [idOrKey, idOrKey])
    return result.rows[0]
  }

  async nextReference(): Promise<string> {
    const result = await this.db.execute<{ next_number: number }>("SELECT COALESCE(MAX(CAST(substr(reference, 6) AS INTEGER)), 0) + 1 AS next_number FROM orders")
    const next = Number(result.rows[0]?.next_number ?? 1)
    return `CORU-${String(next).padStart(6, '0')}`
  }

  async insertPending(order: PendingOrderRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(`INSERT INTO orders (id, reference, status, currency, idempotency_key, rate_micros, rate_valid_until, subtotal_cents, discount_cents, total_cents, promotion_id, promotion_name, promotion_groups, whatsapp_url, created_at, expires_at, fulfillment_type_snapshot, lead_time_snapshot, deposit_usd_cents, balance_usd_cents, preorder_stage, payment_status, shipping_method, personal_delivery_point_id, delivery_address_text, delivery_lat, delivery_lng, delivery_quote_external_id, national_carrier, national_state, national_city, national_office_text) VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [order.id, order.reference, order.currency, order.idempotencyKey, order.rateMicros ?? null, order.rateValidUntil ?? null, order.quote.subtotalCents, order.quote.discountCents, order.quote.totalCents, order.quote.appliedPromotion?.id ?? null, order.quote.appliedPromotion?.name ?? null, order.quote.appliedPromotion?.groupsApplied ?? null, order.whatsappUrl, order.createdAt, order.expiresAt ?? null, order.fulfillmentTypeSnapshot ?? 'STOCK', order.leadTimeSnapshot ?? null, order.depositUsdCents ?? null, order.balanceUsdCents ?? null, order.preorderStage ?? null, order.paymentStatus ?? null, order.shipping?.method ?? null, order.shipping?.method === 'PERSONAL' ? order.shipping.deliveryPointId : null, order.shipping?.method === 'YUMMY' ? order.shipping.addressText : null, order.shipping?.method === 'YUMMY' ? order.shipping.latitude ?? null : null, order.shipping?.method === 'YUMMY' ? order.shipping.longitude ?? null : null, order.shipping?.method === 'YUMMY' ? order.shipping.quoteExternalId ?? null : null, order.shipping?.method === 'NATIONAL' ? order.shipping.carrier : null, order.shipping?.method === 'NATIONAL' ? order.shipping.state : null, order.shipping?.method === 'NATIONAL' ? order.shipping.city : null, order.shipping?.method === 'NATIONAL' ? order.shipping.officeText ?? null : null])
      if (order.shipping) await tx.execute('UPDATE orders SET delivery_quote_amount_minor = ?, delivery_quote_currency = ?, delivery_quote_quoted_at = ?, delivery_quote_external_id = ? WHERE id = ?', [order.shipping.quoteAmountMinor ?? null, order.shipping.quoteCurrency ?? null, order.shipping.quoteQuotedAt ?? null, order.shipping.quoteExternalId ?? null, order.id])
      for (const item of order.items) await tx.execute(`INSERT INTO order_items (id, order_id, product_id, name_snapshot, size_label_snapshot, material_snapshot, fulfillment_type_snapshot, unit_price_cents, quantity, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [item.id, order.id, item.productId, item.name, item.sizeLabel, item.material ?? null, item.fulfillmentTypeSnapshot ?? order.fulfillmentTypeSnapshot ?? 'STOCK', item.unitPriceCents, item.quantity, item.lineTotalCents])
    })
  }
}

const orderSelect = `SELECT o.id, o.reference, o.status, o.currency, o.idempotency_key, o.rate_micros, o.rate_valid_until, o.subtotal_cents, o.discount_cents, o.total_cents, o.promotion_id, o.promotion_name, o.promotion_groups, o.whatsapp_url, o.created_at, o.expires_at, o.confirmed_at, o.discarded_at, o.cancelled_at, o.discard_reason, o.cancel_reason, o.fulfillment_type_snapshot, o.lead_time_snapshot, o.deposit_usd_cents, o.balance_usd_cents, o.preorder_stage, o.payment_status, o.shipping_method, o.personal_delivery_point_id, o.delivery_address_text, o.delivery_lat, o.delivery_lng, o.delivery_quote_amount_minor, o.delivery_quote_currency, o.delivery_quote_quoted_at, o.delivery_quote_external_id, o.national_carrier, o.national_state, o.national_city, o.national_office_text FROM orders o`
