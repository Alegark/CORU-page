import { useEffect, useState, type FormEvent } from 'react'
import { Icon, icons } from '../../components/ui/Icon'
import { RingArtwork } from '../../components/store/RingArtwork'
import { convertUsdCentsToBs, formatBs, formatUsd, quoteCart } from '../../../shared/commerce'
import { saveOrders } from '../../../shared/storage'
import { endOfCaracasDay } from '../../../shared/orders'
import { navigate } from '../../app/router'
import { analytics } from '../../analytics/client'
import { ApiClientError, archiveAdminCategory, archiveAdminDeliveryPoint, archiveAdminPromotion, cancelAdminOrder, createAdminCategory, createAdminDeliveryPoint, createAdminProduct, createAdminPromotion, confirmAdminOrder, discardAdminOrder, fetchAdminAnalytics, fetchAdminCategories, fetchAdminDeliveryPoints, fetchAdminProducts, fetchAdminPromotions, fetchAdminRate, fetchAdminSettings, fetchAdminTraffic, markAdminPreorderDelivered, markAdminPreorderReady, recordAdminPreorderBalance, recordAdminPreorderDeposit, refreshAdminOrderRate, refreshAdminRate, reorderAdminCategories, reorderAdminDeliveryPoints, updateAdminCategory, updateAdminDeliveryPoint, updateAdminProduct, updateAdminRate, updateAdminSettings, uploadAdminImage, type AdminAnalyticsSummary, type AdminDeliveryPointInput, type AdminRateResponse } from '../../api/admin'
import { ImageProcessor } from './ImageProcessor'
import type { Category, Order, OrderStatus, PersonalDeliveryPoint, Product, Promotion, StoreSettings } from '../../../shared/types'
import { defaultPersonalDeliveryPoints } from '../../../shared/delivery-points'
import type { AdminSection } from './AdminShell'
import { PersonalDeliveryPointMap } from '../../components/store/PersonalDeliveryPointMap'
import { AnalyticsPage } from './analytics/AnalyticsPage'

type AdminPagesProps = {
  section: AdminSection
  orderId?: string
  products: Product[]
  setProducts: (products: Product[]) => void
  orders: Order[]
  setOrders: (orders: Order[]) => void
}

function PageHead({ kicker, title, copy, action }: { kicker?: string; title: string; copy?: string; action?: React.ReactNode }) {
  return <div className="admin-page-head"><div>{kicker && <span className="eyebrow">{kicker}</span>}<h1>{title}</h1>{copy && <p>{copy}</p>}</div>{action}</div>
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const labels: Record<OrderStatus, string> = { PENDING: 'Pendiente', CONFIRMED: 'Venta concretada', DISCARDED: 'Descartado', CANCELLED: 'Venta cancelada' }
  return <span className={`status-badge status-${status.toLowerCase()}`}><span />{labels[status]}</span>
}

function MetricCard({ label, value, note, tone = 'neutral' }: { label: string; value: string; note: string; tone?: 'neutral' | 'brand' | 'warning' }) {
  return <article className={`metric-card metric-${tone}`}><span className="eyebrow">{label}</span><strong>{value}</strong><small>{note}</small></article>
}

export function AdminPages({ section, orderId, products, setProducts, orders, setOrders }: AdminPagesProps) {
  if (section === 'products') return <ProductsPageV2 products={products} setProducts={setProducts} />
  if (section === 'categories') return <CategoriesPage products={products} setProducts={setProducts} />
  if (section === 'promotions') return <PromotionsPage products={products} />
  if (section === 'orders') return <OrdersPageV2 orderId={orderId} products={products} setProducts={setProducts} orders={orders} setOrders={setOrders} />
  if (section === 'delivery') return <DeliveryPointsPage />
  if (section === 'analytics') return <AnalyticsPage />
  if (section === 'settings') return <SettingsPageLive />
  return <DashboardPageLive products={products} orders={orders} />
}

type DeliveryPointDraft = {
  name: string
  address: string
  shortDescription: string
  latitude: string
  longitude: string
  scheduleText: string
  active: boolean
  sortOrder: string
}

const seededDeliveryPoint: PersonalDeliveryPoint = { ...defaultPersonalDeliveryPoints[0] }

function emptyDeliveryPointDraft(sortOrder = 1): DeliveryPointDraft {
  return { name: '', address: '', shortDescription: '', latitude: '', longitude: '', scheduleText: '', active: true, sortOrder: String(sortOrder) }
}

function deliveryDraftFromPoint(point: PersonalDeliveryPoint): DeliveryPointDraft {
  return { name: point.name, address: point.address, shortDescription: point.shortDescription ?? '', latitude: point.latitude === undefined ? '' : String(point.latitude), longitude: point.longitude === undefined ? '' : String(point.longitude), scheduleText: point.scheduleText ?? '', active: point.active, sortOrder: String(point.sortOrder) }
}

