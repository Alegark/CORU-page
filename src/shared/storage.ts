import type { CartLine, Currency, Order } from './types'
import { detectTrafficSource, normalizeSource, trafficSourceHintsFromWindow, type AnalyticsTrafficSource } from './analytics-source'

const CART_KEY = 'coru_cart_v1'
const CURRENCY_KEY = 'coru_currency_v1'
const CURRENCY_HINT_KEY = 'coru_currency_hint_seen_v1'
const PRIVACY_KEY = 'coru_privacy_notice_v1'
const SESSION_KEY = 'coru_session_v2'
const SESSION_TIMEOUT_MS = 30 * 60 * 1000
const VISITOR_KEY = 'coru_visitor_v1'
const VISITOR_COOKIE = 'coru_visitor_v1'
const INTERNAL_KEY = 'coru_internal_v1'
const ORDERS_KEY = 'coru_orders_v1'

type SessionRecord = { id: string; lastActivityAt: number; source: AnalyticsTrafficSource }

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as T
    return parsed
  } catch {
    storage.removeItem(key)
    return fallback
  }
}

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

let fallbackVisitorId: string | undefined
let fallbackSession: SessionRecord | undefined

function readVisitorCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const match = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(VISITOR_COOKIE + '='))
  const value = match?.slice(VISITOR_COOKIE.length + 1)
  if (!value) return undefined
  try { return decodeURIComponent(value) } catch { return undefined }
}

function writeVisitorCookie(id: string): void {
  if (typeof document === 'undefined') return
  document.cookie = `${VISITOR_COOKIE}=${encodeURIComponent(id)}; Max-Age=31536000; Path=/; SameSite=Lax`
}

function parseSessionRecord(saved: unknown): SessionRecord | null {
  if (!saved || typeof saved !== 'object') return null
  const record = saved as { id?: unknown; lastActivityAt?: unknown; source?: unknown }
  if (typeof record.id !== 'string' || !record.id) return null
  if (typeof record.lastActivityAt !== 'number' || !Number.isFinite(record.lastActivityAt)) return null
  return {
    id: record.id,
    lastActivityAt: record.lastActivityAt,
    source: typeof record.source === 'string' ? normalizeSource(record.source) : 'direct',
  }
}

function touchSession(storage?: Storage, sourceOverride?: AnalyticsTrafficSource): SessionRecord {
  const now = Date.now()
  try {
    const profileStorage = storage ?? window.localStorage
    const previous = parseSessionRecord(readJson(profileStorage, SESSION_KEY, null))
    const active = Boolean(previous && now >= previous.lastActivityAt && now - previous.lastActivityAt <= SESSION_TIMEOUT_MS)
    const source = sourceOverride
      ?? (active && previous ? previous.source : detectTrafficSource(trafficSourceHintsFromWindow()))
    const session: SessionRecord = {
      id: active && previous ? previous.id : randomId('session'),
      lastActivityAt: now,
      source,
    }
    profileStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return session
  } catch {
    const previousFallback = fallbackSession
    const active = Boolean(previousFallback && now >= previousFallback.lastActivityAt && now - previousFallback.lastActivityAt <= SESSION_TIMEOUT_MS)
    const source = sourceOverride
      ?? (active && previousFallback ? previousFallback.source : detectTrafficSource(trafficSourceHintsFromWindow()))
    fallbackSession = {
      id: active && previousFallback ? previousFallback.id : randomId('session'),
      lastActivityAt: now,
      source,
    }
    return fallbackSession
  }
}

export function loadCart(storage: Storage = window.localStorage): CartLine[] {
  const lines = readJson<unknown>(storage, CART_KEY, [])
  if (!Array.isArray(lines)) return []
  return lines.filter((line): line is CartLine => Boolean(line) && typeof line === 'object' && typeof (line as CartLine).productId === 'string' && Number.isFinite((line as CartLine).quantity) && (line as CartLine).quantity > 0).map((line) => ({ productId: line.productId, quantity: Math.floor(line.quantity) }))
}

