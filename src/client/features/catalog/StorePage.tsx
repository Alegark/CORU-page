import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon, icons } from '../../components/ui/Icon'
import { StoreHeader } from '../../components/store/StoreHeader'
import { PromoBanner } from '../../components/store/PromoBanner'
import { ProductCard } from '../../components/store/ProductCard'
import { CartOverlay } from '../../components/store/CartOverlay'
import { FloatingCart } from '../../components/store/FloatingCart'
import { PrivacyNotice } from '../../components/store/PrivacyNotice'
import { CartToastHost, announceCartAdded, announceCartOpened } from '../../components/store/CartFeedback'
import { Link } from '../../components/ui/Link'
import { getPublicProducts } from '../../../shared/catalog'
import { getCollectionDefinition, isCollectionPublished, normalizeCollectionText, productsForCollection, publishedCollections } from '../../../shared/collections'
import { BRAND_FACEBOOK_URL, BRAND_INSTAGRAM_URL } from '../../../shared/seo'
import type { Category, Order, Product } from '../../../shared/types'
import { isEligibleBundleProduct, type PromotionRule } from '../../../shared/commerce'
import { useCart } from '../cart/CartContext'

const fallbackCategories: Category[] = [{ id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true }, { id: 'cat-accesorios', slug: 'accesorios', name: 'Accesorios', sortOrder: 2, active: true }]
const INITIAL_VISIBLE_PRODUCTS = 12
const LOAD_MORE_STEP = 12

