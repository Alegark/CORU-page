import { convertUsdCentsToBs, quoteCart } from '../../shared/commerce'
import type { CartLine, Currency, CommerceQuote, FulfillmentType, Order, OrderPayment, PaymentKind, ShippingSelection, ShippingSnapshot } from '../../shared/types'
import type { CoruState } from '../state'
import { consumeForOrder, InventoryServiceError, reverseSaleForOrder } from './inventory.service'
import { endOfCaracasDay, getUsableRate, ExchangeRateError } from './exchange-rate.service'

export type OrderErrorCode = 'IDEMPOTENCY_REPLAY' | 'PRODUCT_UNAVAILABLE' | 'STOCK_CONFLICT' | 'ORDER_TERMINAL' | 'RATE_UNAVAILABLE' | 'RATE_EXPIRED' | 'STORE_INACTIVE' | 'MIXED_FULFILLMENT' | 'FULFILLMENT_CHANGED' | 'INVALID_TRANSITION' | 'INVALID_REASON' | 'PAYMENT_CONFLICT' | 'DELIVERY_POINT_UNAVAILABLE' | 'SALE_ALREADY_CANCELLED'

export class OrderServiceError extends Error {
  constructor(public readonly code: OrderErrorCode, message: string, public readonly details?: unknown) {
    super(message)
    this.name = 'OrderServiceError'
  }
}

export type CreateOrderOptions = { shipping?: ShippingSelection | null; actor?: string; sessionId?: string; source?: string }
export type PaymentInput = { currency: Currency; paidAmountMinor?: number; rateMicros?: number; note?: string }

const ORDER_TTL_MS = 72 * 60 * 60 * 1000
const DEFAULT_PREORDER_LEAD_TIME = '3–4 semanas'

