import { useEffect, useRef, useState } from 'react'
import { Brand } from '../brand/Brand'
import { Icon, icons } from '../ui/Icon'
import type { Currency } from '../../../shared/types'

export function StoreHeader({ currency, onCurrencyChange, rateAvailable = true, rateLoading = false }: { currency: Currency; onCurrencyChange: (currency: Currency) => void; rateAvailable?: boolean; rateLoading?: boolean }) {
  const [rateNoticeVisible, setRateNoticeVisible] = useState(false)
  const rateNoticeTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (rateNoticeTimer.current !== null) window.clearTimeout(rateNoticeTimer.current)
  }, [])

  function hideRateNotice() {
    if (rateNoticeTimer.current !== null) window.clearTimeout(rateNoticeTimer.current)
    rateNoticeTimer.current = null
    setRateNoticeVisible(false)
  }

  function handleCurrencyChange(nextCurrency: Currency) {
    onCurrencyChange(nextCurrency)
    if (nextCurrency !== 'Bs' || !rateAvailable) {
      hideRateNotice()
      return
    }

    if (rateNoticeTimer.current !== null) window.clearTimeout(rateNoticeTimer.current)
    setRateNoticeVisible(true)
    rateNoticeTimer.current = window.setTimeout(() => {
      rateNoticeTimer.current = null
      setRateNoticeVisible(false)
    }, 5200)
  }

  return (
    <header className="store-header page-container">
      <Brand />
      <nav className="store-nav" aria-label="Navegación principal">
        <a href="/#novedades">Novedades</a>
        <a href="/#anillos">Anillos</a>
        <a href="/#accesorios">Accesorios</a>
        <a href="/guia-de-tallas">Guía de tallas</a>
        <a href="/privacidad">Privacidad</a>
      </nav>
      <div className="store-header-actions">
        <div className="currency-control">
          <div className={`currency-toggle${rateLoading ? ' is-loading' : ''}${currency === 'Bs' ? ' is-bs' : ''}`} role="group" aria-label="Moneda" aria-busy={rateLoading}>
            <button type="button" className={currency === 'USD' ? 'is-active' : ''} aria-pressed={currency === 'USD'} onClick={() => handleCurrencyChange('USD')}>USD</button>
            <button type="button" className={currency === 'Bs' ? 'is-active' : ''} aria-pressed={currency === 'Bs'} aria-describedby={rateNoticeVisible ? 'currency-rate-notice' : undefined} aria-disabled={!rateAvailable} disabled={!rateAvailable} title={!rateAvailable ? 'Bs no disponible por ahora' : 'Mostrar precios en bolívares'} onClick={() => handleCurrencyChange('Bs')}>Bs</button>
          </div>
          {currency === 'Bs' && (
            <div className={`currency-rate-bubble t-tt${rateNoticeVisible ? ' is-visible' : ''}`} id="currency-rate-notice" role="status" aria-live="polite" aria-hidden={!rateNoticeVisible}>
              <Icon icon={icons.info} />
              <span>Si envías tu pedido hoy, la tasa en Bs queda protegida hasta finalizar el día.</span>
              <button type="button" tabIndex={rateNoticeVisible ? 0 : -1} aria-label="Cerrar aviso de tasa" onClick={hideRateNotice}><Icon icon={icons.xmark} /></button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
