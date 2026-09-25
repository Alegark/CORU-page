import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/worker/app'
import { resetState, state } from '../src/worker/state'

const SHELL = `<!doctype html><html lang="es-VE"><head><meta charset="UTF-8" /><meta name="description" content="CORU" /><link rel="canonical" href="https://coru.systems/" /><title>CORU</title></head><body><div id="root"></div></body></html>`

function assetsStub(extra: Record<string, string> = {}) {
  return {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname
      if (path === '/' || path === '/index.html') {
        return new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
      if (extra[path]) {
        return new Response(extra[path], { status: 200, headers: { 'Content-Type': path.endsWith('.png') ? 'image/png' : 'text/plain' } })
      }
      if (path === '/robots.txt') {
        return new Response('User-agent: *\nAllow: /\n', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      }
      return new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    },
  }
}

describe('SEO worker routes', () => {
  beforeEach(() => resetState())

  it('injects home title, description, canonical, JSON-LD and fallback links', async () => {
    const response = await app.request('/', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=30, stale-while-revalidate=60')
    const html = await response.text()
    expect(html).toContain('<title>Anillos en Maracaibo · CORU</title>')
    expect(html).toContain('name="description"')
    expect(html).toContain('rel="canonical"')
    expect(html).toContain('application/ld+json')
    expect(html).toContain('OnlineStore')
    expect(html).toContain('href="/producto/orbita-oscura"')
    expect(html).toContain('Promo: 3 anillos por $10')
  })

  it('injects product metadata for a public slug', async () => {
    const product = state.products[0]!
    const response = await app.request(`/producto/${product.slug}`, {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain(`<title>${product.name} · CORU Maracaibo</title>`)
    expect(html).toContain(`"@type":"Product"`)
    expect(html).toContain(`<h1>${product.name}</h1>`)
    const canonicals = [...html.matchAll(/rel="canonical" href="([^"]+)"/g)].map((match) => match[1])
    expect(canonicals).toEqual([`https://coru.systems/producto/${encodeURIComponent(product.slug)}`])
    expect(html).toContain('href="/guia-de-tallas"')
  })

  it('returns 404 for unknown product slugs and invented routes', async () => {
    const missing = await app.request('/producto/slug-falso', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('noindex')

    const invented = await app.request('/ruta-inventada', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(invented.status).toBe(404)

    const malformed = await app.request('/producto/%E0%A4%A', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(malformed.status).toBe(404)
    expect(malformed.headers.get('content-type')).toContain('text/html')
  })

  it('serves sitemap.xml with only public products', async () => {
    state.products.find((product) => product.id === 'cadena-mini')!.active = false
    const response = await app.request('/sitemap.xml', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/xml')
    const xml = await response.text()
    expect(xml).toContain('https://coru.systems/')
    expect(xml).toContain('/guia-de-tallas')
    expect(xml).toContain('/privacidad')
    expect(xml).toContain('/producto/orbita-oscura')
    expect(xml).toContain('/entregas-maracaibo')
    expect(xml).toContain('/anillos')
    expect(xml).not.toContain('/producto/cadena-mini')
    expect(xml).not.toContain('/admin')
  })

  it('omits products from the sitemap when the store is inactive', async () => {
    state.settings.storeActive = false
    const response = await app.request('/sitemap.xml', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    const xml = await response.text()
    expect(xml).toContain('https://coru.systems/')
    expect(xml).not.toContain('/producto/')
  })

  it('adds X-Robots-Tag on /admin while keeping API health/catalog', async () => {
    const admin = await app.request('/admin', {}, { ENVIRONMENT: 'local', ASSETS: assetsStub() })
    expect(admin.status).toBe(200)
    expect(admin.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')

    expect((await app.request('/api/health')).status).toBe(200)
    expect((await app.request('/api/catalog')).status).toBe(200)
  })

  it('falls through static assets via ASSETS', async () => {
    const assets = assetsStub({ '/coru-ring-hero.png': 'PNGDATA' })
    const response = await app.request('/coru-ring-hero.png', {}, { ENVIRONMENT: 'local', ASSETS: assets })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('PNGDATA')
    expect(response.headers.get('content-type')).toContain('image/png')
  })
})
