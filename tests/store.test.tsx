import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StorePage } from '../src/client/features/catalog/StorePage'
import { StoreHeader } from '../src/client/components/store/StoreHeader'
import { CartProvider } from '../src/client/features/cart/CartContext'
import { demoProducts } from '../src/shared/catalog'
import type { Currency } from '../src/shared/types'
import { defaultPersonalDeliveryPoints } from '../src/shared/delivery-points'

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

  it('keeps the combo copy clear without repeating the hero subtitle', () => {
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)

    expect(screen.getByText('Anillos y accesorios para combinar')).toBeInTheDocument()
    expect(screen.queryByText(/para combinar sin pedir permiso/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Promo Anillos').length).toBeGreaterThan(0)
    expect(screen.getByText('3 x $10')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Elige 3 piezas y paga menos.' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
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

  it('removes a line with the trash icon action', async () => {
    const user = userEvent.setup()
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: /agregar órbita oscura/i }))
    await user.click(screen.getByRole('button', { name: /Abrir carrito/ }))

    const remove = screen.getByRole('button', { name: 'Quitar Órbita oscura del carrito' })
    expect(remove.querySelector('svg')).toBeTruthy()
    await user.click(remove)

    expect(screen.getByText('Tu carrito está vacío')).toBeInTheDocument()
  })

  it('requires a shipping method before opening WhatsApp', async () => {
    const user = userEvent.setup()
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: /agregar órbita oscura/i }))
    await user.click(screen.getByRole('button', { name: /Abrir carrito/ }))

    expect(screen.getByRole('button', { name: 'Personal' })).not.toHaveClass('is-selected')
    const whatsapp = screen.getByRole('button', { name: 'Pedir por WhatsApp' })
    expect(whatsapp).toHaveAttribute('aria-disabled', 'true')
    await user.click(whatsapp)
    expect(screen.getByRole('alert')).toHaveTextContent('Escoge una modalidad de entrega para continuar.')
  })

  it('filters accessories', async () => {
    const user = userEvent.setup()
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: 'Accesorios' }))
    expect(screen.getByText('Cadena mini')).toBeInTheDocument()
    expect(screen.queryByText('Órbita oscura')).not.toBeInTheDocument()
  })

  it('does not invent a Bajo pedido filter from fulfillment type', () => {
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    expect(screen.queryByRole('button', { name: 'Bajo pedido' })).not.toBeInTheDocument()
  })

  it('exposes guide and privacy links from the store navigation', () => {
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)

    expect(screen.queryByRole('button', { name: /menú/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Guía de tallas' })).toHaveAttribute('href', '/guia-de-tallas')
    expect(screen.getByRole('link', { name: 'Privacidad' })).toHaveAttribute('href', '/privacidad')
  })

  it('keeps shipping details inline with the selected method', async () => {
    const user = userEvent.setup()
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: /agregar órbita oscura/i }))
    await user.click(screen.getByRole('button', { name: /Abrir carrito/ }))

    const national = screen.getByRole('button', { name: 'Envío nacional' })
    expect(national).toHaveAttribute('aria-expanded', 'false')
    expect(national).toHaveAttribute('aria-controls', 'shipping-panel')
    await user.click(national)

    expect(screen.getByRole('region', { name: 'Envío nacional' })).toHaveAttribute('data-open', 'true')
    expect(screen.queryByRole('button', { name: 'Volver al carrito' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MRW' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'ZOOM' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('combobox', { name: 'Empresa de envío' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Ciudad')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ZOOM' }))
    expect(screen.getByRole('button', { name: 'ZOOM' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'MRW' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(national)
    expect(screen.queryByRole('region', { name: 'Envío nacional' })).not.toBeInTheDocument()
    expect(screen.getByText('Envío nacional · ZOOM')).toBeInTheDocument()
  })

  it('shows the compact personal delivery list and follows the selected point', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: defaultPersonalDeliveryPoints }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    try {
      render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
      await user.click(screen.getByRole('button', { name: /agregar órbita oscura/i }))
      await user.click(screen.getByRole('button', { name: /Abrir carrito/ }))
      await user.click(screen.getByRole('button', { name: 'Personal' }))

      const pointSelect = screen.getByRole('combobox', { name: 'Punto de entrega personal' })
      expect(pointSelect).toHaveAttribute('aria-expanded', 'false')
      expect(document.querySelector('.delivery-point-map-frame')).not.toBeInTheDocument()

      await user.click(pointSelect)
      expect(screen.getByRole('option', { name: /Centro Comercial La Paragua/ })).toBeInTheDocument()
      await user.click(screen.getByRole('option', { name: /Centro Comercial La Paragua/ }))
      expect(pointSelect).toHaveAttribute('aria-expanded', 'false')
      expect(pointSelect).toHaveTextContent('Centro Comercial La Paragua')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps Yummy as a direct selection without expanding details', async () => {
    const user = userEvent.setup()
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: /agregar órbita oscura/i }))
    await user.click(screen.getByRole('button', { name: /Abrir carrito/ }))
    await user.click(screen.getByRole('button', { name: 'Yummy' }))

    expect(screen.getByText('Para cotizar el envío, envía tu ubicación por WhatsApp.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Dirección de entrega')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Yummy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Consultar costo' })).not.toBeInTheDocument()
  })

  it('closes the shipping subpanel before closing the cart with Escape', async () => {
    const user = userEvent.setup()
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: /agregar órbita oscura/i }))
    await user.click(screen.getByRole('button', { name: /Abrir carrito/ }))
    await user.click(screen.getByRole('button', { name: 'Envío nacional' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Envío nacional' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /carrito/i })).toBeInTheDocument()
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
