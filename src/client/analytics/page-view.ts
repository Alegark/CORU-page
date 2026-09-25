import type { AnalyticsEvent, Product } from '../../shared/types'
import type { Route } from '../app/router'

export type PageViewEvent = {
  name: AnalyticsEvent['name']
  properties?: Record<string, unknown>
}

export type PageViewTracker = (path: string, route: Route, product?: Product, catalogUnavailable?: boolean) => boolean

export function getPageViewEvent(route: Route, product?: Product, catalogUnavailable = false): PageViewEvent | null {
  if (route.kind === 'home' || route.kind === 'collection') return { name: 'catalog_view' }
  if (route.kind === 'delivery') return { name: 'catalog_view' }
  if (route.kind === 'product') {
    if (!product) return { name: catalogUnavailable ? 'product_view' : 'not_found_view' }
    return {
      name: 'product_view',
      properties: {
        productId: product.id,
        productName: product.name,
        category: product.category,
        unitPriceCents: product.priceCents,
        promoEligible: product.promoEligible,
        fulfillment_type: product.fulfillmentType ?? 'STOCK',
      },
    }
  }
  if (route.kind === 'size-guide') return { name: 'size_guide_view' }
  if (route.kind === 'privacy') return { name: 'privacy_view' }
  if (route.kind === 'not-found') return { name: 'not_found_view' }
  return null
}

export function createPageViewTracker(track: (name: AnalyticsEvent['name'], properties?: Record<string, unknown>) => void): PageViewTracker {
  let lastPath: string | null = null
  return (path, route, product, catalogUnavailable = false) => {
    if (path === lastPath) return false
    lastPath = path
    if (isExcludedPath(path)) return false
    const pageView = getPageViewEvent(route, product, catalogUnavailable)
    if (!pageView) return false
    track(pageView.name, pageView.properties)
    return true
  }
}

function isExcludedPath(path: string): boolean {
  const normalizedPath = path.replace(/\/+$/, '').toLowerCase() || '/'
  return normalizedPath === '/admin'
    || normalizedPath.startsWith('/admin/')
    || normalizedPath === '/api'
    || normalizedPath.startsWith('/api/')
}