function DeliveryPointsPage() {
  const [points, setPoints] = useState<PersonalDeliveryPoint[]>([seededDeliveryPoint])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DeliveryPointDraft>(() => emptyDeliveryPointDraft())
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [previewId, setPreviewId] = useState(seededDeliveryPoint.id)

  useEffect(() => {
    let active = true
    fetchAdminDeliveryPoints().then((remote) => { if (active) { setPoints(remote.length ? remote : [seededDeliveryPoint]); setPreviewId(remote[0]?.id ?? seededDeliveryPoint.id) } }).catch((requestError) => { if (active && !isLocalPreviewError(requestError)) setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudieron cargar los puntos.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  function openEditor(point?: PersonalDeliveryPoint) {
    setError(''); setNotice(''); setEditingId(point?.id ?? null); setDraft(point ? deliveryDraftFromPoint(point) : emptyDeliveryPointDraft(points.length + 1)); setEditorOpen(true)
  }

  function inputFromDraft(): AdminDeliveryPointInput | null {
    const name = draft.name.trim(); const address = draft.address.trim()
    if (!name || !address) { setError('Nombre y dirección son obligatorios.'); return null }
    const latitude = draft.latitude.trim() ? Number(draft.latitude) : undefined; const longitude = draft.longitude.trim() ? Number(draft.longitude) : undefined
    if ((latitude !== undefined && !Number.isFinite(latitude)) || (longitude !== undefined && !Number.isFinite(longitude)) || (latitude === undefined) !== (longitude === undefined)) { setError('Indica latitud y longitud válidas, o deja ambas vacías.'); return null }
    const sortOrder = Number(draft.sortOrder); if (!Number.isInteger(sortOrder) || sortOrder < 1) { setError('El orden debe ser un entero mayor que cero.'); return null }
    return { name, address, ...(draft.shortDescription.trim() ? { shortDescription: draft.shortDescription.trim() } : {}), ...(latitude !== undefined ? { latitude, longitude: longitude! } : {}), ...(draft.scheduleText.trim() ? { scheduleText: draft.scheduleText.trim() } : {}), active: draft.active, sortOrder }
  }

  async function savePoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return; const input = inputFromDraft(); if (!input) return
    setSaving(true); setError(''); setNotice('')
    try {
      try {
        const saved = editingId ? await updateAdminDeliveryPoint(editingId, input) : await createAdminDeliveryPoint(input)
        setPoints((current) => editingId ? current.map((point) => point.id === editingId ? saved : point) : [...current, saved]); setPreviewId(saved.id); setEditorOpen(false); setNotice('Punto guardado.')
        return
      } catch (requestError) {
        if (!isLocalPreviewError(requestError)) { setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo guardar el punto.'); return }
      }
      const localPoint: PersonalDeliveryPoint = { id: editingId ?? `delivery-${Date.now()}`, ...input }
      setPoints((current) => editingId ? current.map((point) => point.id === editingId ? localPoint : point) : [...current, localPoint]); setPreviewId(localPoint.id); setEditorOpen(false); setNotice('Punto guardado en la vista previa local.')
    } finally { setSaving(false) }
  }

  async function archivePoint(point: PersonalDeliveryPoint) {
    if (!window.confirm(`¿Desactivar ${point.name}? Los pedidos históricos conservarán su referencia.`)) return
    setError(''); setNotice('')
    try {
      try { const archived = await archiveAdminDeliveryPoint(point.id); setPoints((current) => current.map((entry) => entry.id === point.id ? archived : entry)); setNotice('Punto desactivado.'); return } catch (requestError) { if (!isLocalPreviewError(requestError)) throw requestError }
      setPoints((current) => current.map((entry) => entry.id === point.id ? { ...entry, active: false } : entry)); setNotice('Punto desactivado en la vista previa local.')
    } catch (requestError) { setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo desactivar el punto.') }
  }

  async function movePoint(point: PersonalDeliveryPoint, delta: -1 | 1) {
    const ordered = [...points].sort((a, b) => a.sortOrder - b.sortOrder); const index = ordered.findIndex((entry) => entry.id === point.id); const target = index + delta; if (index < 0 || target < 0 || target >= ordered.length) return
    const next = [...ordered]; [next[index], next[target]] = [next[target], next[index]]; const ids = next.map((entry) => entry.id)
    try {
      try { setPoints(await reorderAdminDeliveryPoints(ids)); setNotice('Orden actualizado.'); return } catch (requestError) { if (!isLocalPreviewError(requestError)) throw requestError }
      setPoints(next.map((entry, position) => ({ ...entry, sortOrder: position + 1 }))); setNotice('Orden actualizado en la vista previa local.')
    } catch (requestError) { setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo actualizar el orden.') }
  }

  const activePoints = points.filter((point) => point.active).sort((a, b) => a.sortOrder - b.sortOrder)
  const previewPoints = activePoints.length ? activePoints : points.sort((a, b) => a.sortOrder - b.sortOrder)
  return <><PageHead kicker="Operación" title="Puntos de entrega" copy="Administra los puntos personales que aparecen en el mapa y en la lista accesible del carrito." action={<button className="button button-primary" type="button" onClick={() => openEditor()}><Icon icon={icons.plus} /> Nuevo punto</button>} />{error && <div className="inline-notice is-error" role="alert">{error}</div>}{notice && <div className="inline-notice" role="status">{notice}</div>}<div className="delivery-admin-grid"><section className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Vista pública</span><h2>Mapa y lista</h2></div><span className="status-badge status-confirmed"><span />{activePoints.length} activos</span></div><PersonalDeliveryPointMap points={previewPoints} selectedId={previewId} onSelect={(point) => setPreviewId(point.id)} /><small className="admin-help">El mapa es una mejora visual; la lista sigue siendo la fuente accesible y operativa.</small></section><section className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Puntos configurados</span><h2>{loading ? 'Cargando…' : `${points.length} puntos`}</h2></div></div>{!loading && points.length === 0 ? <div className="admin-empty"><Icon icon={icons.location} /><h3>No hay puntos todavía</h3><p>Crea el primero para habilitar la entrega personal.</p></div> : <div className="delivery-admin-list">{[...points].sort((a, b) => a.sortOrder - b.sortOrder).map((point, index, ordered) => <article className={`delivery-admin-card${point.active ? '' : ' is-inactive'}`} key={point.id}><div><strong>{point.name}</strong><p>{point.address}</p>{point.scheduleText && <small>{point.scheduleText}</small>}<span className={`status-badge ${point.active ? 'status-confirmed' : 'status-discarded'}`}><span />{point.active ? 'Activo' : 'Inactivo'}</span></div><div className="delivery-admin-actions"><button className="icon-button" type="button" aria-label={`Subir ${point.name}`} disabled={index === 0} onClick={() => void movePoint(point, -1)}><Icon icon={icons.chevronUp} /></button><button className="icon-button" type="button" aria-label={`Bajar ${point.name}`} disabled={index === ordered.length - 1} onClick={() => void movePoint(point, 1)}><Icon icon={icons.chevronDown} /></button><button className="icon-button" type="button" aria-label={`Editar ${point.name}`} onClick={() => openEditor(point)}><Icon icon={icons.pen} /></button>{point.active && <button className="icon-button" type="button" aria-label={`Desactivar ${point.name}`} onClick={() => void archivePoint(point)}><Icon icon={icons.trash} /></button>}</div></article>)}</div>}</section></div>{editorOpen && <form className="admin-panel form-panel delivery-editor" onSubmit={(event) => void savePoint(event)}><div className="panel-header"><div><span className="eyebrow">{editingId ? 'Editar punto' : 'Nuevo punto'}</span><h2>{editingId ? 'Actualiza los datos de entrega' : 'Agrega un punto personal'}</h2></div><button className="button button-ghost" type="button" onClick={() => setEditorOpen(false)} disabled={saving}>Cancelar</button></div><div className="form-grid"><label>Nombre<input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label><label>Dirección<input className="input" value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} required /></label><label>Descripción breve<input className="input" value={draft.shortDescription} onChange={(event) => setDraft({ ...draft, shortDescription: event.target.value })} /></label><label>Horario<input className="input" value={draft.scheduleText} onChange={(event) => setDraft({ ...draft, scheduleText: event.target.value })} placeholder="Ej. Lun–Vie · 9:00–16:00" /></label><label>Latitud<input className="input" value={draft.latitude} onChange={(event) => setDraft({ ...draft, latitude: event.target.value })} inputMode="decimal" placeholder="Opcional" /></label><label>Longitud<input className="input" value={draft.longitude} onChange={(event) => setDraft({ ...draft, longitude: event.target.value })} inputMode="decimal" placeholder="Opcional" /></label><label>Orden<input className="input" type="number" min="1" step="1" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} /></label></div><label className="checkbox-label"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Disponible para clientes</label><small>Las coordenadas solo posicionan el marcador; la dirección y la lista siguen siendo la referencia para la entrega.</small><button className="button button-primary" type="submit" disabled={saving}><Icon icon={icons.check} /> {saving ? 'Guardando…' : 'Guardar punto'}</button></form>}</>
}

function DashboardPageLive({ products, orders }: { products: Product[]; orders: Order[] }) {
  const [promotions, setPromotions] = useState<Promotion[]>([{ id: 'promo-3x10', name: '3 anillos por $10', kind: 'BUNDLE', targetCategory: 'Anillos', bundleQuantity: 3, bundlePriceCents: 1000, active: true }])
  const [analyticsSummary, setAnalyticsSummary] = useState<AdminAnalyticsSummary>(() => localAnalyticsSummary(orders))
  const [error, setError] = useState('')
  const pending = orders.filter((order) => order.status === 'PENDING').length
  const confirmed = orders.filter((order) => order.status === 'CONFIRMED')
  const activePromotion = promotions.find((promotion) => promotion.active)
  const comboConfirmed = analyticsSummary.promo.confirmed || confirmed.filter((order) => Boolean(order.quote.appliedPromotion)).length
  const comboRate = confirmed.length ? Math.round((comboConfirmed / confirmed.length) * 100) : 0
  useEffect(() => {
    let active = true
    Promise.all([fetchAdminPromotions(), fetchAdminAnalytics()]).then(([remotePromotions, remoteAnalytics]) => { if (active) { setPromotions(remotePromotions); setAnalyticsSummary(remoteAnalytics) } }).catch((requestError) => { if (active && !isLocalPreviewError(requestError)) setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo cargar el resumen.') })
    return () => { active = false }
  }, [orders])
  return <><PageHead kicker="Resumen" title="Buenos días, CORU." copy="Una vista rápida de lo que está pasando en tu tienda." action={<button className="button button-primary" type="button" onClick={() => navigate('/admin/productos')}><Icon icon={icons.plus} /> Nuevo producto</button>} />{error && <div className="inline-notice is-error" role="alert">{error}</div>}<section className="metrics-grid"><MetricCard label="Productos activos" value={String(products.filter((product) => product.active && product.stockQuantity > 0).length)} note="con stock disponible" tone="brand" /><MetricCard label="Pedidos pendientes" value={String(pending)} note="esperando confirmación" tone="warning" /><MetricCard label="Ventas concretadas" value={String(confirmed.length)} note="en total" /><MetricCard label="Ingresos confirmados" value={formatUsd(confirmed.reduce((sum, order) => sum + order.quote.totalCents, 0))} note="solo ventas reales" /></section><section className="admin-dashboard-grid"><article className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Actividad reciente</span><h2>Pedidos por atender</h2></div><button className="text-link" type="button" onClick={() => navigate('/admin/pedidos')}>Ver todos <Icon icon={icons.arrowRight} /></button></div>{orders.length === 0 ? <div className="admin-empty"><Icon icon={icons.orders} /><h3>Aún no hay pedidos</h3><p>Cuando alguien continúe por WhatsApp aparecerán aquí.</p></div> : <div className="mini-order-list">{orders.slice(-3).reverse().map((order) => <div className="mini-order" key={order.id}><span className="order-ref">{order.reference}</span><span>{order.items.length} productos</span><strong>{formatUsd(order.quote.totalCents)}</strong><StatusBadge status={order.status} /></div>)}</div>}</article><article className="admin-panel promo-insight"><div className="panel-header"><div><span className="eyebrow">Promoción activa</span><h2>{activePromotion?.name ?? 'Sin promoción activa'}</h2></div>{activePromotion && <span className="status-badge status-confirmed"><span />Activa</span>}</div><p>{activePromotion ? 'La promoción se mide con pedidos y ventas confirmadas.' : 'Activa una regla desde Promociones cuando quieras ofrecer un combo.'}</p><div className="promo-stat"><strong>{comboConfirmed}</strong><span>combos confirmados</span></div><div className="progress-bar"><span style={{ width: `${comboRate}%` }} /></div><small>{comboRate}% de las ventas confirmadas incluyen promoción.</small></article></section><section className="admin-panel quick-actions"><div className="panel-header"><div><span className="eyebrow">Atajos</span><h2>Qué necesita atención</h2></div></div><div className="quick-action-grid"><button type="button" onClick={() => navigate('/admin/productos')}><Icon icon={icons.box} /><span><strong>{products.filter((product) => product.stockQuantity <= 3).length} productos</strong><small>poco stock</small></span><Icon icon={icons.chevronRight} /></button><button type="button" onClick={() => navigate('/admin/pedidos')}><Icon icon={icons.orders} /><span><strong>{pending} pedidos</strong><small>por revisar</small></span><Icon icon={icons.chevronRight} /></button><button type="button" onClick={() => navigate('/admin/ajustes')}><Icon icon={icons.rotate} /><span><strong>{analyticsSummary.events ? `${analyticsSummary.events.toLocaleString('es-VE')} señales` : 'Sin señales todavía'}</strong><small>analítica anónima</small></span><Icon icon={icons.chevronRight} /></button></div></section></>
}
function ProductsPage({ products, setProducts }: { products: Product[]; setProducts: (products: Product[]) => void }) {
  const [query, setQuery] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([{ id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true }, { id: 'cat-accesorios', slug: 'accesorios', name: 'Accesorios', sortOrder: 2, active: true }])
  const [draft, setDraft] = useState({ name: '', category: 'Anillos' as Product['category'], price: '4', stock: '0', sizeLabel: 'Talla única', material: 'Acero inoxidable', description: '', artwork: 'orbita' as Product['artwork'], promoEligible: true, active: true, fulfillmentType: 'STOCK' as NonNullable<Product['fulfillmentType']>, measurementsText: '', leadTime: '3–4 semanas' })
  const [editorError, setEditorError] = useState('')
  const [saving, setSaving] = useState(false)
  const filtered = products.filter((product) => product.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  useEffect(() => { fetchAdminCategories().then((remote) => { if (remote.length) setCategories(remote) }).catch(() => undefined) }, [])
  function openEditor(product?: Product) {
    setEditorError('')
    if (product) {
      setEditingId(product.id)
      setDraft({ name: product.name, category: product.category, price: String(product.priceCents / 100), stock: String(product.stockQuantity), sizeLabel: product.sizeLabel, material: product.material, description: product.description, artwork: product.artwork, promoEligible: product.promoEligible, active: product.active, fulfillmentType: product.fulfillmentType ?? 'STOCK', measurementsText: product.measurementsText ?? '', leadTime: product.leadTime ?? '3–4 semanas' })
    } else {
      setEditingId(null)
      setDraft({ name: '', category: categories.find((category) => category.active)?.name ?? 'Anillos', price: '4', stock: '0', sizeLabel: 'Talla única', material: 'Acero inoxidable', description: '', artwork: 'orbita', promoEligible: true, active: true, fulfillmentType: 'STOCK', measurementsText: '', leadTime: '3–4 semanas' })
    }
    setEditorOpen(true)
  }
  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const name = draft.name.trim()
    const priceCents = Math.round(Number(draft.price.replace(',', '.')) * 100)
    const stockQuantity = Number(draft.stock)
    if (!name || !Number.isInteger(priceCents) || priceCents < 0 || !Number.isInteger(stockQuantity) || stockQuantity < 0) { setEditorError('Completa nombre, precio y stock con valores válidos.'); return }
    const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const input = { name, slug: slug || undefined, category: draft.category, priceCents, stockQuantity, sizeLabel: draft.sizeLabel.trim() || 'Talla única', material: draft.material.trim(), description: draft.description.trim(), artwork: draft.artwork, promoEligible: draft.fulfillmentType === 'PREORDER' ? false : draft.promoEligible, active: draft.active, fulfillmentType: draft.fulfillmentType, measurementsText: draft.measurementsText.trim() || undefined, leadTime: draft.fulfillmentType === 'PREORDER' ? draft.leadTime.trim() || '3–4 semanas' : undefined }
    setSaving(true)
    try {
      try {
        const remote = editingId ? await updateAdminProduct(editingId, input) : await createAdminProduct(input)
        setProducts(editingId ? products.map((product) => product.id === editingId ? remote : product) : [...products, remote])
        setEditorOpen(false)
        return
      } catch (error) {
        if (!isLocalPreviewError(error)) {
          setEditorError(error instanceof ApiClientError ? error.message : 'No se pudo guardar el producto.')
          return
        }
      }
      if (editingId) setProducts(products.map((product) => product.id === editingId ? { ...product, name, slug: slug || product.slug, category: draft.category, priceCents, stockQuantity, sizeLabel: draft.sizeLabel.trim() || 'Talla única', material: draft.material.trim(), description: draft.description.trim(), artwork: draft.artwork, promoEligible: draft.fulfillmentType === 'PREORDER' ? false : draft.promoEligible, active: draft.active, fulfillmentType: draft.fulfillmentType, measurementsText: draft.measurementsText.trim() || undefined, leadTime: draft.fulfillmentType === 'PREORDER' ? draft.leadTime.trim() || '3–4 semanas' : undefined } : product))
      else setProducts([...products, { id: `product-${Date.now()}`, slug, name, category: draft.category, priceCents, stockQuantity, active: draft.active, primaryImageApproved: false, promoEligible: draft.fulfillmentType === 'PREORDER' ? false : draft.promoEligible, fulfillmentType: draft.fulfillmentType, measurementsText: draft.measurementsText.trim() || undefined, leadTime: draft.fulfillmentType === 'PREORDER' ? draft.leadTime.trim() || '3–4 semanas' : undefined, artwork: draft.artwork, description: draft.description.trim(), material: draft.material.trim(), sizeLabel: draft.sizeLabel.trim() || 'Talla única' }])
      setEditorOpen(false)
    } finally {
      setSaving(false)
    }
  }
  return <><PageHead kicker="Catálogo" title="Productos" copy="Mantén cada pieza lista para salir a la calle." action={<button className="button button-primary" type="button" onClick={() => openEditor()}><Icon icon={icons.plus} /> Nuevo producto</button>} />{editorOpen && <form className="admin-panel form-panel product-editor" onSubmit={(event) => void saveProduct(event)}><div className="panel-header"><div><span className="eyebrow">{editingId ? 'Editar pieza' : 'Nueva pieza'}</span><h2>{editingId ? 'Actualiza los datos del producto' : 'Agrega una pieza al catálogo'}</h2></div><button className="button button-ghost" type="button" onClick={() => setEditorOpen(false)} disabled={saving}>Cancelar</button></div>{editorError && <div className="inline-notice is-error" role="alert">{editorError}</div>}<div className="form-grid"><label>Nombre<input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label><label>Categoría<select className="input" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Product['category'] })}>{categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label><label>Precio USD<input className="input" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} inputMode="decimal" /></label><label>Stock<input className="input" type="number" min="0" step="1" value={draft.stock} onChange={(event) => setDraft({ ...draft, stock: event.target.value })} /></label><label>Información de talla<input className="input" value={draft.sizeLabel} onChange={(event) => setDraft({ ...draft, sizeLabel: event.target.value })} /></label><label>Material<input className="input" value={draft.material} onChange={(event) => setDraft({ ...draft, material: event.target.value })} /></label></div><label>Descripción<textarea className="textarea" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label className="checkbox-label"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Visible en el catálogo</label><label className="checkbox-label"><input type="checkbox" checked={draft.promoEligible} onChange={(event) => setDraft({ ...draft, promoEligible: event.target.checked })} /> Elegible para la promoción</label>{editingId ? <ImageProcessor productId={editingId} onUpload={async (file) => { const uploaded = await uploadAdminImage(editingId, file); try { setProducts(await fetchAdminProducts()) } catch { /* keep current product list */ } return uploaded }} onChanged={async () => { try { setProducts(await fetchAdminProducts()) } catch { /* keep current product list */ } }} /> : <div className="inline-notice" role="status">Guarda producto antes de subir su imagen.</div>}<button className="button button-primary" type="submit" disabled={saving}><Icon icon={icons.check} /> {saving ? 'Guardando…' : 'Guardar producto'}</button></form>}<div className="admin-toolbar"><div className="search-field"><Icon icon={icons.search} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre…" aria-label="Buscar productos" /></div><button className="button button-ghost" type="button"><Icon icon={icons.sliders} /> Filtros</button></div><div className="admin-panel admin-product-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Imagen</th><th>Estado</th><th aria-label="Acciones" /></tr></thead><tbody>{filtered.map((product) => <tr key={product.id}><td><div className="table-product"><RingArtwork artwork={product.artwork} label="" /><span><strong>{product.name}</strong><small>{product.sizeLabel}</small></span></div></td><td>{product.category}</td><td>{formatUsd(product.priceCents)}</td><td><span className={`stock-value${product.stockQuantity <= 3 ? ' is-low' : ''}`}>{product.stockQuantity}</span></td><td><span className={`status-badge ${product.primaryImageApproved ? 'status-confirmed' : 'status-discarded'}`}><span />{product.primaryImageApproved ? 'Lista' : 'Pendiente'}</span></td><td><span className={`status-badge ${product.active && product.stockQuantity > 0 ? 'status-confirmed' : 'status-discarded'}`}><span />{product.active && product.stockQuantity > 0 ? 'Visible' : 'Agotado'}</span></td><td><button className="icon-button" type="button" aria-label={`Editar ${product.name}`} onClick={() => openEditor(product)}><Icon icon={icons.pen} /></button></td></tr>)}</tbody></table></div><div className="admin-mobile-list">{filtered.map((product) => <article className="admin-entity-card" key={product.id}><div className="entity-thumb"><RingArtwork artwork={product.artwork} label="" /></div><div><strong>{product.name}</strong><p>{product.category} · {formatUsd(product.priceCents)}</p><span className={`stock-label${product.stockQuantity <= 3 ? ' is-low' : ''}`}>{product.stockQuantity === 0 ? 'Agotado' : `${product.stockQuantity} en stock`}</span><small>{product.primaryImageApproved ? 'Imagen lista' : 'Imagen pendiente'}</small></div><button className="icon-button" type="button" aria-label={`Editar ${product.name}`} onClick={() => openEditor(product)}><Icon icon={icons.pen} /></button></article>)}</div></div></>
}

type ProductDraft = {
  name: string
  category: Product['category']
  price: string
  stock: string
  sizeLabel: string
  material: string
  description: string
  artwork: Product['artwork']
  promoEligible: boolean
  active: boolean
  fulfillmentType: NonNullable<Product['fulfillmentType']>
  measurementsText: string
  leadTime: string
}

function emptyProductDraft(category = 'Anillos'): ProductDraft {
  return { name: '', category, price: '4', stock: '0', sizeLabel: 'Talla única', material: 'Acero inoxidable', description: '', artwork: 'orbita', promoEligible: true, active: true, fulfillmentType: 'STOCK', measurementsText: '', leadTime: '3–4 semanas' }
}

function draftFromProduct(product: Product): ProductDraft {
  return { name: product.name, category: product.category, price: String(product.priceCents / 100), stock: String(product.stockQuantity), sizeLabel: product.sizeLabel, material: product.material, description: product.description, artwork: product.artwork, promoEligible: product.promoEligible, active: product.active, fulfillmentType: product.fulfillmentType ?? 'STOCK', measurementsText: product.measurementsText ?? '', leadTime: product.leadTime ?? '3–4 semanas' }
}

/** Admin product editor with the STOCK/PREORDER fields visible to operators. */
function ProductsPageV2({ products, setProducts }: { products: Product[]; setProducts: (products: Product[]) => void }) {
  const [query, setQuery] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([{ id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true }, { id: 'cat-accesorios', slug: 'accesorios', name: 'Accesorios', sortOrder: 2, active: true }])
  const [draft, setDraft] = useState<ProductDraft>(() => emptyProductDraft())
  const [editorError, setEditorError] = useState('')
  const [saving, setSaving] = useState(false)
  const filtered = products.filter((product) => product.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  useEffect(() => { fetchAdminCategories().then((remote) => { if (remote.length) setCategories(remote) }).catch(() => undefined) }, [])

  function openEditor(product?: Product): void {
    setEditorError('')
    setEditingId(product?.id ?? null)
    setDraft(product ? draftFromProduct(product) : emptyProductDraft(categories.find((category) => category.active)?.name ?? 'Anillos'))
    setEditorOpen(true)
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (saving) return
    const name = draft.name.trim(); const priceCents = Math.round(Number(draft.price.replace(',', '.')) * 100); const stockQuantity = Number(draft.stock)
    if (!name || !Number.isInteger(priceCents) || priceCents < 0 || !Number.isInteger(stockQuantity) || stockQuantity < 0) { setEditorError('Completa nombre, precio y stock con valores válidos.'); return }
    if (draft.fulfillmentType === 'PREORDER' && !draft.measurementsText.trim()) { setEditorError('Publica las medidas antes de activar Bajo pedido.'); return }
    const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const input = { name, slug: slug || undefined, category: draft.category, priceCents, stockQuantity, sizeLabel: draft.sizeLabel.trim() || 'Talla única', material: draft.material.trim(), description: draft.description.trim(), artwork: draft.artwork, promoEligible: draft.fulfillmentType === 'PREORDER' ? false : draft.promoEligible, active: draft.active, fulfillmentType: draft.fulfillmentType, measurementsText: draft.measurementsText.trim() || undefined, leadTime: draft.fulfillmentType === 'PREORDER' ? draft.leadTime.trim() || '3–4 semanas' : undefined }
    setSaving(true)
    try {
      try {
        const remote = editingId ? await updateAdminProduct(editingId, input) : await createAdminProduct(input)
        setProducts(editingId ? products.map((product) => product.id === editingId ? remote : product) : [...products, remote]); setEditorOpen(false); return
      } catch (error) {
        if (!isLocalPreviewError(error)) { setEditorError(error instanceof ApiClientError ? error.message : 'No se pudo guardar el producto.'); return }
      }
      const local: Product = { id: editingId ?? `product-${Date.now()}`, slug, name, category: draft.category, priceCents, stockQuantity, active: draft.active, primaryImageApproved: editingId ? products.find((product) => product.id === editingId)?.primaryImageApproved ?? false : false, promoEligible: draft.fulfillmentType === 'PREORDER' ? false : draft.promoEligible, fulfillmentType: draft.fulfillmentType, measurementsText: draft.measurementsText.trim() || undefined, leadTime: draft.fulfillmentType === 'PREORDER' ? draft.leadTime.trim() || '3–4 semanas' : undefined, artwork: draft.artwork, description: draft.description.trim(), material: draft.material.trim(), sizeLabel: draft.sizeLabel.trim() || 'Talla única' }
      setProducts(editingId ? products.map((product) => product.id === editingId ? { ...product, ...local, id: product.id, slug: slug || product.slug } : product) : [...products, local]); setEditorOpen(false)
    } finally { setSaving(false) }
  }

  return <><PageHead kicker="Catálogo" title="Productos" copy="Mantén cada pieza lista para salir a la calle." action={<button className="button button-primary" type="button" onClick={() => openEditor()}><Icon icon={icons.plus} /> Nuevo producto</button>} />{editorOpen && <form className="admin-panel form-panel product-editor" onSubmit={(event) => void saveProduct(event)}><div className="panel-header"><div><span className="eyebrow">{editingId ? 'Editar pieza' : 'Nueva pieza'}</span><h2>{editingId ? 'Actualiza los datos del producto' : 'Agrega una pieza al catálogo'}</h2></div><button className="button button-ghost" type="button" onClick={() => setEditorOpen(false)} disabled={saving}>Cancelar</button></div>{editorError && <div className="inline-notice is-error" role="alert">{editorError}</div>}<div className="form-grid"><label>Nombre<input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label><label>Categoría<select className="input" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label><label>Precio USD<input className="input" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} inputMode="decimal" /></label><label>Stock<input className="input" type="number" min="0" step="1" value={draft.stock} onChange={(event) => setDraft({ ...draft, stock: event.target.value })} /></label><label>Información de talla<input className="input" value={draft.sizeLabel} onChange={(event) => setDraft({ ...draft, sizeLabel: event.target.value })} /></label><label>Material<input className="input" value={draft.material} onChange={(event) => setDraft({ ...draft, material: event.target.value })} /></label><label>Modalidad<select className="input" value={draft.fulfillmentType} onChange={(event) => setDraft({ ...draft, fulfillmentType: event.target.value as NonNullable<Product['fulfillmentType']> })}><option value="STOCK">Disponible en stock</option><option value="PREORDER">Bajo pedido</option></select></label>{draft.fulfillmentType === 'PREORDER' && <label>Tiempo estimado<input className="input" value={draft.leadTime} onChange={(event) => setDraft({ ...draft, leadTime: event.target.value })} placeholder="3–4 semanas" /></label>}</div>{draft.fulfillmentType === 'PREORDER' && <label>Medidas para la guía de tallas<textarea className="textarea" value={draft.measurementsText} onChange={(event) => setDraft({ ...draft, measurementsText: event.target.value })} placeholder="Ej. Diámetro interno 17 mm · contorno 53 mm" required /></label>}<label>Descripción<textarea className="textarea" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label className="checkbox-label"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Visible en el catálogo</label><label className="checkbox-label"><input type="checkbox" checked={draft.promoEligible} disabled={draft.fulfillmentType === 'PREORDER'} onChange={(event) => setDraft({ ...draft, promoEligible: event.target.checked })} /> Elegible para la promoción</label>{editingId ? <ImageProcessor productId={editingId} onUpload={async (file) => { const uploaded = await uploadAdminImage(editingId, file); try { setProducts(await fetchAdminProducts()) } catch { /* keep current product list */ } return uploaded }} onChanged={async () => { try { setProducts(await fetchAdminProducts()) } catch { /* keep current product list */ } }} /> : <div className="inline-notice" role="status">Guarda producto antes de subir su imagen.</div>}<button className="button button-primary" type="submit" disabled={saving}><Icon icon={icons.check} /> {saving ? 'Guardando…' : 'Guardar producto'}</button></form>}<div className="admin-toolbar"><div className="search-field"><Icon icon={icons.search} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre…" aria-label="Buscar productos" /></div></div><div className="admin-panel admin-product-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Producto</th><th>Categoría</th><th>Modalidad</th><th>Precio</th><th>Stock</th><th>Estado</th><th aria-label="Acciones" /></tr></thead><tbody>{filtered.map((product) => <tr key={product.id}><td><div className="table-product"><RingArtwork artwork={product.artwork} label="" /><span><strong>{product.name}</strong><small>{product.sizeLabel}</small></span></div></td><td>{product.category}</td><td>{product.fulfillmentType === 'PREORDER' ? <span className="status-badge status-warning"><span />Bajo pedido</span> : <span className="status-badge status-confirmed"><span />Stock</span>}</td><td>{formatUsd(product.priceCents)}</td><td><span className={`stock-value${product.stockQuantity <= 3 && product.fulfillmentType !== 'PREORDER' ? ' is-low' : ''}`}>{product.fulfillmentType === 'PREORDER' ? '—' : product.stockQuantity}</span></td><td><span className={`status-badge ${product.active ? 'status-confirmed' : 'status-discarded'}`}><span />{product.active ? 'Visible' : 'Oculto'}</span></td><td><button className="icon-button" type="button" aria-label={`Editar ${product.name}`} onClick={() => openEditor(product)}><Icon icon={icons.pen} /></button></td></tr>)}</tbody></table></div><div className="admin-mobile-list">{filtered.map((product) => <article className="admin-entity-card" key={product.id}><div className="entity-thumb"><RingArtwork artwork={product.artwork} label="" /></div><div><strong>{product.name}</strong><p>{product.category} · {product.fulfillmentType === 'PREORDER' ? 'Bajo pedido' : formatUsd(product.priceCents)}</p><span className={`stock-label${product.stockQuantity <= 3 && product.fulfillmentType !== 'PREORDER' ? ' is-low' : ''}`}>{product.fulfillmentType === 'PREORDER' ? `${product.leadTime ?? '3–4 semanas'}` : product.stockQuantity === 0 ? 'Agotado' : `${product.stockQuantity} en stock`}</span></div><button className="icon-button" type="button" aria-label={`Editar ${product.name}`} onClick={() => openEditor(product)}><Icon icon={icons.pen} /></button></article>)}</div></div></>
}

function CategoriesPage({ products, setProducts }: { products: Product[]; setProducts: (products: Product[]) => void }) {
  const initial: Category[] = [{ id: 'cat-anillos', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true }, { id: 'cat-accesorios', slug: 'accesorios', name: 'Accesorios', sortOrder: 2, active: true }]
  const [categories, setCategories] = useState<Category[]>(initial)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  useEffect(() => {
    let active = true
    fetchAdminCategories().then((remote) => { if (active) setCategories(remote) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = name.trim()
    if (!next) { setError('Escribe un nombre para la categoría.'); return }
    if (categories.some((category) => category.name.toLocaleLowerCase() === next.toLocaleLowerCase())) { setError('Esa categoría ya existe.'); return }
    try {
      const created = await createAdminCategory({ name: next, sortOrder: categories.length + 1 })
      setCategories((current) => [...current, created])
    } catch (requestError) {
      if (!isLocalPreviewError(requestError)) { setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo guardar la categoría.'); return }
      setCategories((current) => [...current, { id: `category-${Date.now()}`, slug: next.toLocaleLowerCase().replace(/\s+/g, '-'), name: next, sortOrder: current.length + 1, active: true }])
    }
    setName(''); setError('')
  }

  async function moveCategory(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= categories.length) return
    const next = [...categories]
    ;[next[index], next[target]] = [next[target], next[index]]
    next.forEach((category, order) => { category.sortOrder = order + 1 })
    try {
      setCategories(await reorderAdminCategories(next.map((category) => category.id)))
    } catch (requestError) {
      if (!isLocalPreviewError(requestError)) { setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo reordenar las categorías.'); return }
      setCategories(next)
    }
  }

  async function saveCategory(category: Category) {
    const nextName = editingName.trim()
    if (!nextName) { setError('El nombre de la categoría es obligatorio.'); return }
    const previousName = category.name
    try {
      const updated = await updateAdminCategory(category.id, { name: nextName })
      setCategories((current) => current.map((entry) => entry.id === category.id ? updated : entry))
    } catch (requestError) {
      if (!isLocalPreviewError(requestError)) { setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo actualizar la categoría.'); return }
      setCategories((current) => current.map((entry) => entry.id === category.id ? { ...entry, name: nextName, slug: nextName.toLocaleLowerCase().replace(/\s+/g, '-') } : entry))
    }
    if (previousName !== nextName) setProducts(products.map((product) => product.category === previousName ? { ...product, category: nextName } : product))
    setEditingId(null); setEditingName(''); setError('')
  }

  async function deactivateCategory(category: Category) {
    const productCount = products.filter((product) => product.category === category.name).length
    const actionLabel = productCount === 0 ? 'Eliminar' : 'Desactivar'
    const confirmation = productCount === 0
      ? `¿Eliminar la categoría “${category.name}”?`
      : `¿Desactivar la categoría “${category.name}”? Sus productos se ocultarán del catálogo.`
    if (!confirmDestructiveAction(confirmation)) return
    try {
      const updated = await archiveAdminCategory(category.id)
      setCategories((current) => productCount === 0 ? current.filter((entry) => entry.id !== category.id) : current.map((entry) => entry.id === category.id ? updated : entry))
    } catch (requestError) {
      if (!isLocalPreviewError(requestError)) { setError(requestError instanceof ApiClientError ? requestError.message : `No se pudo ${actionLabel.toLocaleLowerCase()} la categoría.`); return }
      setCategories((current) => productCount === 0 ? current.filter((entry) => entry.id !== category.id) : current.map((entry) => entry.id === category.id ? { ...entry, active: false } : entry))
    }
  }

  return <><PageHead kicker="Estructura" title="Categorías" copy="Una estructura simple para que cada pieza encuentre su lugar." action={<button className="button button-primary" type="button" onClick={() => document.getElementById('new-category')?.focus()}><Icon icon={icons.plus} /> Nueva categoría</button>} /><section className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Orden de categorías</span><h2>Cómo se muestra tu colección</h2></div></div><div className="category-list">{categories.map((category, index) => { const productCount = products.filter((product) => product.category === category.name).length; const canRemove = category.active || productCount === 0; return <div className="category-row" key={category.id}><div className="category-reorder"><button className="icon-button" type="button" aria-label={`Subir ${category.name}`} disabled={index === 0} onClick={() => void moveCategory(index, -1)}><Icon icon={icons.chevronUp} /></button><button className="icon-button" type="button" aria-label={`Bajar ${category.name}`} disabled={index === categories.length - 1} onClick={() => void moveCategory(index, 1)}><Icon icon={icons.chevronDown} /></button></div><span className="category-order">{String(index + 1).padStart(2, '0')}</span><div>{editingId === category.id ? <input className="input" value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveCategory(category) } }} aria-label={`Nombre de ${category.name}`} /> : <><strong>{category.name}</strong><small>{productCount} productos</small></>}</div><span className={`status-badge ${category.active ? 'status-confirmed' : 'status-discarded'}`}><span />{category.active ? 'Activa' : 'Inactiva'}</span><div className="category-actions">{editingId === category.id ? <button className="button button-ghost" type="button" onClick={() => void saveCategory(category)}>Guardar</button> : <button className="icon-button" type="button" aria-label={`Editar ${category.name}`} onClick={() => { setEditingId(category.id); setEditingName(category.name); setError('') }}><Icon icon={icons.pen} /></button>}{canRemove && <button className="icon-button" type="button" aria-label={`${productCount === 0 ? 'Eliminar' : 'Desactivar'} ${category.name}`} title={productCount === 0 ? 'Eliminar categoría' : 'Desactivar categoría'} onClick={() => void deactivateCategory(category)}><Icon icon={productCount === 0 ? icons.trash : icons.xmark} /></button>}</div></div> })}</div>{error && <div className="inline-notice is-error" role="alert">{error}</div>}</section><form className="admin-panel form-panel" onSubmit={(event) => void addCategory(event)}><span className="eyebrow">Nueva categoría</span><h2>Agrega una nueva forma de explorar</h2><div className="form-grid"><label>Nombre<input id="new-category" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Pulseras" /></label><label>Slug<input className="input" value={name.toLowerCase().trim().replace(/\s+/g, '-')} readOnly aria-label="Slug generado" /></label><label>Orden<input className="input" value={categories.length + 1} type="number" readOnly /></label></div><button className="button button-primary" type="submit">Guardar categoría</button></form></>
}

function PromotionsPage({ products }: { products: Product[] }) {
  const [previewQuantity, setPreviewQuantity] = useState(3)
  const [editorOpen, setEditorOpen] = useState(false)
  const [promoKind, setPromoKind] = useState<Promotion['kind']>('BUNDLE')
  const [targetCategory, setTargetCategory] = useState('Anillos')
  const [bundleQuantity, setBundleQuantity] = useState('3')
  const [bundlePrice, setBundlePrice] = useState('10')
  const [fixedDiscount, setFixedDiscount] = useState('2')
  const [promoName, setPromoName] = useState('')
  const [promoSaved, setPromoSaved] = useState(false)
  const [promoError, setPromoError] = useState('')
  const [promotions, setPromotions] = useState<Promotion[]>([{ id: 'promo-3x10', name: '3 anillos por $10', kind: 'BUNDLE', targetCategory: 'Anillos', bundleQuantity: 3, bundlePriceCents: 1000, active: true }])
  const [promotionCategories, setPromotionCategories] = useState<string[]>([])

  useEffect(() => {
    let active = true
    fetchAdminPromotions().then((remote) => { if (active) setPromotions(remote) }).catch(() => undefined)
    fetchAdminCategories().then((remote) => { if (active) setPromotionCategories(remote.filter((category) => category.active).map((category) => category.name)) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const activePromotion = promotions.find((promotion) => promotion.active)
  const eligible = products.filter((product) => product.promoEligible).slice(0, 1)
  const quote = quoteCart(eligible.length ? [{ productId: eligible[0].id, quantity: previewQuantity }] : [], products, activePromotion ?? null)
  const targetCategories = [...new Set([...promotionCategories, ...products.map((product) => product.category)])]

  async function savePromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const quantity = Number(bundleQuantity)
    const price = Number(bundlePrice.replace(',', '.'))
    const discount = Number(fixedDiscount.replace(',', '.'))
    if (promoKind === 'BUNDLE' && (!Number.isInteger(quantity) || quantity < 2 || !Number.isFinite(price) || price < 0)) { setPromoError('La cantidad debe ser un entero mayor que uno y el precio no puede ser negativo.'); return }
    if (promoKind === 'FIXED_DISCOUNT' && (!Number.isFinite(discount) || discount < 0)) { setPromoError('El descuento debe ser un número no negativo.'); return }
    const input = promoKind === 'BUNDLE' ? { name: promoName.trim() || `${quantity} piezas por $${price}`, kind: 'BUNDLE' as const, targetCategory: targetCategory || undefined, bundleQuantity: quantity, bundlePriceCents: Math.round(price * 100), active: true } : { name: promoName.trim() || `Descuento de $${discount}`, kind: 'FIXED_DISCOUNT' as const, targetCategory: targetCategory || undefined, fixedDiscountCents: Math.round(discount * 100), active: true }
    try {
      const created = await createAdminPromotion(input)
      setPromotions((current) => [...current, created])
    } catch (requestError) {
      if (!isLocalPreviewError(requestError)) { setPromoError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo guardar la promoción.'); return }
      setPromotions((current) => [...current.map((promotion) => ({ ...promotion, active: false })), { id: `promotion-${Date.now()}`, ...input }])
    }
    setPromoError(''); setPromoSaved(true); setEditorOpen(false); setPromoName(''); window.setTimeout(() => setPromoSaved(false), 2500)
  }

  async function deactivate(promotion: Promotion) {
    if (!confirmDestructiveAction(`¿Desactivar la promoción “${promotion.name}”?`)) return
    try {
      const updated = await archiveAdminPromotion(promotion.id)
      setPromotions((current) => current.map((entry) => entry.id === promotion.id ? updated : entry))
    } catch (requestError) {
      if (!isLocalPreviewError(requestError)) { setPromoError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo desactivar la promoción.'); return }
      setPromotions((current) => current.map((entry) => entry.id === promotion.id ? { ...entry, active: false } : entry))
    }
  }

  return <><PageHead kicker="Reglas comerciales" title="Promociones" copy="Haz que cada oferta se entienda en un vistazo." action={<button className="button button-primary" type="button" onClick={() => setEditorOpen(true)}><Icon icon={icons.plus} /> Nueva promoción</button>} />{editorOpen && <form className="admin-panel form-panel promotion-editor" onSubmit={(event) => void savePromotion(event)}><div className="panel-header"><div><span className="eyebrow">Nueva regla</span><h2>Configura una promoción</h2></div><button className="button button-ghost" type="button" onClick={() => setEditorOpen(false)}>Cancelar</button></div>{promoError && <div className="inline-notice is-error" role="alert">{promoError}</div>}<div className="mode-toggle" aria-label="Tipo de promoción"><button className={promoKind === 'BUNDLE' ? 'is-active' : ''} type="button" onClick={() => setPromoKind('BUNDLE')}>Combo</button><button className={promoKind === 'FIXED_DISCOUNT' ? 'is-active' : ''} type="button" onClick={() => setPromoKind('FIXED_DISCOUNT')}>Descuento fijo</button></div><div className="form-grid"><label>Nombre de la promoción<input className="input" value={promoName} onChange={(event) => setPromoName(event.target.value)} placeholder="Ej. Combo de lanzamiento" /></label><label>Categoría objetivo<select className="input" value={targetCategory} onChange={(event) => setTargetCategory(event.target.value)}><option value="">Todas</option>{targetCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>{promoKind === 'BUNDLE' ? <><label>Cantidad de piezas<input className="input" type="number" min="2" step="1" value={bundleQuantity} onChange={(event) => setBundleQuantity(event.target.value)} /></label><label>Precio del combo USD<input className="input" inputMode="decimal" value={bundlePrice} onChange={(event) => setBundlePrice(event.target.value)} /></label></> : <label>Descuento USD<input className="input" inputMode="decimal" value={fixedDiscount} onChange={(event) => setFixedDiscount(event.target.value)} /></label>}</div><label className="checkbox-label"><input type="checkbox" defaultChecked /> Repetible con piezas mixtas</label><button className="button button-primary" type="submit"><Icon icon={icons.check} /> Guardar promoción</button></form>}{promoSaved && <div className="inline-notice is-success" role="status"><Icon icon={icons.check} /> Promoción guardada.</div>}<div className="promotion-layout"><section className="admin-panel"><div className="promo-list">{promotions.length === 0 && <div className="admin-empty"><Icon icon={icons.tag} /><h3>Aún no hay promociones</h3><p>Crea una regla para activar una oferta.</p></div>}{promotions.map((promotion) => <div className={`promo-list-card${promotion.active ? '' : ' muted-promo'}`} key={promotion.id}><div className="promo-list-icon"><Icon icon={promotion.kind === 'BUNDLE' ? icons.bolt : icons.tag} /></div><div><span className={`status-badge ${promotion.active ? 'status-confirmed' : 'status-discarded'}`}><span />{promotion.active ? 'Activa' : 'Inactiva'}</span><h2>{promotion.name}</h2><p>{promotion.kind === 'BUNDLE' ? `Combo · ${promotion.targetCategory ?? 'Todas'} · ${promotion.bundleQuantity ?? 0} piezas` : `Descuento fijo · ${formatUsd(promotion.fixedDiscountCents ?? 0)}`}</p></div>{promotion.active && <button className="icon-button" type="button" aria-label={`Desactivar ${promotion.name}`} onClick={() => void deactivate(promotion)}><Icon icon={icons.xmark} /></button>}</div>)}</div></section><aside className="admin-panel rule-preview"><span className="eyebrow">Vista rápida</span><h2>La regla se entiende así</h2><p>Comprueba el resultado antes de publicar.</p><div className="quantity-preview">{[1, 2, 3, 6].map((quantity) => <button type="button" key={quantity} className={previewQuantity === quantity ? 'is-active' : ''} onClick={() => setPreviewQuantity(quantity)}>{quantity}</button>)}</div><div className="rule-values"><div><span>{previewQuantity} pieza{previewQuantity !== 1 ? 's' : ''}</span><strong>{formatUsd(quote.totalCents)}</strong></div><div><span>Descuento</span><strong className="discount">{formatUsd(quote.discountCents)}</strong></div></div><div className="promo-preview-banner"><span>{activePromotion?.kind === 'FIXED_DISCOUNT' ? activePromotion.name : `${activePromotion?.bundleQuantity ?? 3}×${formatUsd(activePromotion?.bundlePriceCents ?? 1000)}`}</span><strong>Arma el combo,<br />elige tu actitud.</strong><button className="button button-primary" type="button" onClick={() => navigate('/')}>Elegir mis piezas</button></div></aside></div></>
}

function OrdersPage({ orderId, products, setProducts, orders, setOrders }: { orderId?: string; products: Product[]; setProducts: (products: Product[]) => void; orders: Order[]; setOrders: (orders: Order[]) => void }) {
  const [filter, setFilter] = useState<'ALL' | OrderStatus>('ALL')
  const selected = orderId ? orders.find((order) => order.id === orderId || order.reference === orderId) : undefined
  // Legacy local-preview orders predate fulfillment snapshots; keep their
  // original disabled terminal controls while new orders use the expanded flow.
  if (selected && selected.fulfillmentTypeSnapshot === undefined) return <OrderDetail order={selected} products={products} setProducts={setProducts} orders={orders} setOrders={setOrders} />
  if (selected) return <OrderDetailV2 order={selected} products={products} setProducts={setProducts} orders={orders} setOrders={setOrders} />
  const visible = filter === 'ALL' ? orders : orders.filter((order) => order.status === filter)
  const openOrder = (id: string) => navigate(`/admin/pedidos/${id}`)
  return <><PageHead kicker="Operación" title="Pedidos" copy="Cada intención empieza aquí. Solo una venta concretada cuenta como venta." /><div className="order-filter-row">{[['ALL', 'Todos'], ['PENDING', 'Pendientes'], ['CONFIRMED', 'Concretados'], ['DISCARDED', 'Descartados']].map(([value, label]) => <button key={value} type="button" className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value as typeof filter)}>{label}<span>{value === 'ALL' ? orders.length : orders.filter((order) => order.status === value).length}</span></button>)}</div><section className="admin-panel orders-panel"><div className="admin-table-wrap"><table className="admin-table orders-table"><thead><tr><th>Referencia</th><th>Fecha</th><th>Items</th><th>Total</th><th>Moneda</th><th>Tasa</th><th>Estado</th><th aria-label="Acciones" /></tr></thead><tbody>{visible.map((order) => <tr key={order.id} tabIndex={0} aria-label={`Abrir pedido ${order.reference}`} onClick={() => openOrder(order.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openOrder(order.id) } }}><td><strong className="order-ref">{order.reference}</strong></td><td>{new Date(order.createdAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}</td><td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td><td><strong>{formatUsd(order.quote.totalCents)}</strong></td><td>{order.currency}</td><td>{order.currency === 'Bs' ? <span className={`rate-state${order.rateValidUntil && Date.now() > new Date(order.rateValidUntil).getTime() ? ' rate-expired' : ''}`}><span />{order.rateValidUntil && Date.now() > new Date(order.rateValidUntil).getTime() ? 'Expirada' : 'Válida hoy'}</span> : '—'}</td><td><StatusBadge status={order.status} /></td><td><Icon icon={icons.chevronRight} /></td></tr>)}</tbody></table></div>{visible.length === 0 && <div className="admin-empty"><Icon icon={icons.orders} /><h3>No hay pedidos en este estado</h3><p>Prueba con otro filtro.</p></div>}<div className="admin-mobile-list">{visible.map((order) => <button className="admin-entity-card order-entity" key={order.id} type="button" onClick={() => openOrder(order.id)}><div><strong>{order.reference}</strong><p>{order.items.length} productos · {order.currency === 'USD' ? formatUsd(order.quote.totalCents) : formatBs(order.rateMicros ? convertUsdCentsToBs(order.quote.totalCents, order.rateMicros) : 0)}</p><StatusBadge status={order.status} /></div><Icon icon={icons.chevronRight} /></button>)}</div></section></>
}

function OrdersPageV2({ orderId, products, setProducts, orders, setOrders }: { orderId?: string; products: Product[]; setProducts: (products: Product[]) => void; orders: Order[]; setOrders: (orders: Order[]) => void }) {
  const [filter, setFilter] = useState<'ALL' | OrderStatus>('ALL')
  const selected = orderId ? orders.find((order) => order.id === orderId || order.reference === orderId) : undefined
  // Keep backwards-compatible disabled controls for pre-expansion local orders.
  if (selected && selected.fulfillmentTypeSnapshot === undefined) return <OrderDetail order={selected} products={products} setProducts={setProducts} orders={orders} setOrders={setOrders} />
  if (selected) return <OrderDetailV2 order={selected} products={products} setProducts={setProducts} orders={orders} setOrders={setOrders} />
  const visible = filter === 'ALL' ? orders : orders.filter((order) => order.status === filter)
  const openOrder = (id: string) => navigate(`/admin/pedidos/${id}`)
  const filters: Array<['ALL' | OrderStatus, string]> = [['ALL', 'Todos'], ['PENDING', 'Pendientes'], ['CONFIRMED', 'Concretados'], ['DISCARDED', 'Descartados'], ['CANCELLED', 'Cancelados']]
  return <><PageHead kicker="Operación" title="Pedidos" copy="Cada intención empieza aquí. Solo una venta concretada cuenta como venta." /><div className="order-filter-row">{filters.map(([value, label]) => <button key={value} type="button" className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}<span>{value === 'ALL' ? orders.length : orders.filter((order) => order.status === value).length}</span></button>)}</div><section className="admin-panel orders-panel"><div className="admin-table-wrap"><table className="admin-table orders-table"><thead><tr><th>Referencia</th><th>Fecha</th><th>Modalidad</th><th>Items</th><th>Total</th><th>Estado</th><th aria-label="Acciones" /></tr></thead><tbody>{visible.map((order) => <tr key={order.id} tabIndex={0} aria-label={`Abrir pedido ${order.reference}`} onClick={() => openOrder(order.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openOrder(order.id) } }}><td><strong className="order-ref">{order.reference}</strong></td><td>{new Date(order.createdAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}</td><td>{order.fulfillmentTypeSnapshot === 'PREORDER' ? 'Bajo pedido' : 'Stock'}</td><td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td><td><strong>{formatUsd(order.quote.totalCents)}</strong></td><td><StatusBadge status={order.status} /></td><td><Icon icon={icons.chevronRight} /></td></tr>)}</tbody></table></div>{visible.length === 0 && <div className="admin-empty"><Icon icon={icons.orders} /><h3>No hay pedidos en este estado</h3><p>Prueba con otro filtro.</p></div>}<div className="admin-mobile-list">{visible.map((order) => <button className="admin-entity-card order-entity" key={order.id} type="button" onClick={() => openOrder(order.id)}><div><strong>{order.reference}</strong><p>{order.items.length} productos · {order.fulfillmentTypeSnapshot === 'PREORDER' ? 'Bajo pedido' : order.currency === 'USD' ? formatUsd(order.quote.totalCents) : formatBs(order.rateMicros ? convertUsdCentsToBs(order.quote.totalCents, order.rateMicros) : 0)}</p><StatusBadge status={order.status} /></div><Icon icon={icons.chevronRight} /></button>)}</div></section></>
}

function isLocalPreviewError(error: unknown): boolean {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
  const port = typeof window !== 'undefined' ? window.location.port : ''
  const localPreview = (hostname === 'localhost' || hostname === '127.0.0.1') && (port === '' || port === '4173' || port === '4174')
  return localPreview && error instanceof ApiClientError && (error.code === 'NETWORK_ERROR' || error.status === 404 || (error.code === 'HTTP_ERROR' && error.status === 200))
}

function confirmDestructiveAction(message: string): boolean {
  return typeof window === 'undefined' || typeof window.confirm !== 'function' || window.confirm(message)
}

function OrderDetail({ order, products, setProducts, orders, setOrders }: { order: Order; products: Product[]; setProducts: (products: Product[]) => void; orders: Order[]; setOrders: (orders: Order[]) => void }) {
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const rateExpired = order.currency === 'Bs' && Boolean(order.rateValidUntil && Date.now() > new Date(order.rateValidUntil).getTime())
  async function updateStatus(status: OrderStatus) {
    if (busy) return
    if (status === 'CONFIRMED' && rateExpired) { setNotice('La tasa expiró; actualízala antes de confirmar.'); return }
    setBusy(true)
    try {
      try {
        const remote = status === 'CONFIRMED' ? await confirmAdminOrder(order.id) : await discardAdminOrder(order.id)
        const updated = orders.map((item) => item.id === order.id ? remote : item)
        setOrders(updated)
        saveOrders(updated)
        let stockSynced = true
        if (status === 'CONFIRMED') {
          try { setProducts(await fetchAdminProducts()) } catch { stockSynced = false }
          analytics.track('order_confirmed', { orderReference: remote.reference, promoApplied: Boolean(remote.quote.appliedPromotion), currency: remote.currency })
        }
        setNotice(status === 'CONFIRMED' ? stockSynced ? 'Venta concretada y stock actualizado.' : 'Venta concretada. Recarga para actualizar el stock.' : 'Pedido descartado.')
        return
      } catch (error) {
        if (!isLocalPreviewError(error)) {
          setNotice(error instanceof ApiClientError ? error.message : 'No se pudo actualizar el pedido.')
          return
        }
      }

      // Vite-only preview fallback: retain the same local behavior when no
      // Worker API is mounted at /api.
      if (status === 'CONFIRMED') {
        const conflicts = order.items.filter((item) => (products.find((product) => product.id === item.productId)?.stockQuantity ?? 0) < item.quantity)
        if (conflicts.length) { setNotice(`No hay stock suficiente para ${conflicts.map((item) => item.name).join(', ')}.`); return }
        setProducts(products.map((product) => { const item = order.items.find((line) => line.productId === product.id); return item ? { ...product, stockQuantity: product.stockQuantity - item.quantity } : product }))
      }
      const updated = orders.map((item) => item.id === order.id ? { ...item, status, ...(status === 'CONFIRMED' ? { confirmedAt: new Date().toISOString() } : {}) } : item)
      setOrders(updated)
      saveOrders(updated)
      if (status === 'CONFIRMED') analytics.track('order_confirmed', { orderReference: order.reference, promoApplied: Boolean(order.quote.appliedPromotion), currency: order.currency })
      setNotice(status === 'CONFIRMED' ? 'Venta concretada y stock actualizado.' : 'Pedido descartado.')
    } finally {
      setBusy(false)
    }
  }
  async function refreshRate() {
    if (order.status !== 'PENDING' || order.currency !== 'Bs') return
    if (busy) return
    setBusy(true)
    try {
      try {
        const remote = await refreshAdminOrderRate(order.id)
        const refreshed = orders.map((item) => item.id === order.id ? remote : item)
        setOrders(refreshed)
        saveOrders(refreshed)
        setNotice('Tasa actualizada para este pedido.')
        return
      } catch (error) {
        if (!isLocalPreviewError(error)) {
          setNotice(error instanceof ApiClientError ? error.message : 'No se pudo actualizar la tasa.')
          return
        }
      }
      const nextRate = 36_420_000
      const refreshed = orders.map((item) => item.id === order.id ? { ...item, rateMicros: nextRate, rateValidUntil: endOfCaracasDay(new Date()).toISOString() } : item)
      setOrders(refreshed)
      saveOrders(refreshed)
      setNotice('Tasa actualizada para este pedido.')
    } finally {
      setBusy(false)
    }
  }
  const noticeIsError = notice.includes('No hay') || notice.includes('expiró') || notice.includes('No se pudo') || notice.toLocaleLowerCase().includes('stock')
  return <><button className="back-link" type="button" onClick={() => navigate('/admin/pedidos')}><Icon icon={icons.arrowLeft} /> Pedidos</button><PageHead kicker="Detalle de pedido" title={order.reference} copy={`Creado el ${new Date(order.createdAt).toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'short' })}`} action={<StatusBadge status={order.status} />} />{notice && <div className={`inline-notice ${noticeIsError ? 'is-error' : 'is-success'}`} role="status"><Icon icon={noticeIsError ? icons.warning : icons.check} />{notice}</div>}<div className="order-detail-layout"><section className="admin-panel order-detail-main"><div className="panel-header"><div><span className="eyebrow">Artículos</span><h2>Snapshot del pedido</h2></div><span className="order-ref">{order.reference}</span></div><div className="order-items">{order.items.map((item) => { const product = products.find((entry) => entry.id === item.productId); return <div className="order-item" key={item.productId}><div className="order-item-art">{product && <RingArtwork artwork={product.artwork} label="" />}</div><div><strong>{item.name}</strong><p>{item.sizeLabel} · {formatUsd(item.unitPriceCents)} · {item.quantity} ud.</p></div><strong>{formatUsd(item.lineTotalCents)}</strong></div> })}</div><div className="order-total-block"><span>Subtotal <strong>{formatUsd(order.quote.subtotalCents)}</strong></span><span>Promo <strong className="discount">−{formatUsd(order.quote.discountCents)}</strong></span><span className="total-row">Total <strong>{formatUsd(order.quote.totalCents)}</strong></span>{order.currency === 'Bs' && <span className="bs-total">≈ {formatBs(order.rateMicros ? convertUsdCentsToBs(order.quote.totalCents, order.rateMicros) : 0)}</span>}</div></section><aside className="order-detail-side"><section className="admin-panel"><span className="eyebrow">Metadatos</span><dl className="data-list"><div><dt>Canal</dt><dd>WhatsApp</dd></div><div><dt>Moneda</dt><dd>{order.currency}</dd></div>{order.currency === 'Bs' && <><div><dt>Tasa inicial</dt><dd>Bs {(order.rateMicros! / 1_000_000).toFixed(2)} / USD</dd></div><div><dt>Estado de tasa</dt><dd><span className={rateExpired ? 'rate-state rate-expired' : 'rate-state'}><span />{rateExpired ? 'Expirada' : 'Válida hoy'}</span></dd></div></>}</dl></section><section className="admin-panel order-actions"><span className="eyebrow">Acciones</span><button className="button button-primary" type="button" disabled={busy || order.status !== 'PENDING' || rateExpired} onClick={() => void updateStatus('CONFIRMED')}><Icon icon={icons.check} /> {busy ? 'Guardando…' : 'Concretar venta'}</button><button className="button button-danger" type="button" disabled={busy || order.status !== 'PENDING'} onClick={() => void updateStatus('DISCARDED')}><Icon icon={icons.trash} /> Descartar pedido</button>{order.currency === 'Bs' && order.status === 'PENDING' && <button className="button button-ghost" type="button" disabled={busy} onClick={() => void refreshRate()}><Icon icon={icons.rotate} /> Actualizar tasa</button>}</section></aside></div></>
}

/** Fulfillment-aware order detail used by the expansion workflows. */
function OrderDetailV2({ order, products, setProducts, orders, setOrders }: { order: Order; products: Product[]; setProducts: (products: Product[]) => void; orders: Order[]; setOrders: (orders: Order[]) => void }) {
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const isPreorder = order.fulfillmentTypeSnapshot === 'PREORDER'
  const rateExpired = order.currency === 'Bs' && Boolean(order.rateValidUntil && Date.now() > new Date(order.rateValidUntil).getTime())
  const actionKey = (name: string) => `${name}:${order.id}:${Date.now()}`

  function replaceOrder(next: Order): void {
    const updated = orders.map((item) => item.id === order.id ? next : item)
    setOrders(updated)
    saveOrders(updated)
  }

  async function updateStockStatus(status: 'CONFIRMED' | 'DISCARDED'): Promise<void> {
    if (busy || order.status !== 'PENDING' || (isPreorder && status === 'CONFIRMED')) return
    if (status === 'CONFIRMED' && rateExpired) { setNotice('La tasa expiró; actualízala antes de confirmar.'); return }
    setBusy(true)
    try {
      try {
        const remote = status === 'CONFIRMED' ? await confirmAdminOrder(order.id) : await discardAdminOrder(order.id)
        replaceOrder(remote)
        if (status === 'CONFIRMED') {
          try { setProducts(await fetchAdminProducts()) } catch { /* the next refresh will sync stock */ }
          analytics.track('order_confirmed', { orderReference: remote.reference, promoApplied: Boolean(remote.quote.appliedPromotion), currency: remote.currency })
        }
        setNotice(status === 'CONFIRMED' ? 'Venta concretada y stock actualizado.' : 'Pedido descartado.')
        return
      } catch (error) {
        if (!isLocalPreviewError(error)) { setNotice(error instanceof ApiClientError ? error.message : 'No se pudo actualizar el pedido.'); return }
      }
      if (status === 'CONFIRMED') {
        const conflicts = order.items.filter((item) => (products.find((product) => product.id === item.productId)?.stockQuantity ?? 0) < item.quantity)
        if (conflicts.length) { setNotice(`No hay stock suficiente para ${conflicts.map((item) => item.name).join(', ')}.`); return }
        setProducts(products.map((product) => { const item = order.items.find((line) => line.productId === product.id); return item ? { ...product, stockQuantity: product.stockQuantity - item.quantity } : product }))
      }
      const next: Order = { ...order, status, ...(status === 'CONFIRMED' ? { confirmedAt: new Date().toISOString() } : { discardedAt: new Date().toISOString(), discardReason: 'Descartado por administración', ...(isPreorder ? { preorderStage: 'CANCELLED' as const } : {}) }) }
      replaceOrder(next)
      if (status === 'CONFIRMED') analytics.track('order_confirmed', { orderReference: order.reference, promoApplied: Boolean(order.quote.appliedPromotion), currency: order.currency })
      setNotice(status === 'CONFIRMED' ? 'Venta concretada y stock actualizado.' : 'Pedido descartado.')
    } finally { setBusy(false) }
  }

  async function cancelConfirmedSale(): Promise<void> {
    if (busy || order.status !== 'CONFIRMED') return
    const reason = typeof window !== 'undefined' ? window.prompt('Motivo de cancelación de la venta:', 'Venta cancelada por administración') : 'Venta cancelada por administración'
    if (reason === null || !reason.trim()) return
    setBusy(true)
    try {
      try {
        const remote = await cancelAdminOrder(order.id, reason, actionKey('cancel-sale'))
        replaceOrder(remote)
        if (!isPreorder) { try { setProducts(await fetchAdminProducts()) } catch { /* the next refresh will sync stock */ } }
        setNotice('Venta cancelada. El stock fue devuelto cuando correspondía.')
        return
      } catch (error) {
        if (!isLocalPreviewError(error)) { setNotice(error instanceof ApiClientError ? error.message : 'No se pudo cancelar la venta.'); return }
      }
      const next: Order = { ...order, status: 'CANCELLED', cancelledAt: new Date().toISOString(), cancelReason: reason.trim().slice(0, 240), ...(isPreorder ? { preorderStage: 'CANCELLED' } : {}) }
      if (!isPreorder) setProducts(products.map((product) => { const item = order.items.find((line) => line.productId === product.id); return item ? { ...product, stockQuantity: product.stockQuantity + item.quantity } : product }))
      replaceOrder(next)
      setNotice('Venta cancelada. El stock fue devuelto cuando correspondía.')
    } finally { setBusy(false) }
  }

  function paymentInput(defaultUsdCents: number): { currency: 'USD'; paidAmountMinor: number } | null {
    const defaultAmount = (defaultUsdCents / 100).toFixed(2)
    const value = typeof window !== 'undefined' ? window.prompt('Monto recibido en USD:', defaultAmount) : defaultAmount
    if (value === null) return null
    const amount = Number(value.replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0) { setNotice('Indica un monto válido en USD.'); return null }
    return { currency: 'USD', paidAmountMinor: Math.round(amount * 100) }
  }

  async function recordDeposit(): Promise<void> {
    if (busy || !isPreorder || order.status !== 'PENDING' || order.preorderStage !== 'AWAITING_DEPOSIT') return
    const input = paymentInput(order.depositUsdCents ?? Math.floor(order.quote.totalCents / 2)); if (!input) return
    setBusy(true)
    try {
      try { replaceOrder(await recordAdminPreorderDeposit(order.id, input, actionKey('deposit'))); analytics.track('preorder_deposit_recorded', { orderReference: order.reference }); setNotice('Anticipo registrado. El pedido quedó en proceso.'); return }
      catch (error) { if (!isLocalPreviewError(error)) { setNotice(error instanceof ApiClientError ? error.message : 'No se pudo registrar el anticipo.'); return } }
      replaceOrder({ ...order, status: 'CONFIRMED', confirmedAt: new Date().toISOString(), preorderStage: 'IN_PROCESS', paymentStatus: 'DEPOSIT_PAID', payments: [...(order.payments ?? []), { id: actionKey('payment'), kind: 'DEPOSIT', usdAmountCents: order.depositUsdCents ?? Math.floor(order.quote.totalCents / 2), paidCurrency: 'USD', paidAmountMinor: input.paidAmountMinor, recordedAt: new Date().toISOString() }] })
      analytics.track('preorder_deposit_recorded', { orderReference: order.reference }); setNotice('Anticipo registrado. El pedido quedó en proceso.')
    } finally { setBusy(false) }
  }

  async function markReady(): Promise<void> {
    if (busy || !isPreorder || order.status !== 'CONFIRMED' || order.preorderStage !== 'IN_PROCESS') return
    setBusy(true)
    try {
      try { replaceOrder(await markAdminPreorderReady(order.id)); analytics.track('preorder_ready', { orderReference: order.reference }); setNotice('Pedido marcado como listo.'); return }
      catch (error) { if (!isLocalPreviewError(error)) { setNotice(error instanceof ApiClientError ? error.message : 'No se pudo marcar como listo.'); return } }
      replaceOrder({ ...order, preorderStage: 'READY' }); analytics.track('preorder_ready', { orderReference: order.reference }); setNotice('Pedido marcado como listo.')
    } finally { setBusy(false) }
  }

  async function recordBalance(): Promise<void> {
    if (busy || !isPreorder || order.status !== 'CONFIRMED' || order.preorderStage !== 'READY' || order.paymentStatus !== 'DEPOSIT_PAID') return
    const input = paymentInput(order.balanceUsdCents ?? order.quote.totalCents - (order.depositUsdCents ?? 0)); if (!input) return
    setBusy(true)
    try {
      try { replaceOrder(await recordAdminPreorderBalance(order.id, input, actionKey('balance'))); setNotice('Saldo registrado. Ya puedes marcar el pedido como entregado.'); return }
      catch (error) { if (!isLocalPreviewError(error)) { setNotice(error instanceof ApiClientError ? error.message : 'No se pudo registrar el saldo.'); return } }
      replaceOrder({ ...order, paymentStatus: 'PAID', payments: [...(order.payments ?? []), { id: actionKey('payment'), kind: 'BALANCE', usdAmountCents: order.balanceUsdCents ?? order.quote.totalCents - (order.depositUsdCents ?? 0), paidCurrency: 'USD', paidAmountMinor: input.paidAmountMinor, recordedAt: new Date().toISOString() }] }); setNotice('Saldo registrado. Ya puedes marcar el pedido como entregado.')
    } finally { setBusy(false) }
  }

  async function markDelivered(): Promise<void> {
    if (busy || !isPreorder || order.status !== 'CONFIRMED' || order.preorderStage !== 'READY' || order.paymentStatus !== 'PAID') return
    setBusy(true)
    try {
      try { replaceOrder(await markAdminPreorderDelivered(order.id)); analytics.track('preorder_completed', { orderReference: order.reference }); setNotice('Pedido marcado como entregado.'); return }
      catch (error) { if (!isLocalPreviewError(error)) { setNotice(error instanceof ApiClientError ? error.message : 'No se pudo marcar como entregado.'); return } }
      replaceOrder({ ...order, preorderStage: 'DELIVERED' }); analytics.track('preorder_completed', { orderReference: order.reference }); setNotice('Pedido marcado como entregado.')
    } finally { setBusy(false) }
  }

  async function refreshRate(): Promise<void> {
    if (busy || order.status !== 'PENDING' || order.currency !== 'Bs') return
    setBusy(true)
    try {
      try { replaceOrder(await refreshAdminOrderRate(order.id)); setNotice('Tasa actualizada para este pedido.'); return }
      catch (error) { if (!isLocalPreviewError(error)) { setNotice(error instanceof ApiClientError ? error.message : 'No se pudo actualizar la tasa.'); return } }
      replaceOrder({ ...order, rateMicros: 36_420_000, rateValidUntil: endOfCaracasDay(new Date()).toISOString() }); setNotice('Tasa actualizada para este pedido.')
    } finally { setBusy(false) }
  }

  const noticeIsError = /No |no |expir|válid|motivo|solo /.test(notice)
  const stageLabel = { AWAITING_DEPOSIT: 'Esperando anticipo', IN_PROCESS: 'En proceso', READY: 'Listo para entregar', DELIVERED: 'Entregado', CANCELLED: 'Cancelado' } as const
  const methodLabel = order.shipping?.method === 'PERSONAL' ? 'Entrega personal' : order.shipping?.method === 'YUMMY' ? 'Yummy' : order.shipping?.method === 'NATIONAL' ? `Envío nacional · ${order.shipping.carrier}` : undefined
  const destinationLabel = order.shipping?.method === 'PERSONAL' ? `${order.shipping.deliveryPointName ?? order.shipping.deliveryPointId}${order.shipping.deliveryPointAddress ? ` · ${order.shipping.deliveryPointAddress}` : ''}` : order.shipping?.method === 'YUMMY' ? order.shipping.addressText : order.shipping?.method === 'NATIONAL' ? `${[order.shipping.state, order.shipping.city].filter(Boolean).join(', ') || 'Datos por coordinar por WhatsApp'}${order.shipping.officeText ? ` · ${order.shipping.officeText}` : ''}` : undefined
  return <><button className="back-link" type="button" onClick={() => navigate('/admin/pedidos')}><Icon icon={icons.arrowLeft} /> Pedidos</button><PageHead kicker="Detalle de pedido" title={order.reference} copy={`Creado el ${new Date(order.createdAt).toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'short' })}`} action={<StatusBadge status={order.status} />} />{notice && <div className={`inline-notice ${noticeIsError ? 'is-error' : 'is-success'}`} role="status"><Icon icon={noticeIsError ? icons.warning : icons.check} />{notice}</div>}<div className="order-detail-layout"><section className="admin-panel order-detail-main"><div className="panel-header"><div><span className="eyebrow">Artículos</span><h2>Snapshot del pedido</h2></div><span className="order-ref">{order.reference}</span></div><div className="order-items">{order.items.map((item) => { const product = products.find((entry) => entry.id === item.productId); return <div className="order-item" key={item.productId}><div className="order-item-art">{product && <RingArtwork artwork={product.artwork} label="" />}</div><div><strong>{item.name}</strong><p>{item.sizeLabel} · {formatUsd(item.unitPriceCents)} · {item.quantity} ud.</p></div><strong>{formatUsd(item.lineTotalCents)}</strong></div> })}</div><div className="order-total-block"><span>Subtotal <strong>{formatUsd(order.quote.subtotalCents)}</strong></span><span>Promo <strong className="discount">−{formatUsd(order.quote.discountCents)}</strong></span><span className="total-row">Total <strong>{formatUsd(order.quote.totalCents)}</strong></span>{order.currency === 'Bs' && <span className="bs-total">≈ {formatBs(order.rateMicros ? convertUsdCentsToBs(order.quote.totalCents, order.rateMicros) : 0)}</span>}</div></section><aside className="order-detail-side"><section className="admin-panel"><span className="eyebrow">Metadatos</span><dl className="data-list"><div><dt>Modalidad</dt><dd>{isPreorder ? 'Bajo pedido' : 'Stock'}</dd></div>{isPreorder && order.preorderStage && <div><dt>Etapa</dt><dd>{stageLabel[order.preorderStage]}</dd></div>}{isPreorder && order.paymentStatus && <div><dt>Pago</dt><dd>{order.paymentStatus === 'UNPAID' ? 'Sin pago' : order.paymentStatus === 'DEPOSIT_PAID' ? 'Anticipo recibido' : 'Pagado completo'}</dd></div>}{order.expiresAt && order.status === 'PENDING' && <div><dt>Vence</dt><dd>{new Date(order.expiresAt).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>}{methodLabel && <div><dt>Entrega</dt><dd>{methodLabel}</dd></div>}{destinationLabel && <div><dt>Destino</dt><dd>{destinationLabel}</dd></div>}{order.shipping?.method === 'YUMMY' && order.shipping.quoteExternalId && <div><dt>Referencia Yummy</dt><dd>{order.shipping.quoteExternalId}</dd></div>}<div><dt>Canal</dt><dd>WhatsApp</dd></div><div><dt>Moneda</dt><dd>{order.currency}</dd></div>{order.currency === 'Bs' && <><div><dt>Tasa inicial</dt><dd>Bs {(order.rateMicros! / 1_000_000).toFixed(2)} / USD</dd></div><div><dt>Estado de tasa</dt><dd><span className={rateExpired ? 'rate-state rate-expired' : 'rate-state'}><span />{rateExpired ? 'Expirada' : 'Válida hoy'}</span></dd></div></>}</dl></section><section className="admin-panel order-actions"><span className="eyebrow">Acciones</span>{!isPreorder && order.status === 'PENDING' && <><button className="button button-primary" type="button" disabled={busy || rateExpired} onClick={() => void updateStockStatus('CONFIRMED')}><Icon icon={icons.check} /> {busy ? 'Guardando…' : 'Concretar venta'}</button><button className="button button-danger" type="button" disabled={busy} onClick={() => void updateStockStatus('DISCARDED')}><Icon icon={icons.trash} /> Descartar pedido</button></>}{isPreorder && order.status === 'PENDING' && order.preorderStage === 'AWAITING_DEPOSIT' && <><button className="button button-primary" type="button" disabled={busy} onClick={() => void recordDeposit()}><Icon icon={icons.check} /> Registrar anticipo</button><button className="button button-danger" type="button" disabled={busy} onClick={() => void updateStockStatus('DISCARDED')}><Icon icon={icons.trash} /> Descartar pedido</button></>}{isPreorder && order.status === 'CONFIRMED' && order.preorderStage === 'IN_PROCESS' && <button className="button button-primary" type="button" disabled={busy} onClick={() => void markReady()}><Icon icon={icons.check} /> Marcar listo</button>}{isPreorder && order.status === 'CONFIRMED' && order.preorderStage === 'READY' && order.paymentStatus === 'DEPOSIT_PAID' && <button className="button button-primary" type="button" disabled={busy} onClick={() => void recordBalance()}><Icon icon={icons.check} /> Registrar saldo</button>}{isPreorder && order.status === 'CONFIRMED' && order.preorderStage === 'READY' && order.paymentStatus === 'PAID' && <button className="button button-primary" type="button" disabled={busy} onClick={() => void markDelivered()}><Icon icon={icons.check} /> Marcar entregado</button>}{order.status === 'CONFIRMED' && <button className="button button-danger" type="button" disabled={busy || (isPreorder && order.preorderStage === 'DELIVERED')} onClick={() => void cancelConfirmedSale()}><Icon icon={icons.xmark} /> Cancelar venta y devolver stock</button>}{order.currency === 'Bs' && order.status === 'PENDING' && <button className="button button-ghost" type="button" disabled={busy} onClick={() => void refreshRate()}><Icon icon={icons.rotate} /> Actualizar tasa</button>}{order.status === 'CANCELLED' && <p className="admin-action-note">Venta cancelada{order.cancelReason ? `: ${order.cancelReason}` : ''}.</p>}{order.status === 'DISCARDED' && <p className="admin-action-note">Pedido descartado{order.discardReason ? `: ${order.discardReason}` : ''}.</p>}</section></aside></div></>
}

function localAnalyticsSummary(orders: Order[]): AdminAnalyticsSummary {
  const confirmed = orders.filter((order) => order.status === 'CONFIRMED')
  const pending = orders.filter((order) => order.status === 'PENDING')
  const discarded = orders.filter((order) => order.status === 'DISCARDED')
  const promoConfirmed = confirmed.filter((order) => Boolean(order.quote.appliedPromotion)).length
  return {
    events: 0,
    funnel: { catalog_view: 0, product_view: 0, cart_add: 0, order_intent: orders.length, order_confirmed: confirmed.length },
    sources: orders.length ? { directo: orders.length } : {},
    devices: orders.length ? { desconocido: orders.length } : {},
    traffic: { visits: 0, sessions: 0, pagesPerSession: 0 },
    promo: { started: 0, completed: orders.filter((order) => Boolean(order.quote.appliedPromotion)).length, confirmed: promoConfirmed },
    confirmedOrders: confirmed.length,
    pendingOrders: pending.length,
    discardedOrders: discarded.length,
    confirmedRevenueCents: confirmed.reduce((sum, order) => sum + order.quote.totalCents, 0),
  }
}

function AnalyticsPageLive({ orders }: { orders: Order[] }) {
  const [summary, setSummary] = useState<AdminAnalyticsSummary>(() => localAnalyticsSummary(orders))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([fetchAdminAnalytics(), fetchAdminTraffic()]).then(([remote, traffic]) => { if (active) { setSummary({ ...remote, traffic }); setError('') } }).catch((requestError) => {
      if (!active) return
      setSummary(localAnalyticsSummary(orders))
      if (!isLocalPreviewError(requestError)) setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo cargar la analítica.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [orders])

  const funnelRows = ([
    ['Vistas de catálogo', summary.funnel.catalog_view],
    ['Producto visto', summary.funnel.product_view],
    ['Agregado al carrito', summary.funnel.cart_add],
    ['WhatsApp', summary.funnel.order_intent],
    ['Venta concretada', summary.funnel.order_confirmed],
  ] as const)
  const funnelBase = Math.max(1, ...funnelRows.map(([, value]) => value))
  const sourceEntries = Object.entries(summary.sources).sort(([, a], [, b]) => b - a)
  const deviceEntries = Object.entries(summary.devices).sort(([, a], [, b]) => b - a)
  const hasActivity = summary.events > 0 || summary.funnel.order_intent > 0 || summary.confirmedOrders > 0
  return <><PageHead kicker="Señales anónimas" title="Analítica" copy="Entiende qué productos generan interés y qué termina en una venta real." action={<span className="analytics-retention-note">Retención: 180 días</span>} />{loading && <div className="inline-notice" role="status" aria-live="polite">Cargando señales reales…</div>}{error && <div className="inline-notice is-error" role="alert">{error}</div>}<section className="metrics-grid"><MetricCard label="Ingresos confirmados" value={formatUsd(summary.confirmedRevenueCents)} note="sin contar pendientes" tone="brand" /><MetricCard label="Conversión a venta" value={summary.funnel.order_intent ? `${Math.round((summary.confirmedOrders / summary.funnel.order_intent) * 100)}%` : '0%'} note="de intención a confirmación" /><MetricCard label="Combos confirmados" value={String(summary.promo.confirmed)} note="ventas con promoción" /></section><section className="admin-panel traffic-summary-panel"><div className="panel-header"><div><span className="eyebrow">Tráfico anónimo</span><h2>Visitas a la tienda</h2></div><span className="panel-meta">sin IP, correo ni teléfono</span></div><div className="traffic-summary-grid"><div><strong>{summary.traffic.visits.toLocaleString('es-VE')}</strong><span>Visitas</span></div><div><strong>{summary.traffic.sessions.toLocaleString('es-VE')}</strong><span>Sesiones</span></div><div><strong>{summary.traffic.pagesPerSession.toLocaleString('es-VE', { maximumFractionDigits: 2 })}</strong><span>Páginas por sesión</span></div></div><p className="admin-panel-note">Una visita es una carga del catálogo. Las sesiones usan un identificador aleatorio temporal del navegador.</p></section><section className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Señales de navegación</span><h2>{hasActivity ? 'Embudo de la tienda' : 'Aún no hay señales'}</h2></div></div>{hasActivity ? <div className="funnel-list">{funnelRows.map(([label, value]) => <div className="funnel-row" key={label}><span>{label}</span><div className="progress-bar"><span style={{ width: `${Math.round((value / funnelBase) * 100)}%` }} /></div><strong>{value.toLocaleString('es-VE')}</strong></div>)}</div> : <div className="admin-empty"><Icon icon={icons.chart} /><h3>Sin eventos todavía</h3><p>Las señales anónimas aparecerán cuando haya actividad.</p></div>}</section><div className="analytics-grid"><section className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Fuentes</span><h2>De dónde llega la gente</h2></div></div>{sourceEntries.length ? <div className="traffic-list">{sourceEntries.map(([label, value]) => { const total = Math.max(1, sourceEntries.reduce((sum, [, count]) => sum + count, 0)); const percentage = Math.round((value / total) * 100); return <div className="traffic-row" key={label}><span>{label}</span><div className="progress-bar"><span style={{ width: `${percentage}%` }} /></div><strong>{percentage}%</strong></div> })}</div> : <div className="admin-empty"><p>No hay fuentes registradas todavía.</p></div>}</section><section className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Dispositivos</span><h2>Cómo visitan la tienda</h2></div></div>{deviceEntries.length ? <div className="traffic-list">{deviceEntries.map(([label, value]) => <div className="traffic-row" key={label}><span>{label}</span><div className="progress-bar"><span style={{ width: `${Math.round((value / Math.max(1, summary.events)) * 100)}%` }} /></div><strong>{value.toLocaleString('es-VE')}</strong></div>)}</div> : <div className="admin-empty"><p>No hay dispositivos registrados todavía.</p></div>}</section></div><section className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Ventas reales</span><h2>Estado de pedidos</h2></div></div><div className="order-breakdown"><div><span className="breakdown-dot confirmed" /><strong>{summary.confirmedOrders}</strong><small>Concretados</small></div><div><span className="breakdown-dot pending" /><strong>{summary.pendingOrders}</strong><small>Pendientes</small></div><div><span className="breakdown-dot discarded" /><strong>{summary.discardedOrders}</strong><small>Descartados</small></div></div></section></>
}
const localSettingsDefaults: StoreSettings = { whatsappPhone: '584120000000', whatsappIntro: 'Hola, quiero pedir estos productos de CORU.', storeName: 'CORU', instagramUrl: '@coru', facebookUrl: 'CORU', privacyUrl: '/privacidad', storeActive: true }

function formatRateMicros(rateMicros: number | null | undefined): string {
  if (!rateMicros || rateMicros <= 0) return '—'
  const whole = Math.floor(rateMicros / 1_000_000)
  const fraction = String(rateMicros % 1_000_000).padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole},${fraction}` : String(whole)
}

function SettingsPageLive() {
  const [settings, setSettings] = useState<StoreSettings>(localSettingsDefaults)
  const [mode, setMode] = useState<'automatic' | 'manual'>('automatic')
  const [rate, setRate] = useState<AdminRateResponse | null>(null)
  const [manualRate, setManualRate] = useState('36,42')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([fetchAdminSettings(), fetchAdminRate()]).then(([remoteSettings, remoteRate]) => {
      if (!active) return
      setSettings(remoteSettings)
      setMode(remoteRate.mode === 'MANUAL' ? 'manual' : 'automatic')
      setRate(remoteRate)
      setManualRate(formatRateMicros(remoteRate.rateMicros))
    }).catch((requestError) => {
      if (active && !isLocalPreviewError(requestError)) setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudieron cargar los ajustes.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function saveSettings() {
    if (saving) return
    const normalizedPhone = settings.whatsappPhone.replace(/\s/g, '').replace(/[()-]/g, '')
    const numericRate = manualRate.replace(',', '.').trim()
    if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) { setError('El número debe usar formato internacional, por ejemplo +584120000000.'); return }
    if (mode === 'manual' && (!Number.isFinite(Number(numericRate)) || Number(numericRate) <= 0)) { setError('La tasa manual debe ser mayor que cero.'); return }
    setSaving(true); setError('')
    try {
      let nextSettings = settings
      let nextRate = rate
      try {
        nextSettings = await updateAdminSettings({ ...settings, whatsappPhone: normalizedPhone })
        nextRate = mode === 'manual' ? await updateAdminRate({ rate: numericRate }) : await updateAdminRate({ mode: 'AUTOMATIC' })
      } catch (requestError) {
        if (!isLocalPreviewError(requestError)) throw requestError
        nextSettings = { ...settings, whatsappPhone: normalizedPhone.slice(1) }
        nextRate = mode === 'manual' ? { available: true, rateMicros: Math.round(Number(numericRate) * 1_000_000), mode: 'MANUAL', updatedAt: new Date().toISOString(), validUntil: new Date().toISOString() } : rate
      }
      setSettings(nextSettings); setRate(nextRate); setSaved(true); window.setTimeout(() => setSaved(false), 2500)
    } catch (requestError) { setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudieron guardar los ajustes.') }
    finally { setSaving(false) }
  }

  async function refreshCurrentRate() {
    if (mode !== 'automatic' || refreshing) return
    setRefreshing(true); setError('')
    try {
      const refreshed = await refreshAdminRate()
      setRate(refreshed)
      setManualRate(formatRateMicros(refreshed.rateMicros))
    } catch (requestError) {
      if (isLocalPreviewError(requestError)) setRate((current) => current)
      else setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo actualizar la tasa.')
    } finally { setRefreshing(false) }
  }

  async function deactivateStore() {
    if (!settings.storeActive) return
    if (!confirmDestructiveAction('¿Desactivar la tienda? El catálogo público dejará de recibir pedidos.')) return
    setError('')
    try {
      const updated = await updateAdminSettings({ storeActive: false })
      setSettings(updated)
    } catch (requestError) {
      if (!isLocalPreviewError(requestError)) { setError(requestError instanceof ApiClientError ? requestError.message : 'No se pudo desactivar la tienda.'); return }
      setSettings((current) => ({ ...current, storeActive: false }))
    }
  }

  const shownPhone = settings.whatsappPhone.startsWith('+') ? settings.whatsappPhone : `+${settings.whatsappPhone}`
  const rateText = mode === 'manual' && manualRate ? manualRate : formatRateMicros(rate?.rateMicros)
  const rateUpdated = rate?.updatedAt ? new Date(rate.updatedAt).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' }) : 'sin actualización'
  return <><PageHead kicker="Operación" title="Ajustes" copy="Las pocas opciones que mantienen la tienda lista para vender." action={<button className="button button-primary" type="button" onClick={() => void saveSettings()} disabled={saving}>{saving ? 'Guardando…' : <><Icon icon={icons.check} /> Guardar cambios</>}</button>} />{loading && <div className="inline-notice" role="status">Cargando configuración…</div>}{error && <div className="inline-notice is-error" role="alert">{error}</div>}{saved && <div className="inline-notice is-success" role="status"><Icon icon={icons.check} /> Cambios guardados.</div>}<div className="settings-grid"><section className="admin-panel form-panel"><span className="eyebrow">WhatsApp</span><h2>Destino y mensaje inicial</h2><label>Número destino<input className="input" value={shownPhone} onChange={(event) => setSettings((current) => ({ ...current, whatsappPhone: event.target.value }))} inputMode="tel" /></label><label>Mensaje inicial<textarea className="textarea" value={settings.whatsappIntro} onChange={(event) => setSettings((current) => ({ ...current, whatsappIntro: event.target.value }))} /></label><small>El resumen del carrito se añade automáticamente.</small></section><section className="admin-panel form-panel"><span className="eyebrow">Moneda y tasa</span><h2>Cómo mostramos Bs</h2><div className="mode-toggle"><button className={mode === 'automatic' ? 'is-active' : ''} type="button" onClick={() => setMode('automatic')}>Automática</button><button className={mode === 'manual' ? 'is-active' : ''} type="button" onClick={() => setMode('manual')}>Manual</button></div><div className="rate-card"><span>Tasa actual</span><strong>Bs {rateText || '—'} / USD</strong><small>{rate?.available ? `Actualizada ${rateUpdated}` : 'No disponible'}</small></div>{mode === 'automatic' && <button className="button button-ghost" type="button" onClick={() => void refreshCurrentRate()} disabled={refreshing}>{refreshing ? 'Actualizando…' : 'Actualizar tasa'}</button>}{mode === 'manual' && <label>Tasa manual<input className="input" value={manualRate} onChange={(event) => setManualRate(event.target.value)} inputMode="decimal" /></label>}</section><section className="admin-panel form-panel"><span className="eyebrow">Tienda</span><h2>Datos públicos</h2><label>Nombre<input className="input" value={settings.storeName} onChange={(event) => setSettings((current) => ({ ...current, storeName: event.target.value }))} /></label><div className="form-grid"><label>Instagram<input className="input" value={settings.instagramUrl} onChange={(event) => setSettings((current) => ({ ...current, instagramUrl: event.target.value }))} /></label><label>Facebook<input className="input" value={settings.facebookUrl} onChange={(event) => setSettings((current) => ({ ...current, facebookUrl: event.target.value }))} /></label></div><label>Política de privacidad<input className="input" value={settings.privacyUrl} onChange={(event) => setSettings((current) => ({ ...current, privacyUrl: event.target.value }))} /></label></section><section className="admin-panel danger-panel"><span className="eyebrow">Zona de riesgo</span><h2>Desactivar la tienda</h2><p>Oculta temporalmente el catálogo público. Los pedidos existentes no se borran.</p><button className="button button-danger" type="button" onClick={() => void deactivateStore()} disabled={!settings.storeActive}>{settings.storeActive ? 'Desactivar tienda' : 'Tienda desactivada'}</button></section></div></>
}
