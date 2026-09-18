import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminShell } from '../src/client/features/admin/AdminShell'
import { AdminPages } from '../src/client/features/admin/AdminPages'
import { demoProducts } from '../src/shared/catalog'
import type { Order } from '../src/shared/types'

describe('Admin operational shell', () => {
  it('shows the approved navigation order', () => {
    render(<AdminShell section="dashboard"><AdminPages section="dashboard" products={demoProducts} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)
    const navigation = within(screen.getByRole('navigation', { name: /navegación administrativa/i }))
    expect(navigation.getByText('Resumen')).toBeInTheDocument()
    expect(navigation.getByText('Productos')).toBeInTheDocument()
    expect(navigation.getByText('Categorías')).toBeInTheDocument()
    expect(navigation.getByText('Promociones')).toBeInTheDocument()
    expect(navigation.getByText('Pedidos')).toBeInTheDocument()
    expect(navigation.getByText('Analítica')).toBeInTheDocument()
    expect(navigation.getByText('Ajustes')).toBeInTheDocument()
  })

  it('returns focus to the menu after closing mobile navigation', async () => {
    const user = userEvent.setup()
    render(<AdminShell section="dashboard"><AdminPages section="dashboard" products={demoProducts} setProducts={() => undefined} orders={[]} setOrders={() => undefined} /></AdminShell>)
    const menu = screen.getByRole('button', { name: /abrir navegación/i })
    await user.click(menu)
    expect(screen.getAllByRole('button', { name: /cerrar navegación/i })[0]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(menu).toHaveFocus()
  })

  it('disables actions for terminal orders', () => {
    const order: Order = {
      id: 'order-1', reference: 'CORU-000001', createdAt: new Date().toISOString(), status: 'CONFIRMED', currency: 'USD', items: [{ productId: 'orbita-oscura', quantity: 1, name: 'Órbita oscura', sizeLabel: 'Talla única', unitPriceCents: 400, lineTotalCents: 400 }], quote: { subtotalCents: 400, discountCents: 0, totalCents: 400 }, whatsappUrl: 'https://wa.me/584120000000',
    }
    render(<AdminShell section="orders"><AdminPages section="orders" products={demoProducts} setProducts={() => undefined} orders={[order]} setOrders={() => undefined} orderId={order.id} /></AdminShell>)
    expect(screen.getByRole('button', { name: /concretar venta/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /descartar pedido/i })).toBeDisabled()
  })
})
