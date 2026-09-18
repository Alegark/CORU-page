import { describe, expect, it } from 'vitest'
import { resolveRoute } from '../src/client/app/router'

describe('route shell', () => {
  it('maps public and admin paths', () => {
    expect(resolveRoute('/')).toEqual({ kind: 'home' })
    expect(resolveRoute('/producto/estrella-rota')).toEqual({ kind: 'product', slug: 'estrella-rota' })
    expect(resolveRoute('/privacidad')).toEqual({ kind: 'privacy' })
    expect(resolveRoute('/guia-de-tallas')).toEqual({ kind: 'size-guide' })
    expect(resolveRoute('/admin/pedidos')).toEqual({ kind: 'admin', section: 'orders', orderId: undefined })
    expect(resolveRoute('/admin/entregas')).toEqual({ kind: 'admin', section: 'delivery', orderId: undefined })
    expect(resolveRoute('/admin/pedidos/CORU-000001')).toEqual({ kind: 'admin', section: 'orders', orderId: 'CORU-000001' })
    expect(resolveRoute('/missing')).toEqual({ kind: 'not-found' })
  })
})
