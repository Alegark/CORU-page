import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Brand } from '../../components/brand/Brand'
import { Icon, icons } from '../../components/ui/Icon'
import { navigate } from '../../app/router'

export type AdminSection = 'dashboard' | 'products' | 'categories' | 'promotions' | 'orders' | 'analytics' | 'delivery' | 'settings'

function caracasDateLabel(date = new Date()): string {
  const value = new Intl.DateTimeFormat('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Caracas' }).format(date)
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const navItems: Array<{ id: AdminSection; label: string; icon: typeof icons[keyof typeof icons] }> = [
  { id: 'dashboard', label: 'Resumen', icon: icons.chart },
  { id: 'products', label: 'Productos', icon: icons.box },
  { id: 'categories', label: 'Categorías', icon: icons.layers },
  { id: 'promotions', label: 'Promociones', icon: icons.tag },
  { id: 'orders', label: 'Pedidos', icon: icons.orders },
  { id: 'delivery', label: 'Entregas', icon: icons.location },
  { id: 'analytics', label: 'Analítica', icon: icons.chart },
  { id: 'settings', label: 'Ajustes', icon: icons.gear },
]

function sectionPath(section: AdminSection): string {
  return section === 'dashboard'
    ? '/admin'
    : `/admin/${section === 'products' ? 'productos' : section === 'categories' ? 'categorias' : section === 'promotions' ? 'promociones' : section === 'orders' ? 'pedidos' : section === 'delivery' ? 'entregas' : section === 'analytics' ? 'analitica' : 'ajustes'}`
}

export function AdminShell({ section, children, pendingOrders = 0 }: { section: AdminSection; children: ReactNode; pendingOrders?: number }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!drawerOpen) return
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      const target = previouslyFocused.current ?? menuButton.current
      target?.focus()
      previouslyFocused.current = null
    }
  }, [drawerOpen])

  return <div className="admin-shell app-shell"><aside className={`admin-sidebar${drawerOpen ? ' is-open' : ''}`}><div className="admin-brand"><Brand compact /><span>ADMIN</span><button ref={closeButton} className="icon-button admin-close" type="button" onClick={() => setDrawerOpen(false)} aria-label="Cerrar navegación"><Icon icon={icons.xmark} /></button></div><nav aria-label="Navegación administrativa">{navItems.map((item) => <button key={item.id} type="button" className={section === item.id ? 'is-active' : ''} onClick={() => { setDrawerOpen(false); navigate(sectionPath(item.id)) }}><Icon icon={item.icon} /><span>{item.label}</span>{item.id === 'orders' && pendingOrders > 0 && <em>{pendingOrders}</em>}</button>)}</nav><div className="admin-sidebar-footer"><span className="status-dot" /> <span>Catálogo activo</span></div></aside><div className="admin-content"><header className="admin-topbar"><button ref={menuButton} className="icon-button admin-menu" type="button" onClick={() => setDrawerOpen(true)} aria-label="Abrir navegación"><Icon icon={icons.bars} /></button><div><span className="eyebrow">Operación CORU</span><p>{caracasDateLabel()}</p></div><div className="admin-topbar-actions"><button className="admin-view-store" type="button" onClick={() => navigate('/')}>Ver tienda <Icon icon={icons.arrowRight} /></button><a className="admin-logout" href="/cdn-cgi/access/logout" aria-label="Cerrar sesión" title="Cerrar sesión"><Icon icon={icons.logout} /><span>Cerrar sesión</span></a></div></header><main id="main-content" className="admin-main">{children}</main></div>{drawerOpen && <button className="admin-scrim" type="button" onClick={() => setDrawerOpen(false)} aria-label="Cerrar navegación" />}</div>
}
