import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CartProvider } from '../src/client/features/cart/CartContext'
import { StorePage } from '../src/client/features/catalog/StorePage'
import { Brand } from '../src/client/components/brand/Brand'
import { demoProducts } from '../src/shared/catalog'

describe('SPA crawlable links', () => {
  it('renders product cards as links and navigates on primary click', async () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    const user = userEvent.setup()
    render(<CartProvider><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)

    const card = screen.getByRole('link', { name: /Ver Órbita oscura/i })
    expect(card).toHaveAttribute('href', '/producto/orbita-oscura')
    await user.click(card)
    expect(pushState).toHaveBeenCalled()
    expect(String(pushState.mock.calls.at(-1)?.[2] ?? '')).toContain('/producto/orbita-oscura')
  })

  it('renders the brand as a link and skips navigate on ctrl+click', async () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    const user = userEvent.setup()
    render(<Brand />)

    const brand = screen.getByRole('link', { name: 'Ir a CORU' })
    expect(brand).toHaveAttribute('href', '/')
    await user.click(brand)
    expect(pushState).toHaveBeenCalled()

    pushState.mockClear()
    fireEvent.click(brand, { button: 0, ctrlKey: true })
    expect(pushState).not.toHaveBeenCalled()
  })
})
