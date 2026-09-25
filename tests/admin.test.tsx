import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminShell } from '../src/client/features/admin/AdminShell'
import { AdminPages } from '../src/client/features/admin/AdminPages'
import { demoProducts } from '../src/shared/catalog'
import type { Order, Product } from '../src/shared/types'

describe('Admin operational shell', () => {
  it('shows the approved navigation order', () => {
    render(<AdminShell section="dashboard"><AdminPages section="dashboard" products={demoProducts} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)
    const navigation = within(screen.getByRole('navigation', { name: /navegación administrativa/i }))
    expect(navigation.getByText('Resumen')).toBeInTheDocument()
    expect(navigation.getByText('Productos')).toBeInTheDocument()
    expect(navigation.getByText('Categorías')).toBeInTheDocument()
    expect(navigation.getByText('Promociones')).toBeInTheDocument()
    expect(navigation.getByText('Pedidos')).toBeInTheDocument()
    expect(navigation.getByText('Analítica')).toBeInTheDocument()
    expect(navigation.getByText('Ajustes')).toBeInTheDocument()
  })

  it('returns focus to the menu after closing mobile navigation', async () => {
    const user = userEvent.setup()
    render(<AdminShell section="dashboard"><AdminPages section="dashboard" products={demoProducts} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)
    const menu = screen.getByRole('button', { name: /abrir navegación/i })
    await user.click(menu)
    expect(screen.getAllByRole('button', { name: /cerrar navegación/i })[0]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(menu).toHaveFocus()
  })

  it('uses CORU switches for catalog visibility and promotion eligibility', async () => {
    const user = userEvent.setup()
    render(<AdminShell section="products"><AdminPages section="products" products={demoProducts} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)

    await user.click(screen.getByRole('button', { name: /nuevo producto/i }))
    const visible = screen.getByLabelText('Visible en el catálogo')
    const promo = screen.getByLabelText('Elegible para la promoción')

    expect(visible).toHaveClass('coru-switch-input')
    expect(promo).toHaveClass('coru-switch-input')
    expect(visible).toBeChecked()
    expect(promo).toBeChecked()

    await user.click(visible)
    await user.click(promo)
    expect(visible).not.toBeChecked()
    expect(promo).not.toBeChecked()
  })

  it('shows the uploaded product photo in the product list', () => {
    const photo = '/api/admin/products/orbita-oscura/images/photo-1/preview'
    const product = { ...demoProducts[0], imageUrl: photo }
    render(<AdminShell section="products"><AdminPages section="products" products={[product]} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)
    const images = screen.getAllByRole('img', { name: product.name })
    expect(images.length).toBeGreaterThan(0)
    expect(images[0]).toHaveAttribute('src', photo)
  })

  it('shows an emergency alert and preserves the last saved rate after automatic refresh fails', async () => {
    const settings = { whatsappPhone: '584120000000', whatsappIntro: 'Hola', storeName: 'CORU', instagramUrl: '@coru', facebookUrl: 'CORU', privacyUrl: '/privacidad', storeActive: true }
    const rate = { available: true, rateMicros: 962_999_000, mode: 'AUTOMATIC', updatedAt: '2026-09-22T18:00:00.000Z', validUntil: '2026-09-22T23:59:59.000Z', lastRefreshError: 'El proveedor automático respondió HTTP 502 y el respaldo no respondió.', lastRefreshAttemptedAt: '2026-09-22T19:00:00.000Z' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const data = String(input).includes('/settings/rate') ? rate : settings
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    try {
      render(<AdminShell section="settings"><AdminPages section="settings" products={demoProducts} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/no se pudo actualizar la tasa automática/i)
      expect(alert).toHaveTextContent(/se mantiene la última tasa/i)
      expect(alert).toHaveTextContent('Bs 962,999 / USD')
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('clears only cart-add analytics after confirmation and refreshes the dashboard', async () => {
    const user = userEvent.setup()
    let unitsAdded = 59
    let deleteRequests = 0
    const summary = () => ({
      range: { from: '2026-09-16', to: '2026-09-22', timezone: 'America/Caracas' as const },
      kpis: { pageViews: 165, sessions: 42, uniqueVisitors: 28, unitsAdded, whatsappIntents: 1 },
      sessionsAvailableFrom: '2026-09-24',
      commercial: { unitsAdded, potentialValueCents: unitsAdded ? 25050 : 0, potentialValueEstimated: false, whatsappPerAddPct: 9 },
      funnel: { catalogSessions: 28, productViewSessions: 9, addSessions: unitsAdded ? 11 : 0, whatsappSessions: 1, confirmedOrders: 0 },
      sources: [],
      devices: [],
      timeline: [],
      realOrders: { pending: 1, confirmed: 0, discarded: 0, cancelled: 0, confirmedStockRevenueCents: 0 },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/api/admin/analytics/summary')) return new Response(JSON.stringify({ data: summary() }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.includes('/api/admin/analytics/products')) return new Response(JSON.stringify({ data: { products: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/api/admin/analytics/cart-add') && init?.method === 'DELETE') {
        deleteRequests += 1
        unitsAdded = 0
        return new Response(JSON.stringify({ data: { deletedEvents: 7 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    try {
      render(<AdminShell section="analytics"><AdminPages section="analytics" products={demoProducts} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)

      const uniqueVisitorsKpi = (await screen.findByText('Visitantes únicos', { exact: true })).closest('article')
      const pageViewsKpi = screen.getByText('Vistas de página', { exact: true }).closest('article')
      const sessionsKpi = screen.getByText('Sesiones', { exact: true }).closest('article')
      expect(uniqueVisitorsKpi).toHaveTextContent('28')
      expect(uniqueVisitorsKpi).toHaveTextContent('1 por perfil de navegador en todo el período')
      expect(pageViewsKpi).toHaveTextContent('165')
      expect(sessionsKpi).toHaveTextContent('42')
      expect(sessionsKpi).toHaveTextContent(/30 min de inactividad/i)
      expect(screen.getByText('Visitantes únicos por día', { exact: true })).toBeInTheDocument()
      expect(screen.getByText('Dispositivos únicos por día', { exact: true })).toBeInTheDocument()
      expect(screen.getByText(/perfiles de navegador clasificados por tamaño de pantalla/i)).toBeInTheDocument()

      expect((await screen.findAllByText('59')).length).toBeGreaterThan(0)
      await user.click(screen.getByRole('button', { name: /limpiar agregados/i }))
      expect(screen.getByRole('alertdialog')).toHaveTextContent('visitas, consultas de productos, pedidos y ventas se conservarán')
      expect(deleteRequests).toBe(0)
      await user.click(screen.getByRole('button', { name: /sí, borrar agregados/i }))

      await waitFor(() => expect(deleteRequests).toBe(1))
      await waitFor(() => {
        const unitsAddedKpi = screen.getAllByText('Unidades agregadas', { exact: true })[0]?.closest('article')
        expect(unitsAddedKpi).toHaveTextContent('0')
      })
      expect(await screen.findByRole('status')).toHaveTextContent('Se eliminaron 7 eventos de agregado al carrito')
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('opens the product editor directly below the selected product', async () => {
    const user = userEvent.setup()
    const product = demoProducts[0]
    render(<AdminShell section="products"><AdminPages section="products" products={demoProducts} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)

    const edit = screen.getByRole('button', { name: `Editar ${product.name}` })
    await user.click(edit)

    expect(screen.getByRole('heading', { name: /actualiza los datos del producto/i })).toBeInTheDocument()
    expect(edit.closest('.admin-product-row')?.nextElementSibling).toHaveClass('admin-product-editor-slot')
  })

  it('queues images while creating a product and uploads them after save', async () => {
    const user = userEvent.setup()
    const setProducts = vi.fn()
    const savedProduct: Product = { ...demoProducts[0], id: 'producto-con-fotos', slug: 'producto-con-fotos', name: 'Producto con fotos', primaryImageApproved: true }
    const savedImage = { id: 'image-1', productId: savedProduct.id, originalKey: 'products/producto-con-fotos/image-1/original', mimeType: 'image/png' as const, byteSize: 3, sortOrder: 1, processingStatus: 'READY' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    const requests: Array<{ url: string; method?: string }> = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      requests.push({ url, method: init?.method })
      if (url.endsWith('/api/admin/products') && init?.method === 'POST') return new Response(JSON.stringify({ data: savedProduct }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith(`/api/admin/products/${savedProduct.id}/images`) && init?.method === 'POST') return new Response(JSON.stringify({ data: savedImage }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/api/admin/products') && !init?.method) return new Response(JSON.stringify({ data: [savedProduct] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/api/admin/categories')) return new Response(JSON.stringify({ data: [{ id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    render(<AdminShell section="products"><AdminPages section="products" products={demoProducts} setProducts={setProducts} orders={[]} setOrders={() => undefined} /></AdminShell>)

    try {
      await user.click(screen.getByRole('button', { name: /nuevo producto/i }))
      await user.type(screen.getByLabelText(/^nombre$/i), 'Producto con fotos')
      const file = new File([new Uint8Array([1, 2, 3])], 'anillo.png', { type: 'image/png' })
      await user.upload(screen.getByLabelText(/elegir imágenes/i), file)
      expect(screen.getByText(/1 imagen lista para subir al guardar/i)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /guardar producto/i }))
      await waitFor(() => expect(setProducts).toHaveBeenCalled())
      expect(requests).toEqual(expect.arrayContaining([
        { url: '/api/admin/products', method: 'POST' },
        { url: `/api/admin/products/${savedProduct.id}/images`, method: 'POST' },
      ]))
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('offers permanent deletion for inactive promotions', async () => {
    const user = userEvent.setup()
    const promotion = { id: 'old-promo', name: 'Promoción vencida', kind: 'FIXED_DISCOUNT' as const, fixedDiscountCents: 200, active: false }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/admin/promotions/old-promo') && init?.method === 'DELETE') return new Response(JSON.stringify({ data: promotion }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/api/admin/promotions')) return new Response(JSON.stringify({ data: [promotion] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/api/admin/categories')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      render(<AdminShell section="promotions"><AdminPages section="promotions" products={demoProducts} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)
      await waitFor(() => expect(screen.getByText('Promoción vencida')).toBeInTheDocument())
      const remove = screen.getByRole('button', { name: 'Eliminar Promoción vencida' })
      await user.click(remove)
      await waitFor(() => expect(screen.queryByText('Promoción vencida')).not.toBeInTheDocument())
      expect(confirm).toHaveBeenCalledWith('¿Eliminar la promoción “Promoción vencida”? Esta acción no se puede deshacer.')
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/promotions/old-promo', expect.objectContaining({ method: 'DELETE' }))
    } finally {
      confirm.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('offers permanent deletion for inactive products', async () => {
    const user = userEvent.setup()
    const product = { ...demoProducts[0], active: false }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith(`/api/admin/products/${product.id}`) && init?.method === 'DELETE') return new Response(JSON.stringify({ data: product }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/api/admin/categories')) return new Response(JSON.stringify({ data: [{ id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      render(<AdminShell section="products"><AdminPages section="products" products={[product]} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)
      await waitFor(() => expect(screen.getAllByRole('button', { name: `Eliminar ${product.name}` }).length).toBeGreaterThan(0))
      const remove = screen.getAllByRole('button', { name: `Eliminar ${product.name}` })[0]
      await user.click(remove)
      expect(confirm).toHaveBeenCalledWith(`¿Eliminar el producto “${product.name}”? Esta acción no se puede deshacer.`)
      expect(fetchMock).toHaveBeenCalledWith(`/api/admin/products/${product.id}`, expect.objectContaining({ method: 'DELETE' }))
    } finally {
      confirm.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('disables actions for terminal orders', () => {
    const order: Order = {
      id: 'order-1', reference: 'CORU-000001', createdAt: new Date().toISOString(), status: 'CONFIRMED', currency: 'USD', items: [{ productId: 'orbita-oscura', quantity: 1, name: 'Órbita oscura', sizeLabel: 'Talla única', unitPriceCents: 400, lineTotalCents: 400 }], quote: { subtotalCents: 400, discountCents: 0, totalCents: 400 }, whatsappUrl: 'https://wa.me/584120000000',
    }
    render(<AdminShell section="orders"><AdminPages section="orders" products={demoProducts} setProducts={() => undefined} orders={[order]} setOrders={() => undefined} orderId={order.id} /></AdminShell>)
    expect(screen.getByRole('button', { name: /concretar venta/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /descartar pedido/i })).toBeDisabled()
  })

  it('calculates ring measurements and preserves manual overrides until recalculation', async () => {
    const user = userEvent.setup()
    render(<AdminShell section="products"><AdminPages section="products" products={demoProducts} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)

    await user.click(screen.getByRole('button', { name: /nuevo producto/i }))
    const diameter = screen.getByLabelText(/diámetro interno/i)
    const circumference = screen.getByLabelText(/circunferencia/i)
    const usSize = screen.getByLabelText(/talla us/i)

    expect(diameter).toHaveAttribute('placeholder', 'Ej. 1.73')
    expect(circumference).toHaveAttribute('placeholder', 'Ej. 5.44')

    await user.type(diameter, '1.73')
    expect(circumference).toHaveValue(5.44)
    expect(usSize).toHaveValue('7')

    await user.clear(circumference)
    await user.type(circumference, '5.5')
    await user.clear(usSize)
    await user.type(usSize, '7.5')
    await user.clear(diameter)
    await user.type(diameter, '1.74')
    expect(circumference).toHaveValue(5.5)
    expect(usSize).toHaveValue('7.5')

    await user.click(screen.getByRole('button', { name: /recalcular desde diámetro/i }))
    expect(circumference).toHaveValue(5.47)
    expect(usSize).toHaveValue('7')
  })

  it('sends centimeter measurements as millimeters to the catalog API', async () => {
    const user = userEvent.setup()
    const setProducts = vi.fn()
    const savedPayloads: Record<string, unknown>[] = []
    const savedProduct: Product = { ...demoProducts[0], id: 'anillo-cm', name: 'Anillo cm', innerDiameterMm: 17.3, circumferenceMm: 54.4, usSize: '7' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/admin/products') && init?.method === 'POST') {
        savedPayloads.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({ data: savedProduct }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    render(<AdminShell section="products"><AdminPages section="products" products={demoProducts} setProducts={setProducts} orders={[]} setOrders={() => undefined} /></AdminShell>)

    try {
      await user.click(screen.getByRole('button', { name: /nuevo producto/i }))
      await user.type(screen.getByLabelText(/^nombre$/i), 'Anillo cm')
      await user.type(screen.getByLabelText(/diámetro interno/i), '1.73')
      await user.click(screen.getByRole('button', { name: /guardar producto/i }))

      await waitFor(() => expect(setProducts).toHaveBeenCalled())
      expect(savedPayloads[0]).toMatchObject({ innerDiameterMm: 17.3, circumferenceMm: 54.4, usSize: '7' })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('allows preorder products without ring measurements', async () => {
    const user = userEvent.setup()
    const setProducts = vi.fn()
    const savedPayloads: Record<string, unknown>[] = []
    const savedProduct: Product = { ...demoProducts[0], id: 'collar-de-prueba', name: 'Collar de prueba', sizeLabel: 'Talla única', fulfillmentType: 'PREORDER', stockQuantity: 0, measurementsText: undefined, innerDiameterMm: undefined, circumferenceMm: undefined, usSize: undefined }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/admin/products') && init?.method === 'POST') {
        savedPayloads.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({ data: savedProduct }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/admin/categories')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    render(<AdminShell section="products"><AdminPages section="products" products={demoProducts} setProducts={setProducts} orders={[]} setOrders={() => undefined} /></AdminShell>)

    try {
      await user.click(screen.getByRole('button', { name: /nuevo producto/i }))
      expect(screen.queryByLabelText(/información de talla/i)).not.toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText(/modalidad/i), 'PREORDER')
      await user.type(screen.getByLabelText(/^nombre$/i), 'Collar de prueba')
      await user.click(screen.getByRole('button', { name: /guardar producto/i }))

      await waitFor(() => expect(setProducts).toHaveBeenCalled())
      expect(savedPayloads).toHaveLength(1)
      expect(savedPayloads[0]).toMatchObject({ sizeLabel: 'Talla única', fulfillmentType: 'PREORDER' })
      expect(savedPayloads[0]).not.toHaveProperty('measurementsText')
      expect(savedPayloads[0]).not.toHaveProperty('innerDiameterMm')
      expect(savedPayloads[0]).not.toHaveProperty('circumferenceMm')
      expect(savedPayloads[0]).not.toHaveProperty('usSize')
    } finally {
      fetchMock.mockRestore()
    }
  })
})
