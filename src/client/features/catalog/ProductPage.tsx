import { useEffect, useMemo, useState } from 'react'
import { Icon, icons } from '../../components/ui/Icon'
import { Link } from '../../components/ui/Link'
import { Brand } from '../../components/brand/Brand'
import { CartOverlay } from '../../components/store/CartOverlay'
import { FloatingCart } from '../../components/store/FloatingCart'
import { CartToastHost, announceCartAdded, announceCartOpened } from '../../components/store/CartFeedback'
import { ProductCard } from '../../components/store/ProductCard'
import { RingArtwork } from '../../components/store/RingArtwork'
import { formatCurrencyAmount } from '../../../shared/commerce'
import { relatedProductsFromCollection } from '../../../shared/collections'
import { getPublicProducts } from '../../../shared/catalog'
import type { Order, Product, ProductImageSource } from '../../../shared/types'
import type { PromotionRule } from '../../../shared/commerce'
import { useCart } from '../cart/CartContext'
import { formatCentimeters } from '../../../shared/ring-size'

type ProductMeasurement = {
  label: string
  value: string
}

function getProductMeasurements(product: Product): ProductMeasurement[] {
  return [
    product.usSize?.trim() ? { label: 'Talla US', value: product.usSize.trim() } : null,
    product.innerDiameterMm !== undefined ? { label: 'Diámetro interno', value: formatCentimeters(product.innerDiameterMm) } : null,
    product.circumferenceMm !== undefined ? { label: 'Circunferencia', value: formatCentimeters(product.circumferenceMm) } : null,
  ].filter((measurement): measurement is ProductMeasurement => measurement !== null)
}

function formatProductInformation(product: Product): string {
  return product.measurementsText?.trim() || product.sizeLabel
}

