import { ANALYTICS_EVENT_NAMES } from './analytics-events'
import type { AnalyticsEvent, CartLine, Currency, ShippingSelection } from './types'

type ValidationSuccess<T> = { ok: true; value: T }
type ValidationFailure = { ok: false; details: Array<{ path: string; message: string }> }

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

function parseShipping(value: unknown, details: Array<{ path: string; message: string }>): ShippingSelection | null | undefined {
  if (value === undefined || value === null) return value === null ? null : undefined
  if (!value || typeof value !== 'object') { details.push({ path: 'shipping', message: 'La entrega no es válida.' }); return undefined }
  const candidate = value as Record<string, unknown>
  if (candidate.method === 'PERSONAL') {
    if (typeof candidate.deliveryPointId !== 'string' || candidate.deliveryPointId.trim().length === 0) details.push({ path: 'shipping.deliveryPointId', message: 'Selecciona un punto de entrega.' })
    return typeof candidate.deliveryPointId === 'string' && candidate.deliveryPointId.trim() ? { method: 'PERSONAL', deliveryPointId: candidate.deliveryPointId.trim() } : undefined
  }
  if (candidate.method === 'YUMMY') {
    if (typeof candidate.addressText !== 'string' || candidate.addressText.trim().length < 5 || candidate.addressText.length > 400) details.push({ path: 'shipping.addressText', message: 'Indica una dirección válida.' })
    const latitude = candidate.latitude
    const longitude = candidate.longitude
    if ((latitude === undefined) !== (longitude === undefined)) details.push({ path: 'shipping.coordinates', message: 'La latitud y la longitud deben enviarse juntas.' })
    if (latitude !== undefined && (typeof latitude !== 'number' || latitude < -90 || latitude > 90)) details.push({ path: 'shipping.latitude', message: 'Coordenada inválida.' })
    if (longitude !== undefined && (typeof longitude !== 'number' || longitude < -180 || longitude > 180)) details.push({ path: 'shipping.longitude', message: 'Coordenada inválida.' })
    return typeof candidate.addressText === 'string' && candidate.addressText.trim().length >= 5 ? { method: 'YUMMY', addressText: candidate.addressText.trim(), ...(typeof latitude === 'number' ? { latitude } : {}), ...(typeof longitude === 'number' ? { longitude } : {}), ...(typeof candidate.quoteReference === 'string' && candidate.quoteReference.trim() ? { quoteReference: candidate.quoteReference.trim().slice(0, 120) } : {}) } : undefined
  }
  if (candidate.method === 'NATIONAL') {
    if (candidate.carrier !== 'MRW' && candidate.carrier !== 'ZOOM') details.push({ path: 'shipping.carrier', message: 'La empresa de envío no es válida.' })
    const location: Partial<Record<'state' | 'city' | 'officeText', string>> = {}
    for (const key of ['state', 'city', 'officeText'] as const) {
      const raw = candidate[key]
      if (raw !== undefined && (typeof raw !== 'string' || raw.length > (key === 'officeText' ? 160 : 100))) details.push({ path: `shipping.${key}`, message: 'El dato de destino no es válido.' })
      if (typeof raw === 'string' && raw.trim()) location[key] = raw.trim().slice(0, key === 'officeText' ? 160 : 100)
    }
    return candidate.carrier === 'MRW' || candidate.carrier === 'ZOOM' ? { method: 'NATIONAL', carrier: candidate.carrier, ...location } : undefined
  }
  details.push({ path: 'shipping.method', message: 'La modalidad de entrega no es válida.' })
  return undefined
}

export function parseOrderIntentInput(input: unknown): ValidationResult<{ lines: CartLine[]; currency: Currency; rateMicros?: number; shipping?: ShippingSelection | null; sessionId?: string; source?: string }> {
  if (!input || typeof input !== 'object') return { ok: false, details: [{ path: '', message: 'El cuerpo debe ser un objeto.' }] }
  const value = input as Record<string, unknown>
  const details: Array<{ path: string; message: string }> = []
  const rawLines = value.lines
  if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > 50) details.push({ path: 'lines', message: 'Incluye entre 1 y 50 líneas.' })
  const lines: CartLine[] = []
  if (Array.isArray(rawLines)) {
    rawLines.forEach((line, index) => {
      if (!line || typeof line !== 'object') { details.push({ path: `lines.${index}`, message: 'Línea inválida.' }); return }
      const candidate = line as Record<string, unknown>
      if (typeof candidate.productId !== 'string' || candidate.productId.trim().length === 0) details.push({ path: `lines.${index}.productId`, message: 'Producto inválido.' })
      const quantity = candidate.quantity
      if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0 || quantity > 100) details.push({ path: `lines.${index}.quantity`, message: 'La cantidad debe ser un entero entre 1 y 100.' })
      if (typeof candidate.productId === 'string' && typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0 && quantity <= 100) lines.push({ productId: candidate.productId.trim(), quantity })
    })
  }
  const currency = value.currency
  if (currency !== 'USD' && currency !== 'Bs') details.push({ path: 'currency', message: 'La moneda debe ser USD o Bs.' })
  const rateMicros = value.rateMicros
  // The client may include its last displayed rate as a hint, but the Worker
  // is authoritative and resolves the usable rate server-side.  An omitted
  // hint is therefore valid for Bs; a supplied hint still has to be a
  // positive integer so malformed payloads cannot leak into domain code.
  if (rateMicros !== undefined && (typeof rateMicros !== 'number' || !Number.isInteger(rateMicros) || rateMicros <= 0)) details.push({ path: 'rateMicros', message: 'La tasa enviada debe ser un entero positivo.' })
  const shipping = parseShipping(value.shipping, details)
  const sessionId = value.sessionId
  if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.trim().length === 0 || sessionId.length > 80)) details.push({ path: 'sessionId', message: 'Sesión inválida.' })
  const source = value.source
  if (source !== undefined && (typeof source !== 'string' || source.length > 40)) details.push({ path: 'source', message: 'Fuente inválida.' })
  if (details.length) return { ok: false, details }
  return { ok: true, value: { lines, currency: currency as Currency, ...(typeof rateMicros === 'number' ? { rateMicros } : {}), ...(shipping !== undefined ? { shipping } : {}), ...(typeof sessionId === 'string' ? { sessionId: sessionId.trim() } : {}), ...(typeof source === 'string' ? { source: source.trim().slice(0, 40) || 'directo' } : {}) } }
}

