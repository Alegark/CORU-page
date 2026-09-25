import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoreHeader } from '../src/client/components/store/StoreHeader'
import { StorePage } from '../src/client/features/catalog/StorePage'
import { CartProvider } from '../src/client/features/cart/CartContext'
import { demoProducts } from '../src/shared/catalog'

beforeEach(() => window.localStorage.clear())

describe('store contextual feedback', () => {
  it('shows the currency hint once and remembers dismissal', async () => {
    const user = userEvent.setup()
    const onCurrencyChange = () => undefined
    const first = render(<StoreHeader currency="USD" onCurrencyChange={onCurrencyChange} rateAvailable />)

    await waitFor(() => expect(screen.getByText('Elige tu moneda')).toBeInTheDocument(), { timeout: 1200 })
    await user.click(screen.getByRole('button', { name: 'Cerrar ayuda de moneda' }))
    expect(window.localStorage.getItem('coru_currency_hint_seen_v1')).toBe('true')

    first.unmount()
    render(<StoreHeader currency="USD" onCurrencyChange={onCurrencyChange} rateAvailable />)
    expect(screen.queryByText('Elige tu moneda')).not.toBeInTheDocument()
  })

  it('replaces the cart toast and closes the onboarding hint', async () => {
    const user = userEvent.setup()
    render(<CartProvider products={demoProducts}><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)

    await user.click(screen.getByRole('button', { name: /agregar órbita oscura/i }))
    const toast = () => document.querySelector<HTMLElement>('.cart-toast')
    expect(document.querySelectorAll('.cart-toast')).toHaveLength(1)
    expect(toast()).toHaveTextContent('Agregado al carrito')
    expect(toast()).toHaveTextContent('Órbita oscura')
    expect(toast()).not.toHaveTextContent('$4')
    expect(screen.queryByText('Elige tu moneda')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /agregar calavera orbital/i }))
    expect(document.querySelectorAll('.cart-toast')).toHaveLength(1)
    expect(toast()).toHaveTextContent('Calavera orbital')
  })

  it('closes the bubble before opening the cart', async () => {
    const user = userEvent.setup()
    render(<CartProvider products={demoProducts}><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)

    await user.click(screen.getByRole('button', { name: /agregar órbita oscura/i }))
    expect(document.querySelector('.cart-toast')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Abrir carrito, 1 producto' }))
    expect(document.querySelector('.cart-toast')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /carrito/i })).toBeInTheDocument()
  })
})
