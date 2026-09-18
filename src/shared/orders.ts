import { convertUsdCentsToBs, quoteCart } from './commerce'
import type { CartLine, Currency, Order, Product } from './types'
import { getSessionId, loadOrders, saveOrders } from './storage'

const DEFAULT_WHATSAPP = '584120000000'

function nextReference(orders: Order[]): string {
  const max = orders.reduce((highest, order) => {
    const match = order.reference.match(/(\d+)$/)
    return Math.max(highest, match ? Number(match[1]) : 0)
  }, 0)
  return `CORU-${String(max + 1).padStart(6, '0')}`
}

export type CreateOrderResult = {
  order: Order
  reused: boolean
}

const intents = new Map<string, Order>()

function randomOrderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createOrderIntent(lines: CartLine[], currency: Currency, rateMicros: number | undefined, products: Product[], idempotencyKey = getSessionId()): CreateOrderResult {
  const cached = intents.get(idempotencyKey)
  if (cached) return { order: cached, reused: true }

  const available = new Map(products.map((product) => [product.id, product]))
  const combined = new Map<string, number>()
  lines.forEach((line) => {
    if (!line.productId) return
    const quantity = Math.floor(line.quantity)
    if (quantity > 0) combined.set(line.productId, (combined.get(line.productId) ?? 0) + quantity)
  })
  const cleanLines = [...combined.entries()].map(([productId, quantity]) => ({ productId, quantity }))
  if (!cleanLines.length) throw new Error('PRODUCT_UNAVAILABLE')
  const unavailable = cleanLines.filter((line) => {
    const product = available.get(line.productId)
    return !product || !product.active || !product.primaryImageApproved || ((product.fulfillmentType ?? 'STOCK') === 'STOCK' && product.stockQuantity < line.quantity)
  })
  if (unavailable.length) throw new Error('PRODUCT_UNAVAILABLE')
  const quote = quoteCart(cleanLines, products)
  const now = new Date()
  const orderItems = cleanLines.map((line) => {
    const product = available.get(line.productId)!
    return { ...line, name: product.name, sizeLabel: product.sizeLabel, unitPriceCents: product.priceCents, lineTotalCents: product.priceCents * line.quantity, material: product.material, fulfillmentTypeSnapshot: product.fulfillmentType ?? 'STOCK' as const }
  })
  const orders = loadOrders()
  const reference = nextReference(orders)
  const order: Order = {
    id: randomOrderId(),
    reference,
    createdAt: now.toISOString(),
    status: 'PENDING',
    currency,
    ...(currency === 'Bs' && rateMicros ? { rateMicros, rateValidUntil: endOfCaracasDay(now).toISOString() } : {}),
    items: orderItems,
    quote,
    whatsappUrl: '',
    expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(),
    fulfillmentTypeSnapshot: available.get(cleanLines[0].productId)?.fulfillmentType ?? 'STOCK',
  }
  if (order.fulfillmentTypeSnapshot === 'PREORDER') {
    order.leadTimeSnapshot = available.get(cleanLines[0].productId)?.leadTime ?? '3–4 semanas'
    order.depositUsdCents = Math.floor(quote.totalCents / 2)
    order.balanceUsdCents = quote.totalCents - order.depositUsdCents
    order.preorderStage = 'AWAITING_DEPOSIT'
    order.paymentStatus = 'UNPAID'
  }
  const bsTotal = currency === 'Bs' && rateMicros ? convertUsdCentsToBs(quote.totalCents, rateMicros) : undefined
  const linesText = orderItems.map((item) => `${item.quantity}× ${item.name}`).join('\n')
  const validity = order.rateValidUntil ? 'Tasa asegurada para tu pedido hasta finalizar hoy.' : ''
  const promotionLine = quote.appliedPromotion ? `Promo: ${quote.appliedPromotion.name} (${quote.appliedPromotion.groupsApplied} combo${quote.appliedPromotion.groupsApplied > 1 ? 's' : ''})` : ''
  const text = [`Hola, quiero pedir estos productos de CORU.`, `Referencia: ${reference}`, linesText, promotionLine, `Total USD: $${(quote.totalCents / 100).toFixed(2)}`, bsTotal ? `Total Bs: Bs ${(bsTotal / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : '', validity].filter(Boolean).join('\n')
  order.whatsappUrl = `https://wa.me/${DEFAULT_WHATSAPP}?text=${encodeURIComponent(text)}`
  intents.set(idempotencyKey, order)
  saveOrders([...orders, order])
  return { order, reused: false }
}

export function endOfCaracasDay(date: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
  return new Date(`${parts.year}-${parts.month}-${parts.day}T23:59:59-04:00`)
}
