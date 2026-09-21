import { Icon, icons } from '../ui/Icon'
import { RingArtwork } from './RingArtwork'
import { navigate } from '../../app/router'
import { formatCurrencyAmount, type PromotionRule } from '../../../shared/commerce'
import type { Currency, Product } from '../../../shared/types'

export function ProductCard({ product, promotion, onAdd, currency = 'USD', rateMicros = null }: { product: Product; promotion?: PromotionRule | null; onAdd: () => void; currency?: Currency; rateMicros?: number | null }) {
  const isPreorder = (product.fulfillmentType ?? 'STOCK') === 'PREORDER'
  const promoLabel = isPreorder ? 'Bajo pedido' : promotion === null || !product.promoEligible ? null : promotion?.kind === 'FIXED_DISCOUNT' ? promotion.name : 'Promo Anillos'
  return (
    <article className="product-card">
      <button className="product-card-image" type="button" onClick={() => navigate(`/producto/${product.slug}`)} aria-label={`Ver ${product.name}`}>
        {promoLabel && <span className="product-badge">{promoLabel}</span>}
        <RingArtwork artwork={product.artwork} label={product.name} imageUrl={product.imageUrl} />
      </button>
      <div className="product-card-body">
        <div className="product-card-copy">
          <h3>{product.name}</h3>
          <p>{isPreorder ? `${product.sizeLabel} · 3–4 semanas` : product.sizeLabel}</p>
        </div>
        <strong className="product-price">{formatCurrencyAmount(product.priceCents, currency, rateMicros)}</strong>
        <button className="icon-button add-button" type="button" onClick={onAdd} aria-label={`Agregar ${product.name}`}><Icon icon={icons.plus} /></button>
      </div>
    </article>
  )
}