function StyleExplore({ children }: { children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [canScrollBack, setCanScrollBack] = useState(false)
  const [canScrollForward, setCanScrollForward] = useState(false)

  const updateArrows = () => {
    const row = rowRef.current
    if (!row) return
    const max = row.scrollWidth - row.clientWidth
    setCanScrollBack(row.scrollLeft > 4)
    setCanScrollForward(max > 4 && row.scrollLeft < max - 4)
  }

  useLayoutEffect(() => {
    updateArrows()
    const row = rowRef.current
    if (!row) return
    row.addEventListener('scroll', updateArrows, { passive: true })
    window.addEventListener('resize', updateArrows)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateArrows)
    observer?.observe(row)
    return () => {
      row.removeEventListener('scroll', updateArrows)
      window.removeEventListener('resize', updateArrows)
      observer?.disconnect()
    }
  }, [children])

  function scrollStyles(direction: -1 | 1) {
    const row = rowRef.current
    if (!row) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    row.scrollBy({ left: direction * Math.max(180, row.clientWidth * 0.72), behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <div className="style-explore" aria-label="Explora por estilo">
      <span className="style-explore-label">Explora por estilo</span>
      <div className="style-explore-scroller">
        <button className="style-explore-arrow" type="button" aria-label="Ver estilos anteriores" disabled={!canScrollBack} onClick={() => scrollStyles(-1)}><Icon icon={icons.arrowLeft} /></button>
        <div ref={rowRef} className="style-explore-row" role="group">{children}</div>
        <button className="style-explore-arrow" type="button" aria-label="Ver más estilos" disabled={!canScrollForward} onClick={() => scrollStyles(1)}><Icon icon={icons.arrowRight} /></button>
      </div>
    </div>
  )
}

function CatalogSkeleton() {
  return (
    <div className="catalog-skeleton" role="status" aria-live="polite" aria-busy="true">
      <p className="sr-only">Cargando colección. Estamos preparando las piezas disponibles.</p>
      <div className="style-explore" aria-hidden="true">
        <span className="style-explore-label">Explora por estilo</span>
        <div className="style-explore-row">
          {Array.from({ length: 4 }, (_, index) => <span key={index} className="style-chip catalog-skeleton-chip" />)}
        </div>
      </div>
      <div className="product-grid" aria-hidden="true">
        {Array.from({ length: INITIAL_VISIBLE_PRODUCTS }, (_, index) => (
          <article key={index} className="product-card">
            <div className="product-card-image catalog-skeleton-image" />
            <div className="product-card-body">
              <div className="product-card-copy">
                <span className="catalog-skeleton-line" />
                <span className="catalog-skeleton-line catalog-skeleton-line--short" />
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="button button-secondary catalog-load-more catalog-skeleton-more" aria-hidden="true">Ver más anillos</div>
    </div>
  )
}

function PromoBannerSkeleton() {
  return (
    <section className="promo-banner promo-banner--three" aria-hidden="true">
      <div className="promo-copy">
        <span className="badge badge-brand">3 x $10</span>
        <h2>Elige 3 piezas y paga menos.</h2>
      </div>
      <div className="promo-play">
        <div className="promo-slots-track">
          {[0, 1, 2].map((index) => (
            <div className="promo-slots-unit" key={index}>
              {index > 0 && <span className="promo-slot-connector" />}
              <span className="promo-slot">{index + 1}</span>
            </div>
          ))}
        </div>
        <p className="promo-steps-status">Elige tus primeros 3 anillos</p>
        <span className="button button-primary promo-action">Elegir anillos</span>
      </div>
    </section>
  )
}

function styleFromLocation(): string | null {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/anillos') return 'anillos'
  const match = path.match(/^\/anillos\/([^/]+)$/)
  if (match) {
    try { return decodeURIComponent(match[1]) } catch { return null }
  }
  return new URLSearchParams(window.location.search).get('estilo')
}

export function StorePage({
  products,
  categories = fallbackCategories,
  promotion,
  catalogLoading = false,
  catalogError,
  onRetry,
  onOrderCreated,
}: {
  products: Product[]
  categories?: Category[]
  promotion?: PromotionRule | null
  catalogLoading?: boolean
  catalogError?: string | null
  onRetry?: () => void
  onOrderCreated: (order: Order) => void
}) {
  const { lines, currency, setCurrency, add, itemCount, rateMicros, rateAvailable, rateLoading } = useCart()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Todos')
  const [cartOpen, setCartOpen] = useState(false)
  const [introShown, setIntroShown] = useState(false)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_PRODUCTS)
  const [styleSlug, setStyleSlug] = useState<string | null>(styleFromLocation)
  const filterRowRef = useRef<HTMLDivElement>(null)
  const filterPillInitialized = useRef(false)
  const publicProducts = useMemo(() => getPublicProducts(products), [products])
  const styleCollections = useMemo(() => publishedCollections(publicProducts), [publicProducts])
  const visibleCategories = useMemo(() => {
    const availableCategoryNames = new Set(publicProducts.map((product) => product.category))
    return categories
      .filter((entry) => entry.active && availableCategoryNames.has(entry.name))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }, [categories, publicProducts])
  const categoryFilters = useMemo(() => ['Todos', ...visibleCategories.map((entry) => entry.name)], [visibleCategories])
  const activeStyle = useMemo(() => {
    if (!styleSlug) return null
    const definition = getCollectionDefinition(styleSlug)
    if (!definition || !isCollectionPublished(productsForCollection(publicProducts, definition).length)) return null
    return styleSlug
  }, [publicProducts, styleSlug])
  const filtered = useMemo(() => publicProducts.filter((product) => {
    const matchesCategory = category === 'Todos' || product.category === category
    const matchesSearch = product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())
    if (!matchesCategory || !matchesSearch) return false
    if (!activeStyle) return true
    const definition = getCollectionDefinition(activeStyle)
    if (!definition) return true
    return definition.match.test(normalizeCollectionText(`${product.name} ${product.description}`))
  }), [activeStyle, category, publicProducts, search])
  const visibleProducts = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const eligibleUnits = useMemo(() => lines.flatMap((line) => {
    const product = products.find((item) => item.id === line.productId)
    return product && isEligibleBundleProduct(product, promotion) ? Array.from({ length: Math.min(line.quantity, 99) }, () => product) : []
  }), [lines, products, promotion])
  const eligibleCount = eligibleUnits.length

  function selectStyle(slug: string | null) {
    setStyleSlug(slug)
    const url = new URL(window.location.href)
    const previousPath = url.pathname
    url.pathname = '/'
    if (slug) url.searchParams.set('estilo', slug)
    else url.searchParams.delete('estilo')
    const next = `${url.pathname}${url.search}${url.hash}`
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (current === next) return
    window.history.replaceState({}, '', next)
    if (previousPath.replace(/\/+$/, '') !== '/') window.dispatchEvent(new PopStateEvent('popstate'))
  }

  function browsePromotion() {
    const targetCategory = promotion?.targetCategory ?? 'Anillos'
    selectStyle(null)
    setSearch('')
    setCategory(categoryFilters.includes(targetCategory) ? targetCategory : 'Todos')
    window.requestAnimationFrame(() => {
      document.getElementById('anillos')?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      document.getElementById('product-search')?.focus({ preventScroll: true })
    })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroShown(true), 24)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (category !== 'Todos' && !categoryFilters.includes(category)) setCategory('Todos')
  }, [category, categoryFilters])

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_PRODUCTS)
  }, [category, search, activeStyle])

  useLayoutEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, '') || '/'
    if (path !== '/anillos' && !path.startsWith('/anillos/')) return
    selectStyle(styleFromLocation())
  }, [])

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
    if (add(product)) announceCartAdded(product.name)
  }

  function openCart() {
    announceCartOpened()
    setCartOpen(true)
  }

  function renderStyleFilters() {
    if (!styleCollections.length) return null
    return (
      <StyleExplore>
        <button type="button" className={`style-chip${!activeStyle ? ' is-selected' : ''}`} aria-pressed={!activeStyle} onClick={() => selectStyle(null)}>Todos</button>
        {styleCollections.map((entry) => <button key={entry.slug} type="button" className={`style-chip${activeStyle === entry.slug ? ' is-selected' : ''}`} aria-pressed={activeStyle === entry.slug} onClick={() => selectStyle(entry.slug)}>{entry.h1}</button>)}
      </StyleExplore>
    )
  }

  return (
    <div className="store-page app-shell">
      <StoreHeader currency={currency} onCurrencyChange={setCurrency} rateAvailable={rateAvailable} rateLoading={rateLoading} />
      <main id="main-content">
        <div className="page-container store-main">
          <section className="store-intro" id="novedades">
            <div className={`store-intro-copy t-stagger${introShown ? ' is-shown' : ''}`}>
              <h1 className="display-heading t-stagger-line t-stagger-line--1">Arma tu <span>combo</span></h1>
              <p className="t-stagger-line t-stagger-line--2">Anillos y accesorios en Maracaibo · Envíos a toda Venezuela</p>
            </div>
          </section>
          {catalogLoading && promotion === null ? <PromoBannerSkeleton /> : <PromoBanner progress={eligibleCount} units={eligibleUnits} promotion={promotion} currency={currency} rateMicros={rateMicros} onBrowse={browsePromotion} onOpenCart={openCart} />}
          <section className="catalog-section" id="anillos" aria-label="Catálogo de piezas">
            <div className="catalog-toolbar">
              <div className="search-field"><Icon icon={icons.search} /><label className="sr-only" htmlFor="product-search">Buscar piezas</label><input id="product-search" className="input" type="search" placeholder="Buscar anillos o accesorios…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
              <div ref={filterRowRef} className="filter-row t-tabs" role="group" aria-label="Filtrar por categoría">
                <span className="t-tabs-pill" aria-hidden="true" />
                {categoryFilters.map((item) => <button key={item} type="button" className={`filter-chip t-tab${category === item ? ' is-selected' : ''}`} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
              </div>
            </div>
            {renderStyleFilters()}
            {catalogLoading ? <CatalogSkeleton /> : catalogError ? <div className="empty-state surface-card catalog-state" role="alert"><div className="empty-icon" aria-hidden="true">!</div><h3>No pudimos cargar la colección</h3><p>{catalogError}</p>{onRetry && <button className="button button-primary" type="button" onClick={onRetry}>Reintentar</button>}</div> : !publicProducts.length ? <div className="empty-state surface-card catalog-state"><div className="empty-icon"><Icon icon={icons.box} /></div><h3>La colección se está preparando</h3><p>Pronto habrá piezas disponibles. Vuelve a visitarnos.</p></div> : filtered.length === 0 ? <div className="empty-state surface-card"><div className="empty-icon"><Icon icon={icons.search} /></div><h3>No encontramos esa pieza</h3><p>Prueba otra búsqueda o vuelve a ver toda la colección.</p><button className="button button-secondary" type="button" onClick={() => { setSearch(''); setCategory('Todos'); selectStyle(null) }}>Ver todo</button></div> : <><div className="product-grid">{visibleProducts.map((product, index) => <ProductCard key={product.id} product={product} promotion={promotion} currency={currency} rateMicros={rateMicros} priority={index < 4} onAdd={() => addProduct(product)} />)}</div>{visibleProducts.length < filtered.length && <button className="button button-secondary catalog-load-more" type="button" onClick={() => setVisibleCount((current) => Math.min(current + LOAD_MORE_STEP, filtered.length))}>Ver más anillos <Icon icon={icons.chevronDown} aria-hidden="true" /></button>}</>}
          </section>
          <section className="about-strip" id="accesorios">
              <div className="about-strip-intro"><span className="eyebrow">Hecho para rotar</span><h2>Una colección chica.<br />Muchas formas de usarla.</h2></div>
              <div className="about-links" aria-label="Información útil">
                <Link className="about-link about-link-featured" href="/guia-de-tallas">
                  <span className="about-link-copy"><span className="about-link-label">Antes de pedir</span><strong>Guía de tallas</strong><small>Aprende a medir tu talla.</small></span>
                  <Icon icon={icons.arrowRight} />
                </Link>
                <Link className="about-link about-link-secondary" href="/entregas-maracaibo">
                  <span className="about-link-copy"><span className="about-link-label">Entregas</span><strong>Entregas en Maracaibo</strong><small>Puntos de entrega y envíos nacionales.</small></span>
                  <Icon icon={icons.arrowRight} />
                </Link>
                <Link className="about-link about-link-secondary" href="/privacidad">
                  <span className="about-link-copy"><span className="about-link-label">Transparencia</span><strong>Cómo cuidamos tus datos</strong><small>Privacidad y uso de la información.</small></span>
                  <Icon icon={icons.arrowRight} />
                </Link>
                <a className="about-link about-link-secondary" href={BRAND_INSTAGRAM_URL} target="_blank" rel="noopener">
                  <span className="about-link-copy"><span className="about-link-label">Redes</span><strong>Instagram</strong><small>@corucore.jpg</small></span>
                  <Icon icon={icons.arrowRight} />
                </a>
                <a className="about-link about-link-secondary" href={BRAND_FACEBOOK_URL} target="_blank" rel="noopener">
                  <span className="about-link-copy"><span className="about-link-label">Redes</span><strong>Facebook</strong><small>CORU en Facebook</small></span>
                  <Icon icon={icons.arrowRight} />
                </a>
              </div>
            </section>
        </div>
      </main>
      <FloatingCart itemCount={itemCount} open={cartOpen} onCart={openCart} />
      <CartOverlay products={products} open={cartOpen} onClose={() => setCartOpen(false)} onOrderCreated={onOrderCreated} rateMicros={rateMicros} rateAvailable={rateAvailable} />
      <CartToastHost />
      <PrivacyNotice />
    </div>
  )
}
