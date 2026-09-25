import { useEffect, useRef, useState } from 'react'
import { Brand } from '../brand/Brand'
import { Icon, icons } from '../ui/Icon'
import type { Currency } from '../../../shared/types'
import { isCurrencyHintSeen, markCurrencyHintSeen } from '../../../shared/storage'
import { CART_ADDED_EVENT } from './CartFeedback'

export function StoreHeader({ currency, onCurrencyChange, rateAvailable = true, rateLoading = false }: { currency: Currency; onCurrencyChange: (currency: Currency) => void; rateAvailable?: boolean; rateLoading?: boolean }) {
  const [rateNoticeVisible, setRateNoticeVisible] = useState(false)
  const [currencyHintVisible, setCurrencyHintVisible] = useState(false)
  const rateNoticeTimer = useRef<number | null>(null)
  const currencyHintTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (rateNoticeTimer.current !== null) window.clearTimeout(rateNoticeTimer.current)
    if (currencyHintTimer.current !== null) window.clearTimeout(currencyHintTimer.current)
  }, [])

  useEffect(() => {
    if (isCurrencyHintSeen()) return
    currencyHintTimer.current = window.setTimeout(() => {
      currencyHintTimer.current = null
      setCurrencyHintVisible(true)
    }, 700)
    return () => {
      if (currencyHintTimer.current !== null) window.clearTimeout(currencyHintTimer.current)
    }
  }, [])

  useEffect(() => {
    const handleCartAdded = () => {
      if (currencyHintTimer.current !== null) window.clearTimeout(currencyHintTimer.current)
      currencyHintTimer.current = null
      markCurrencyHintSeen()
      setCurrencyHintVisible(false)
      if (rateNoticeTimer.current !== null) window.clearTimeout(rateNoticeTimer.current)
      rateNoticeTimer.current = null
      setRateNoticeVisible(false)
    }
    window.addEventListener(CART_ADDED_EVENT, handleCartAdded)
    return () => window.removeEventListener(CART_ADDED_EVENT, handleCartAdded)
  }, [])

  function hideRateNotice() {
    if (rateNoticeTimer.current !== null) window.clearTimeout(rateNoticeTimer.current)
    rateNoticeTimer.current = null
    setRateNoticeVisible(false)
  }

  function dismissCurrencyHint() {
    if (currencyHintTimer.current !== null) window.clearTimeout(currencyHintTimer.current)
    currencyHintTimer.current = null
    markCurrencyHintSeen()
    setCurrencyHintVisible(false)
  }

  function handleCurrencyChange(nextCurrency: Currency) {
    dismissCurrencyHint()
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
        <a href="/anillos">Anillos</a>
        <a href="/#accesorios">Accesorios</a>
        <a href="/entregas-maracaibo">Entregas</a>
        <a href="/guia-de-tallas">Guía de tallas</a>
        <a href="/privacidad">Privacidad</a>
      </nav>
      <div className="store-header-actions">
        <div className="currency-control">
          <div className={`currency-toggle${rateLoading ? ' is-loading' : ''}${currency === 'Bs' ? ' is-bs' : ''}`} role="group" aria-label="Moneda" aria-busy={rateLoading}>
            <button type="button" className={currency === 'USD' ? 'is-active' : ''} aria-pressed={currency === 'USD'} aria-describedby={currencyHintVisible ? 'currency-hint' : undefined} onClick={() => handleCurrencyChange('USD')}>USD</button>
            <button type="button" className={currency === 'Bs' ? 'is-active' : ''} aria-pressed={currency === 'Bs'} aria-describedby={currencyHintVisible ? 'currency-hint' : rateNoticeVisible ? 'currency-rate-notice' : undefined} aria-disabled={!rateAvailable} disabled={!rateAvailable} title={!rateAvailable ? 'Bs no disponible por ahora' : 'Mostrar precios en bolívares'} onClick={() => handleCurrencyChange('Bs')}>Bs</button>
          </div>
          {currencyHintVisible && (
            <div className="currency-onboarding-tooltip t-tt is-visible" id="currency-hint" role="status" aria-live="polite">
              <strong>Elige tu moneda</strong>
              <span>Puedes alternar los precios entre USD y Bs desde este botón.</span>
              <button type="button" aria-label="Cerrar ayuda de moneda" onClick={dismissCurrencyHint}><Icon icon={icons.xmark} /></button>
            </div>
          )}
          {currency === 'Bs' && !currencyHintVisible && (
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
