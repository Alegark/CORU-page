import { describe, expect, it } from 'vitest'
import { demoProducts } from '../src/shared/catalog'
import { convertUsdCentsToBs, formatCurrencyAmount, isEligibleBundleProduct, quoteCart } from '../src/shared/commerce'

describe('CORU commerce quote', () => {
  it.each([
    [0, 0, 0],
    [1, 400, 400],
    [2, 800, 800],
    [3, 1200, 1000],
    [4, 1600, 1400],
    [5, 2000, 1800],
    [6, 2400, 2000],
  ])('prices %i eligible rings', (quantity, subtotal, total) => {
    const result = quoteCart([{ productId: 'orbita-oscura', quantity }], demoProducts)
    expect(result.subtotalCents).toBe(subtotal)
    expect(result.totalCents).toBe(total)
    expect(result.totalCents).toBeLessThanOrEqual(result.subtotalCents)
  })

  it('keeps non-eligible accessories at regular price', () => {
    const result = quoteCart([{ productId: 'orbita-oscura', quantity: 3 }, { productId: 'cadena-mini', quantity: 1 }], demoProducts)
    expect(result.totalCents).toBe(1700)
    expect(result.discountCents).toBe(200)
  })

  it('shares bundle eligibility with the storefront indicator', () => {
    expect(isEligibleBundleProduct(demoProducts[0], undefined)).toBe(true)
    expect(isEligibleBundleProduct(demoProducts[6], undefined)).toBe(false)
    expect(isEligibleBundleProduct({ ...demoProducts[5], promoEligible: true }, undefined)).toBe(false)
    expect(isEligibleBundleProduct(undefined, undefined)).toBe(false)
    expect(isEligibleBundleProduct(demoProducts[0], null)).toBe(false)
  })

  it('converts USD cents with half-up rounding', () => {
    expect(convertUsdCentsToBs(400, 250_000_000)).toBe(100_000)
    expect(convertUsdCentsToBs(1, 36_420_000)).toBe(36)
  })

  it('formats catalog amounts in the selected currency', () => {
    expect(formatCurrencyAmount(400, 'USD', 36_420_000)).toBe('$4')
    expect(formatCurrencyAmount(400, 'Bs', 36_420_000)).toBe('Bs 145,68')
    expect(formatCurrencyAmount(400, 'Bs', null)).toBe('$4')
  })

  it('accepts an operator-configured bundle rule', () => {
    const result = quoteCart([{ productId: 'orbita-oscura', quantity: 2 }], demoProducts, { id: 'custom', name: '2 por $7', kind: 'BUNDLE', targetCategory: 'Anillos', bundleQuantity: 2, bundlePriceCents: 700 })
    expect(result.totalCents).toBe(700)
    expect(result.appliedPromotion?.id).toBe('custom')
  })

  it('supports a fixed discount without exceeding the subtotal', () => {
    const result = quoteCart([{ productId: 'cadena-mini', quantity: 1 }], demoProducts, { id: 'fixed', name: 'Lanzamiento', kind: 'FIXED_DISCOUNT', fixedDiscountCents: 1000 })
    expect(result.subtotalCents).toBe(700)
    expect(result.totalCents).toBe(0)
    expect(result.discountCents).toBe(700)
  })

  it('can disable promotions for a remote catalog with no active rule', () => {
    const result = quoteCart([{ productId: 'orbita-oscura', quantity: 3 }], demoProducts, null)
    expect(result.totalCents).toBe(1200)
    expect(result.discountCents).toBe(0)
  })

  it('limits a fixed discount to its target category', () => {
    const result = quoteCart([{ productId: 'orbita-oscura', quantity: 1 }, { productId: 'cadena-mini', quantity: 1 }], demoProducts, { id: 'fixed', name: 'Aros -$2', kind: 'FIXED_DISCOUNT', targetCategory: 'Anillos', fixedDiscountCents: 200 })
    expect(result.subtotalCents).toBe(1_100)
    expect(result.discountCents).toBe(200)
    expect(result.totalCents).toBe(900)
  })
})