function id(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function nextReference(orders: Order[]): string {
  const max = orders.reduce((highest, order) => {
    const match = order.reference.match(/(\d+)$/)
    return Math.max(highest, match ? Number(match[1]) : 0)
  }, 0)
  return `CORU-${String(max + 1).padStart(6, '0')}`
}

function cleanLines(lines: CartLine[]): CartLine[] {
  const combined = new Map<string, number>()
  lines.forEach((line) => combined.set(line.productId, (combined.get(line.productId) ?? 0) + Math.floor(line.quantity)))
  return [...combined.entries()].map(([productId, quantity]) => ({ productId, quantity }))
}

function fulfillmentOf(product: { fulfillmentType?: FulfillmentType }): FulfillmentType { return product.fulfillmentType ?? 'STOCK' }

function appendAudit(order: Order, action: NonNullable<Order['audit']>[number]['action'], now: Date, actor?: string, reason?: string): void {
  order.audit ??= []
  order.audit.push({ id: id('audit'), action, ...(actor ? { actor: actor.slice(0, 120) } : {}), ...(reason ? { reason: reason.slice(0, 240) } : {}), createdAt: now.toISOString() })
  order.lastActionActor = actor
  order.lastActionAt = now.toISOString()
}

function buildWhatsappUrl(state: CoruState, order: Pick<Order, 'reference' | 'items' | 'quote' | 'fulfillmentTypeSnapshot' | 'shipping' | 'depositUsdCents' | 'balanceUsdCents' | 'leadTimeSnapshot'>, totalBs?: number): string {
  const promotionLine = order.quote.appliedPromotion ? `Promo: ${order.quote.appliedPromotion.name} (${order.quote.appliedPromotion.groupsApplied} combo${order.quote.appliedPromotion.groupsApplied > 1 ? 's' : ''})` : ''
  const intro = state.settings?.whatsappIntro ?? 'Hola, quiero pedir estos productos de CORU.'
  const phone = state.settings?.whatsappPhone ?? '584120000000'
  const lines = [intro, `Referencia: ${order.reference}`, order.fulfillmentTypeSnapshot === 'PREORDER' ? 'Modalidad: Bajo pedido' : 'Modalidad: Disponible', ...order.items.map((item) => `${item.quantity}× ${item.name}`), promotionLine, `Total USD: $${(order.quote.totalCents / 100).toFixed(2)}`]
  if (order.fulfillmentTypeSnapshot === 'PREORDER') {
    lines.push(`Tiempo estimado: ${order.leadTimeSnapshot ?? DEFAULT_PREORDER_LEAD_TIME}`, `Anticipo (50%): $${((order.depositUsdCents ?? Math.floor(order.quote.totalCents / 2)) / 100).toFixed(2)}`, `Saldo al entregar: $${((order.balanceUsdCents ?? order.quote.totalCents - Math.floor(order.quote.totalCents / 2)) / 100).toFixed(2)}`)
  } else if (order.shipping) {
    if (order.shipping.method === 'PERSONAL') lines.push('Entrega: Personal', `Punto: ${order.shipping.deliveryPointName ?? order.shipping.deliveryPointId}`, ...(order.shipping.deliveryPointAddress ? [`Dirección: ${order.shipping.deliveryPointAddress}`] : []))
    if (order.shipping.method === 'NATIONAL') lines.push(`Envío nacional: ${order.shipping.carrier}`, `Estado: ${order.shipping.state}`, `Ciudad: ${order.shipping.city}`, ...(order.shipping.officeText ? [`Oficina: ${order.shipping.officeText}`] : []), 'Modalidad: Cobro a destino')
    if (order.shipping.method === 'YUMMY') lines.push('Entrega: Yummy', `Destino: ${order.shipping.addressText}`, ...(order.shipping.quoteAmountMinor === undefined ? ['Costo del delivery: por confirmar', 'La tarifa de Yummy se calcula al solicitar el servicio y puede variar según la hora y disponibilidad.'] : [`Delivery estimado al generar el pedido: ${order.shipping.quoteCurrency ?? 'Bs'} ${((order.shipping.quoteAmountMinor ?? 0) / 100).toFixed(2)}`, 'La tarifa puede variar al momento de solicitar el servicio.']))
  }
  if (totalBs !== undefined) lines.push(`Total Bs: Bs ${(totalBs / 100).toFixed(2)}`, 'Tasa asegurada para tu pedido hasta finalizar hoy.')
  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.filter(Boolean).join('\n'))}`
}

function getOrder(state: CoruState, orderId: string): Order {
  const order = state.orders.find((candidate) => candidate.id === orderId || candidate.reference === orderId)
  if (!order) throw new OrderServiceError('PRODUCT_UNAVAILABLE', 'Pedido no encontrado.')
  return order
}

function resolveShipping(state: CoruState, shipping: ShippingSelection | null | undefined): ShippingSnapshot | undefined {
  if (!shipping) {
    const fallback = state.deliveryPoints.find((point) => point.active)
    return fallback ? { method: 'PERSONAL', deliveryPointId: fallback.id, deliveryPointName: fallback.name, deliveryPointAddress: fallback.address } : undefined
  }
  if (shipping.method === 'PERSONAL') {
    const point = state.deliveryPoints.find((candidate) => candidate.active && candidate.id === shipping.deliveryPointId)
    if (!point) throw new OrderServiceError('DELIVERY_POINT_UNAVAILABLE', 'El punto de entrega ya no está disponible.', { points: state.deliveryPoints.filter((candidate) => candidate.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(({ id, name, address, shortDescription, latitude, longitude, scheduleText, sortOrder }) => ({ id, name, address, ...(shortDescription ? { shortDescription } : {}), ...(latitude !== undefined ? { latitude } : {}), ...(longitude !== undefined ? { longitude } : {}), ...(scheduleText ? { scheduleText } : {}), sortOrder })) })
    return { ...shipping, deliveryPointName: point.name, deliveryPointAddress: point.address }
  }
  if (shipping.method === 'YUMMY') {
    const quote = shipping.quoteReference ? state.yummyQuotes.get(shipping.quoteReference) : undefined
    const sameDestination = quote && quote.addressText.trim() === shipping.addressText.trim() && quote.latitude === shipping.latitude && quote.longitude === shipping.longitude
    return { ...shipping, ...(shipping.quoteReference ? { quoteExternalId: shipping.quoteReference } : {}), ...(sameDestination ? { quoteAmountMinor: quote.amountMinor, quoteCurrency: quote.currency, quoteQuotedAt: quote.quotedAt } : {}) }
  }
  return { ...shipping }
}

function usablePayment(state: CoruState, currency: Currency, requestedRateMicros: number | undefined, now: Date): { rateMicros?: number; paidAmountMinor: (usdCents: number) => number } {
  if (currency === 'USD') return { paidAmountMinor: (usdCents) => usdCents }
  try {
    const rateMicros = getUsableRate(state, now)
    return { rateMicros, paidAmountMinor: (usdCents) => convertUsdCentsToBs(usdCents, rateMicros) }
  } catch (error) {
    if (error instanceof ExchangeRateError) throw new OrderServiceError('RATE_UNAVAILABLE', error.message)
    void requestedRateMicros
    throw error
  }
}

type SelectedProduct = { line: CartLine; product: NonNullable<CoruState['products'][number]> }

/** Pure order-intent validation used before anti-abuse reservation. */
export function validateOrderIntent(state: CoruState, lines: CartLine[], shipping?: ShippingSelection | null): { normalized: CartLine[]; selected: SelectedProduct[]; fulfillmentType: FulfillmentType } {
  if (!state.settings.storeActive) throw new OrderServiceError('STORE_INACTIVE', 'La tienda no está recibiendo pedidos en este momento.')
  const products = new Map(state.products.map((product) => [product.id, product]))
  const activeCategories = new Set(state.categories.filter((category) => category.active).map((category) => category.name))
  const normalized = cleanLines(lines)
  if (!normalized.length || normalized.some((line) => line.quantity <= 0)) throw new OrderServiceError('PRODUCT_UNAVAILABLE', 'Incluye al menos un producto disponible.')
  const selected = normalized.map((line) => ({ line, product: products.get(line.productId) })).filter((entry): entry is SelectedProduct => Boolean(entry.product))
  if (selected.length !== normalized.length || selected.some(({ line, product }) => !activeCategories.has(product.category) || !product.active || !product.primaryImageApproved || line.quantity <= 0)) throw new OrderServiceError('PRODUCT_UNAVAILABLE', 'Uno o más productos ya no están disponibles.')
  const fulfillmentTypes = new Set(selected.map(({ product }) => fulfillmentOf(product)))
  if (fulfillmentTypes.size > 1) throw new OrderServiceError('MIXED_FULFILLMENT', 'Separa los productos disponibles y los productos bajo pedido para crear pedidos independientes.')
  const fulfillmentType = [...fulfillmentTypes][0]
  if (fulfillmentType === 'STOCK' && selected.some(({ line, product }) => product.stockQuantity < line.quantity)) throw new OrderServiceError('PRODUCT_UNAVAILABLE', 'Uno o más productos ya no están disponibles.')
  if (fulfillmentType === 'PREORDER' && selected.some(({ product }) => !product.material || !product.sizeLabel || !product.measurementsText)) throw new OrderServiceError('PRODUCT_UNAVAILABLE', 'Este producto bajo pedido aún no tiene medidas publicadas.')
  if (fulfillmentType === 'PREORDER' && shipping) throw new OrderServiceError('FULFILLMENT_CHANGED', 'Los productos bajo pedido no usan entrega en este paso.')
  return { normalized, selected, fulfillmentType }
}

export function createPendingOrder(state: CoruState, lines: CartLine[], currency: Currency, requestedRateMicros?: number, idempotencyKey?: string, now = new Date(), options: CreateOrderOptions = {}): { order: Order; reused: boolean } {
  if (idempotencyKey) {
    const cached = state.idempotency.get(idempotencyKey)
    if (cached) return { order: cached, reused: true }
  }
  const { normalized, selected, fulfillmentType } = validateOrderIntent(state, lines, options.shipping)
  const products = new Map(state.products.map((product) => [product.id, product]))
  const payment = usablePayment(state, currency, requestedRateMicros, now)
  const promotion = fulfillmentType === 'STOCK' ? state.promotions?.find((candidate) => candidate.active && (!candidate.startsAt || now >= new Date(candidate.startsAt)) && (!candidate.endsAt || now <= new Date(candidate.endsAt))) : null
  const quote = quoteCart(normalized, state.products, promotion)
  const orderItems = selected.map(({ line, product }) => ({ ...line, name: product.name, sizeLabel: product.sizeLabel, unitPriceCents: product.priceCents, lineTotalCents: product.priceCents * line.quantity, material: product.material, fulfillmentTypeSnapshot: fulfillmentOf(product) }))
  const reference = nextReference(state.orders)
  const expiresAt = new Date(now.getTime() + ORDER_TTL_MS).toISOString()
  const depositUsdCents = fulfillmentType === 'PREORDER' ? Math.floor(quote.totalCents / 2) : undefined
  const balanceUsdCents = fulfillmentType === 'PREORDER' ? quote.totalCents - (depositUsdCents ?? 0) : undefined
  const shippingSnapshot = fulfillmentType === 'STOCK' ? resolveShipping(state, options.shipping) : undefined
  const order: Order = {
    id: id('order'), reference, createdAt: now.toISOString(), expiresAt, status: 'PENDING', currency,
    ...(payment.rateMicros ? { rateMicros: payment.rateMicros, rateValidUntil: endOfCaracasDay(now).toISOString() } : {}),
    items: orderItems, quote, whatsappUrl: '', fulfillmentTypeSnapshot: fulfillmentType,
    ...(fulfillmentType === 'PREORDER' ? { leadTimeSnapshot: selected[0].product.leadTime ?? DEFAULT_PREORDER_LEAD_TIME, depositUsdCents, balanceUsdCents, preorderStage: 'AWAITING_DEPOSIT' as const, paymentStatus: 'UNPAID' as const } : {}),
    ...(shippingSnapshot ? { shipping: shippingSnapshot } : {}),
  }
  const totalBs = payment.rateMicros ? convertUsdCentsToBs(quote.totalCents, payment.rateMicros) : undefined
  order.whatsappUrl = buildWhatsappUrl(state, order, totalBs)
  appendAudit(order, 'CREATED', now, options.actor)
  state.orders.push(order)
  if (idempotencyKey) state.idempotency.set(idempotencyKey, order)
  return { order, reused: false }
}

export function reassignOrderReference(state: CoruState, order: Order, reference: string): Order {
  order.reference = reference
  const totalBs = order.rateMicros ? convertUsdCentsToBs(order.quote.totalCents, order.rateMicros) : undefined
  order.whatsappUrl = buildWhatsappUrl(state, order, totalBs)
  return order
}

export function expireIfDue(state: CoruState, order: Order, now = new Date(), actor = 'system'): boolean {
  if (order.status !== 'PENDING' || !order.expiresAt || now < new Date(order.expiresAt)) return false
  order.status = 'DISCARDED'; order.discardedAt ??= now.toISOString(); order.discardReason ??= 'EXPIRED_UNREVIEWED'
  if (order.fulfillmentTypeSnapshot === 'PREORDER') order.preorderStage = 'CANCELLED'
  appendAudit(order, 'EXPIRED_UNREVIEWED', now, actor, 'EXPIRED_UNREVIEWED')
  return true
}

export function expirePendingOrders(state: CoruState, now = new Date()): Order[] { return state.orders.filter((order) => expireIfDue(state, order, now)) }

export function confirmOrder(state: CoruState, orderId: string, now = new Date()): Order {
  const order = getOrder(state, orderId); expireIfDue(state, order, now)
  if (order.status !== 'PENDING') throw new OrderServiceError('ORDER_TERMINAL', 'El pedido ya no está pendiente.')
  if (order.fulfillmentTypeSnapshot === 'PREORDER') throw new OrderServiceError('INVALID_TRANSITION', 'Un pedido bajo pedido se confirma al registrar el anticipo.')
  if (order.currency === 'Bs' && order.rateValidUntil && now > new Date(order.rateValidUntil)) throw new OrderServiceError('RATE_EXPIRED', 'La tasa del pedido expiró; actualízala antes de confirmar.')
  try { consumeForOrder(state, order, now) } catch (error) {
    if (error instanceof InventoryServiceError && error.code === 'STOCK_CONFLICT') throw new OrderServiceError('STOCK_CONFLICT', error.message)
    throw error
  }
  order.status = 'CONFIRMED'; order.confirmedAt = now.toISOString(); appendAudit(order, 'CONFIRMED', now); return order
}

export function discardOrder(state: CoruState, orderId: string, reason = 'Descartado por administración', now = new Date(), actor = 'admin'): Order {
  const order = getOrder(state, orderId); expireIfDue(state, order, now)
  if (order.status !== 'PENDING') throw new OrderServiceError('ORDER_TERMINAL', 'El pedido ya no está pendiente.')
  const cleanReason = reason.trim(); if (!cleanReason) throw new OrderServiceError('INVALID_REASON', 'Indica un motivo para descartar el pedido.')
  order.status = 'DISCARDED'; order.discardedAt = now.toISOString(); order.discardReason = cleanReason.slice(0, 240)
  if (order.fulfillmentTypeSnapshot === 'PREORDER') order.preorderStage = 'CANCELLED'
  appendAudit(order, 'DISCARDED', now, actor, order.discardReason); return order
}

function actionReplay(state: CoruState, key?: string): Order | undefined { return key ? state.actionIdempotency.get(key) : undefined }
function storeAction(state: CoruState, key: string | undefined, order: Order): void { if (key) state.actionIdempotency.set(key, order) }

function recordPayment(order: Order, kind: PaymentKind, input: PaymentInput, usdAmountCents: number, now: Date, key?: string): void {
  const paidCurrency = input.currency; const rateMicros = paidCurrency === 'Bs' ? input.rateMicros : undefined
  const paidAmountMinor = input.paidAmountMinor ?? (paidCurrency === 'USD' ? usdAmountCents : convertUsdCentsToBs(usdAmountCents, rateMicros ?? 0))
  if (!Number.isInteger(paidAmountMinor) || paidAmountMinor <= 0 || (paidCurrency === 'Bs' && (!rateMicros || rateMicros <= 0))) throw new OrderServiceError('PAYMENT_CONFLICT', 'El pago no tiene una tasa o monto válido.')
  order.payments ??= []; const payment: OrderPayment = { id: id('payment'), kind, usdAmountCents, paidCurrency, paidAmountMinor, ...(rateMicros ? { rateMicros } : {}), recordedAt: now.toISOString(), ...(input.note ? { note: input.note.trim().slice(0, 240) } : {}), ...(key ? { idempotencyKey: key } : {}) }; order.payments.push(payment)
}

export function recordPreorderDeposit(state: CoruState, orderId: string, input: PaymentInput, idempotencyKey?: string, now = new Date(), actor = 'admin'): Order {
  const replay = actionReplay(state, idempotencyKey); if (replay) return replay
  const order = getOrder(state, orderId); expireIfDue(state, order, now)
  if (order.fulfillmentTypeSnapshot !== 'PREORDER' || order.status !== 'PENDING' || order.preorderStage !== 'AWAITING_DEPOSIT' || order.paymentStatus !== 'UNPAID') throw new OrderServiceError('INVALID_TRANSITION', 'El pedido no está listo para registrar anticipo.')
  const payment = usablePayment(state, input.currency, input.rateMicros, now)
  recordPayment(order, 'DEPOSIT', { ...input, rateMicros: payment.rateMicros ?? input.rateMicros }, order.depositUsdCents ?? Math.floor(order.quote.totalCents / 2), now, idempotencyKey)
  order.status = 'CONFIRMED'; order.confirmedAt = now.toISOString(); order.preorderStage = 'IN_PROCESS'; order.paymentStatus = 'DEPOSIT_PAID'; appendAudit(order, 'RECORD_DEPOSIT', now, actor); storeAction(state, idempotencyKey, order); return order
}

export function markPreorderReady(state: CoruState, orderId: string, now = new Date(), actor = 'admin'): Order {
  const order = getOrder(state, orderId)
  if (order.fulfillmentTypeSnapshot !== 'PREORDER' || order.status !== 'CONFIRMED' || order.preorderStage !== 'IN_PROCESS' || order.paymentStatus !== 'DEPOSIT_PAID') throw new OrderServiceError('INVALID_TRANSITION', 'El pedido no está en proceso.')
  order.preorderStage = 'READY'; appendAudit(order, 'MARK_READY', now, actor); return order
}

export function recordPreorderBalance(state: CoruState, orderId: string, input: PaymentInput, idempotencyKey?: string, now = new Date(), actor = 'admin'): Order {
  const replay = actionReplay(state, idempotencyKey); if (replay) return replay
  const order = getOrder(state, orderId)
  if (order.fulfillmentTypeSnapshot !== 'PREORDER' || order.status !== 'CONFIRMED' || order.preorderStage !== 'READY' || order.paymentStatus !== 'DEPOSIT_PAID') throw new OrderServiceError('INVALID_TRANSITION', 'El pedido no está listo para registrar el saldo.')
  const payment = usablePayment(state, input.currency, input.rateMicros, now)
  recordPayment(order, 'BALANCE', { ...input, rateMicros: payment.rateMicros ?? input.rateMicros }, order.balanceUsdCents ?? order.quote.totalCents - (order.depositUsdCents ?? 0), now, idempotencyKey)
  order.paymentStatus = 'PAID'; appendAudit(order, 'RECORD_BALANCE', now, actor); storeAction(state, idempotencyKey, order); return order
}

export function markPreorderDelivered(state: CoruState, orderId: string, now = new Date(), actor = 'admin'): Order {
  const order = getOrder(state, orderId)
  if (order.fulfillmentTypeSnapshot !== 'PREORDER' || order.status !== 'CONFIRMED' || order.preorderStage !== 'READY' || order.paymentStatus !== 'PAID') throw new OrderServiceError('INVALID_TRANSITION', 'El pedido no está listo para entregar.')
  order.preorderStage = 'DELIVERED'; appendAudit(order, 'MARK_DELIVERED', now, actor); return order
}

export function cancelSale(state: CoruState, orderId: string, reason: string, idempotencyKey?: string, now = new Date(), actor = 'admin'): Order {
  const replay = actionReplay(state, idempotencyKey); if (replay) return replay
  const order = getOrder(state, orderId); const cleanReason = reason.trim(); if (!cleanReason) throw new OrderServiceError('INVALID_REASON', 'Indica un motivo para cancelar la venta.')
  if (order.status === 'CANCELLED') throw new OrderServiceError('SALE_ALREADY_CANCELLED', 'La venta ya fue cancelada.')
  if (order.status !== 'CONFIRMED') throw new OrderServiceError('ORDER_TERMINAL', 'Solo se puede cancelar una venta confirmada.')
  if (order.fulfillmentTypeSnapshot !== 'PREORDER') {
    try { reverseSaleForOrder(state, order, cleanReason, now) } catch (error) {
      if (error instanceof InventoryServiceError) throw new OrderServiceError(error.code === 'STOCK_CONFLICT' ? 'SALE_ALREADY_CANCELLED' : 'STOCK_CONFLICT', error.message)
      throw error
    }
  } else if (order.preorderStage === 'DELIVERED') throw new OrderServiceError('ORDER_TERMINAL', 'Un pedido entregado no puede cancelarse.')
  order.status = 'CANCELLED'; order.cancelledAt = now.toISOString(); order.cancelReason = cleanReason.slice(0, 240); if (order.fulfillmentTypeSnapshot === 'PREORDER') order.preorderStage = 'CANCELLED'; appendAudit(order, 'CANCEL_SALE', now, actor, order.cancelReason); storeAction(state, idempotencyKey, order); return order
}

export function refreshOrderRate(state: CoruState, orderId: string, now = new Date()): Order {
  const order = getOrder(state, orderId); expireIfDue(state, order, now)
  if (order.status !== 'PENDING' || order.currency !== 'Bs') throw new OrderServiceError('ORDER_TERMINAL', 'Solo un pedido Bs pendiente puede actualizar su tasa.')
  if (!state.currentRateMicros || state.currentRateMicros <= 0) throw new OrderServiceError('RATE_UNAVAILABLE', 'La tasa de Bs no está disponible.')
  order.rateMicros = state.currentRateMicros; order.rateValidUntil = endOfCaracasDay(now).toISOString(); order.whatsappUrl = buildWhatsappUrl(state, order, convertUsdCentsToBs(order.quote.totalCents, order.rateMicros)); return order
}
