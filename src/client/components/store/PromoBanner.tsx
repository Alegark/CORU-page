import { Icon, icons } from '../ui/Icon'
import { RingArtwork } from './RingArtwork'
import { formatCurrencyAmount, type PromotionRule } from '../../../shared/commerce'
import type { Currency, Product } from '../../../shared/types'

export type PromoBannerUnit = Pick<Product, 'id' | 'name' | 'artwork' | 'imageUrl' | 'imageSources'>

type PromoBannerProps = {
  progress: number
  /** Eligible units in cart order (one entry per unit); used to show the rings inside the combo slots. */
  units?: PromoBannerUnit[]
  promotion?: PromotionRule | null
  onBrowse: () => void
  onOpenCart: () => void
  currency?: Currency
  rateMicros?: number | null
}

function SlotArt({ unit }: { unit: PromoBannerUnit }) {
  const src = unit.imageSources?.[0]?.thumb320 ?? unit.imageSources?.[0]?.src ?? unit.imageUrl
  if (src) return <img src={src} alt="" loading="lazy" decoding="async" />
  return <RingArtwork artwork={unit.artwork} label={unit.name} />
}

export function PromoBanner({ progress, units = [], promotion, onBrowse, onOpenCart, currency = 'USD', rateMicros = null }: PromoBannerProps) {
  if (promotion === null) return null

  const isBundle = promotion?.kind !== 'FIXED_DISCOUNT'
  const bundleQuantity = promotion?.bundleQuantity ?? 3
  const bundlePriceCents = promotion?.bundlePriceCents ?? 1000
  const bundlePrice = formatCurrencyAmount(bundlePriceCents, currency, rateMicros)
  const badge = isBundle ? `${bundleQuantity} x ${bundlePrice}` : promotion?.name ?? 'Promoción activa'

  // Other promotion formats retain their existing presentation and action.
  if (!isBundle || bundleQuantity !== 3) {
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
        <button className="button button-primary" type="button" onClick={onBrowse}>Completar combo <Icon icon={icons.arrowRight} /></button>
      </section>
    )
  }

  const eligibleCount = Math.max(0, Math.floor(progress))
  const completed = Math.floor(eligibleCount / 3)
  const remainder = eligibleCount % 3
  const activeSteps = eligibleCount > 0 && remainder === 0 ? 3 : remainder
  const groupUnits = remainder === 0 ? units.slice(-3) : units.slice(completed * 3)
  const combosCopy = `${completed} combo${completed === 1 ? '' : 's'} aplicado${completed === 1 ? '' : 's'}`
  const missing = 3 - remainder
  const missingCopy = `Te falta${missing === 1 ? '' : 'n'} ${missing} pieza${missing === 1 ? '' : 's'}`
  const status = eligibleCount === 0
    ? 'Elige tus primeros 3 anillos'
    : completed === 0
      ? missingCopy
      : remainder === 0
        ? combosCopy
        : `${combosCopy} · ${missingCopy} para otro`
  const buttonCopy = completed > 0 ? 'Ver carrito' : eligibleCount === 0 ? 'Elegir anillos' : 'Seguir eligiendo'
  const progressDescription = completed > 0 && remainder === 0
    ? status
    : `${status}. ${activeSteps} de 3 piezas en el combo actual`
  return (
    <section className={`promo-banner promo-banner--three${completed > 0 && remainder === 0 ? ' is-complete' : ''}`} aria-labelledby="promo-title">
      <div className="promo-copy">
        <span className="badge badge-brand"><Icon icon={icons.bolt} aria-hidden="true" /> {badge}</span>
        <h2 id="promo-title">{completed > 0 ? '¡Combo listo!' : 'Elige 3 piezas y paga menos.'}</h2>
      </div>
      <div className="promo-play">
        <div className="promo-slots" role="progressbar" aria-label="Progreso del combo" aria-valuemin={0} aria-valuemax={3} aria-valuenow={activeSteps} aria-valuetext={progressDescription}>
          <div className="promo-slots-track" aria-hidden="true">
            {[0, 1, 2].map((index) => {
              const filled = index < activeSteps
              const unit = filled ? groupUnits[index] : undefined
              return (
                <div className="promo-slots-unit" key={index}>
                  {index > 0 && <span className={`promo-slot-connector${filled ? ' is-active' : ''}`} />}
                  <span key={unit ? `${unit.id}-${index}-${eligibleCount}` : `empty-${index}`} className={`promo-slot${filled ? ' is-filled' : ''}${unit ? ' has-art' : ''}`}>
                    {unit ? <SlotArt unit={unit} /> : index + 1}
                    {index === 2 && activeSteps === 3 && <span className="promo-slot-check"><Icon icon={icons.check} /></span>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <p className="promo-steps-status" role="status" aria-live="polite" aria-atomic="true">{status}</p>
        <button className="button button-primary promo-action" type="button" onClick={completed > 0 ? onOpenCart : onBrowse}>
          {buttonCopy} <Icon icon={icons.arrowRight} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}
