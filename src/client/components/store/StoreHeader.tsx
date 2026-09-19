import { useEffect, useRef, useState } from 'react'
import { Brand } from '../brand/Brand'
import { Icon, icons } from '../ui/Icon'
import type { Currency } from '../../../shared/types'

export function StoreHeader({ currency, onCurrencyChange, rateAvailable = true, rateLoading = false }: { currency: Currency; onCurrencyChange: (currency: Currency) => void; rateAvailable?: boolean; rateLoading?: boolean }) {
  const [menuState, setMenuState] = useState<'closed' | 'open' | 'closing'>('closed')
  const [rateNoticeVisible, setRateNoticeVisible] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const rateNoticeTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
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

  function closeMenu() {
    if (menuState === 'closed') return
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    setMenuState('closing')
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setMenuState('closed')
    }, 150)
  }

  function toggleMenu() {
    if (menuState === 'open') {
      closeMenu()
      return
    }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
    setMenuState('open')
  }

  return (
    <header className="store-header page-container">
      <Brand />
      <nav className={`store-nav t-dropdown${menuState === 'open' ? ' is-open' : menuState === 'closing' ? ' is-closing' : ''}`} data-origin="top-right" aria-label="Navegación principal">
        <a href="/#novedades" onClick={closeMenu}>Novedades</a>
        <a href="/#anillos" onClick={closeMenu}>Anillos</a>
        <a href="/#accesorios" onClick={closeMenu}>Accesorios</a>
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
              <span>La tasa en Bs queda protegida hasta finalizar hoy.</span>
              <button type="button" tabIndex={rateNoticeVisible ? 0 : -1} aria-label="Cerrar aviso de tasa" onClick={hideRateNotice}><Icon icon={icons.xmark} /></button>
            </div>
          )}
        </div>
        <button
          className="menu-trigger icon-button"
          type="button"
          onClick={toggleMenu}
          onPointerUp={(event) => {
            // Pointer activation (especially touch) can leave a stale focus
            // ring after the menu closes. Keyboard activation still keeps its
            // focus ring because it does not dispatch a pointer event.
            event.currentTarget.blur()
          }}
          aria-expanded={menuState === 'open'}
          aria-label={menuState === 'open' ? 'Cerrar menú' : 'Abrir menú'}
        >
          <Icon icon={icons.bars} />
        </button>
      </div>
    </header>
  )
}
