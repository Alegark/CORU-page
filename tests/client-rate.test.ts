import { describe, expect, it } from 'vitest'
import { initialRateForLocation } from '../src/client/features/cart/rate-state'

describe('storefront initial exchange rate', () => {
  it('does not show the preview rate on the production domain', () => {
    expect(initialRateForLocation({ hostname: 'coru.systems', port: '' })).toEqual({ rateMicros: null, rateAvailable: false })
  })

  it('keeps the sample rate limited to local Vite previews', () => {
    expect(initialRateForLocation({ hostname: 'localhost', port: '4173' })).toEqual({ rateMicros: 36_420_000, rateAvailable: true })
  })
})
