import type { CartLine, Currency, Order } from './types'

const CART_KEY = 'coru_cart_v1'
const CURRENCY_KEY = 'coru_currency_v1'
const PRIVACY_KEY = 'coru_privacy_notice_v1'
const SESSION_KEY = 'coru_session_v1'
const VISITOR_KEY = 'coru_visitor_v1'
const VISITOR_COOKIE = 'coru_visitor_v1'
const SOURCE_KEY = 'coru_source_v1'
const ORDERS_KEY = 'coru_orders_v1'

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

function readVisitorCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const match = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(VISITOR_COOKIE + '='))
  const value = match?.slice(VISITOR_COOKIE.length + 1)
  return value ? decodeURIComponent(value) : undefined
}

function writeVisitorCookie(id: string): void {
  if (typeof document === 'undefined') return
  document.cookie = `${VISITOR_COOKIE}=${encodeURIComponent(id)}; Max-Age=31536000; Path=/; SameSite=Lax`
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

export function isPrivacyDismissed(storage: Storage = window.localStorage): boolean {
  return readJson<boolean>(storage, PRIVACY_KEY, false) === true
}

export function dismissPrivacy(storage: Storage = window.localStorage): void {
  storage.setItem(PRIVACY_KEY, JSON.stringify(true))
}

export function getSessionId(storage: Storage = window.sessionStorage): string {
  let id = readJson<string>(storage, SESSION_KEY, '')
  if (!id) {
    id = randomId('session')
    storage.setItem(SESSION_KEY, JSON.stringify(id))
  }
  return id
}

/**
 * Anonymous browser-profile identifier used only to deduplicate catalog visits.
 * It is intentionally separate from the short-lived session identifier.
 */
export function getVisitorId(storage?: Storage): string {
  try {
    const candidate = storage ?? window.localStorage
    let id = readJson<string>(candidate, VISITOR_KEY, '')
    if (!id) {
      id = randomId('visitor')
      candidate.setItem(VISITOR_KEY, JSON.stringify(id))
    }
    return id
  } catch {
    const cookieId = readVisitorCookie()
    if (cookieId) return cookieId
    fallbackVisitorId ??= randomId('visitor')
    writeVisitorCookie(fallbackVisitorId)
    return fallbackVisitorId
  }
}

export function getSource(storage: Storage = window.sessionStorage): string {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('src')?.trim().toLowerCase() || params.get('utm_source')?.trim().toLowerCase()
  if (source) {
    const normalized = normalizeSource(source)
    storage.setItem(SOURCE_KEY, JSON.stringify(normalized))
    return normalized
  }
  return normalizeSource(readJson<string>(storage, SOURCE_KEY, 'direct'))
}

function normalizeSource(value: unknown): string {
  const source = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (source === 'instagram' || source === 'ig') return 'instagram'
  if (source === 'facebook' || source === 'fb') return 'facebook'
  if (source === 'whatsapp' || source === 'wa') return 'whatsapp'
  if (!source || source === 'direct' || source === 'directo') return 'direct'
  return 'other'
}

export function loadOrders(storage: Storage = window.localStorage): Order[] {
  const orders = readJson<unknown>(storage, ORDERS_KEY, [])
  if (!Array.isArray(orders)) return []
  return orders.filter((order): order is Order => {
    if (!order || typeof order !== 'object') return false
    const value = order as Partial<Order>
    return typeof value.id === 'string' && typeof value.reference === 'string' && (value.status === 'PENDING' || value.status === 'CONFIRMED' || value.status === 'DISCARDED') && (value.currency === 'USD' || value.currency === 'Bs') && Array.isArray(value.items) && Boolean(value.quote && typeof value.quote === 'object')
  })
}

export function saveOrders(orders: Order[], storage: Storage = window.localStorage): void {
  storage.setItem(ORDERS_KEY, JSON.stringify(orders))
}
