import { useEffect, useRef, useState } from 'react'
import { Brand } from '../brand/Brand'
import { Icon, icons } from '../ui/Icon'
import type { Currency } from '../../../shared/types'

export function StoreHeader({ currency, onCurrencyChange, rateAvailable = true, rateLoading = false }: { currency: Currency; onCurrencyChange: (currency: Currency) => void; rateAvailable?: boolean; rateLoading?: boolean }) {
  const [menuState, setMenuState] = useState<'closed' | 'open' | 'closing'>('closed')
  const closeTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

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
        <div className={`currency-toggle${rateLoading ? ' is-loading' : ''}${currency === 'Bs' ? ' is-bs' : ''}`} role="group" aria-label="Moneda" aria-busy={rateLoading}>
          <button type="button" className={currency === 'USD' ? 'is-active' : ''} aria-pressed={currency === 'USD'} onClick={() => onCurrencyChange('USD')}>USD</button>
          <button type="button" className={currency === 'Bs' ? 'is-active' : ''} aria-pressed={currency === 'Bs'} aria-disabled={!rateAvailable} disabled={!rateAvailable} title={!rateAvailable ? 'Bs no disponible por ahora' : 'Mostrar precios en bolívares'} onClick={() => onCurrencyChange('Bs')}>Bs</button>
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
