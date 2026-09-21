import { beforeEach, describe, expect, it } from 'vitest'
import { dismissPrivacy, getVisitorId, isPrivacyDismissed, loadCart, saveCart } from '../src/shared/storage'

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

  it('persists one anonymous visitor id across browser sessions', () => {
    const first = getVisitorId()
    expect(first).toBeTruthy()
    expect(getVisitorId()).toBe(first)

    window.localStorage.clear()

    expect(getVisitorId()).not.toBe(first)
  })

  it('keeps one fallback visitor id when browser storage cannot be written', () => {
    const blockedStorage = {
      getItem: () => { throw new Error('storage blocked') },
      setItem: () => { throw new Error('storage blocked') },
      removeItem: () => { throw new Error('storage blocked') },
    } as unknown as Storage

    const first = getVisitorId(blockedStorage)
    expect(first).toBeTruthy()
    expect(getVisitorId(blockedStorage)).toBe(first)
  })
})
