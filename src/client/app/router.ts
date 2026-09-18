export type Route =
  | { kind: 'home' }
  | { kind: 'product'; slug: string }
  | { kind: 'privacy' }
  | { kind: 'size-guide' }
  | { kind: 'admin'; section: string; orderId?: string }
  | { kind: 'not-found' }

export function resolveRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (path === '/') return { kind: 'home' }
  if (path === '/privacidad') return { kind: 'privacy' }
  if (path === '/guia-de-tallas') return { kind: 'size-guide' }

  const productMatch = path.match(/^\/producto\/([^/]+)$/)
  if (productMatch) return { kind: 'product', slug: decodeURIComponent(productMatch[1]) }

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

export function navigate(path: string): void {
  if (window.location.pathname === path) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
