import { describe, expect, it } from 'vitest'
import { resolveRoute } from '../src/client/app/router'
import { createPageViewTracker, getPageViewEvent } from '../src/client/analytics/page-view'
import { demoProducts } from '../src/shared/catalog'

describe('route shell', () => {
  it('maps public and admin paths', () => {
    expect(resolveRoute('/')).toEqual({ kind: 'home' })
    expect(resolveRoute('/producto/estrella-rota')).toEqual({ kind: 'product', slug: 'estrella-rota' })
    expect(resolveRoute('/anillos')).toEqual({ kind: 'collection' })
    expect(resolveRoute('/anillos/calaveras')).toEqual({ kind: 'collection', slug: 'calaveras' })
    expect(resolveRoute('/entregas-maracaibo')).toEqual({ kind: 'delivery' })
    expect(resolveRoute('/privacidad')).toEqual({ kind: 'privacy' })
    expect(resolveRoute('/guia-de-tallas')).toEqual({ kind: 'size-guide' })
    expect(resolveRoute('/admin/pedidos')).toEqual({ kind: 'admin', section: 'orders', orderId: undefined })
    expect(resolveRoute('/admin/entregas')).toEqual({ kind: 'admin', section: 'delivery', orderId: undefined })
    expect(resolveRoute('/admin/pedidos/CORU-000001')).toEqual({ kind: 'admin', section: 'orders', orderId: 'CORU-000001' })
    expect(resolveRoute('/missing')).toEqual({ kind: 'not-found' })
  })

  it('maps every public route to one page-view event and excludes admin routes', () => {
    expect(getPageViewEvent(resolveRoute('/'))?.name).toBe('catalog_view')
    expect(getPageViewEvent(resolveRoute('/anillos'))?.name).toBe('catalog_view')
    expect(getPageViewEvent(resolveRoute('/anillos/calaveras'))?.name).toBe('catalog_view')
    expect(getPageViewEvent(resolveRoute('/entregas-maracaibo'))?.name).toBe('catalog_view')
    expect(getPageViewEvent(resolveRoute('/producto/estrella-rota'), demoProducts[0])?.name).toBe('product_view')
    expect(getPageViewEvent(resolveRoute('/producto/no-existe'))?.name).toBe('not_found_view')
    expect(getPageViewEvent(resolveRoute('/guia-de-tallas'))?.name).toBe('size_guide_view')
    expect(getPageViewEvent(resolveRoute('/privacidad'))?.name).toBe('privacy_view')
    expect(getPageViewEvent(resolveRoute('/ruta-inexistente'))?.name).toBe('not_found_view')
    expect(getPageViewEvent(resolveRoute('/admin/analitica'))).toBeNull()
  })

  it('tracks once per public route change, skips admin and counts the same route again after reload', () => {
    const tracked: string[] = []
    const tracker = createPageViewTracker((name) => tracked.push(name))

    expect(tracker('/', resolveRoute('/'))).toBe(true)
    expect(tracker('/', resolveRoute('/'))).toBe(false)
    expect(tracker('/admin/analitica', resolveRoute('/admin/analitica'))).toBe(false)
    expect(tracker('/privacidad', resolveRoute('/privacidad'))).toBe(true)
    expect(tracker('/producto/no-existe', resolveRoute('/producto/no-existe'))).toBe(true)
    expect(createPageViewTracker((name) => tracked.push(name))('/', resolveRoute('/'))).toBe(true)
    expect(tracked).toEqual(['catalog_view', 'privacy_view', 'not_found_view', 'catalog_view'])
  })

  it('never counts unknown paths under admin or API as public not-found views', () => {
    const tracked: string[] = []
    const tracker = createPageViewTracker((name) => tracked.push(name))

    expect(tracker('/admin/ruta-inexistente', resolveRoute('/admin/ruta-inexistente'))).toBe(false)
    expect(tracker('/ADMIN/ruta-inexistente', resolveRoute('/ADMIN/ruta-inexistente'))).toBe(false)
    expect(tracker('/api/analytics', resolveRoute('/api/analytics'))).toBe(false)
    expect(tracked).toEqual([])
  })
})
