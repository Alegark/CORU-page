import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StorePage } from '../src/client/features/catalog/StorePage'
import { StoreHeader } from '../src/client/components/store/StoreHeader'
import { CartProvider } from '../src/client/features/cart/CartContext'
import { demoProducts } from '../src/shared/catalog'
import type { Currency } from '../src/shared/types'

function CurrencyHeaderHarness() {
  const [currency, setCurrency] = useState<Currency>('USD')
  return <StoreHeader currency={currency} onCurrencyChange={setCurrency} rateAvailable />
}

describe('Store', () => {
  it('adds three eligible rings and shows the bundle total without a size selector', async () => {
    const user = userEvent.setup()
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: /agregar órbita oscura/i }))
    await user.click(screen.getByRole('button', { name: /agregar calavera orbital/i }))
    await user.click(screen.getByRole('button', { name: /agregar estrella rota/i }))
    await user.click(screen.getByRole('button', { name: 'Abrir carrito, 3 productos' }))
    expect(screen.getByText('$10')).toBeInTheDocument()
    expect(screen.queryByLabelText(/talla|size/i)).not.toBeInTheDocument()
  })

  it('clears the cart from the compact header action', async () => {
    const user = userEvent.setup()
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: /agregar órbita oscura/i }))
    await user.click(screen.getByRole('button', { name: /Abrir carrito/ }))
    await user.click(screen.getByRole('button', { name: 'Vaciar carrito' }))
    expect(screen.getByText('Tu carrito está vacío')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vaciar carrito' })).toBeDisabled()
  })

  it('filters accessories', async () => {
    const user = userEvent.setup()
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: 'Accesorios' }))
    expect(screen.getByText('Cadena mini')).toBeInTheDocument()
    expect(screen.queryByText('Órbita oscura')).not.toBeInTheDocument()
  })

  it('does not leave the mobile menu trigger focused after a touch', () => {
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    const menu = screen.getByRole('button', { name: 'Abrir menú' })
    menu.focus()
    fireEvent.pointerUp(menu, { pointerType: 'touch' })
    expect(menu).not.toHaveFocus()
  })

  it('shows the Bs rate explanation beside the currency toggle', async () => {
    const user = userEvent.setup()
    render(<CurrencyHeaderHarness />)

    await user.click(screen.getByRole('button', { name: 'Bs' }))
    expect(screen.getByRole('status')).toHaveTextContent('Si envías tu pedido hoy, la tasa en Bs queda protegida hasta finalizar el día.')
    expect(screen.getByRole('status')).toHaveAttribute('aria-hidden', 'false')

    await user.click(screen.getByRole('button', { name: 'Cerrar aviso de tasa' }))
    expect(document.querySelector('#currency-rate-notice')).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders a sliding pill behind the selected category', () => {
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    const row = screen.getByRole('group', { name: 'Filtrar por categoría' })
    expect(row.querySelector('.t-tabs-pill')).toBeInTheDocument()
    expect(row.querySelector('.filter-chip.is-selected')).toHaveTextContent('Todos')
  })

  it('does not render category filters that have no public products', () => {
    render(<CartProvider><StorePage products={demoProducts} categories={[
      { id: 'rings', slug: 'anillos', name: 'Anillos', sortOrder: 1, active: true },
      { id: 'empty', slug: 'vacio', name: 'Vacío', sortOrder: 2, active: true },
      { id: 'accessories', slug: 'accesorios', name: 'Accesorios', sortOrder: 3, active: true },
    ]} onOrderCreated={() => undefined} /></CartProvider>)
    const row = screen.getByRole('group', { name: 'Filtrar por categoría' })
    expect(row).toHaveTextContent('Anillos')
    expect(row).toHaveTextContent('Accesorios')
    expect(row).not.toHaveTextContent('Vacío')
  })

  it('keeps the cart mounted while its close transition finishes', async () => {
    const user = userEvent.setup()
    document.documentElement.style.setProperty('--panel-close-dur', '.35s')
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)

    await user.click(screen.getByRole('button', { name: /Abrir carrito/ }))
    expect(document.querySelector('.cart-panel')).toBeInTheDocument()

    const closeButton = document.querySelector<HTMLButtonElement>('.cart-panel-header button[aria-label="Cerrar carrito"]')
    expect(closeButton).not.toBeNull()
    await user.click(closeButton!)
    expect(document.querySelector('.cart-panel')).toBeInTheDocument()

    await waitFor(() => expect(document.querySelector('.cart-panel')).not.toBeInTheDocument(), { timeout: 1000 })
    document.documentElement.style.removeProperty('--panel-close-dur')
  })
})
