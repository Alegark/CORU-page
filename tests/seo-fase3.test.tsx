import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { app } from '../src/worker/app'
import { resetState, state } from '../src/worker/state'
import { NATIONAL_SHIPPING_COPY, YUMMY_DELIVERY_COPY } from '../src/shared/shipping-copy'
import { DeliveryPage } from '../src/client/features/catalog/DeliveryPage'
import { CartProvider } from '../src/client/features/cart/CartContext'
import { StorePage } from '../src/client/features/catalog/StorePage'
import { ProductPage } from '../src/client/features/catalog/ProductPage'
import { demoProducts } from '../src/shared/catalog'
import { productImageAlt } from '../src/shared/seo'
import { vi } from 'vitest'

const SHELL = `<!doctype html><html lang="es-VE"><head><meta charset="UTF-8" /><meta name="description" content="CORU" /><title>CORU</title></head><body><div id="root"></div></body></html>`

function assetsStub() {
  return {
    fetch: async () => new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  }
}

describe('Fase 3 SEO collections and delivery', () => {
  beforeEach(() => resetState())

  it('serves /anillos and published collection pages with CollectionPage JSON-LD', async () => {
    // Seed enough Anillos matching calaveras for the threshold.
    state.products = [
      { ...state.products[0]!, id: 'c1', slug: 'anillo-calavera-1', name: 'Anillo calavera uno', category: 'Anillos', description: 'calavera', active: true, primaryImageApproved: true, stockQuantity: 5 },
      { ...state.products[0]!, id: 'c2', slug: 'anillo-calavera-2', name: 'Anillo calavera dos', category: 'Anillos', description: 'calavera', active: true, primaryImageApproved: true, stockQuantity: 5 },
      { ...state.products[0]!, id: 'c3', slug: 'anillo-calavera-3', name: 'Anillo calavera tres', category: 'Anillos', description: 'calavera', active: true, primaryImageApproved: true, stockQuantity: 5 },
      { ...state.products[0]!, id: 'c4', slug: 'anillo-calavera-4', name: 'Anillo calavera cuatro', category: 'Anillos', description: 'calavera', active: true, primaryImageApproved: true, stockQuantity: 5 },
    ]

    const all = await app.request('/anillos', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(all.status).toBe(200)
    const allHtml = await all.text()
    expect(allHtml).toContain('<title>Todos los anillos · CORU Maracaibo</title>')
    expect(allHtml).toContain('rel="canonical" href="https://coru.systems/anillos"')
    expect(allHtml).toContain('CollectionPage')
    expect(allHtml).toContain('href="/producto/anillo-calavera-1"')

    const calaveras = await app.request('/anillos/calaveras', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(calaveras.status).toBe(200)
    const html = await calaveras.text()
    expect(html).toContain('Anillos de calavera en Maracaibo · CORU')
    expect(html).toContain('canonical" href="https://coru.systems/anillos/calaveras"')
    expect(html).toContain('<h1>Anillos de calavera</h1>')
  })

  it('returns 404 for unknown or under-threshold collections', async () => {
    const unknown = await app.request('/anillos/no-existe', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(unknown.status).toBe(404)

    // flores needs 4 matches; seed only one
    state.products = [{ ...state.products[0]!, id: 'f1', slug: 'flor-1', name: 'Anillo flor', category: 'Anillos', description: 'flor', active: true, primaryImageApproved: true, stockQuantity: 3 }]
    const thin = await app.request('/anillos/flores', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(thin.status).toBe(404)
    expect(await thin.text()).toContain('noindex')
  })

  it('lists /anillos, published collections and /entregas-maracaibo in the sitemap', async () => {
    state.products = Array.from({ length: 4 }, (_, index) => ({
      ...state.products[0]!,
      id: `sello-${index}`,
      slug: `anillo-sello-${index}`,
      name: `Anillo sello ${index}`,
      category: 'Anillos' as const,
      description: 'anillo tipo sello',
      active: true,
      primaryImageApproved: true,
      stockQuantity: 4,
    }))
    const response = await app.request('/sitemap.xml', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    const xml = await response.text()
    expect(xml).toContain('/anillos')
    expect(xml).toContain('/anillos/sello')
    expect(xml).toContain('/entregas-maracaibo')
    expect(xml).not.toContain('/anillos/flores')
  })

  it('points product breadcrumbs at /anillos', async () => {
    const product = state.products.find((entry) => entry.category === 'Anillos') ?? state.products[0]!
    const response = await app.request(`/producto/${product.slug}`, {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    const html = await response.text()
    expect(html).toContain('"item":"https://coru.systems/anillos"')
    expect(html).toContain('<a href="/anillos">Anillos</a>')
  })

  it('serves /entregas-maracaibo with delivery copy and points', async () => {
    const response = await app.request('/entregas-maracaibo', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<title>Entregas en Maracaibo · CORU</title>')
    expect(html).toContain(YUMMY_DELIVERY_COPY)
    expect(html).toContain(NATIONAL_SHIPPING_COPY)
    expect(html).toContain('C.C. El Gran Ruby')
    expect(html).toContain('BreadcrumbList')
  })
})

describe('Fase 3 client surfaces', () => {
  it('renders delivery points and exact shipping copy', async () => {
    vi.stubGlobal('import.meta', { env: { DEV: true } })
    // DeliveryPage uses isVitePreview(); in tests it typically falls through to fetch.
    // Force preview path by mocking fetchPersonalDeliveryPoints via network stub:
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'p1', name: 'C.C. El Gran Ruby', address: 'Maracaibo', sortOrder: 1 },
        { id: 'p2', name: 'C.C. La Paragua', address: 'Maracaibo', sortOrder: 2 },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

    render(<DeliveryPage />)
    expect(await screen.findByRole('heading', { name: 'Entregas en Maracaibo' })).toBeInTheDocument()
    expect(await screen.findByText('C.C. El Gran Ruby')).toBeInTheDocument()
    expect(screen.getByText(YUMMY_DELIVERY_COPY)).toBeInTheDocument()
    expect(screen.getByText(NATIONAL_SHIPPING_COPY)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver la colección' })).toHaveAttribute('href', '/')

    globalThis.fetch = originalFetch
  })

  it('filters styles on the home storefront without leaving the page', async () => {
    const user = userEvent.setup()
    const rings = Array.from({ length: 4 }, (_, index) => ({
      ...demoProducts[0]!,
      id: `home-calavera-${index}`,
      slug: `home-calavera-${index}`,
      name: `Anillo calavera ${index}`,
      description: 'calavera plateada',
      category: 'Anillos',
    }))
    render(<CartProvider><StorePage products={[...demoProducts, ...rings]} onOrderCreated={() => undefined} /></CartProvider>)
    expect(screen.getByRole('heading', { name: /Arma tu combo/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Todos' }).every((button) => button.getAttribute('aria-pressed') === 'true')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Todos los anillos' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anillos de calavera' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'Anillos' }))
    expect(screen.getByRole('button', { name: 'Anillos' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { name: 'Todos' })[1]).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Anillos de calavera' }))
    expect(screen.getByRole('heading', { name: /Arma tu combo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anillos de calavera' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Anillos' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /Anillo calavera 0/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Órbita oscura/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Entregas en Maracaibo/ })).toHaveAttribute('href', '/entregas-maracaibo')
  })

  it('renders related products and alt text format on the product page', () => {
    const catalog = Array.from({ length: 5 }, (_, index) => ({
      ...demoProducts[0]!,
      id: `rel-${index}`,
      slug: `rel-calavera-${index}`,
      name: `Anillo calavera rel ${index}`,
      description: 'calavera',
      category: 'Anillos',
      material: 'Aleación de zinc',
      imageUrl: `/img/${index}.webp`,
    }))
    render(<CartProvider><ProductPage product={catalog[0]!} products={catalog} onOrderCreated={() => undefined} /></CartProvider>)
    expect(screen.getByRole('heading', { name: /Más anillos de calavera/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Anillos' })).toHaveAttribute('href', '/?estilo=anillos')
    expect(screen.getByRole('img', { name: productImageAlt(catalog[0]!.name, catalog[0]!.material) })).toBeInTheDocument()
  })
})

describe('productImageAlt', () => {
  it('formats name with lowercase material', () => {
    expect(productImageAlt('Anillo calavera alada', 'Aleación de zinc')).toBe('Anillo calavera alada, aleación de zinc')
    expect(productImageAlt('Anillo calavera alada', 'Aleación de zinc', 'Anillo plateado de aleación de zinc con calavera central, alas y detalles oscuros. Para combinar.')).toBe('Anillo plateado de aleación de zinc con calavera central, alas y detalles oscuros')
  })
})
