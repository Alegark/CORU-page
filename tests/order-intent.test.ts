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
    const whatsapp = decodeURIComponent(first.order.whatsappUrl)
    expect(whatsapp).toContain('📦 *PRODUCTOS*')
    expect(whatsapp).toContain('- 3 uds × Órbita oscura [Talla única]')
    expect(whatsapp).toContain('$4.00 × 3 = $12.00')
    expect(whatsapp).toContain('📋 *DATOS DE ENTREGA Y FACTURA*')
    expect(whatsapp).toContain('- Referencia: *CORU-000001*')
    expect(whatsapp).toContain('💰 *RESUMEN DE PAGO*')
    expect(whatsapp).toContain('- Subtotal: $12.00')
    expect(whatsapp).toContain('- Descuento: −$2.00')
    expect(whatsapp).toContain('- TOTAL EN USD: *$10.00*')
    expect(whatsapp).toContain('- TOTAL EN BS: *Bs. 364,20*')
    expect(whatsapp).not.toContain('- Promoción:')
    expect(whatsapp).not.toContain('- Tasa asegurada hasta finalizar hoy.')
    expect(whatsapp.endsWith('NOTA: Tasa asegurada hasta finalizar hoy.')).toBe(true)
    expect(whatsapp).not.toContain('🧾')
    expect(whatsapp).not.toContain('🎁')
    expect(loadOrders()).toHaveLength(1)
    expect(demoProducts.find((product) => product.id === 'orbita-oscura')?.stockQuantity).toBe(before)
  })

  it('normalizes duplicate cart lines into one snapshot', () => {
    const result = createOrderIntent([{ productId: 'orbita-oscura', quantity: 1 }, { productId: 'orbita-oscura', quantity: 2 }], 'USD', undefined, demoProducts, 'duplicate-lines')
    expect(result.order.items).toHaveLength(1)
    expect(result.order.items[0].quantity).toBe(3)
    expect(result.order.quote.totalCents).toBe(1000)
  })

  it('puts preorder timing and payment terms in the final notes', () => {
    const result = createOrderIntent([{ productId: 'signo-lunar', quantity: 1 }], 'USD', undefined, demoProducts, 'preorder-notes')
    const whatsapp = decodeURIComponent(result.order.whatsappUrl)

    expect(whatsapp).toContain('📝 *NOTAS*')
    expect(whatsapp).toContain('- Tiempo estimado de envío: 3–4 semanas')
    expect(whatsapp).toContain('- Forma de pago: 50% inicial · 50% al entregar')
    expect(whatsapp).not.toContain('💰 *RESUMEN DE PAGO*\n\n━━━━━━━━━━━━━━')
  })
})
