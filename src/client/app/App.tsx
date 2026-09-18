import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { resolveRoute, type Route } from './router'
import { CartProvider } from '../features/cart/CartContext'
import { StorePage } from '../features/catalog/StorePage'
import { ProductPage } from '../features/catalog/ProductPage'
import { PrivacyPage } from '../features/catalog/PrivacyPage'
import { SizeGuidePage } from '../features/catalog/SizeGuidePage'
import type { AdminSection } from '../features/admin/AdminShell'
import { getProductBySlug } from '../../shared/catalog'
import { demoProducts } from '../../shared/catalog'
import { loadOrders, saveOrders } from '../../shared/storage'
import type { Order, Product } from '../../shared/types'
import type { PublicProduct, PublicPromotion } from '../../shared/contracts'
import { ApiClientError, fetchActivePromotion, fetchAdminOrder, fetchAdminOrders, fetchAdminProducts, fetchCatalog, fetchPublicCategories } from '../api/client'
import type { Category } from '../../shared/types'

const AdminShell = lazy(() => import('../features/admin/AdminShell').then(({ AdminShell: component }) => ({ default: component })))
const AdminPages = lazy(() => import('../features/admin/AdminPages').then(({ AdminPages: component }) => ({ default: component })))

const defaultPublicCategories: Category[] = [
  { id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true },
  { id: 'cat-accesorios', slug: 'accesorios', name: 'Accesorios', sortOrder: 2, active: true },
]

function isVitePreview(): boolean {
  const hostname = window.location.hostname
  const port = window.location.port
  return (hostname === 'localhost' || hostname === '127.0.0.1') && (port === '' || port === '4173' || port === '4174')
}

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
  const localPreview = isVitePreview()
  const [products, setProducts] = useState<Product[]>(() => localPreview ? demoProducts : [])
  const [orders, setOrders] = useState<Order[]>(() => localPreview ? loadOrders() : [])
  const [publicPromotion, setPublicPromotion] = useState<PublicPromotion | null | undefined>(() => localPreview ? undefined : null)
  const [publicCategories, setPublicCategories] = useState<Category[]>(defaultPublicCategories)
  const [catalogLoading, setCatalogLoading] = useState(() => !localPreview)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogAttempt, setCatalogAttempt] = useState(0)

  useEffect(() => {
    if (route.kind !== 'home' && route.kind !== 'product') return
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
    setCatalogLoading(true)
    setCatalogError(null)
    Promise.all([
      fetchCatalog(controller.signal),
      fetchActivePromotion(controller.signal).catch(() => null),
      fetchPublicCategories(controller.signal).catch(() => defaultPublicCategories),
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
  }, [catalogAttempt, localPreview, route.kind])

  useEffect(() => {
    if (route.kind !== 'admin') return
    const controller = new AbortController()
    fetchAdminProducts(controller.signal).then((remoteProducts) => setProducts(remoteProducts)).catch(() => undefined)
    fetchAdminOrders(controller.signal).then(async (summaries) => {
      const details = await Promise.all(summaries.map((summary) => fetchAdminOrder(summary.id, controller.signal)))
      if (!controller.signal.aborted) {
        setOrders(details)
        saveOrders(details)
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [route.kind])
  const product = route.kind === 'product' ? getProductBySlug(products, route.slug) : undefined
  const adminSection = route.kind === 'admin' ? route.section as AdminSection : 'dashboard'

  function handleOrderCreated(order: Order) {
    setOrders((current) => {
      const next = current.some((item) => item.id === order.id) ? current : [...current, order]
      saveOrders(next)
      return next
    })
  }

  const content = useMemo(() => {
    if (route.kind === 'home') return <StorePage products={products} categories={publicCategories} promotion={publicPromotion} catalogLoading={catalogLoading} catalogError={catalogError} onRetry={() => setCatalogAttempt((attempt) => attempt + 1)} onOrderCreated={handleOrderCreated} />
    if (route.kind === 'product') {
      if (catalogLoading) return <CatalogLoading />
      if (catalogError) return <CatalogError message={catalogError} onRetry={() => setCatalogAttempt((attempt) => attempt + 1)} />
      return product ? <ProductPage product={product} products={products} promotion={publicPromotion} onOrderCreated={handleOrderCreated} /> : <NotFound />
    }
    if (route.kind === 'privacy') return <PrivacyPage />
    if (route.kind === 'size-guide') return <SizeGuidePage />
    if (route.kind === 'admin') return <Suspense fallback={<AdminLoading />}><AdminShell section={adminSection} pendingOrders={orders.filter((order) => order.status === 'PENDING').length}><AdminPages section={adminSection} orderId={route.orderId} products={products} setProducts={setProducts} orders={orders} setOrders={setOrders} /></AdminShell></Suspense>
    return <NotFound />
  }, [adminSection, catalogError, catalogLoading, orders, product, products, publicPromotion, route])

  return <CartProvider products={products} promotion={publicPromotion} catalogReady={route.kind !== 'home' && route.kind !== 'product' || (!catalogLoading && !catalogError)}>{content}</CartProvider>
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
