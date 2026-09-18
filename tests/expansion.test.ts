import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/worker/app'
import { resetState, state } from '../src/worker/state'
import { cancelSale, confirmOrder, createPendingOrder, expirePendingOrders, markPreorderDelivered, markPreorderReady, recordPreorderBalance, recordPreorderDeposit } from '../src/worker/services/order.service'

describe('v1.1 fulfillment and order safeguards', () => {
  beforeEach(() => resetState())

  it('expires an unreviewed STOCK intent after 72 hours without touching inventory', () => {
    const created = createPendingOrder(state, [{ productId: 'orbita-oscura', quantity: 1 }], 'USD', undefined, 'expiry-1', new Date('2026-09-01T12:00:00Z')).order
    expect(created.expiresAt).toBe('2026-09-04T12:00:00.000Z')
    const stock = state.products.find((product) => product.id === 'orbita-oscura')!.stockQuantity
    expect(expirePendingOrders(state, new Date('2026-09-04T12:00:00Z'))).toHaveLength(1)
    expect(created).toMatchObject({ status: 'DISCARDED', discardReason: 'EXPIRED_UNREVIEWED', discardedAt: '2026-09-04T12:00:00.000Z' })
    expect(state.products.find((product) => product.id === 'orbita-oscura')!.stockQuantity).toBe(stock)
  })

  it('runs the PREORDER payment lifecycle without inventory movements', () => {
    const created = createPendingOrder(state, [{ productId: 'signo-lunar', quantity: 1 }], 'USD', undefined, 'preorder-1', new Date('2026-09-01T12:00:00Z')).order
    expect(created).toMatchObject({ fulfillmentTypeSnapshot: 'PREORDER', preorderStage: 'AWAITING_DEPOSIT', paymentStatus: 'UNPAID', depositUsdCents: 225, balanceUsdCents: 225 })
    recordPreorderDeposit(state, created.id, { currency: 'USD', paidAmountMinor: 225 }, 'deposit-1', new Date('2026-09-01T13:00:00Z'))
    markPreorderReady(state, created.id)
    recordPreorderBalance(state, created.id, { currency: 'USD', paidAmountMinor: 225 }, 'balance-1')
    markPreorderDelivered(state, created.id)
    expect(created).toMatchObject({ status: 'CONFIRMED', preorderStage: 'DELIVERED', paymentStatus: 'PAID' })
    expect(state.movements).toHaveLength(0)
  })

  it('cancels a confirmed STOCK sale once and restores exact quantities', () => {
    const product = state.products.find((entry) => entry.id === 'orbita-oscura')!
    const before = product.stockQuantity
    const order = createPendingOrder(state, [{ productId: product.id, quantity: 2 }], 'USD', undefined, 'cancel-1').order
    confirmOrder(state, order.id)
    expect(product.stockQuantity).toBe(before - 2)
    cancelSale(state, order.id, 'Cliente desistió', 'cancel-action-1')
    expect(product.stockQuantity).toBe(before)
    expect(state.movements.filter((movement) => movement.type === 'SALE_REVERSAL')).toHaveLength(1)
    expect(() => cancelSale(state, order.id, 'repetido', 'cancel-action-2')).toThrowError(/ya fue cancelada/)
  })

  it('returns stable anti-abuse responses and does not create the sixth intent', async () => {
    let cookie = ''
    const make = (key: string) => app.request('/api/orders/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'CF-Connecting-IP': '198.51.100.9', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ lines: [{ productId: 'orbita-oscura', quantity: 1 }], currency: 'USD' }) })
    for (let index = 0; index < 5; index += 1) { const response = await make(`guard-${index}`); cookie = response.headers.get('Set-Cookie')?.split(';')[0] ?? cookie; expect(response.status).toBe(200) }
    const limited = await make('guard-5')
    expect(limited.status).toBe(429)
    expect((await limited.json()) as { error: { code: string; details: { retryAfterSeconds: number } } }).toMatchObject({ error: { code: 'ORDER_INTENT_RATE_LIMITED' } })
    expect(state.orders).toHaveLength(5)
    expect((await make('guard-0')).status).toBe(200)
    expect(state.orders).toHaveLength(5)
  })
})
