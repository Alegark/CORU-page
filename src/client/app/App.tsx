import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { resolveRoute, type Route } from './router'
import { CartProvider } from '../features/cart/CartContext'
import { StorePage } from '../features/catalog/StorePage'
import { ProductPage } from '../features/catalog/ProductPage'
import { PrivacyPage } from '../features/catalog/PrivacyPage'
import { SizeGuidePage } from '../features/catalog/SizeGuidePage'
import { DeliveryPage } from '../features/catalog/DeliveryPage'
import type { AdminSection } from '../features/admin/AdminShell'
import { getProductBySlug, getPublicProducts } from '../../shared/catalog'
import { demoProducts } from '../../shared/catalog'
import { ALL_RINGS_COLLECTION, allRingProducts, getCollectionDefinition, isCollectionPublished, productsForCollection } from '../../shared/collections'
import { loadOrders, saveOrders } from '../../shared/storage'
import { isVitePreview } from '../../shared/vite-preview'
import { applyDocumentSeo, buildSeoMeta, publishedCollections } from '../../shared/seo'
import { analytics } from '../analytics/client'
import { createPageViewTracker } from '../analytics/page-view'
import type { Order, Product } from '../../shared/types'
import type { PublicProduct, PublicPromotion } from '../../shared/contracts'
import { ApiClientError, fetchActivePromotion, fetchCatalog, fetchPublicCategories } from '../api/public'
import type { Category } from '../../shared/types'

const AdminShell = lazy(async () => {
  await import('../design/admin.css')
  const { AdminShell: component } = await import('../features/admin/AdminShell')
  return { default: component }
})
const AdminPages = lazy(() => import('../features/admin/AdminPages').then(({ AdminPages: component }) => ({ default: component })))

const defaultPublicCategories: Category[] = [
  { id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true },
  { id: 'cat-accesorios', slug: 'accesorios', name: 'Accesorios', sortOrder: 2, active: true },
]

function catalogErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'NETWORK_ERROR') return 'No pudimos cargar la colección. Comprueba tu conexión e inténtalo de nuevo.'
  return 'No pudimos cargar la colección. Inténtalo de nuevo.'
}

/**
 * Public catalog intentionally omits exact stock and internal flags. The
 * storefront still needs a local availability value for its quantity
 * controls; the Worker remains authoritative when the order is created.
 */
function toClientProduct(product: PublicProduct, promotion: PublicPromotion | null): Product {
  return { ...product, stockQuantity: 100, active: true, primaryImageApproved: true, promoEligible: product.promotionEligible ?? Boolean(promotion && (!promotion.targetCategory || product.category === promotion.targetCategory)) }
}

