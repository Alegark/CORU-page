import { beforeEach, describe, expect, it } from 'vitest'
import { dismissPrivacy, isPrivacyDismissed, loadCart, saveCart } from '../src/shared/storage'

describe('versioned browser storage', () => {
  beforeEach(() => window.localStorage.clear())

  it('persists cart shape and resets corrupt JSON', () => {
    saveCart([{ productId: 'orbita-oscura', quantity: 2 }])
    expect(loadCart()).toEqual([{ productId: 'orbita-oscura', quantity: 2 }])
    window.localStorage.setItem('coru_cart_v1', '{bad')
    expect(loadCart()).toEqual([])
    expect(window.localStorage.getItem('coru_cart_v1')).toBeNull()
  })

  it('remembers the privacy dismissal', () => {
    expect(isPrivacyDismissed()).toBe(false)
    dismissPrivacy()
    expect(isPrivacyDismissed()).toBe(true)
  })
})
