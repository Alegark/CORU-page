import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromoBanner } from '../src/client/components/store/PromoBanner'
import { StorePage } from '../src/client/features/catalog/StorePage'
import { CartProvider } from '../src/client/features/cart/CartContext'
import { demoProducts } from '../src/shared/catalog'

beforeEach(() => window.localStorage.clear())

describe('three-piece promo banner', () => {
  it.each([
    [0, 0, 'Elige tus primeros 3 anillos', 'Elegir anillos', 'Elige 3 piezas y paga menos.'],
    [1, 1, 'Te faltan 2 piezas', 'Seguir eligiendo', 'Elige 3 piezas y paga menos.'],
    [2, 2, 'Te falta 1 pieza', 'Seguir eligiendo', 'Elige 3 piezas y paga menos.'],
    [3, 3, '1 combo aplicado', 'Ver carrito', '¡Combo listo!'],
    [4, 1, '1 combo aplicado · Te faltan 2 piezas para otro', 'Ver carrito', '¡Combo listo!'],
    [5, 2, '1 combo aplicado · Te falta 1 pieza para otro', 'Ver carrito', '¡Combo listo!'],
    [6, 3, '2 combos aplicados', 'Ver carrito', '¡Combo listo!'],
    [7, 1, '2 combos aplicados · Te faltan 2 piezas para otro', 'Ver carrito', '¡Combo listo!'],
  ])('renders %i eligible units as the current combo step', (count, step, status, action, heading) => {
    render(<PromoBanner progress={count} onBrowse={() => undefined} onOpenCart={() => undefined} />)
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(status)
    expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(step))
    expect(screen.queryByText(`${count} de 3 seleccionadas`)).not.toBeInTheDocument()
  })

  it('changes its action at the third unit and returns to browsing when units are removed', async () => {
    const user = userEvent.setup()
    const onBrowse = vi.fn()
    const onOpenCart = vi.fn()
    const view = render(<PromoBanner progress={2} onBrowse={onBrowse} onOpenCart={onOpenCart} />)
    await user.click(screen.getByRole('button', { name: 'Seguir eligiendo' }))
    expect(onBrowse).toHaveBeenCalledOnce()
    view.rerender(<PromoBanner progress={3} onBrowse={onBrowse} onOpenCart={onOpenCart} />)
    await user.click(screen.getByRole('button', { name: 'Ver carrito' }))
    expect(onOpenCart).toHaveBeenCalledOnce()
    view.rerender(<PromoBanner progress={1} onBrowse={onBrowse} onOpenCart={onOpenCart} />)
    expect(screen.getByRole('button', { name: 'Seguir eligiendo' })).toBeInTheDocument()
  })

  it('retains the fixed-discount presentation and hides an inactive banner', () => {
    const fixed = { id: 'fixed', name: 'Lanzamiento', kind: 'FIXED_DISCOUNT' as const, fixedDiscountCents: 200 }
    const view = render(<PromoBanner progress={0} promotion={fixed} onBrowse={() => undefined} onOpenCart={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Completar combo' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    view.rerender(<PromoBanner progress={0} promotion={null} onBrowse={() => undefined} onOpenCart={() => undefined} />)
    expect(screen.queryByRole('heading', { name: /piezas/i })).not.toBeInTheDocument()
  })

  it('formats the badge in Bs without changing the progress', () => {
    render(<PromoBanner progress={2} currency="Bs" rateMicros={36_420_000} onBrowse={() => undefined} onOpenCart={() => undefined} />)
    expect(screen.getByText('3 x Bs 364,20')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
  })

  it('fills the current combo slots with the rings in the cart', () => {
    const [first, second, third, fourth] = demoProducts.filter((product) => product.category === 'Anillos')
    const imaged = { ...first, imageSources: [{ id: 'img-1', src: '/media/a/detail.webp', thumb320: '/media/a/thumb-320.webp', thumb640: '/media/a/thumb-640.webp', detail1200: '/media/a/detail.webp' }] }
    const view = render(<PromoBanner progress={2} units={[imaged, second]} onBrowse={() => undefined} onOpenCart={() => undefined} />)
    const slots = view.container.querySelectorAll('.promo-slot')
    expect(slots).toHaveLength(3)
    expect(slots[0].querySelector('img')).toHaveAttribute('src', '/media/a/thumb-320.webp')
    expect(slots[1].classList.contains('has-art')).toBe(true)
    expect(slots[2].classList.contains('is-filled')).toBe(false)
    view.rerender(<PromoBanner progress={4} units={[imaged, second, third, fourth]} onBrowse={() => undefined} onOpenCart={() => undefined} />)
    const next = view.container.querySelectorAll('.promo-slot')
    expect(next[0].classList.contains('has-art')).toBe(true)
    expect(next[1].classList.contains('is-filled')).toBe(false)
    expect(view.container.querySelector('.promo-slot-check')).toBeNull()
    view.rerender(<PromoBanner progress={3} units={[imaged, second, third]} onBrowse={() => undefined} onOpenCart={() => undefined} />)
    expect(view.container.querySelectorAll('.promo-slot.has-art')).toHaveLength(3)
    expect(view.container.querySelector('.promo-slot-check')).not.toBeNull()
  })
})

describe('store promo interaction', () => {
  it('selects the promo category, clears search and focuses it before a combo is complete', async () => {
    const user = userEvent.setup()
    render(<CartProvider products={demoProducts}><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: 'Accesorios' }))
    const search = screen.getByRole('searchbox', { name: 'Buscar piezas' })
    await user.type(search, 'cadena')
    await user.click(screen.getByRole('button', { name: 'Elegir anillos' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Anillos' })).toHaveAttribute('aria-pressed', 'true')
      expect(search).toHaveValue('')
      expect(search).toHaveFocus()
    })
  })

  it('opens the existing cart at three units and recalculates after a unit is removed', async () => {
    const user = userEvent.setup()
    render(<CartProvider products={demoProducts}><StorePage products={demoProducts} onOrderCreated={() => undefined} /></CartProvider>)
    const add = screen.getByRole('button', { name: /agregar órbita oscura/i })
    await user.click(add)
    await user.click(add)
    expect(screen.getByRole('status')).toHaveTextContent('Te falta 1 pieza')
    await user.click(add)
    expect(screen.getByRole('status')).toHaveTextContent('1 combo aplicado')
    await user.click(screen.getByRole('button', { name: 'Ver carrito' }))
    expect(within(screen.getByRole('dialog')).getByText('$10')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Quitar una unidad de Órbita oscura' }))
    expect(screen.getByRole('status')).toHaveTextContent('Te falta 1 pieza')
    expect(screen.getByRole('button', { name: 'Seguir eligiendo' })).toBeInTheDocument()
  })

  it('does not count an eligible-marked PREORDER product toward the stock bundle', async () => {
    const user = userEvent.setup()
    const products = demoProducts.map((product) => product.id === 'signo-lunar' ? { ...product, promoEligible: true } : product)
    render(<CartProvider products={products}><StorePage products={products} onOrderCreated={() => undefined} /></CartProvider>)
    await user.click(screen.getByRole('button', { name: /agregar signo lunar/i }))
    expect(screen.getByRole('status')).toHaveTextContent('Elige tus primeros 3 anillos')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })
})
