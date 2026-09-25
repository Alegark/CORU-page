export type Route =
  | { kind: 'home' }
  | { kind: 'product'; slug: string }
  | { kind: 'collection'; slug?: string }
  | { kind: 'delivery' }
  | { kind: 'privacy' }
  | { kind: 'size-guide' }
  | { kind: 'admin'; section: string; orderId?: string }
  | { kind: 'not-found' }

export function resolveRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (path === '/') return { kind: 'home' }
  if (path === '/privacidad') return { kind: 'privacy' }
  if (path === '/guia-de-tallas') return { kind: 'size-guide' }
  if (path === '/entregas-maracaibo') return { kind: 'delivery' }
  if (path === '/anillos') return { kind: 'collection' }

  const collectionMatch = path.match(/^\/anillos\/([^/]+)$/)
  if (collectionMatch) {
    try {
      return { kind: 'collection', slug: decodeURIComponent(collectionMatch[1]) }
    } catch {
      return { kind: 'not-found' }
    }
  }

  const productMatch = path.match(/^\/producto\/([^/]+)$/)
  if (productMatch) {
    try {
      return { kind: 'product', slug: decodeURIComponent(productMatch[1]) }
    } catch {
      return { kind: 'not-found' }
    }
  }

  if (path === '/admin' || path === '/admin/') return { kind: 'admin', section: 'dashboard' }
  const adminMatch = path.match(/^\/admin\/([^/]+)(?:\/([^/]+))?$/)
  if (adminMatch) {
    const sectionMap: Record<string, string> = {
      productos: 'products',
      categorias: 'categories',
      promociones: 'promotions',
      pedidos: 'orders',
      entregas: 'delivery',
      analitica: 'analytics',
      ajustes: 'settings',
      resumen: 'dashboard',
    }
    const section = sectionMap[adminMatch[1]]
    if (section) return { kind: 'admin', section, orderId: adminMatch[2] }
  }

  return { kind: 'not-found' }
}
