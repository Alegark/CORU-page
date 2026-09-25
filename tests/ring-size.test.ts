import { describe, expect, it } from 'vitest'
import { centimetersToMillimeters, deriveRingMeasurements, formatCentimeters, formatProductSizeLabel, millimetersToCentimeters } from '../src/shared/ring-size'
import { createPendingOrder } from '../src/worker/services/order.service'
import { resetState, state } from '../src/worker/state'

describe('customer-facing product size', () => {
  it('prefers the structured US size over a generic label', () => {
    expect(formatProductSizeLabel({ sizeLabel: 'Talla única', usSize: '10' })).toBe('Talla US 10')
    expect(formatProductSizeLabel({ sizeLabel: 'Talla unica', usSize: 'US 7' })).toBe('Talla US 7')
    expect(formatProductSizeLabel({ sizeLabel: 'Largo 45 cm', usSize: '9' })).toBe('Largo 45 cm')
    expect(formatProductSizeLabel({ sizeLabel: 'Talla única' })).toBe('Talla no especificada')
    expect(formatProductSizeLabel({ sizeLabel: 'Talla única' }, 'Talla única')).toBe('Talla única')
  })

  it('snapshots the same size the customer saw into the order and WhatsApp message', () => {
    resetState()
    const product = state.products.find((entry) => entry.id === 'orbita-oscura')!
    product.usSize = '10'
    const { order } = createPendingOrder(state, [{ productId: product.id, quantity: 1 }], 'USD', undefined, 'size-snapshot', new Date('2026-09-15T16:00:00.000Z'))
    expect(order.items[0].sizeLabel).toBe('Talla US 10')
    expect(decodeURIComponent(order.whatsappUrl)).toContain('[Talla US 10]')
  })
})

describe('ring measurement conversion', () => {
  it('uses the approved CORU reference row when the diameter matches', () => {
    expect(deriveRingMeasurements(17.3)).toEqual({ circumferenceMm: 54.4, usSize: '7' })
  })

  it('calculates circumference and suggests the closest CORU US size between rows', () => {
    expect(deriveRingMeasurements(17.4)).toEqual({ circumferenceMm: 54.7, usSize: '7' })
    expect(deriveRingMeasurements(17)).toEqual({ circumferenceMm: 53.4, usSize: '7' })
  })

  it('converts the centimeter entry used by the catalog UI to stored millimeters', () => {
    expect(centimetersToMillimeters(1.73)).toBe(17.3)
    expect(millimetersToCentimeters(54.4)).toBe(5.44)
    expect(formatCentimeters(57)).toBe('5.70 cm')
  })

  it('rejects a non-positive or non-finite diameter', () => {
    expect(() => deriveRingMeasurements(0)).toThrow(/diámetro/i)
    expect(() => deriveRingMeasurements(Number.NaN)).toThrow(/diámetro/i)
  })
})