export function saveCart(lines: CartLine[], storage: Storage = window.localStorage): void {
  storage.setItem(CART_KEY, JSON.stringify(lines.filter((line) => typeof line.productId === 'string' && line.productId.trim() && Number.isInteger(line.quantity) && line.quantity > 0).map((line) => ({ productId: line.productId.trim(), quantity: line.quantity }))))
}

export function loadCurrency(storage: Storage = window.localStorage): Currency {
  return readJson<Currency>(storage, CURRENCY_KEY, 'USD') === 'Bs' ? 'Bs' : 'USD'
}

export function saveCurrency(currency: Currency, storage: Storage = window.localStorage): void {
  storage.setItem(CURRENCY_KEY, JSON.stringify(currency))
}

export function isCurrencyHintSeen(storage: Storage = window.localStorage): boolean {
  return readJson<boolean>(storage, CURRENCY_HINT_KEY, false) === true
}

export function markCurrencyHintSeen(storage: Storage = window.localStorage): void {
  storage.setItem(CURRENCY_HINT_KEY, JSON.stringify(true))
}

export function isPrivacyDismissed(storage: Storage = window.localStorage): boolean {
  return readJson<boolean>(storage, PRIVACY_KEY, false) === true
}

export function dismissPrivacy(storage: Storage = window.localStorage): void {
  storage.setItem(PRIVACY_KEY, JSON.stringify(true))
}

export function markInternalBrowser(storage?: Storage): void {
  try {
    const target = storage ?? window.localStorage
    target.setItem(INTERNAL_KEY, JSON.stringify(true))
  } catch {
    // Analytics must never throw when storage is unavailable.
  }
}

export function isInternalBrowser(storage?: Storage): boolean {
  try {
    const target = storage ?? window.localStorage
    return readJson<boolean>(target, INTERNAL_KEY, false) === true
  } catch {
    return false
  }
}

export function getSessionId(storage?: Storage): string {
  return touchSession(storage).id
}

/**
 * Anonymous browser-profile identifier used only to deduplicate catalog visits.
 * It is intentionally separate from the short-lived session identifier.
 */
export function getVisitorId(storage?: Storage): string {
  const cookieId = readVisitorCookie()
  try {
    const candidate = storage ?? window.localStorage
    let id = readJson<string>(candidate, VISITOR_KEY, '')
    if (!id) {
      id = cookieId ?? randomId('visitor')
      candidate.setItem(VISITOR_KEY, JSON.stringify(id))
    }
    // Keep a first-party cookie as a recovery copy so clearing localStorage does
    // not create a second visitor for the same browser profile.
    writeVisitorCookie(id)
    return id
  } catch {
    if (cookieId) return cookieId
    fallbackVisitorId ??= randomId('visitor')
    writeVisitorCookie(fallbackVisitorId)
    return fallbackVisitorId
  }
}

/** First-touch source for the current idle session; explicit src/utm_source always wins. */
export function getSource(storage: Storage = window.localStorage): string {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const explicit = params.get('src')?.trim().toLowerCase() || params.get('utm_source')?.trim().toLowerCase()
  if (explicit) {
    const normalized = normalizeSource(explicit)
    touchSession(storage, normalized)
    return normalized
  }
  return touchSession(storage).source
}

export function loadOrders(storage: Storage = window.localStorage): Order[] {
  const orders = readJson<unknown>(storage, ORDERS_KEY, [])
  if (!Array.isArray(orders)) return []
  return orders.filter((order): order is Order => {
    if (!order || typeof order !== 'object') return false
    const value = order as Partial<Order>
    return typeof value.id === 'string' && typeof value.reference === 'string' && (value.status === 'PENDING' || value.status === 'CONFIRMED' || value.status === 'DISCARDED' || value.status === 'CANCELLED') && (value.currency === 'USD' || value.currency === 'Bs') && Array.isArray(value.items) && Boolean(value.quote && typeof value.quote === 'object')
  })
}

export function saveOrders(orders: Order[], storage: Storage = window.localStorage): void {
  storage.setItem(ORDERS_KEY, JSON.stringify(orders))
}
