import { Icon, icons } from '../ui/Icon'
import { formatCurrencyAmount, type PromotionRule } from '../../../shared/commerce'
import type { Currency } from '../../../shared/types'

export function PromoBanner({ progress, promotion, onAction, currency = 'USD', rateMicros = null }: { progress: number; promotion?: PromotionRule | null; onAction: () => void; currency?: Currency; rateMicros?: number | null }) {
  if (promotion === null) return null
  const isBundle = promotion?.kind !== 'FIXED_DISCOUNT'
  const bundleQuantity = promotion?.bundleQuantity ?? 3
  const bundlePriceCents = promotion?.bundlePriceCents ?? 1000
  const badge = isBundle ? `${bundleQuantity} x ${formatCurrencyAmount(bundlePriceCents, currency, rateMicros)}` : promotion?.name ?? 'Promoción activa'
  const percentage = Math.min(100, Math.round((progress / bundleQuantity) * 100))
  return (
    <section className="promo-banner" aria-labelledby="promo-title">
      <div className="promo-copy">
        <span className="badge badge-brand"><Icon icon={icons.bolt} /> {badge}</span>
        <h2 id="promo-title">Elige 3 piezas y paga menos.</h2>
        {isBundle && <div className="promo-progress-wrap">
          <div className="promo-progress" role="progressbar" aria-label={`${progress} de ${bundleQuantity} seleccionadas`} aria-valuemin={0} aria-valuemax={bundleQuantity} aria-valuenow={Math.min(progress, bundleQuantity)}>
            <span style={{ width: `${percentage}%` }} />
          </div>
          <p className="promo-progress-copy">{progress} de {bundleQuantity} seleccionadas</p>
        </div>}
      </div>
      <button className="button button-primary" type="button" onClick={onAction}>Completar combo <Icon icon={icons.arrowRight} /></button>
    </section>
  )
}
