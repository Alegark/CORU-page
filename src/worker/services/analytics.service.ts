import type { AnalyticsEvent, Order } from '../../shared/types'
import type { CoruState } from '../state'

const RETENTION_DAYS = 180

export type AnalyticsSummary = {
  events: number
  funnel: Record<AnalyticsEvent['name'], number>
  sources: Record<string, number>
  devices: Record<string, number>
  traffic: TrafficSummary
  promo: { started: number; completed: number; confirmed: number }
  confirmedOrders: number
  pendingOrders: number
  discardedOrders: number
  confirmedRevenueCents: number
}

export type AnalyticsRange = {
  fromMs?: number
  toMs?: number
}

export type TrafficSummary = {
  /** Total catalog page loads recorded during the retention window/range. */
  visits: number
  /** Distinct anonymous browser sessions that loaded the catalog. */
  sessions: number
  /** Average catalog loads per anonymous session. */
  pagesPerSession: number
}

export function recordAnalytics(state: CoruState, events: AnalyticsEvent[]): number {
  state.analytics.push(...events.map((event) => ({ ...event, ...(event.properties ? { properties: { ...event.properties } } : {}) })))
  return events.length
}

export function purgeAnalytics(state: CoruState, now = new Date()): number {
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  const before = state.analytics.length
  state.analytics = state.analytics.filter((event) => Date.parse(event.occurredAt) >= cutoff)
  return before - state.analytics.length
}

function deviceFor(event: AnalyticsEvent): string {
  const value = event.properties?.device
  return typeof value === 'string' && value ? value.slice(0, 24) : 'desconocido'
}

function inRange(event: AnalyticsEvent, range: AnalyticsRange): boolean {
  const occurredAt = Date.parse(event.occurredAt)
  if (Number.isNaN(occurredAt)) return false
  if (range.fromMs !== undefined && occurredAt < range.fromMs) return false
  if (range.toMs !== undefined && occurredAt > range.toMs) return false
  return true
}

export function summarizeTraffic(state: CoruState, range: AnalyticsRange = {}): TrafficSummary {
  const visits = state.analytics.filter((event) => event.name === 'catalog_view' && inRange(event, range))
  const sessions = new Set(visits.map((event) => event.sessionId)).size
  return {
    visits: visits.length,
    sessions,
    pagesPerSession: sessions ? Number((visits.length / sessions).toFixed(2)) : 0,
  }
}

export function summarizeAnalytics(state: CoruState, orders: Order[] = state.orders): AnalyticsSummary {
  const funnel: AnalyticsSummary['funnel'] = { catalog_view: 0, product_view: 0, cart_add: 0, order_intent: 0, order_confirmed: 0, size_guide_view: 0, shipping_method_selected: 0, yummy_quote_requested: 0, yummy_quote_succeeded: 0, yummy_quote_failed: 0, preorder_intent_created: 0, preorder_deposit_recorded: 0, preorder_ready: 0, preorder_completed: 0 }
  const sources: Record<string, number> = {}
  const devices: Record<string, number> = {}
  let started = 0
  let completed = 0
  let confirmed = 0
  for (const event of state.analytics) {
    funnel[event.name] += 1
    sources[event.source] = (sources[event.source] ?? 0) + 1
    const device = deviceFor(event)
    devices[device] = (devices[device] ?? 0) + 1
    if (event.name === 'cart_add' && event.properties?.promoEligible === true) started += 1
    if (event.name === 'order_intent' && event.properties?.promoApplied === true) completed += 1
    if (event.name === 'order_confirmed' && event.properties?.promoApplied === true) confirmed += 1
  }
  const confirmedOrders = orders.filter((order) => order.status === 'CONFIRMED')
  return {
    events: state.analytics.length,
    funnel, sources, devices, traffic: summarizeTraffic(state),
    promo: { started, completed, confirmed },
    confirmedOrders: confirmedOrders.length,
    pendingOrders: orders.filter((order) => order.status === 'PENDING').length,
    discardedOrders: orders.filter((order) => order.status === 'DISCARDED').length,
    confirmedRevenueCents: confirmedOrders.reduce((sum, order) => sum + order.quote.totalCents, 0),
  }
}
