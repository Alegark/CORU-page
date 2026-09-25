import { Icon, icons } from '../ui/Icon'
import { Link } from '../ui/Link'
import { RingArtwork } from './RingArtwork'
import { formatCurrencyAmount, type PromotionRule } from '../../../shared/commerce'
import type { Currency, Product } from '../../../shared/types'
import { formatProductSizeLabel } from '../../../shared/ring-size'

export function ProductCard({ product, promotion, onAdd, currency = 'USD', rateMicros = null, priority = false }: { product: Product; promotion?: PromotionRule | null; onAdd: () => void; currency?: Currency; rateMicros?: number | null; priority?: boolean }) {
  const isPreorder = (product.fulfillmentType ?? 'STOCK') === 'PREORDER'
  const promoLabel = isPreorder ? 'Bajo pedido' : promotion === null || !product.promoEligible ? null : promotion?.kind === 'FIXED_DISCOUNT' ? promotion.name : 'Promo Anillos'
  const sizeLabel = formatProductSizeLabel(product)
  return (
    <article className="product-card">
      <Link className="product-card-image" href={`/producto/${product.slug}`} aria-label={`Ver ${product.name}`}>
        {promoLabel && <span className="product-badge">{promoLabel}</span>}
        <RingArtwork artwork={product.artwork} label={product.name} imageUrl={product.imageUrl} imageSource={product.imageSources?.[0]} priority={priority} material={product.material} description={product.description} />
      </Link>
      <div className="product-card-body">
        <div className="product-card-copy">
          <h3>{product.name}</h3>
          <p>{isPreorder ? `${sizeLabel} · 3–4 semanas` : sizeLabel}</p>
        </div>
        <strong className="product-price">{formatCurrencyAmount(product.priceCents, currency, rateMicros)}</strong>
        <button className="icon-button add-button" type="button" onClick={onAdd} aria-label={`Agregar ${product.name}`}><Icon icon={icons.plus} /></button>
      </div>
    </article>
  )
}
