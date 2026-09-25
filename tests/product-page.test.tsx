import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CartProvider } from '../src/client/features/cart/CartContext'
import { ProductPage } from '../src/client/features/catalog/ProductPage'
import { demoProducts } from '../src/shared/catalog'
import { productImageAlt } from '../src/shared/seo'

describe('Product detail measurements', () => {
  it('shows structured ring measurements as separate public details', () => {
    const product = { ...demoProducts[0], usSize: '7', innerDiameterMm: 17.3, circumferenceMm: 54.4, measurementsText: 'Diámetro interno 17.3 mm · contorno 54.4 mm' }
    render(<CartProvider><ProductPage product={product} products={[product]} onOrderCreated={() => undefined} /></CartProvider>)

    expect(screen.getByText('Talla US', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Diámetro interno', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Circunferencia', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('1.73 cm')).toBeInTheDocument()
    expect(screen.getByText('5.44 cm')).toBeInTheDocument()
    expect(screen.queryByText('Talla US 7 · Diámetro interno 1.73 cm · Circunferencia 5.44 cm')).not.toBeInTheDocument()
    expect(screen.getByText('Medidas')).toBeInTheDocument()
  })

  it('renders only the structured ring values that exist', () => {
    const product = { ...demoProducts[0], usSize: '7', measurementsText: 'Talla única' }
    render(<CartProvider><ProductPage product={product} products={[product]} onOrderCreated={() => undefined} /></CartProvider>)

    expect(screen.getByText('Talla US', { exact: true })).toBeInTheDocument()
    expect(screen.queryByText('Diámetro interno', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Circunferencia', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Talla única')).not.toBeInTheDocument()
  })

  it('keeps generic information visible for products without ring fields', () => {
    const product = { ...demoProducts[5], measurementsText: 'Ajuste cómodo' }
    render(<CartProvider><ProductPage product={product} products={[product]} onOrderCreated={() => undefined} /></CartProvider>)

    expect(screen.getByText('Medidas')).toBeInTheDocument()
    expect(screen.getByText('Ajuste cómodo')).toBeInTheDocument()
    expect(screen.queryByText('Talla US')).not.toBeInTheDocument()
  })

  it('keeps one clear collection return action', () => {
    const product = demoProducts[0]
    render(<CartProvider><ProductPage product={product} products={[product]} onOrderCreated={() => undefined} /></CartProvider>)

    const returnLink = screen.getByRole('link', { name: 'Volver a la colección' })
    expect(screen.getAllByRole('link', { name: 'Volver a la colección' })).toHaveLength(1)
    expect(returnLink).toHaveClass('product-back-link')
    expect(returnLink).toHaveAttribute('href', '/?estilo=anillos')
    expect(screen.getByRole('link', { name: 'Anillos' })).toHaveAttribute('href', '/?estilo=anillos')
  })

  it('changes the main image from thumbnails and carousel arrows', async () => {
    const user = userEvent.setup()
    const product = { ...demoProducts[0], imageUrls: ['/ring-front.webp', '/ring-side.webp'] }
    render(<CartProvider><ProductPage product={product} products={[product]} onOrderCreated={() => undefined} /></CartProvider>)

    const mainImage = () => screen.getByRole('img', { name: productImageAlt(product.name, product.material, product.description) })
    expect(mainImage()).toHaveAttribute('src', '/ring-front.webp')

    await user.click(screen.getByRole('button', { name: 'Ver imagen 2' }))
    expect(mainImage()).toHaveAttribute('src', '/ring-side.webp')

    await user.click(screen.getByRole('button', { name: 'Ver imagen anterior' }))
    expect(mainImage()).toHaveAttribute('src', '/ring-front.webp')

    await user.click(screen.getByRole('button', { name: 'Ver imagen siguiente' }))
    expect(mainImage()).toHaveAttribute('src', '/ring-side.webp')
  })
})
