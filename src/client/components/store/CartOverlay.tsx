import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon, icons } from '../ui/Icon'
import { formatCurrencyAmount, formatUsd, quoteCart } from '../../../shared/commerce'
import { createOrderIntent } from '../../../shared/orders'
import type { Order, Product, ShippingMethod, ShippingSelection, PersonalDeliveryPoint } from '../../../shared/types'
import { useCart } from '../../features/cart/CartContext'
import { RingArtwork } from './RingArtwork'
import { analytics } from '../../analytics/client'
import { ApiClientError, fetchPersonalDeliveryPoints } from '../../api/public'
import { createOrderIntentRemote } from '../../features/orders/orderIntent'
import { ShippingPanel } from './ShippingPanel'
import { defaultPersonalDeliveryPoints } from '../../../shared/delivery-points'

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
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod | null>(null)
  const [expandedShippingMethod, setExpandedShippingMethod] = useState<Exclude<ShippingMethod, 'YUMMY'> | null>(null)
  const [deliveryPointId, setDeliveryPointId] = useState('coru-punto-central')
  const [nationalCarrier, setNationalCarrier] = useState<'MRW' | 'ZOOM'>('MRW')
  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const closeTimer = useRef<number | null>(null)
  const dragStartY = useRef<number | null>(null)
  const dragPointerId = useRef<number | null>(null)
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const visibleLines = lines.map((line) => ({ ...line, product: productById.get(line.productId) })).filter((line): line is typeof line & { product: Product } => Boolean(line.product))
  const stockLines = lines.filter((line) => (productById.get(line.productId)?.fulfillmentType ?? 'STOCK') === 'STOCK')
  const preorderLines = lines.filter((line) => (productById.get(line.productId)?.fulfillmentType ?? 'STOCK') === 'PREORDER')
  const hasStock = stockLines.length > 0
  const hasPreorder = preorderLines.length > 0
  const showPreorderNote = hasPreorder && visibleLines.some(({ product }) => (product.fulfillmentType ?? 'STOCK') === 'PREORDER')
  const personalPoints = deliveryPoints.length ? deliveryPoints : (isVitePreview() ? defaultPersonalDeliveryPoints.map((point) => ({ ...point })) : [])
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
    return () => {
      previouslyFocused.current?.focus()
      previouslyFocused.current = null
    }
  }, [open, mounted])

  useEffect(() => {
    if (!open || !mounted) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (expandedShippingMethod) {
        setExpandedShippingMethod(null)
        return
      }
      onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, mounted, onClose, expandedShippingMethod])

  useEffect(() => {
    if (!open) {
      setCreateError('')
      setExpandedShippingMethod(null)
      setDragOffset(0)
      setDragging(false)
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
      if (hasStock && !shippingMethod) { setCreateError('Escoge una modalidad de entrega para continuar.'); return }
      if (hasStock && shippingMethod === 'PERSONAL' && !personalPoints.length) { setCreateError('No hay puntos personales activos. Elige Yummy o Nacional, o inténtalo más tarde.'); return }
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
          order = createOrderIntent(group.lines, currency, currency === 'Bs' ? usableRate! : undefined, products, groupKey, group.shipping).order
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

  function shippingSelection(): ShippingSelection {
    if (!shippingMethod) return { method: 'PERSONAL', deliveryPointId: deliveryPointId || personalPoints[0]?.id || 'coru-punto-central' }
    if (shippingMethod === 'YUMMY') return { method: 'YUMMY', addressText: 'Por coordinar por WhatsApp' }
    if (shippingMethod === 'NATIONAL') return { method: 'NATIONAL', carrier: nationalCarrier }
    return { method: 'PERSONAL', deliveryPointId: deliveryPointId || personalPoints[0]?.id || 'coru-punto-central' }
  }

  function selectShippingMethod(method: ShippingMethod): void {
    setCreateError('')
    setShippingMethod(method)
    if (method === 'YUMMY') {
      setExpandedShippingMethod(null)
      return
    }
    setExpandedShippingMethod((current) => current === method ? null : method)
  }

  function handleWhatsAppClick(): void {
    if (hasStock && !shippingMethod) {
      setCreateError('Escoge una modalidad de entrega para continuar.')
      return
    }
    void handleCreateOrder()
  }

  function handleDragStart(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType === 'mouse') return
    dragStartY.current = event.clientY
    dragPointerId.current = event.pointerId
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handleDragMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragStartY.current === null || dragPointerId.current !== event.pointerId) return
    const offset = Math.max(0, event.clientY - dragStartY.current)
    setDragOffset(offset)
  }

  function handleDragEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragPointerId.current !== event.pointerId) return
    const shouldClose = dragOffset > 96
    dragStartY.current = null
    dragPointerId.current = null
    setDragging(false)
    setDragOffset(0)
    if (shouldClose) onClose()
  }

  if (!mounted) return null

  return (
    <div className="overlay-root">
      <button className="overlay-scrim" data-open={animationState === 'open'} type="button" onClick={onClose} aria-label="Cerrar carrito" />
      <aside className={`cart-panel t-panel-slide${dragging ? ' is-dragging' : ''}`} style={{ '--cart-drag-offset': `${dragOffset}px` } as CSSProperties} data-open={animationState === 'open'} role="dialog" aria-modal="true" aria-hidden={animationState === 'closed' && !open} aria-labelledby="cart-title">
        <div className="cart-panel-drag-handle" aria-hidden="true" onPointerDown={handleDragStart} onPointerMove={handleDragMove} onPointerUp={handleDragEnd} onPointerCancel={handleDragEnd}><span /></div>
        <div className="cart-panel-header">
          <div><h2 id="cart-title">Carrito</h2></div>
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
                  <div className="cart-line-side"><strong>{displayAmount(product.priceCents * quantity)}</strong><button className="cart-line-remove" type="button" onClick={() => remove(product.id)} aria-label={`Quitar ${product.name} del carrito`} title="Quitar del carrito"><Icon icon={icons.trash} aria-hidden="true" /></button></div>
                </div>
              ))}
            </div>
            <div className="cart-footer">
              {createError && <div className={`inline-notice is-error${hasStock && !shippingMethod ? ' shipping-method-notice' : ''}`} role="alert">{createError}</div>}
              {hasStock && <div className="shipping-selector"><strong>Entrega para piezas disponibles</strong><div className="shipping-options" role="group" aria-label="Modalidad de entrega">
                {(['PERSONAL', 'YUMMY', 'NATIONAL'] as const).map((method) => {
                  const isExpandable = method !== 'YUMMY'
                  const isExpanded = isExpandable && expandedShippingMethod === method
                  const label = method === 'PERSONAL' ? 'Personal' : method === 'YUMMY' ? 'Yummy' : 'Envío nacional'
                  return <button key={method} type="button" className={shippingMethod === method ? 'is-selected' : ''} aria-expanded={isExpandable ? isExpanded : undefined} {...(isExpandable ? { 'aria-controls': 'shipping-panel' } : {})} onClick={() => selectShippingMethod(method)}>{label}</button>
                })}
              </div>{shippingMethod === 'NATIONAL' && <span className="shipping-selection-summary">Envío nacional · {nationalCarrier}</span>}
                {shippingMethod === 'YUMMY' && <p className="delivery-method-note">Para cotizar el envío, envía tu ubicación por WhatsApp.</p>}
                {shippingMethod && <ShippingPanel key={shippingMethod} open={expandedShippingMethod !== null} method={shippingMethod} points={personalPoints} selectedPointId={deliveryPointId} onSelectPoint={(point) => setDeliveryPointId(point.id)} nationalCarrier={nationalCarrier} onNationalCarrierChange={setNationalCarrier} />}
              </div>}
              {showPreorderNote && <div className="preorder-cart-note"><strong>Bajo pedido</strong><span>50% al solicitar · 50% al entregar · llega en 3–4 semanas.</span></div>}
              {quote.appliedPromotion && <div className="cart-promo"><Icon icon={icons.bolt} /><span><strong>Promo aplicada</strong><small>{quote.appliedPromotion.name} · {quote.appliedPromotion.groupsApplied} aplicación{quote.appliedPromotion.groupsApplied > 1 ? 'es' : ''}</small></span><strong>−{displayAmount(quote.discountCents)}</strong></div>}
              <div className="totals"><span>Subtotal <strong>{displayAmount(quote.subtotalCents)}</strong></span>{quote.discountCents > 0 && <span>Descuento <strong className="discount">−{displayAmount(quote.discountCents)}</strong></span>}<span className="total-row">Total <strong>{displayAmount(quote.totalCents)}</strong></span>{currency === 'Bs' && usableRate && <span className="bs-total">≈ USD {formatUsd(quote.totalCents)}</span>}</div>
              <button className={`button button-primary whatsapp-cta${hasStock && !shippingMethod ? ' is-blocked' : ''}`} type="button" disabled={creating} aria-disabled={hasStock && !shippingMethod ? 'true' : 'false'} onClick={handleWhatsAppClick}><Icon icon={icons.whatsapp} />{creating ? 'Creando pedido…' : 'Pedir por WhatsApp'}</button>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
