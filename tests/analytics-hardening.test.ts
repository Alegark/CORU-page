import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isBotUserAgent, shouldDropClientAnalytics } from '../src/shared/analytics-bots'
import { detectTrafficSource } from '../src/shared/analytics-source'
import { clampAnalyticsTimestamps } from '../src/shared/analytics-time'
import { getSessionId, getSource, isInternalBrowser, markInternalBrowser } from '../src/shared/storage'
import { analytics } from '../src/client/analytics/client'

vi.mock('../src/client/api/public', async () => {
  const actual = await vi.importActual<typeof import('../src/client/api/public')>('../src/client/api/public')
  return { ...actual, sendAnalytics: vi.fn(async () => ({ accepted: 0 })) }
})

import { sendAnalytics } from '../src/client/api/public'

describe('analytics bot detection', () => {
  it('matches crawlers and WhatsApp link-preview UAs without blocking normal browsers', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true)
    expect(isBotUserAgent('WhatsApp/2.23.20.0')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36')).toBe(false)
    expect(isBotUserAgent('')).toBe(false)
  })
})

describe('analytics timestamp clamping', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z')

  it('keeps timestamps within the allowed skew window', () => {
    const events = [
      { occurredAt: '2026-09-24T11:55:00.000Z' },
      { occurredAt: '2026-09-24T12:01:00.000Z' },
    ]
    expect(clampAnalyticsTimestamps(events, now)).toEqual(events)
  })

  it('remaps skewed batches relative to the latest event', () => {
    const events = [
      { name: 'catalog_view', occurredAt: '2026-09-24T08:00:00.000Z' },
      { name: 'product_view', occurredAt: '2026-09-24T08:05:00.000Z' },
    ]
    const clamped = clampAnalyticsTimestamps(events, now)
    expect(Date.parse(clamped[1]!.occurredAt)).toBe(now)
    expect(Date.parse(clamped[0]!.occurredAt)).toBe(now - 5 * 60 * 1000)
  })

  it('rejects future stamps beyond two minutes by remapping the batch', () => {
    const events = [{ occurredAt: '2026-09-24T12:10:00.000Z' }]
    expect(clampAnalyticsTimestamps(events, now)[0]!.occurredAt).toBe(new Date(now).toISOString())
  })
})

describe('traffic source detection', () => {
  it('lets explicit src/utm_source win', () => {
    expect(detectTrafficSource({ search: '?utm_source=ig', userAgent: 'Mozilla/5.0', referrer: 'https://google.com/', locationHost: 'coru.shop' })).toBe('instagram')
    expect(detectTrafficSource({ search: '?src=facebook', referrer: 'https://instagram.com/', locationHost: 'coru.shop' })).toBe('facebook')
  })

  it('detects in-app browsers, click ids, and referrers', () => {
    expect(detectTrafficSource({ search: '', userAgent: 'Instagram 312.0.0.0.0 Android', locationHost: 'coru.shop' })).toBe('instagram')
    expect(detectTrafficSource({ search: '', userAgent: 'Mozilla/5.0 FBAN/FBIOS', locationHost: 'coru.shop' })).toBe('facebook')
    expect(detectTrafficSource({ search: '?igsh=abc', userAgent: 'Mozilla/5.0', locationHost: 'coru.shop' })).toBe('instagram')
    expect(detectTrafficSource({ search: '?fbclid=abc', userAgent: 'Mozilla/5.0', locationHost: 'coru.shop' })).toBe('facebook')
    expect(detectTrafficSource({ search: '?fbclid=abc', referrer: 'https://l.instagram.com/', userAgent: 'Mozilla/5.0', locationHost: 'coru.shop' })).toBe('instagram')
    expect(detectTrafficSource({ search: '', referrer: 'https://m.facebook.com/', locationHost: 'coru.shop' })).toBe('facebook')
    expect(detectTrafficSource({ search: '', referrer: 'https://wa.me/580000', locationHost: 'coru.shop' })).toBe('whatsapp')
    expect(detectTrafficSource({ search: '', referrer: 'https://coru.shop/productos', locationHost: 'coru.shop' })).toBe('direct')
    expect(detectTrafficSource({ search: '', referrer: '', locationHost: 'coru.shop' })).toBe('direct')
    expect(detectTrafficSource({ search: '', referrer: 'https://news.example/', locationHost: 'coru.shop' })).toBe('other')
    expect(detectTrafficSource({ search: '', referrer: 'https://www.google.com/', locationHost: 'coru.systems' })).toBe('search')
    expect(detectTrafficSource({ search: '', referrer: 'https://www.google.co.ve/', locationHost: 'coru.systems' })).toBe('search')
    expect(detectTrafficSource({ search: '', referrer: 'https://www.bing.com/search?q=anillos', locationHost: 'coru.systems' })).toBe('search')
    expect(detectTrafficSource({ search: '?utm_source=google_business', locationHost: 'coru.systems' })).toBe('search')
    expect(detectTrafficSource({ search: '?src=gbp', locationHost: 'coru.systems' })).toBe('search')
  })
})

describe('session-scoped source persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' })
  })

  it('keeps first-touch source across page views and resets after 30 minutes idle', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'))
      window.history.replaceState({}, '', '/?src=instagram')
      expect(getSource()).toBe('instagram')
      const sessionId = getSessionId()
      window.history.replaceState({}, '', '/')
      expect(getSource()).toBe('instagram')
      expect(getSessionId()).toBe(sessionId)

      window.history.replaceState({}, '', '/?src=facebook')
      expect(getSource()).toBe('facebook')
      expect(getSessionId()).toBe(sessionId)

      vi.setSystemTime(new Date('2026-09-24T12:31:00.000Z'))
      window.history.replaceState({}, '', '/')
      Object.defineProperty(document, 'referrer', { configurable: true, value: 'https://news.example/x' })
      expect(getSource()).toBe('other')
      expect(getSessionId()).not.toBe(sessionId)
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats legacy session records without source as direct', () => {
    window.localStorage.setItem('coru_session_v2', JSON.stringify({ id: 'legacy-session', lastActivityAt: Date.now() }))
    expect(getSource()).toBe('direct')
    expect(getSessionId()).toBe('legacy-session')
  })
})

describe('internal browser analytics flag', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.mocked(sendAnalytics).mockClear()
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: false })
  })

  it('marks and reads the internal flag without throwing when storage is blocked', () => {
    expect(isInternalBrowser()).toBe(false)
    markInternalBrowser()
    expect(isInternalBrowser()).toBe(true)
    const blocked = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    } as unknown as Storage
    expect(() => markInternalBrowser(blocked)).not.toThrow()
    expect(isInternalBrowser(blocked)).toBe(false)
  })

  it('drops client track calls when the internal flag is set', async () => {
    markInternalBrowser()
    analytics.track('catalog_view')
    await analytics.flush()
    expect(sendAnalytics).not.toHaveBeenCalled()
  })

  it('drops client track calls for automation UAs and webdriver', async () => {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: true })
    expect(shouldDropClientAnalytics()).toBe(true)
    analytics.track('catalog_view')
    await analytics.flush()
    expect(sendAnalytics).not.toHaveBeenCalled()
  })
})
