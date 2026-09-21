import type { AnalyticsEvent, Order, Product } from '../../shared/types'
import type { CoruState } from '../state'

const RETENTION_DAYS = 180
const DAY_MS = 24 * 60 * 60 * 1000
const CARACAS_TIMEZONE = 'America/Caracas' as const
const CARACAS_OFFSET = '-04:00'
const navigationEvents = new Set<AnalyticsEvent['name']>(['catalog_view', 'product_view', 'size_guide_view'])

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
  from?: string
  to?: string
  timezone?: typeof CARACAS_TIMEZONE
}

export type ResolvedAnalyticsRange = {
  from: string
  to: string
  fromMs: number
  toMs: number
  timezone: typeof CARACAS_TIMEZONE
}

export type TrafficSummary = {
  visits: number
  sessions: number
  pagesPerSession: number
}

export type ProductInterestRow = {
  productId: string
  name: string
  views: number
  unitsAdded: number
  addSessions: number
  interestScore: number
  relativeInterestPct: number
}

export type AnalyticsTimelineBucket = {
  bucket: string
  uniqueVisits: number
  unitsAdded: number
  whatsappIntents: number
}

export type AnalyticsSource = 'instagram' | 'facebook' | 'whatsapp' | 'direct' | 'other'
export type AnalyticsDevice = 'mobile' | 'tablet' | 'desktop' | 'unknown'

export type AdminAnalyticsSummaryV2 = {
  range: Pick<ResolvedAnalyticsRange, 'from' | 'to' | 'timezone'>
  kpis: { uniqueVisits: number; totalVisits: number; uniqueDevices: number; unitsAdded: number; whatsappIntents: number }
  commercial: { unitsAdded: number; potentialValueCents: number; potentialValueEstimated: boolean; whatsappPerAddPct: number }
  funnel: { catalogSessions: number; productViewSessions: number; addSessions: number; whatsappSessions: number; confirmedOrders: number }
  sources: Array<{ source: AnalyticsSource; visits: number; percentage: number }>
  devices: Array<{ device: AnalyticsDevice; visits: number; percentage: number }>
  timeline: AnalyticsTimelineBucket[]
  realOrders: { pending: number; confirmed: number; discarded: number; cancelled: number; confirmedStockRevenueCents: number }
}

export function recordAnalytics(state: CoruState, events: AnalyticsEvent[]): number {
  state.analytics.push(...events.map((event) => ({ ...event, ...(event.properties ? { properties: { ...event.properties } } : {}) })))
  return events.length
}

