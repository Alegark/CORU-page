import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, icons } from '../ui/Icon'
import { formatCurrencyAmount, formatUsd, quoteCart } from '../../../shared/commerce'
import { createOrderIntent } from '../../../shared/orders'
import type { Order, Product, ShippingSelection, PersonalDeliveryPoint } from '../../../shared/types'
import type { YummyQuoteResponse } from '../../../shared/contracts'
import { useCart } from '../../features/cart/CartContext'
import { RingArtwork } from './RingArtwork'
import { analytics } from '../../analytics/client'
import { RateLockNotice } from './RateLockNotice'
import { ApiClientError, fetchPersonalDeliveryPoints, requestYummyQuote } from '../../api/client'
import { createOrderIntentRemote } from '../../features/orders/orderIntent'
import { PersonalDeliveryPointMap } from './PersonalDeliveryPointMap'

function isVitePreview(): boolean {
  const hostname = window.location.hostname
  const port = window.location.port
  return (hostname === 'localhost' || hostname === '127.0.0.1') && (port === '' || port === '4173' || port === '4174')
}

function readDurationMs(variable: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  const match = raw.match(/^(-?(?:\d+\.?\d*|\.\d+))(ms|s)?$/i)
  if (!match) return fallback
  const value = Number(match[1])
  if (!Number.isFinite(value)) return fallback
  return value * (match[2]?.toLowerCase() === 's' ? 1000 : 1)
}

