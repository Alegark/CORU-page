import { Icon, icons } from '../ui/Icon'
import { formatCurrencyAmount, type PromotionRule } from '../../../shared/commerce'
import type { Currency } from '../../../shared/types'

export function PromoBanner({ progress, promotion, onAction, currency = 'USD', rateMicros = null }: { progress: number; promotion?: PromotionRule | null; onAction: () => void; currency?: Currency; rateMicros?: number | null }) {
  if (promotion === null) return null
  const isBundle = promotion?.kind !== 'FIXED_DISCOUNT'
  const bundleQuantity = promotion?.bundleQuantity ?? 3
  const bundlePriceCents = promotion?.bundlePriceCents ?? 1000
  const remaining = Math.max(0, bundleQuantity - progress)
  const badge = isBundle ? `${bundleQuantity}×${formatCurrencyAmount(bundlePriceCents, currency, rateMicros)}` : promotion?.name ?? 'Promoción activa'
  return (
    <section className="promo-banner" aria-labelledby="promo-title">
      <div className="promo-copy">
        <span className="badge badge-brand"><Icon icon={icons.bolt} /> {badge}</span>
        <h2 id="promo-title">Arma el combo, elige tu actitud.</h2>
        <p>{!isBundle ? 'La promoción se aplica automáticamente al generar tu pedido.' : remaining === 0 ? 'Promo aplicada a tu carrito.' : remaining === 1 ? `Te falta 1 pieza para activar la promo.` : `La promo se aplica al seleccionar ${bundleQuantity} piezas elegibles.`}</p>
      </div>
      <button className="button button-primary" type="button" onClick={onAction}>{remaining === 0 ? 'Ver carrito' : isBundle ? `Elegir mis ${bundleQuantity}` : 'Ver piezas'} <Icon icon={icons.arrowRight} /></button>
      {isBundle && <div className="promo-progress" aria-label={`${progress} de ${bundleQuantity} piezas seleccionadas`}><span style={{ transform: `scaleX(${Math.min(1, progress / bundleQuantity)})` }} /></div>}
    </section>
  )
}