export function purgeAnalytics(state: CoruState, now = new Date()): number {
  const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS
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

function eventProperties(event: AnalyticsEvent): Record<string, string | number | boolean> {
  return event.properties ?? {}
}

function stringProperty(event: AnalyticsEvent, key: string): string | undefined {
  const value = eventProperties(event)[key]
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : undefined
}

function numberProperty(event: AnalyticsEvent, key: string): number | undefined {
  const value = eventProperties(event)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function visitorIdFor(event: AnalyticsEvent): string | undefined {
  return stringProperty(event, 'visitorId')
}

function sessionIdentityFor(event: AnalyticsEvent): string {
  return visitorIdFor(event) ?? `session:${event.sessionId}`
}

function quantityDelta(event: AnalyticsEvent): number {
  const value = numberProperty(event, 'quantityDelta')
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : 1
}

function unitPriceCents(event: AnalyticsEvent): number | undefined {
  const value = numberProperty(event, 'unitPriceCents')
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined
}

function productIdFor(event: AnalyticsEvent): string | undefined {
  return stringProperty(event, 'productId')
}

function productLookup(state: CoruState, productId: string | undefined): Product | undefined {
  return productId ? state.products.find((product) => product.id === productId) : undefined
}

function normalizeSource(value: string | undefined): AnalyticsSource {
  const source = (value ?? '').trim().toLowerCase().replace(/^src=/, '').replace(/^utm_source=/, '')
  if (source === 'instagram' || source === 'ig') return 'instagram'
  if (source === 'facebook' || source === 'fb') return 'facebook'
  if (source === 'whatsapp' || source === 'wa') return 'whatsapp'
  if (!source || source === 'direct' || source === 'directo') return 'direct'
  return 'other'
}

function normalizeDevice(value: string | undefined): AnalyticsDevice {
  if (value === 'mobile' || value === 'tablet' || value === 'desktop') return value
  return 'unknown'
}

function localDateParts(date: Date): { year: string; month: string; day: string; hour: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const result = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
  return { year: result.year, month: result.month, day: result.day, hour: result.hour }
}

function localDateString(date: Date): string {
  const parts = localDateParts(date)
  return parts.year + '-' + parts.month + '-' + parts.day
}

function todayInCaracas(now: Date): string {
  return localDateString(now)
}

function dateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function validDateOnly(value: string): boolean {
  if (!dateOnly(value)) return false
  const parsed = Date.parse(value + 'T00:00:00' + CARACAS_OFFSET)
  if (Number.isNaN(parsed)) return false
  return localDateString(new Date(parsed)) === value
}

function startOfCaracasDate(value: string): number {
  return Date.parse(value + 'T00:00:00' + CARACAS_OFFSET)
}

function endOfCaracasDate(value: string): number {
  return Date.parse(value + 'T23:59:59.999' + CARACAS_OFFSET)
}

function shiftDate(value: string, deltaDays: number): string {
  const shifted = new Date(startOfCaracasDate(value) + deltaDays * DAY_MS)
  return localDateString(shifted)
}

export function resolveAnalyticsDateRange(fromRaw?: string, toRaw?: string, now = new Date()): { ok: true; value: ResolvedAnalyticsRange } | { ok: false; details: Array<{ path: string; message: string }> } {
  const today = todayInCaracas(now)
  const from = fromRaw?.trim() || shiftDate(toRaw?.trim() && validDateOnly(toRaw.trim()) ? toRaw.trim() : today, -6)
  const to = toRaw?.trim() || today
  const details: Array<{ path: string; message: string }> = []
  if (!validDateOnly(from)) details.push({ path: 'from', message: 'La fecha inicial debe tener formato YYYY-MM-DD.' })
  if (!validDateOnly(to)) details.push({ path: 'to', message: 'La fecha final debe tener formato YYYY-MM-DD.' })
  if (details.length) return { ok: false, details }
  const fromMs = startOfCaracasDate(from)
  const requestedToMs = endOfCaracasDate(to)
  const toMs = Math.min(requestedToMs, now.getTime())
  if (fromMs > toMs) details.push({ path: 'range', message: 'La fecha inicial no puede ser posterior a la fecha final.' })
  const spanDays = Math.floor((startOfCaracasDate(to) - fromMs) / DAY_MS) + 1
  if (spanDays > RETENTION_DAYS) details.push({ path: 'range', message: 'El intervalo no puede superar ' + RETENTION_DAYS + ' días.' })
  if (details.length) return { ok: false, details }
  return { ok: true, value: { from, to, fromMs, toMs, timezone: CARACAS_TIMEZONE } }
}

export function summarizeTraffic(state: CoruState, range: AnalyticsRange = {}): TrafficSummary {
  const visits = uniqueCatalogVisitEvents(eventsInRange(state, range))
  const sessions = new Set(visits.map(visitorIdFor).filter((id): id is string => Boolean(id))).size
  return { visits: visits.length, sessions, pagesPerSession: sessions ? Number((visits.length / sessions).toFixed(2)) : 0 }
}

function eventsInRange(state: CoruState, range: AnalyticsRange): AnalyticsEvent[] {
  return state.analytics.filter((event) => inRange(event, range))
}

function orderDate(order: Order, status: Order['status']): string | undefined {
  if (status === 'CONFIRMED') return order.confirmedAt
  if (status === 'DISCARDED') return order.discardedAt ?? order.createdAt
  if (status === 'CANCELLED') return order.cancelledAt ?? order.createdAt
  return order.createdAt
}

function orderInRange(order: Order, status: Order['status'], range: AnalyticsRange): boolean {
  if (range.fromMs === undefined && range.toMs === undefined) return true
  const timestamp = orderDate(order, status)
  if (!timestamp) return false
  const value = Date.parse(timestamp)
  if (Number.isNaN(value)) return false
  if (range.fromMs !== undefined && value < range.fromMs) return false
  if (range.toMs !== undefined && value > range.toMs) return false
  return true
}

function isStockOrder(order: Order): boolean {
  if (order.fulfillmentTypeSnapshot) return order.fulfillmentTypeSnapshot === 'STOCK'
  return order.items.every((item) => (item.fulfillmentTypeSnapshot ?? 'STOCK') === 'STOCK')
}

function percentage(value: number, total: number): number {
  return total ? Math.round((value / total) * 100) : 0
}

function visitDistribution(events: AnalyticsEvent[], property: (event: AnalyticsEvent) => string): Array<{ label: string; visits: number; percentage: number }> {
  const counts = new Map<string, number>()
  for (const event of events) {
    const value = property(event)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const total = events.length
  return [...counts.entries()].map(([label, visits]) => ({ label, visits, percentage: percentage(visits, total) })).sort((a, b) => b.visits - a.visits || a.label.localeCompare(b.label))
}

function uniqueCatalogVisitEvents(events: AnalyticsEvent[]): AnalyticsEvent[] {
  const seen = new Set<string>()
  return [...events]
    .filter((event) => event.name === 'catalog_view' && Boolean(visitorIdFor(event)))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .filter((event) => {
      const key = visitorIdFor(event)
      if (!key) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function uniqueCatalogVisitEventsPerDay(events: AnalyticsEvent[]): AnalyticsEvent[] {
  const seen = new Set<string>()
  return [...events]
    .filter((event) => event.name === 'catalog_view' && Boolean(visitorIdFor(event)))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .filter((event) => {
      const visitorId = visitorIdFor(event)
      if (!visitorId) return false
      const key = `${visitorId}|${localDateString(new Date(event.occurredAt))}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function bucketFor(event: AnalyticsEvent, range: ResolvedAnalyticsRange): string {
  const parts = localDateParts(new Date(event.occurredAt))
  return range.from === range.to ? parts.hour + ':00' : parts.year + '-' + parts.month + '-' + parts.day
}

export function summarizeProductInterest(state: CoruState, range: AnalyticsRange = {}): ProductInterestRow[] {
  const rows = new Map<string, { name?: string; views: number; unitsAdded: number; addSessions: Set<string> }>()
  for (const event of eventsInRange(state, range)) {
    if (event.name !== 'product_view' && event.name !== 'cart_add') continue
    const productId = productIdFor(event)
    if (!productId) continue
    const row = rows.get(productId) ?? { views: 0, unitsAdded: 0, addSessions: new Set<string>() }
    row.name ??= stringProperty(event, 'productName')
    if (event.name === 'product_view') row.views += 1
    else { row.unitsAdded += quantityDelta(event); row.addSessions.add(event.sessionId) }
    rows.set(productId, row)
  }
  const result = [...rows.entries()].map(([productId, row]) => {
    const product = productLookup(state, productId)
    const interestScore = row.views + row.unitsAdded * 3
    return { productId, name: row.name ?? product?.name ?? 'Producto histórico', views: row.views, unitsAdded: row.unitsAdded, addSessions: row.addSessions.size, interestScore, relativeInterestPct: 0 }
  }).sort((a, b) => b.interestScore - a.interestScore || b.unitsAdded - a.unitsAdded || b.views - a.views || a.name.localeCompare(b.name)).slice(0, 10)
  const maxScore = result[0]?.interestScore ?? 0
  return result.map((row) => ({ ...row, relativeInterestPct: percentage(row.interestScore, maxScore) }))
}

export function summarizeAnalyticsV2(state: CoruState, orders: Order[] = state.orders, range: ResolvedAnalyticsRange): AdminAnalyticsSummaryV2 {
  const events = eventsInRange(state, range)
  const catalogVisits = uniqueCatalogVisitEvents(events)
  const totalVisits = events.filter((event) => event.name === 'catalog_view').length
  const uniqueDevices = new Set(catalogVisits.map(visitorIdFor).filter((id): id is string => Boolean(id)))
  const adds = events.filter((event) => event.name === 'cart_add')
  const orderIntents = events.filter((event) => event.name === 'order_intent')
  const unitsAdded = adds.reduce((sum, event) => sum + quantityDelta(event), 0)
  let potentialValueCents = 0
  let potentialValueEstimated = false
  for (const event of adds) {
    const snapshotPrice = unitPriceCents(event)
    const price = snapshotPrice ?? productLookup(state, productIdFor(event))?.priceCents
    if (snapshotPrice === undefined) potentialValueEstimated = true
    if (price !== undefined) potentialValueCents += price * quantityDelta(event)
  }
  const sessionsWithAdd = new Set(adds.map(sessionIdentityFor)).size
  const sessionsWithIntent = new Set(orderIntents.map(sessionIdentityFor)).size
  const confirmed = orders.filter((order) => order.status === 'CONFIRMED' && orderInRange(order, 'CONFIRMED', range))
  const sourceEntries = visitDistribution(catalogVisits, (event) => normalizeSource(event.source)).map(({ label, visits, percentage: pct }) => ({ source: label as AnalyticsSource, visits, percentage: pct }))
  const deviceEntries = visitDistribution(catalogVisits, (event) => normalizeDevice(stringProperty(event, 'device'))).map(({ label, visits, percentage: pct }) => ({ device: label as AnalyticsDevice, visits, percentage: pct }))
  const timelineMap = new Map<string, AnalyticsTimelineBucket>()
  for (const event of uniqueCatalogVisitEventsPerDay(events)) {
    const bucket = bucketFor(event, range)
    const current = timelineMap.get(bucket) ?? { bucket, uniqueVisits: 0, unitsAdded: 0, whatsappIntents: 0 }
    current.uniqueVisits += 1
    timelineMap.set(bucket, current)
  }
  for (const event of events) {
    if (event.name !== 'cart_add' && event.name !== 'order_intent') continue
    const bucket = bucketFor(event, range)
    const current = timelineMap.get(bucket) ?? { bucket, uniqueVisits: 0, unitsAdded: 0, whatsappIntents: 0 }
    if (event.name === 'cart_add') current.unitsAdded += quantityDelta(event)
    if (event.name === 'order_intent') current.whatsappIntents += 1
    timelineMap.set(bucket, current)
  }
  const realOrders = {
    pending: orders.filter((order) => order.status === 'PENDING' && orderInRange(order, 'PENDING', range)).length,
    confirmed: confirmed.length,
    discarded: orders.filter((order) => order.status === 'DISCARDED' && orderInRange(order, 'DISCARDED', range)).length,
    cancelled: orders.filter((order) => order.status === 'CANCELLED' && orderInRange(order, 'CANCELLED', range)).length,
    confirmedStockRevenueCents: confirmed.filter(isStockOrder).reduce((sum, order) => sum + order.quote.totalCents, 0),
  }
  return {
    range: { from: range.from, to: range.to, timezone: range.timezone ?? CARACAS_TIMEZONE },
    kpis: { uniqueVisits: catalogVisits.length, totalVisits, uniqueDevices: uniqueDevices.size, unitsAdded, whatsappIntents: orderIntents.length },
    commercial: { unitsAdded, potentialValueCents, potentialValueEstimated, whatsappPerAddPct: percentage(sessionsWithIntent, sessionsWithAdd) },
    funnel: { catalogSessions: catalogVisits.length, productViewSessions: new Set(events.filter((event) => event.name === 'product_view').map(sessionIdentityFor)).size, addSessions: sessionsWithAdd, whatsappSessions: sessionsWithIntent, confirmedOrders: confirmed.length },
    sources: sourceEntries,
    devices: deviceEntries,
    timeline: [...timelineMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
    realOrders,
  }
}

export function summarizeAnalytics(state: CoruState, orders: Order[] = state.orders, range: AnalyticsRange = {}): AnalyticsSummary {
  const filteredEvents = eventsInRange(state, range)
  const funnel: AnalyticsSummary['funnel'] = { catalog_view: 0, product_view: 0, cart_add: 0, order_intent: 0, order_confirmed: 0, size_guide_view: 0, shipping_method_selected: 0, yummy_quote_requested: 0, yummy_quote_succeeded: 0, yummy_quote_failed: 0, preorder_intent_created: 0, preorder_deposit_recorded: 0, preorder_ready: 0, preorder_completed: 0 }
  const sources: Record<string, number> = {}
  const devices: Record<string, number> = {}
  let started = 0
  let completed = 0
  let confirmed = 0
  for (const event of filteredEvents) {
    funnel[event.name] += 1
    sources[event.source] = (sources[event.source] ?? 0) + 1
    const device = deviceFor(event)
    devices[device] = (devices[device] ?? 0) + 1
    if (event.name === 'cart_add' && event.properties?.promoEligible === true) started += 1
    if (event.name === 'order_intent' && event.properties?.promoApplied === true) completed += 1
    if (event.name === 'order_confirmed' && event.properties?.promoApplied === true) confirmed += 1
  }
  const confirmedOrders = orders.filter((order) => order.status === 'CONFIRMED' && orderInRange(order, 'CONFIRMED', range))
  return {
    events: filteredEvents.length,
    funnel, sources, devices, traffic: summarizeTraffic(state, range),
    promo: { started, completed, confirmed },
    confirmedOrders: confirmedOrders.length,
    pendingOrders: orders.filter((order) => order.status === 'PENDING' && orderInRange(order, 'PENDING', range)).length,
    discardedOrders: orders.filter((order) => order.status === 'DISCARDED' && orderInRange(order, 'DISCARDED', range)).length,
    confirmedRevenueCents: confirmedOrders.reduce((sum, order) => sum + order.quote.totalCents, 0),
  }
}