export function ProductPage({ product, products, promotion, onOrderCreated }: { product: Product; products: Product[]; promotion?: PromotionRule | null; onOrderCreated: (order: Order) => void }) {
  const { add, itemCount, currency, rateMicros, rateAvailable } = useCart()
  const [cartOpen, setCartOpen] = useState(false)
  const [added, setAdded] = useState(false)
  const gallery: ProductImageSource[] = product.imageSources?.length ? product.imageSources : (product.imageUrls?.length ? product.imageUrls.map((src, index) => ({ id: `fallback-${index}`, src })) : product.imageUrl ? [{ id: 'fallback-primary', src: product.imageUrl }] : [])
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const selectedImage = gallery[selectedImageIndex]?.src
  const isPreorder = (product.fulfillmentType ?? 'STOCK') === 'PREORDER'
  const promoLabel = isPreorder ? 'Bajo pedido' : promotion === null || !product.promoEligible ? product.category : promotion?.kind === 'FIXED_DISCOUNT' ? promotion.name : 'Promo Anillos'
  const related = useMemo(() => relatedProductsFromCollection(product, getPublicProducts(products), 4), [product, products])
  const relatedHeading = related.collection.h1.toLocaleLowerCase('es')
  const relatedHref = `/?estilo=${encodeURIComponent('match' in related.collection ? related.collection.slug : 'anillos')}`
  useEffect(() => { setSelectedImageIndex(0) }, [product.id, product.imageUrl, product.imageUrls?.join('|')])
  const changeImage = (offset: number) => {
    if (gallery.length < 2) return
    setSelectedImageIndex((current) => (current + offset + gallery.length) % gallery.length)
  }
  const measurements = getProductMeasurements(product)
  return (
    <div className="product-page app-shell">
      <header className="simple-header page-container"><Brand /></header>
      <main id="main-content" className="page-container product-detail">
        <Link className="back-link product-back-link" href="/?estilo=anillos"><Icon icon={icons.arrowLeft} /> Volver a la colección</Link>
        <nav className="product-breadcrumb" aria-label="Migas de pan">
          <Link href="/">Inicio</Link>
          <span aria-hidden="true"> › </span>
          <Link href="/?estilo=anillos">Anillos</Link>
          <span aria-hidden="true"> › </span>
          <span>{product.name}</span>
        </nav>
        <div className="product-detail-grid">
          <div className="product-detail-visual">
            <span className="product-badge">{promoLabel}</span>
            <div className="product-gallery-stage">
              <RingArtwork artwork={product.artwork} label={product.name} large imageUrl={selectedImage} imageSource={gallery[selectedImageIndex]} priority material={product.material} description={product.description} />
              {gallery.length > 1 && (
                <>
                  <button className="product-gallery-arrow is-previous" type="button" onClick={() => changeImage(-1)} aria-label="Ver imagen anterior"><Icon icon={icons.arrowLeft} /></button>
                  <button className="product-gallery-arrow is-next" type="button" onClick={() => changeImage(1)} aria-label="Ver imagen siguiente"><Icon icon={icons.arrowRight} /></button>
                </>
              )}
            </div>
            {gallery.length > 1 && (
              <div className="product-gallery" aria-label="Galería del producto">
                {gallery.map((image, index) => (
                  <button className={`product-gallery-thumb${selectedImageIndex === index ? ' is-active' : ''}`} type="button" key={`${image.id}-${index}`} onClick={() => setSelectedImageIndex(index)} aria-label={`Ver imagen ${index + 1}`} aria-pressed={selectedImageIndex === index}>
                    <img src={image.thumb320 ?? image.src} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="product-detail-copy">
            <span className="eyebrow">{product.category} · CORU</span>
            <h1 className="display-heading">{product.name}</h1>
            <div className="detail-price-row">
              <strong>{formatCurrencyAmount(product.priceCents, currency, rateMicros)}</strong>
              <span className="stock-pill">{isPreorder ? 'Bajo pedido' : product.stockQuantity <= 0 ? 'Agotado' : product.stockQuantity <= 3 ? 'Últimas piezas' : 'En stock'}</span>
            </div>
            <p className="detail-description">{product.description}</p>
            {isPreorder && (
              <div className="preorder-notice">
                <strong>Tiempo estimado de llegada: {product.leadTime ?? '3–4 semanas'}</strong>
                <span>El tiempo es estimado y puede variar.</span>
                <span>50% al solicitar · 50% al entregar.</span>
              </div>
            )}
            <dl className="detail-meta">
              <div><dt>Material</dt><dd>{product.material}</dd></div>
              <div className={measurements.length ? 'detail-meta-size' : undefined}>
                <dt>Medidas</dt>
                <dd>
                  {measurements.length ? (
                    <dl className="size-measurements" aria-label="Medidas de talla">
                      {measurements.map((measurement) => <div key={measurement.label}><dt>{measurement.label}</dt><dd>{measurement.value}</dd></div>)}
                    </dl>
                  ) : formatProductInformation(product)}
                </dd>
              </div>
            </dl>
            <button className="button button-primary detail-add" type="button" disabled={!product.active || (!isPreorder && product.stockQuantity <= 0)} onClick={() => { const addedToCart = add(product); if (!addedToCart) return; setAdded(true); announceCartAdded(product.name) }}>
              <Icon icon={added ? icons.check : icons.plus} /> {isPreorder ? added ? 'Agregado al carrito' : 'Solicitar bajo pedido' : product.stockQuantity <= 0 ? 'Agotado' : added ? 'Agregado al carrito' : 'Agregar al carrito'}
            </button>
            <Link className="detail-cart-link" href="/guia-de-tallas">Guía de tallas</Link>
          </div>
        </div>
        {related.products.length > 0 && (
          <section className="related-products" aria-labelledby="related-products-title">
            <div className="related-products-header">
              <h2 id="related-products-title">Más {relatedHeading}</h2>
              <Link href={relatedHref}>Ver colección</Link>
            </div>
            <div className="product-grid related-products-grid">
              {related.products.map((item, index) => (
                <ProductCard key={item.id} product={item} promotion={promotion} currency={currency} rateMicros={rateMicros} priority={index < 2} onAdd={() => { if (add(item)) announceCartAdded(item.name) }} />
              ))}
            </div>
          </section>
        )}
      </main>
      <FloatingCart itemCount={itemCount} open={cartOpen} onCart={() => { announceCartOpened(); setCartOpen(true) }} />
      <CartOverlay products={products} open={cartOpen} onClose={() => setCartOpen(false)} onOrderCreated={onOrderCreated} rateMicros={rateMicros} rateAvailable={rateAvailable} />
      <CartToastHost />
    </div>
  )
}
