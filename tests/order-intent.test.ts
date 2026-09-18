import { beforeEach, describe, expect, it } from 'vitest'
import { demoProducts } from '../src/shared/catalog'
import { createOrderIntent } from '../src/shared/orders'
import { loadOrders } from '../src/shared/storage'

describe('WhatsApp order intents', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('creates one pending order per idempotency key and preserves stock', () => {
    const before = demoProducts.find((product) => product.id === 'orbita-oscura')?.stockQuantity
    const first = createOrderIntent([{ productId: 'orbita-oscura', quantity: 3 }], 'Bs', 36_420_000, demoProducts, 'test-intent-1')
    const second = createOrderIntent([{ productId: 'orbita-oscura', quantity: 3 }], 'Bs', 40_000_000, demoProducts, 'test-intent-1')

    expect(first.reused).toBe(false)
    expect(second.reused).toBe(true)
    expect(second.order.id).toBe(first.order.id)
    expect(first.order.reference).toBe('CORU-000001')
    expect(first.order.status).toBe('PENDING')
    expect(first.order.rateMicros).toBe(36_420_000)
    expect(first.order.whatsappUrl).toContain(encodeURIComponent('Referencia: CORU-000001'))
    expect(loadOrders()).toHaveLength(1)
    expect(demoProducts.find((product) => product.id === 'orbita-oscura')?.stockQuantity).toBe(before)
  })

  it('normalizes duplicate cart lines into one snapshot', () => {
    const result = createOrderIntent([{ productId: 'orbita-oscura', quantity: 1 }, { productId: 'orbita-oscura', quantity: 2 }], 'USD', undefined, demoProducts, 'duplicate-lines')
    expect(result.order.items).toHaveLength(1)
    expect(result.order.items[0].quantity).toBe(3)
    expect(result.order.quote.totalCents).toBe(1000)
  })
})
