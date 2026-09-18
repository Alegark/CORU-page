import { useEffect, useState } from 'react'
import { navigate } from '../../app/router'
import { Icon, icons } from '../../components/ui/Icon'
import { Brand } from '../../components/brand/Brand'
import { CartOverlay } from '../../components/store/CartOverlay'
import { FloatingCart } from '../../components/store/FloatingCart'
import { RingArtwork } from '../../components/store/RingArtwork'
import { formatCurrencyAmount } from '../../../shared/commerce'
import type { Order, Product } from '../../../shared/types'
import type { PromotionRule } from '../../../shared/commerce'
import { useCart } from '../cart/CartContext'
import { analytics } from '../../analytics/client'

export function ProductPage({ product, products, promotion, onOrderCreated }: { product: Product; products: Product[]; promotion?: PromotionRule | null; onOrderCreated: (order: Order) => void }) {
  const { add, itemCount, currency, rateMicros, rateAvailable } = useCart()
  const [cartOpen, setCartOpen] = useState(false)
  const [added, setAdded] = useState(false)
  const isPreorder = (product.fulfillmentType ?? 'STOCK') === 'PREORDER'
  const promoLabel = isPreorder ? 'Bajo pedido' : promotion === null || !product.promoEligible ? product.category : promotion?.kind === 'FIXED_DISCOUNT' ? promotion.name : `${promotion?.bundleQuantity ?? 3}×${formatCurrencyAmount(promotion?.bundlePriceCents ?? 1000, currency, rateMicros)}`
  useEffect(() => { analytics.track('product_view', { productId: product.id, promoEligible: product.promoEligible }) }, [product.id, product.promoEligible])
  return <div className="product-page app-shell"><header className="simple-header page-container"><Brand /><button className="icon-button" type="button" onClick={() => navigate('/')} aria-label="Volver a la colección"><Icon icon={icons.arrowLeft} /></button></header><main id="main-content" className="page-container product-detail"><button className="back-link" type="button" onClick={() => navigate('/')}><Icon icon={icons.arrowLeft} /> Volver a la colección</button><div className="product-detail-grid"><div className="product-detail-visual"><span className="product-badge">{promoLabel}</span><RingArtwork artwork={product.artwork} label={product.name} large imageUrl={product.imageUrl} /></div><div className="product-detail-copy"><span className="eyebrow">{product.category} · CORU</span><h1 className="display-heading">{product.name}</h1><div className="detail-price-row"><strong>{formatCurrencyAmount(product.priceCents, currency, rateMicros)}</strong><span className="stock-pill">{isPreorder ? 'Bajo pedido' : product.stockQuantity <= 0 ? 'Agotado' : product.stockQuantity <= 3 ? 'Últimas piezas' : 'En stock'}</span></div><p className="detail-description">{product.description}</p>{isPreorder && <div className="preorder-notice"><strong>Tiempo estimado de llegada: {product.leadTime ?? '3–4 semanas'}</strong><span>El tiempo es estimado y puede variar.</span><span>50% al solicitar · 50% al entregar.</span></div>}<dl className="detail-meta"><div><dt>Material</dt><dd>{product.material}</dd></div><div><dt>Información</dt><dd>{product.sizeLabel}</dd></div>{product.measurementsText && <div><dt>Medidas</dt><dd>{product.measurementsText}</dd></div>}</dl><button className="button button-primary detail-add" type="button" disabled={!product.active || (!isPreorder && product.stockQuantity <= 0)} onClick={() => { add(product); analytics.track('cart_add', { productId: product.id, promoEligible: product.promoEligible, fulfillment_type: isPreorder ? 'PREORDER' : 'STOCK' }); setAdded(true) }}><Icon icon={added ? icons.check : icons.plus} /> {isPreorder ? added ? 'Agregado al carrito' : 'Solicitar bajo pedido' : product.stockQuantity <= 0 ? 'Agotado' : added ? 'Agregado al carrito' : 'Agregar al carrito'}</button><button className="detail-cart-link" type="button" onClick={() => navigate('/guia-de-tallas')}>Guía de tallas</button></div></div></main><FloatingCart itemCount={itemCount} open={cartOpen} onCart={() => setCartOpen(true)} /><CartOverlay products={products} open={cartOpen} onClose={() => setCartOpen(false)} onOrderCreated={onOrderCreated} rateMicros={rateMicros} rateAvailable={rateAvailable} /></div>
}
