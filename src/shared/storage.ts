import type { CartLine, Currency, Order } from './types'

const CART_KEY = 'coru_cart_v1'
const CURRENCY_KEY = 'coru_currency_v1'
const PRIVACY_KEY = 'coru_privacy_notice_v1'
const SESSION_KEY = 'coru_session_v1'
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

export function getSource(storage: Storage = window.sessionStorage): string {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('utm_source')?.trim().toLowerCase()
  if (source) {
    const normalized = source.slice(0, 40)
    storage.setItem(SOURCE_KEY, JSON.stringify(normalized))
    return normalized
  }
  return readJson<string>(storage, SOURCE_KEY, 'directo')
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