export function CartOverlay({ products, open, onClose, onOrderCreated, rateMicros = 36_420_000, rateAvailable = true }: { products: Product[]; open: boolean; onClose: () => void; onOrderCreated: (order: Order) => void; rateMicros?: number | null; rateAvailable?: boolean }) {
  const { lines, currency, setQuantity, remove, clear, itemCount, promotion } = useCart()
  const [mounted, setMounted] = useState(open)
  const [animationState, setAnimationState] = useState<'closed' | 'open' | 'closing'>('closed')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [deliveryPoints, setDeliveryPoints] = useState<PersonalDeliveryPoint[]>([])
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>('PERSONAL')
  const [deliveryPointId, setDeliveryPointId] = useState('coru-punto-central')
  const [national, setNational] = useState<{ carrier: 'MRW' | 'ZOOM'; state: string; city: string; officeText: string }>({ carrier: 'MRW', state: '', city: '', officeText: '' })
  const [yummyAddress, setYummyAddress] = useState('')
  const [yummyQuote, setYummyQuote] = useState<YummyQuoteResponse | null>(null)
  const [yummyQuoteLoading, setYummyQuoteLoading] = useState(false)
  const yummyQuoteVersion = useRef(0)
  const closeButton = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const closeTimer = useRef<number | null>(null)
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const visibleLines = lines.map((line) => ({ ...line, product: productById.get(line.productId) })).filter((line): line is typeof line & { product: Product } => Boolean(line.product))
  const stockLines = lines.filter((line) => (productById.get(line.productId)?.fulfillmentType ?? 'STOCK') === 'STOCK')
  const preorderLines = lines.filter((line) => (productById.get(line.productId)?.fulfillmentType ?? 'STOCK') === 'PREORDER')
  const hasStock = stockLines.length > 0
  const hasPreorder = preorderLines.length > 0
  const showPreorderNote = hasPreorder && visibleLines.some(({ product }) => (product.fulfillmentType ?? 'STOCK') === 'PREORDER')
  const personalPoints = deliveryPoints.length ? deliveryPoints : (isVitePreview() ? [{ id: 'coru-punto-central', name: 'Punto CORU · Centro', address: 'Punto coordinado por CORU', active: true, sortOrder: 1 } satisfies PersonalDeliveryPoint] : [])
  const quote = quoteCart(lines, products, promotion)
  const usableRate = rateAvailable && rateMicros && rateMicros > 0 ? rateMicros : null
  const displayAmount = (usdCents: number) => formatCurrencyAmount(usdCents, currency, usableRate)

  useEffect(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }

    if (open) {
      setMounted(true)
      setAnimationState('closed')
      const frame = window.requestAnimationFrame(() => setAnimationState('open'))
      return () => window.cancelAnimationFrame(frame)
    }

    if (!mounted) {
      setAnimationState('closed')
      return
    }

    setAnimationState('closing')
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const closeMs = reducedMotion ? 1 : readDurationMs('--panel-close-dur', 350)
    closeTimer.current = window.setTimeout(() => {
      setMounted(false)
      setAnimationState('closed')
      closeTimer.current = null
    }, closeMs)

    return () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
    }
  }, [open])

  useEffect(() => {
    if (!open || !hasStock) return
    fetchPersonalDeliveryPoints().then((points) => { setDeliveryPoints(points); if (points[0]) setDeliveryPointId((current) => points.some((point) => point.id === current) ? current : points[0].id) }).catch(() => undefined)
  }, [open, hasStock])

  useEffect(() => {
    if (!open || !mounted) return
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      previouslyFocused.current?.focus()
      previouslyFocused.current = null
    }
  }, [open, mounted])

  useEffect(() => {
    if (!open) {
      setCreateError('')
      setYummyQuote(null)
      setYummyQuoteLoading(false)
      yummyQuoteVersion.current += 1
    }
  }, [open])

  async function handleCreateOrder() {
    if (!visibleLines.length || creating) return
    setCreating(true)
    setCreateError('')
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 220))
      const key = `intent-${Date.now()}-${Math.random()}`
      if (currency === 'Bs' && !usableRate) { setCreateError('La tasa no está disponible. Continúa en USD por ahora.'); return }
      if (hasStock && shippingMethod === 'PERSONAL' && !personalPoints.length) { setCreateError('No hay puntos personales activos. Elige Yummy o Nacional, o inténtalo más tarde.'); return }
      if (hasStock && shippingMethod === 'YUMMY' && yummyAddress.trim().length < 5) { setCreateError('Indica una dirección válida para Yummy.'); return }
      if (hasStock && shippingMethod === 'NATIONAL' && (!national.state.trim() || !national.city.trim())) { setCreateError('Indica estado y ciudad para el envío nacional.'); return }
      const groups = [ ...(hasStock ? [{ lines: stockLines, shipping: shippingSelection() }] : []), ...(hasPreorder ? [{ lines: preorderLines, shipping: null }] : []) ]
      let lastOrder: Order | null = null
      for (const [index, group] of groups.entries()) {
        const groupKey = `${key}-${index}`
        let order: Order
        try {
          const remote = await createOrderIntentRemote({ lines: group.lines, currency, ...(currency === 'Bs' && usableRate ? { rateMicros: usableRate } : {}), ...(group.shipping ? { shipping: group.shipping } : {}) }, groupKey)
          order = remote
        } catch (error) {
          const localPreview = isVitePreview() && error instanceof ApiClientError && (error.code === 'NETWORK_ERROR' || error.status === 404 || (error.code === 'HTTP_ERROR' && error.status === 200))
          if (!localPreview) throw error
          order = createOrderIntent(group.lines, currency, currency === 'Bs' ? usableRate! : undefined, products, groupKey).order
        }
        try { window.open(order.whatsappUrl, '_blank', 'noopener,noreferrer') } catch { /* feedback remains available */ }
        lastOrder = order
        if (group.shipping) analytics.track('shipping_method_selected', { shipping_method: group.shipping.method })
        analytics.track('order_intent', { orderReference: order.reference, promoApplied: Boolean(order.quote.appliedPromotion), currency: order.currency, fulfillment_type: order.fulfillmentTypeSnapshot ?? 'STOCK' })
        onOrderCreated(order)
      }
      if (lastOrder) {
        // WhatsApp is the confirmation step. Clear the local cart and close
        // the drawer so the same intent cannot be submitted twice by mistake.
        clear()
        onClose()
      }
    } catch (error) {
      const unavailable = (error instanceof ApiClientError && error.code === 'PRODUCT_UNAVAILABLE') || (error instanceof Error && error.message === 'PRODUCT_UNAVAILABLE')
      if (error instanceof ApiClientError && error.code === 'DELIVERY_POINT_UNAVAILABLE') {
        const details = error.details && typeof error.details === 'object' ? error.details as { points?: unknown } : undefined
        const freshPoints = Array.isArray(details?.points) ? details.points.filter((point): point is PersonalDeliveryPoint => Boolean(point && typeof point === 'object' && typeof (point as Record<string, unknown>).id === 'string' && typeof (point as Record<string, unknown>).name === 'string' && typeof (point as Record<string, unknown>).address === 'string')) : []
        if (freshPoints.length) { setDeliveryPoints(freshPoints); setDeliveryPointId(freshPoints[0].id) }
        setCreateError('Ese punto ya no está disponible. Selecciona uno actualizado para continuar.')
      } else setCreateError(unavailable ? 'Una pieza del carrito se agotó. Ajusta tu selección para continuar.' : 'No pudimos crear el pedido. Inténtalo de nuevo.')
    } finally {
      setCreating(false)
    }
  }

  type ShippingMethod = 'PERSONAL' | 'YUMMY' | 'NATIONAL'
  function shippingSelection(): ShippingSelection {
    if (shippingMethod === 'YUMMY') return { method: 'YUMMY', addressText: yummyAddress.trim(), ...(yummyQuote?.status === 'quoted' && yummyQuote.externalId ? { quoteReference: yummyQuote.externalId } : {}) }
    if (shippingMethod === 'NATIONAL') return { method: 'NATIONAL', carrier: national.carrier, state: national.state.trim(), city: national.city.trim(), ...(national.officeText.trim() ? { officeText: national.officeText.trim() } : {}) }
    return { method: 'PERSONAL', deliveryPointId: deliveryPointId || personalPoints[0]?.id || 'coru-punto-central' }
  }

  async function quoteYummy(): Promise<void> {
    const addressText = yummyAddress.trim()
    if (addressText.length < 5 || yummyQuoteLoading) return
    const version = ++yummyQuoteVersion.current
    setYummyQuoteLoading(true)
    setYummyQuote(null)
    analytics.track('yummy_quote_requested', { method: 'YUMMY' })
    try {
      const result = await requestYummyQuote({ addressText })
      if (version !== yummyQuoteVersion.current) return
      setYummyQuote(result)
      analytics.track(result.status === 'quoted' ? 'yummy_quote_succeeded' : 'yummy_quote_failed', { method: 'YUMMY' })
    } catch {
      if (version !== yummyQuoteVersion.current) return
      setYummyQuote({ status: 'error', fallbackCopy: 'Costo de delivery a confirmar por WhatsApp.' })
      analytics.track('yummy_quote_failed', { method: 'YUMMY' })
    } finally { if (version === yummyQuoteVersion.current) setYummyQuoteLoading(false) }
  }

  if (!mounted) return null

  return (
    <div className="overlay-root">
      <button className="overlay-scrim" data-open={animationState === 'open'} type="button" onClick={onClose} aria-label="Cerrar carrito" />
      <aside className="cart-panel t-panel-slide" data-open={animationState === 'open'} role="dialog" aria-modal="true" aria-hidden={animationState !== 'open'} aria-labelledby="cart-title">
        <div className="cart-panel-header">
          <div><span className="eyebrow">Tu selección</span><h2 id="cart-title">Carrito <span>({itemCount})</span></h2></div>
          <div className="cart-panel-actions">
            <button className="icon-button clear-cart-button" type="button" onClick={clear} disabled={visibleLines.length === 0} aria-label="Vaciar carrito" title="Vaciar carrito"><Icon icon={icons.trash} /></button>
            <button ref={closeButton} className="icon-button" type="button" onClick={onClose} aria-label="Cerrar carrito"><Icon icon={icons.xmark} /></button>
          </div>
        </div>
        {visibleLines.length === 0 ? (
          <div className="cart-empty"><div className="empty-icon"><Icon icon={icons.bag} /></div><h3>Tu carrito está vacío</h3><p>Explora las piezas y arma un combo a tu ritmo.</p><button className="button button-secondary" type="button" onClick={onClose}>Ver colección</button></div>
        ) : (
          <>
            <div className="cart-lines">
              {visibleLines.map(({ product, quantity }) => (
                <div className="cart-line" key={product.id}>
                  <div className="cart-line-art"><RingArtwork artwork={product.artwork} label={product.name} imageUrl={product.imageUrl} /></div>
                  <div className="cart-line-main"><h3>{product.name}</h3><p>{product.sizeLabel} · {displayAmount(product.priceCents)}</p>{(product.fulfillmentType ?? 'STOCK') === 'PREORDER' && <span className="cart-fulfillment-label">Bajo pedido · 3–4 semanas</span>}<div className="quantity-stepper" aria-label={`Cantidad de ${product.name}`}><button type="button" onClick={() => setQuantity(product.id, quantity - 1)} aria-label={`Quitar una unidad de ${product.name}`}><Icon icon={icons.minus} /></button><span>{quantity}</span><button type="button" onClick={() => setQuantity(product.id, (product.fulfillmentType ?? 'STOCK') === 'PREORDER' ? quantity + 1 : Math.min(product.stockQuantity, quantity + 1))} aria-label={`Añadir una unidad de ${product.name}`}><Icon icon={icons.plus} /></button></div></div>
                  <div className="cart-line-side"><strong>{displayAmount(product.priceCents * quantity)}</strong><button className="text-button" type="button" onClick={() => remove(product.id)}>Quitar</button></div>
                </div>
              ))}
            </div>
            <div className="cart-footer">
              {createError && <div className="inline-notice is-error" role="alert">{createError}</div>}
              {hasStock && <div className="shipping-selector"><strong>Entrega para piezas disponibles</strong><div className="shipping-options" role="group" aria-label="Modalidad de entrega"><button type="button" className={shippingMethod === 'PERSONAL' ? 'is-selected' : ''} onClick={() => { setShippingMethod('PERSONAL'); setYummyQuote(null); setYummyQuoteLoading(false); yummyQuoteVersion.current += 1 }}>Personal</button><button type="button" className={shippingMethod === 'YUMMY' ? 'is-selected' : ''} onClick={() => { setShippingMethod('YUMMY'); setYummyQuoteLoading(false); yummyQuoteVersion.current += 1 }}>Yummy</button><button type="button" className={shippingMethod === 'NATIONAL' ? 'is-selected' : ''} onClick={() => { setShippingMethod('NATIONAL'); setYummyQuote(null); setYummyQuoteLoading(false); yummyQuoteVersion.current += 1 }}>Nacional</button></div>{shippingMethod === 'PERSONAL' && (personalPoints.length ? <PersonalDeliveryPointMap points={personalPoints} selectedId={deliveryPointId} onSelect={(point) => setDeliveryPointId(point.id)} /> : <div className="inline-notice" role="status">No hay puntos personales activos en este momento.</div>)}{shippingMethod === 'YUMMY' && <><input className="input" value={yummyAddress} onChange={(event) => { setYummyAddress(event.target.value); setYummyQuote(null); setYummyQuoteLoading(false); yummyQuoteVersion.current += 1 }} placeholder="Dirección de entrega" aria-label="Dirección de entrega" /><p className="delivery-method-note">El costo se calcula con la tarifa vigente de Yummy al solicitar el delivery. Puede variar según la hora y la disponibilidad; te confirmamos el monto por WhatsApp.</p><div className="yummy-quote-actions"><button className="button button-ghost" type="button" disabled={yummyQuoteLoading || yummyAddress.trim().length < 5} onClick={() => void quoteYummy()}>{yummyQuoteLoading ? 'Consultando…' : 'Consultar costo'}</button>{yummyQuote?.status === 'quoted' && <span className="delivery-quote-notice">Estimado: {yummyQuote.currency} {(yummyQuote.amountMinor / 100).toFixed(2)} · sujeto a cambio</span>}{(yummyQuote?.status === 'unavailable' || yummyQuote?.status === 'error') && <span className="delivery-quote-notice">{yummyQuote.fallbackCopy}</span>}</div></>}{shippingMethod === 'NATIONAL' && <div className="shipping-national-fields"><select className="input" value={national.carrier} onChange={(event) => setNational({ ...national, carrier: event.target.value as 'MRW' | 'ZOOM' })}><option value="MRW">MRW</option><option value="ZOOM">ZOOM</option></select><input className="input" value={national.state} onChange={(event) => setNational({ ...national, state: event.target.value })} placeholder="Estado" aria-label="Estado" /><input className="input" value={national.city} onChange={(event) => setNational({ ...national, city: event.target.value })} placeholder="Ciudad" aria-label="Ciudad" /><input className="input" value={national.officeText} onChange={(event) => setNational({ ...national, officeText: event.target.value })} placeholder="Oficina o agencia (opcional)" aria-label="Oficina o agencia (opcional)" /><small className="delivery-quote-notice">Cobro a destino · cobertura nacional.</small></div>}</div>}
              {showPreorderNote && <div className="preorder-cart-note"><strong>Pedido bajo pedido</strong><span>50% al solicitar · 50% al entregar · llega en 3–4 semanas.</span></div>}
              {quote.appliedPromotion && <div className="cart-promo"><Icon icon={icons.bolt} /><span><strong>Promo aplicada</strong><small>{quote.appliedPromotion.name} · {quote.appliedPromotion.groupsApplied} aplicación{quote.appliedPromotion.groupsApplied > 1 ? 'es' : ''}</small></span><strong>−{displayAmount(quote.discountCents)}</strong></div>}
              <div className="totals"><span>Subtotal <strong>{displayAmount(quote.subtotalCents)}</strong></span>{quote.discountCents > 0 && <span>Descuento <strong className="discount">−{displayAmount(quote.discountCents)}</strong></span>}<span className="total-row">Total <strong>{displayAmount(quote.totalCents)}</strong></span>{currency === 'Bs' && usableRate && <span className="bs-total">≈ USD {formatUsd(quote.totalCents)}</span>}</div>
              {currency === 'Bs' && <RateLockNotice available={Boolean(usableRate)} />}
              <button className="button button-primary whatsapp-cta" type="button" disabled={creating} onClick={handleCreateOrder}><Icon icon={icons.whatsapp} />{creating ? 'Creando pedido…' : 'Pedir por WhatsApp'}</button>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
