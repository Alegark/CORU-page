import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon, icons } from '../../components/ui/Icon'
import { StoreHeader } from '../../components/store/StoreHeader'
import { PromoBanner } from '../../components/store/PromoBanner'
import { ProductCard } from '../../components/store/ProductCard'
import { CartOverlay } from '../../components/store/CartOverlay'
import { FloatingCart } from '../../components/store/FloatingCart'
import { PrivacyNotice } from '../../components/store/PrivacyNotice'
import { navigate } from '../../app/router'
import { getPublicProducts } from '../../../shared/catalog'
import type { Category, Order, Product } from '../../../shared/types'
import type { PromotionRule } from '../../../shared/commerce'
import { useCart } from '../cart/CartContext'
import { analytics } from '../../analytics/client'

const fallbackCategories: Category[] = [{ id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true }, { id: 'cat-accesorios', slug: 'accesorios', name: 'Accesorios', sortOrder: 2, active: true }]

export function StorePage({ products, categories = fallbackCategories, promotion, catalogLoading = false, catalogError, onRetry, onOrderCreated }: { products: Product[]; categories?: Category[]; promotion?: PromotionRule | null; catalogLoading?: boolean; catalogError?: string | null; onRetry?: () => void; onOrderCreated: (order: Order) => void }) {
  const { lines, currency, setCurrency, add, itemCount, rateMicros, rateAvailable, rateLoading } = useCart()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Todos')
  const [cartOpen, setCartOpen] = useState(false)
  const [introShown, setIntroShown] = useState(false)
  const filterRowRef = useRef<HTMLDivElement>(null)
  const filterPillInitialized = useRef(false)
  const pageViewTracked = useRef(false)
  const publicProducts = useMemo(() => getPublicProducts(products), [products])
  const visibleCategories = useMemo(() => {
    const availableCategoryNames = new Set(publicProducts.map((product) => product.category))
    return categories
      .filter((entry) => entry.active && availableCategoryNames.has(entry.name))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }, [categories, publicProducts])
  const categoryFilters = useMemo(() => ['Todos', ...visibleCategories.map((entry) => entry.name)], [visibleCategories])
  const filtered = useMemo(() => publicProducts.filter((product) => {
    const matchesCategory = category === 'Todos' || product.category === category
    return matchesCategory && product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())
  }), [category, publicProducts, search])
  const eligibleCount = useMemo(() => lines.reduce((sum, line) => {
    const product = products.find((item) => item.id === line.productId)
    const eligible = product?.promoEligible && (promotion === undefined || !promotion?.targetCategory || product.category === promotion.targetCategory)
    return sum + (eligible ? line.quantity : 0)
  }, 0), [lines, products, promotion])

  useEffect(() => {
    if (catalogLoading || pageViewTracked.current) return
    pageViewTracked.current = true
    analytics.track('catalog_view', { productCount: publicProducts.length })
  }, [catalogLoading, publicProducts.length])

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroShown(true), 24)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (category !== 'Todos' && !categoryFilters.includes(category)) setCategory('Todos')
  }, [category, categoryFilters])

  useLayoutEffect(() => {
    const row = filterRowRef.current
    const pill = row?.querySelector<HTMLElement>('.t-tabs-pill')
    if (!row || !pill) return

    const active = () => row.querySelector<HTMLButtonElement>('.filter-chip.is-selected')
    const moveTo = (tab: HTMLButtonElement, animate: boolean) => {
      if (!animate) {
        const previousTransition = pill.style.transition
        pill.style.transition = 'none'
        pill.style.transform = `translateX(${tab.offsetLeft}px)`
        pill.style.width = `${tab.offsetWidth}px`
        void pill.offsetWidth
        pill.style.transition = previousTransition
        return
      }
      pill.style.transform = `translateX(${tab.offsetLeft}px)`
      pill.style.width = `${tab.offsetWidth}px`
    }

    const selected = active()
    if (!selected) return
    moveTo(selected, filterPillInitialized.current)
    filterPillInitialized.current = true

    const handleResize = () => {
      const current = active()
      if (!current) return
      moveTo(current, false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [category, categoryFilters])

  function addProduct(product: Product) {
    add(product)
  }

  return (
    <div className="store-page app-shell">
      <StoreHeader currency={currency} onCurrencyChange={setCurrency} rateAvailable={rateAvailable} rateLoading={rateLoading} />
      <main id="main-content">
        <div className="page-container store-main">
          <section className="store-intro" id="novedades">
            <div className={`store-intro-copy t-stagger${introShown ? ' is-shown' : ''}`}>
              <h1 className="display-heading t-stagger-line t-stagger-line--1">Arma tu <span>combo</span></h1>
              <p className="t-stagger-line t-stagger-line--2">Anillos y accesorios para combinar</p>
            </div>
          </section>
          <PromoBanner progress={eligibleCount} promotion={promotion} currency={currency} rateMicros={rateMicros} onAction={() => { document.getElementById('anillos')?.scrollIntoView({ behavior: 'smooth' }) }} />
          <section className="catalog-section" id="anillos" aria-label="Catálogo de piezas">
            <div className="catalog-toolbar">
              <div className="search-field"><Icon icon={icons.search} /><label className="sr-only" htmlFor="product-search">Buscar piezas</label><input id="product-search" className="input" type="search" placeholder="Buscar anillos o accesorios…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
              <div ref={filterRowRef} className="filter-row t-tabs" role="group" aria-label="Filtrar por categoría">
                <span className="t-tabs-pill" aria-hidden="true" />
                {categoryFilters.map((item) => <button key={item} type="button" className={`filter-chip t-tab${category === item ? ' is-selected' : ''}`} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
              </div>
            </div>
            {catalogLoading ? <div className="empty-state surface-card catalog-state" role="status" aria-live="polite" aria-busy="true"><div className="empty-icon" aria-hidden="true"><span className="catalog-spinner" /></div><h3>Cargando colección</h3><p>Estamos preparando las piezas disponibles.</p></div> : catalogError ? <div className="empty-state surface-card catalog-state" role="alert"><div className="empty-icon" aria-hidden="true">!</div><h3>No pudimos cargar la colección</h3><p>{catalogError}</p>{onRetry && <button className="button button-primary" type="button" onClick={onRetry}>Reintentar</button>}</div> : !publicProducts.length ? <div className="empty-state surface-card catalog-state"><div className="empty-icon"><Icon icon={icons.box} /></div><h3>La colección se está preparando</h3><p>Pronto habrá piezas disponibles. Vuelve a visitarnos.</p></div> : filtered.length === 0 ? <div className="empty-state surface-card"><div className="empty-icon"><Icon icon={icons.search} /></div><h3>No encontramos esa pieza</h3><p>Prueba otra búsqueda o vuelve a ver toda la colección.</p><button className="button button-secondary" type="button" onClick={() => { setSearch(''); setCategory('Todos') }}>Ver todo</button></div> : <div className="product-grid">{filtered.map((product) => <ProductCard key={product.id} product={product} promotion={promotion} currency={currency} rateMicros={rateMicros} onAdd={() => addProduct(product)} />)}</div>}
          </section>
          <section className="about-strip" id="accesorios">
            <div className="about-strip-intro"><span className="eyebrow">Hecho para rotar</span><h2>Una colección chica.<br />Muchas formas de usarla.</h2></div>
            <div className="about-links" aria-label="Información útil">
              <button className="about-link about-link-featured" type="button" onClick={() => navigate('/guia-de-tallas')}>
                <span className="about-link-copy"><span className="about-link-label">Antes de pedir</span><strong>Guía de tallas</strong><small>Aprende a medir tu talla.</small></span>
                <Icon icon={icons.arrowRight} />
              </button>
              <button className="about-link about-link-secondary" type="button" onClick={() => navigate('/privacidad')}>
                <span className="about-link-copy"><span className="about-link-label">Transparencia</span><strong>Cómo cuidamos tus datos</strong><small>Privacidad y uso de la información.</small></span>
                <Icon icon={icons.arrowRight} />
              </button>
            </div>
          </section>
        </div>
      </main>
      <FloatingCart itemCount={itemCount} open={cartOpen} onCart={() => setCartOpen(true)} />
      <CartOverlay products={products} open={cartOpen} onClose={() => setCartOpen(false)} onOrderCreated={onOrderCreated} rateMicros={rateMicros} rateAvailable={rateAvailable} />
      <PrivacyNotice />
    </div>
  )
}
