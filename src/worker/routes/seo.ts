import { Hono } from 'hono'
import type { Context } from 'hono'
import { resolveRoute } from '../../shared/routes'
import {
  absoluteUrl,
  allRingProducts,
  buildFallbackHtml,
  buildSeoMeta,
  buildSitemapXml,
  collectionPath,
  getCollectionDefinition,
  injectSeoIntoHtml,
  isCollectionPublished,
  productsForCollection,
  publishedCollections,
  type SeoPageInput,
} from '../../shared/seo'
import type { CoruEnv } from '../env'
import { ensureStateHydrated } from '../persistence'
import { state } from '../state'
import {
  activePromotionForRequest,
  publicProductForSlug,
  publicProducts,
  refreshCatalogForRequest,
  toPublicProduct,
} from './public'

const HTML_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=60'
const HTML_SHELL_CACHE = 'public, max-age=0, must-revalidate'
const STATIC_EXT_RE = /\.(?:txt|png|jpe?g|gif|webp|svg|ico|webmanifest|css|js|map|woff2?|json)$/i

function looksLikeStaticAsset(path: string): boolean {
  if (path === '/robots.txt' || path === '/site.webmanifest' || path === '/favicon.ico') return true
  return STATIC_EXT_RE.test(path)
}

async function loadSpaShell(c: Context<CoruEnv>): Promise<string | null> {
  if (!c.env?.ASSETS) return null
  // Build a clean Request: copying c.req.raw can pass a jsdom AbortSignal that
  // undici rejects in Vitest, while Workers accept the Worker Request fine.
  const shell = await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url).toString(), { method: 'GET' }))
  if (!shell.ok) return null
  return shell.text()
}

async function hydrateForSeo(c: Context<CoruEnv>): Promise<boolean> {
  try {
    const database = await ensureStateHydrated(state, c.env ?? {})
    if (database) c.set('database', database)
    await refreshCatalogForRequest(c)
    return true
  } catch (error) {
    console.error('CORU SEO persistence bootstrap failed', error)
    return false
  }
}

function catalogProducts(hydrated: boolean) {
  return hydrated && state.settings.storeActive ? publicProducts().map((product) => toPublicProduct(product)) : []
}

function activeDeliveryPoints() {
  return state.settings.storeActive
    ? state.deliveryPoints.filter((point) => point.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(({ name, address }) => ({ name, address }))
    : []
}

function seoInputForRequest(path: string, hydrated: boolean): SeoPageInput {
  const route = resolveRoute(path)
  const products = catalogProducts(hydrated)
  const others = publishedCollections(products).map(({ slug, h1 }) => ({ slug, h1 }))

  if (route.kind === 'home') {
    return { kind: 'home', path: '/', products, promotion: null, otherCollections: others }
  }
  if (route.kind === 'product') {
    const raw = hydrated ? publicProductForSlug(route.slug) : undefined
    return {
      kind: 'product',
      path: `/producto/${encodeURIComponent(route.slug)}`,
      product: raw ? toPublicProduct(raw) : null,
      products,
    }
  }
  if (route.kind === 'collection') {
    if (route.slug) {
      const definition = getCollectionDefinition(route.slug)
      if (!definition) return { kind: 'not-found', path }
      const matched = productsForCollection(products, definition)
      const published = isCollectionPublished(matched.length)
      return {
        kind: 'collection',
        path: collectionPath(route.slug),
        collectionSlug: route.slug,
        collectionPublished: published,
        collectionProducts: matched,
        otherCollections: others,
      }
    }
    const rings = allRingProducts(products)
    return {
      kind: 'collection',
      path: '/anillos',
      collectionProducts: rings,
      collectionPublished: isCollectionPublished(rings.length, true),
      otherCollections: others,
    }
  }
  if (route.kind === 'delivery') {
    return { kind: 'delivery', path: '/entregas-maracaibo', deliveryPoints: activeDeliveryPoints() }
  }
  if (route.kind === 'size-guide') return { kind: 'size-guide', path: '/guia-de-tallas' }
  if (route.kind === 'privacy') return { kind: 'privacy', path: '/privacidad' }
  if (route.kind === 'admin') return { kind: 'admin', path }
  return { kind: 'not-found', path }
}

async function proxyAssets(c: Context<CoruEnv>, extras?: Record<string, string>): Promise<Response> {
  if (!c.env?.ASSETS) return c.json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }, 404)
  const asset = await c.env.ASSETS.fetch(c.req.raw)
  const headers = new Headers(asset.headers)
  if (extras) for (const [key, value] of Object.entries(extras)) headers.set(key, value)
  return new Response(asset.body, { status: asset.status, headers })
}

async function serveInjectedHtml(c: Context<CoruEnv>, input: SeoPageInput): Promise<Response> {
  const shell = await loadSpaShell(c)
  if (!shell) return proxyAssets(c)

  let pageInput = input
  if (pageInput.kind === 'home') {
    try {
      const promotion = await activePromotionForRequest(c)
      pageInput = { ...pageInput, promotion: promotion ?? null }
    } catch {
      // keep promotion null
    }
  }

  const meta = buildSeoMeta(pageInput)
  const fallback = buildFallbackHtml(pageInput)
  const html = injectSeoIntoHtml(shell, meta, fallback)
  return new Response(c.req.method === 'HEAD' ? null : html, {
    status: meta.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': HTML_CACHE,
    },
  })
}

export const seoRoutes = new Hono<CoruEnv>()

seoRoutes.on(['GET', 'HEAD'], '/sitemap.xml', async (c) => {
  const hydrated = await hydrateForSeo(c)
  const entries = [
    { loc: absoluteUrl('/') },
    { loc: absoluteUrl('/guia-de-tallas') },
    { loc: absoluteUrl('/privacidad') },
    { loc: absoluteUrl('/entregas-maracaibo') },
  ]
  if (hydrated && state.settings.storeActive) {
    const products = catalogProducts(true)
    const rings = allRingProducts(products)
    if (isCollectionPublished(rings.length, true)) entries.push({ loc: absoluteUrl('/anillos') })
    for (const collection of publishedCollections(products)) {
      entries.push({ loc: absoluteUrl(collectionPath(collection.slug)) })
    }
    for (const product of products) {
      entries.push({ loc: absoluteUrl(`/producto/${encodeURIComponent(product.slug)}`) })
    }
  }
  const xml = buildSitemapXml(entries)
  return new Response(c.req.method === 'HEAD' ? null : xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': HTML_CACHE,
    },
  })
})

/** Public HTML + admin asset pass-through. Mounted after /api and /media routes. */
seoRoutes.on(['GET', 'HEAD'], '*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (path.startsWith('/api/') || path.startsWith('/media/')) return next()
  if (path === '/sitemap.xml') return next()

  if (path === '/admin' || path.startsWith('/admin/')) {
    return proxyAssets(c, { 'X-Robots-Tag': 'noindex, nofollow' })
  }

  if (looksLikeStaticAsset(path)) return next()

  const hydrated = await hydrateForSeo(c)
  // Fail open: serve untouched shell when persistence is down.
  if (!hydrated) {
    const shell = await loadSpaShell(c)
    if (shell) {
      return new Response(c.req.method === 'HEAD' ? null : shell, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': HTML_SHELL_CACHE },
      })
    }
    return proxyAssets(c)
  }

  const input = seoInputForRequest(path, hydrated)
  if (input.kind === 'admin') return proxyAssets(c, { 'X-Robots-Tag': 'noindex, nofollow' })
  return serveInjectedHtml(c, input)
})
