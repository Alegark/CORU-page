import type { Order } from '../../shared/types'
import type { CoruState, InventoryMovement } from '../state'

export type InventoryErrorCode = 'PRODUCT_NOT_FOUND' | 'STOCK_CONFLICT' | 'INVALID_QUANTITY'

export class InventoryServiceError extends Error {
  constructor(public readonly code: InventoryErrorCode, message: string) {
    super(message)
    this.name = 'InventoryServiceError'
  }
}

function movementId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `movement-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function assertIntegerQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 0) throw new InventoryServiceError('INVALID_QUANTITY', 'La cantidad de stock debe ser un entero no negativo.')
}

function appendMovement(state: CoruState, movement: Omit<InventoryMovement, 'id' | 'createdAt'> & { createdAt?: string }, now: Date): InventoryMovement {
  const entry: InventoryMovement = { ...movement, id: movementId(), createdAt: movement.createdAt ?? now.toISOString() }
  state.movements.push(entry)
  return entry
}

/** Set an absolute stock count and record the resulting delta. */
export function setStock(state: CoruState, productId: string, quantity: number, note?: string, now = new Date()) {
  assertIntegerQuantity(quantity)
  const product = state.products.find((candidate) => candidate.id === productId)
  if (!product) throw new InventoryServiceError('PRODUCT_NOT_FOUND', 'Producto no encontrado.')
  const delta = quantity - product.stockQuantity
  if (delta === 0) return { product, movement: undefined }
  product.stockQuantity = quantity
  const movement = appendMovement(state, { productId, type: 'MANUAL_SET', delta, ...(note ? { note: note.slice(0, 200) } : {}) }, now)
  return { product, movement }
}

/** Apply a signed stock adjustment and reject a negative resulting count. */
export function adjustStock(state: CoruState, productId: string, delta: number, note?: string, now = new Date()) {
  if (!Number.isInteger(delta)) throw new InventoryServiceError('INVALID_QUANTITY', 'El ajuste de stock debe ser un entero.')
  const product = state.products.find((candidate) => candidate.id === productId)
  if (!product) throw new InventoryServiceError('PRODUCT_NOT_FOUND', 'Producto no encontrado.')
  const quantity = product.stockQuantity + delta
  if (quantity < 0) throw new InventoryServiceError('STOCK_CONFLICT', 'El stock no puede quedar negativo.')
  if (delta === 0) return { product, movement: undefined }
  product.stockQuantity = quantity
  const movement = appendMovement(state, { productId, type: 'MANUAL_ADJUST', delta, ...(note ? { note: note.slice(0, 200) } : {}) }, now)
  return { product, movement }
}

/**
 * Consume all order lines as one logical operation.  Every line is checked
 * before any mutation, so a stock race cannot leave a partially decremented
 * order in the in-memory adapter (the SQL adapter follows the same contract).
 */
export function consumeForOrder(state: CoruState, order: Order, now = new Date()): void {
  const products = new Map(state.products.map((product) => [product.id, product]))
  const conflicts = order.items.filter((item) => {
    const product = products.get(item.productId)
    return !product || product.stockQuantity < item.quantity
  })
  if (conflicts.length) throw new InventoryServiceError('STOCK_CONFLICT', 'El stock cambió; revisa el pedido antes de confirmar.')

  for (const item of order.items) {
    const product = products.get(item.productId)!
    product.stockQuantity -= item.quantity
    appendMovement(state, { productId: item.productId, type: 'SALE', delta: -item.quantity, note: order.reference, orderId: order.id }, now)
  }
}

/**
 * Restore a confirmed STOCK sale exactly once. The service deliberately uses
 * the original SALE movement quantities instead of the current order lines so
 * historical snapshots remain authoritative and partial reversals are never
 * possible.
 */
export function reverseSaleForOrder(state: CoruState, order: Order, reason: string, now = new Date()): InventoryMovement[] {
  const sales = state.movements.filter((movement) => movement.type === 'SALE' && (movement.orderId === order.id || movement.note === order.reference))
  if (!sales.length) throw new InventoryServiceError('STOCK_CONFLICT', 'No se encontró la venta original para revertir.')
  const products = sales.map((sale) => state.products.find((candidate) => candidate.id === sale.productId))
  if (products.some((product) => !product)) throw new InventoryServiceError('PRODUCT_NOT_FOUND', 'Producto de la venta no encontrado.')
  if (sales.some((sale) => state.movements.some((movement) => movement.type === 'SALE_REVERSAL' && movement.reversesMovementId === sale.id))) throw new InventoryServiceError('STOCK_CONFLICT', 'La venta ya tiene una reversión registrada.')
  const reversals: InventoryMovement[] = []
  for (const sale of sales) {
    const product = state.products.find((candidate) => candidate.id === sale.productId)
    if (!product) throw new InventoryServiceError('PRODUCT_NOT_FOUND', 'Producto de la venta no encontrado.')
    product.stockQuantity += Math.abs(sale.delta)
    reversals.push(appendMovement(state, { productId: sale.productId, type: 'SALE_REVERSAL', delta: Math.abs(sale.delta), note: `${order.reference}: ${reason.slice(0, 200)}`, reversesMovementId: sale.id, orderId: order.id }, now))
  }
  return reversals
}