function isPublicCatalogRoute(route: Route): boolean {
  return route.kind === 'home' || route.kind === 'product' || route.kind === 'collection'
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => resolveRoute(window.location.pathname))
  useEffect(() => {
    const onPopState = () => setRoute(resolveRoute(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  return route
}

export function App() {
  const route = useRoute()
  const pageViewTracker = useRef<ReturnType<typeof createPageViewTracker> | null>(null)
  pageViewTracker.current ??= createPageViewTracker((name, properties) => analytics.track(name, properties))
  const previousRouteKind = useRef(route.kind)
  const enteredPublicFromAdmin = previousRouteKind.current === 'admin' && isPublicCatalogRoute(route)
  const localPreview = isVitePreview()
  const [products, setProducts] = useState<Product[]>(() => localPreview ? demoProducts : [])
  const [orders, setOrders] = useState<Order[]>(() => localPreview ? loadOrders() : [])
  const [publicPromotion, setPublicPromotion] = useState<PublicPromotion | null | undefined>(() => localPreview ? undefined : null)
  const [publicCategories, setPublicCategories] = useState<Category[]>(defaultPublicCategories)
  const [catalogLoading, setCatalogLoading] = useState(() => !localPreview)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const product = route.kind === 'product' ? getProductBySlug(products, route.slug) : undefined
  const adminSection = route.kind === 'admin' ? route.section as AdminSection : 'dashboard'
  const publicCatalog = useMemo(() => getPublicProducts(products), [products])

  const collectionView = useMemo(() => {
    if (route.kind !== 'collection') return null
    if (route.slug) {
      const definition = getCollectionDefinition(route.slug)
      if (!definition) return { missing: true as const }
      const matched = productsForCollection(publicCatalog, definition)
      if (!isCollectionPublished(matched.length)) return { missing: true as const }
      return { missing: false as const, view: { slug: definition.slug, h1: definition.h1, intro: definition.intro, products: matched } }
    }
    const rings = allRingProducts(publicCatalog)
    if (!isCollectionPublished(rings.length, true)) return { missing: true as const }
    return { missing: false as const, view: { h1: ALL_RINGS_COLLECTION.h1, intro: ALL_RINGS_COLLECTION.intro, products: rings } }
  }, [publicCatalog, route])

  useEffect(() => {
    previousRouteKind.current = route.kind
  }, [route.kind])

  useEffect(() => {
    if (route.kind === 'admin') return
    const path = window.location.pathname
    const others = publishedCollections(publicCatalog).map(({ slug, h1 }) => ({ slug, h1 }))
    if (route.kind === 'home') {
      applyDocumentSeo(buildSeoMeta({ kind: 'home', path: '/', promotion: publicPromotion ?? null, products: publicCatalog, otherCollections: others }))
      return
    }
    if (route.kind === 'product') {
      if (catalogLoading) return
      applyDocumentSeo(buildSeoMeta({ kind: 'product', path, product: product ?? null }))
      return
    }
    if (route.kind === 'collection') {
      if (catalogLoading) return
      if (!collectionView || collectionView.missing) {
        applyDocumentSeo(buildSeoMeta({ kind: 'not-found', path }))
        return
      }
      applyDocumentSeo(buildSeoMeta({
        kind: 'collection',
        path,
        collectionSlug: collectionView.view.slug,
        collectionPublished: true,
        collectionProducts: collectionView.view.products,
        otherCollections: others,
      }))
      return
    }
    if (route.kind === 'delivery') {
      applyDocumentSeo(buildSeoMeta({ kind: 'delivery', path: '/entregas-maracaibo' }))
      return
    }
    if (route.kind === 'size-guide') {
      applyDocumentSeo(buildSeoMeta({ kind: 'size-guide', path: '/guia-de-tallas' }))
      return
    }
    if (route.kind === 'privacy') {
      applyDocumentSeo(buildSeoMeta({ kind: 'privacy', path: '/privacidad' }))
      return
    }
    applyDocumentSeo(buildSeoMeta({ kind: 'not-found', path }))
  }, [catalogLoading, collectionView, product, publicCatalog, publicPromotion, route])

  useEffect(() => {
    if ((route.kind === 'product' || route.kind === 'collection') && catalogLoading) return
    pageViewTracker.current?.(window.location.pathname, route, route.kind === 'product' ? product : undefined, Boolean(catalogError))
  }, [catalogError, catalogLoading, product, route])

  useEffect(() => {
    if (!isPublicCatalogRoute(route)) return
    if (localPreview) {
      // Keep products created through the local Admin fallback while the SPA
      // navigates between sections. A full reload still starts from the demo
      // catalog; a configured Worker persists the authoritative catalog.
      setPublicPromotion(undefined)
      setPublicCategories(defaultPublicCategories)
      setCatalogLoading(false)
      setCatalogError(null)
      return
    }
    const controller = new AbortController()
    const freshKey = enteredPublicFromAdmin ? String(Date.now()) : undefined
    setCatalogLoading(true)
    setCatalogError(null)
    Promise.all([
      fetchCatalog(controller.signal, freshKey),
      fetchActivePromotion(controller.signal, freshKey).catch(() => null),
      fetchPublicCategories(controller.signal, freshKey).catch(() => defaultPublicCategories),
    ]).then(([remoteProducts, promotion, categories]) => {
      if (controller.signal.aborted) return
      setProducts(remoteProducts.map((product) => toClientProduct(product, promotion)))
      setPublicPromotion(promotion)
      setPublicCategories(categories.length ? categories.map((category) => ({ ...category, active: true })) : defaultPublicCategories)
    }).catch((error) => {
      if (controller.signal.aborted) return
      setProducts([])
      setPublicPromotion(null)
      setCatalogError(catalogErrorMessage(error))
    }).finally(() => {
      if (!controller.signal.aborted) setCatalogLoading(false)
    })
    return () => controller.abort()
  }, [catalogAttempt, localPreview, route.kind === 'admin' || !isPublicCatalogRoute(route)])

  useEffect(() => {
    if (route.kind !== 'admin') return
    const controller = new AbortController()
    void import('../api/admin').then(({ fetchAdminOrder, fetchAdminOrders, fetchAdminProducts }) => {
      if (controller.signal.aborted) return
      void fetchAdminProducts(controller.signal).then((remoteProducts) => {
        if (!controller.signal.aborted) setProducts(remoteProducts)
      }).catch(() => undefined)
      void fetchAdminOrders(controller.signal).then(async (summaries) => {
        const details = await Promise.all(summaries.map((summary) => fetchAdminOrder(summary.id, controller.signal)))
        if (!controller.signal.aborted) {
          setOrders(details)
          if (localPreview) saveOrders(details)
        }
      }).catch(() => undefined)
    }).catch(() => undefined)
    return () => controller.abort()
  }, [route.kind])

  function handleOrderCreated(order: Order) {
    setOrders((current) => {
      const next = current.some((item) => item.id === order.id) ? current : [...current, order]
      if (localPreview) saveOrders(next)
      return next
    })
  }

  const content = useMemo(() => {
    if (route.kind === 'home' || route.kind === 'collection') return <StorePage products={products} categories={publicCategories} promotion={publicPromotion} catalogLoading={catalogLoading} catalogError={catalogError} onRetry={() => setCatalogAttempt((attempt) => attempt + 1)} onOrderCreated={handleOrderCreated} />
    if (route.kind === 'product') {
      if (catalogLoading) return <CatalogLoading />
      if (catalogError) return <CatalogError message={catalogError} onRetry={() => setCatalogAttempt((attempt) => attempt + 1)} />
      return product ? <ProductPage product={product} products={products} promotion={publicPromotion} onOrderCreated={handleOrderCreated} /> : <NotFound />
    }
    if (route.kind === 'delivery') return <DeliveryPage />
    if (route.kind === 'privacy') return <PrivacyPage />
    if (route.kind === 'size-guide') return <SizeGuidePage />
    if (route.kind === 'admin') return <Suspense fallback={<AdminLoading />}><AdminShell section={adminSection} pendingOrders={orders.filter((order) => order.status === 'PENDING').length}><AdminPages section={adminSection} orderId={route.orderId} products={products} setProducts={setProducts} orders={orders} setOrders={setOrders} /></AdminShell></Suspense>
    return <NotFound />
  }, [adminSection, catalogError, catalogLoading, collectionView, orders, product, products, publicCategories, publicPromotion, route])

  return <CartProvider products={products} promotion={publicPromotion} catalogReady={isPublicCatalogRoute(route) && !catalogLoading && !catalogError}>{content}</CartProvider>
}

function CatalogLoading() {
  return <div className="empty-state surface-card catalog-state" role="status" aria-live="polite" aria-busy="true"><div className="empty-icon" aria-hidden="true"><span className="catalog-spinner" /></div><h1>Cargando colección</h1><p>Estamos preparando las piezas disponibles.</p></div>
}

function CatalogError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="empty-state surface-card catalog-state" role="alert"><div className="empty-icon" aria-hidden="true">!</div><h1>No pudimos cargar la colección</h1><p>{message}</p><button className="button button-primary" type="button" onClick={onRetry}>Reintentar</button></div>
}

function AdminLoading() {
  return <div className="empty-state surface-card catalog-state" role="status" aria-live="polite" aria-busy="true"><div className="empty-icon" aria-hidden="true"><span className="catalog-spinner" /></div><h1>Cargando operación</h1><p>Estamos preparando el panel administrativo.</p></div>
}

function NotFound() {
  return <div className="not-found app-shell"><main id="main-content" className="not-found-inner"><img src="/brand/coru-mascot.svg" alt="" aria-hidden="true" /><span className="eyebrow">404 · Página no encontrada</span><h1 className="display-heading">Esta pieza se fue<br />a otra colección.</h1><p>Vuelve al inicio para seguir explorando.</p><a className="button button-secondary" href="/">Ir a la tienda</a></main></div>
}
