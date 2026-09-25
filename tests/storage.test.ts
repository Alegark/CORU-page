import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dismissPrivacy, getSessionId, getSource, getVisitorId, isCurrencyHintSeen, isInternalBrowser, isPrivacyDismissed, loadCart, loadOrders, markCurrencyHintSeen, markInternalBrowser, saveCart, saveOrders } from '../src/shared/storage'
import type { Order } from '../src/shared/types'

describe('versioned browser storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.cookie = 'coru_visitor_v1=; Max-Age=0; Path=/'
    window.history.replaceState({}, '', '/')
  })

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

  it('remembers the one-time currency hint', () => {
    expect(isCurrencyHintSeen()).toBe(false)
    markCurrencyHintSeen()
    expect(isCurrencyHintSeen()).toBe(true)
  })

  it('persists one anonymous visitor id across browser sessions', () => {
    const first = getVisitorId()
    expect(first).toBeTruthy()
    expect(getVisitorId()).toBe(first)
  })

  it('shares a session across tabs and starts a new one only after 30 minutes of inactivity', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'))
      const sharedProfileStorage = window.localStorage
      const first = getSessionId(sharedProfileStorage)

      vi.setSystemTime(new Date('2026-09-24T12:29:59.999Z'))
      expect(getSessionId(sharedProfileStorage)).toBe(first)

      vi.setSystemTime(new Date('2026-09-24T13:00:00.000Z'))
      expect(getSessionId(sharedProfileStorage)).not.toBe(first)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stores first-touch traffic source with the session record', () => {
    window.history.replaceState({}, '', '/?src=whatsapp')
    expect(getSource()).toBe('whatsapp')
    const saved = JSON.parse(window.localStorage.getItem('coru_session_v2') ?? 'null') as { source?: string }
    expect(saved.source).toBe('whatsapp')
    window.history.replaceState({}, '', '/')
    expect(getSource()).toBe('whatsapp')
  })

  it('marks internal browsers used for Admin', () => {
    expect(isInternalBrowser()).toBe(false)
    markInternalBrowser()
    expect(isInternalBrowser()).toBe(true)
  })

  it('reuses the first-party visitor id if local storage is cleared', () => {
    const first = getVisitorId()
    window.localStorage.clear()

    expect(getVisitorId()).toBe(first)
    expect(JSON.parse(window.localStorage.getItem('coru_visitor_v1') ?? 'null')).toBe(first)
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

  it('accepts cancelled orders when reloading local history', () => {
    const order = {
      id: 'order-cancelled', reference: 'CORU-000099', createdAt: '2026-09-22T10:00:00.000Z', status: 'CANCELLED', currency: 'USD',
      items: [{ productId: 'orbita-oscura', quantity: 1, name: 'Órbita oscura', sizeLabel: 'Talla única', unitPriceCents: 400, lineTotalCents: 400 }],
      quote: { subtotalCents: 400, discountCents: 0, totalCents: 400 }, whatsappUrl: 'https://wa.me/1',
    } as Order
    saveOrders([order])
    expect(loadOrders()).toEqual([order])
  })
})