const analyticsNames = new Set<string>(ANALYTICS_EVENT_NAMES)
const analyticsPropertyKeys = new Set(['productId', 'productName', 'category', 'promoEligible', 'fulfillment_type', 'unitPriceCents', 'quantityDelta', 'device', 'visitorId', 'productCount', 'promoApplied', 'currency', 'orderReference', 'method', 'shipping_method', 'carrier', 'amountMinor', 'status', 'stage', 'sessionModel'])
const forbiddenKeys = new Set(['name', 'phone', 'email', 'address', 'message', 'customertext', 'customer_text', 'coordinates', 'latitude', 'longitude', 'paymentnote', 'payment_note', 'ip', 'token'])

export function parseAnalyticsInput(input: unknown): ValidationResult<{ events: AnalyticsEvent[] }> {
  if (!input || typeof input !== 'object') return { ok: false, details: [{ path: '', message: 'El cuerpo debe ser un objeto.' }] }
  const value = input as Record<string, unknown>
  if (!Array.isArray(value.events) || value.events.length > 20) return { ok: false, details: [{ path: 'events', message: 'Se permiten hasta 20 eventos por lote.' }] }
  const details: Array<{ path: string; message: string }> = []
  const events: AnalyticsEvent[] = []
  value.events.forEach((event, index) => {
    if (!event || typeof event !== 'object') { details.push({ path: `events.${index}`, message: 'Evento inválido.' }); return }
    const candidate = event as Record<string, unknown>
    if (typeof candidate.name !== 'string' || !analyticsNames.has(candidate.name)) details.push({ path: `events.${index}.name`, message: 'Tipo de evento no permitido.' })
    if (typeof candidate.sessionId !== 'string' || candidate.sessionId.trim().length === 0 || candidate.sessionId.length > 80) details.push({ path: `events.${index}.sessionId`, message: 'Sesión inválida.' })
    if (typeof candidate.occurredAt !== 'string' || Number.isNaN(Date.parse(candidate.occurredAt))) details.push({ path: `events.${index}.occurredAt`, message: 'Fecha inválida.' })
    const source = candidate.source
    if (source !== undefined && (typeof source !== 'string' || source.length > 40)) details.push({ path: `events.${index}.source`, message: 'Fuente inválida.' })
    const properties = candidate.properties
    let cleanProperties: Record<string, string | number | boolean> | undefined
    if (properties !== undefined) {
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) details.push({ path: `events.${index}.properties`, message: 'Las propiedades contienen datos no permitidos.' })
      else {
        const record = properties as Record<string, unknown>
        const invalid = Object.entries(record).some(([key, value]) => {
          const lowerKey = key.toLowerCase()
          if (!analyticsPropertyKeys.has(key) || forbiddenKeys.has(lowerKey) || /customer|phone|email|address|coordinate|payment|rawip|device.?token/.test(lowerKey)) return true
          if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return true
          if (typeof value === 'string' && value.length > 120) return true
          if (typeof value === 'number' && !Number.isFinite(value)) return true
          if (key === 'unitPriceCents' && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) return true
          if (key === 'quantityDelta' && (typeof value !== 'number' || !Number.isInteger(value) || value < 1)) return true
          return false
        })
        if (invalid || Object.keys(record).length > 20) details.push({ path: `events.${index}.properties`, message: 'Las propiedades contienen datos no permitidos.' })
        else cleanProperties = record as Record<string, string | number | boolean>
      }
    }
    if (typeof candidate.name === 'string' && analyticsNames.has(candidate.name) && typeof candidate.sessionId === 'string' && candidate.sessionId.trim().length > 0 && candidate.sessionId.length <= 80 && typeof candidate.occurredAt === 'string' && !Number.isNaN(Date.parse(candidate.occurredAt))) events.push({ name: candidate.name as AnalyticsEvent['name'], sessionId: candidate.sessionId.trim(), source: typeof source === 'string' ? source.trim().slice(0, 40) || 'directo' : 'directo', occurredAt: candidate.occurredAt, ...(cleanProperties ? { properties: cleanProperties } : {}) })
  })
  if (details.length) return { ok: false, details }
  return { ok: true, value: { events } }
}
