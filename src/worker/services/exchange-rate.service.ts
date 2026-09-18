import type { CoruState } from '../state'

export type RateMode = 'AUTOMATIC' | 'MANUAL'

export type ExchangeRateProvider = {
  getRate: (signal?: AbortSignal) => Promise<unknown>
}

type RateFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown } catch { return undefined }
}

function extractRateValue(payload: unknown): unknown {
  if (typeof payload === 'number' || typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.rate !== undefined || record.rateUsd !== undefined || record.value !== undefined) return record.rate ?? record.rateUsd ?? record.value
  if (!record.data || typeof record.data !== 'object') return null
  const data = record.data as Record<string, unknown>
  if (data.price !== undefined) return data.price
  // The approved read-only relay returns Binance's JSON body as `content`
  // (older responses called it `text`). Parse that inner body, never free-form
  // text, before accepting a numeric rate.
  const nested = typeof data.content === 'string' ? data.content : typeof data.text === 'string' ? data.text : undefined
  return nested ? extractRateValue(parseJson(nested)) : null
}

export type PublicRate = {
  available: boolean
  rateMicros: number | null
  mode: RateMode
  updatedAt: string | null
}

export class ExchangeRateError extends Error {
  constructor(public readonly code: 'RATE_INVALID' | 'RATE_UNAVAILABLE', message: string) {
    super(message)
    this.name = 'ExchangeRateError'
  }
}

/** Operator-controlled JSON endpoint (direct Binance or the approved relay). */
export function createHttpRateProvider(url: string, fetcher: RateFetcher = (input, init) => fetch(input, init)): ExchangeRateProvider {
  return {
    getRate: async (signal?: AbortSignal) => {
      const response = await fetcher(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'es-VE,es;q=0.9,en-US;q=0.8,en;q=0.7',
          'User-Agent': 'binance-wallet/1.0.0 (Skill)',
          Origin: 'https://www.binance.com',
          Referer: 'https://www.binance.com/en/p2p',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          // Keep the relay response for at most ten minutes. This stays
          // within the Worker cron cadence while avoiding its shared-IP rate
          // limit; Binance remains the source of the quote.
          'X-Cache-Tolerance': '600',
        },
        signal,
      })
      if (!response.ok) throw new Error(`rate provider status ${response.status}`)
      return extractRateValue(parseJson(await response.text()))
    },
  }
}

/** Caracas day end used for the customer-facing rate lock. */
export function endOfCaracasDay(date: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
  return new Date(`${parts.year}-${parts.month}-${parts.day}T23:59:59-04:00`)
}

/** Convert a decimal rate to integer micros without floating-point drift. */
export function parseRateToMicros(value: unknown): number | null {
  const raw = typeof value === 'number' ? (Number.isFinite(value) ? value.toString() : '') : typeof value === 'string' ? value.trim().replace(',', '.') : ''
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) return null
  const [whole, fraction = ''] = raw.split('.')
  const micros = Number(`${whole}${fraction.padEnd(6, '0')}`)
  if (!Number.isSafeInteger(micros) || micros <= 0) return null
  return micros
}

export function formatRate(rateMicros: number): string {
  if (!Number.isSafeInteger(rateMicros) || rateMicros <= 0) return ''
  const whole = Math.floor(rateMicros / 1_000_000)
  const fraction = String(rateMicros % 1_000_000).padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

function normalizeRateMetadata(state: CoruState, now: Date): void {
  if (state.currentRateMicros <= 0) return
  const updatedAt = Date.parse(state.rateUpdatedAt)
  const validUntil = Date.parse(state.rateValidUntil)
  // The in-memory bootstrap rate is intentionally usable in preview and as a
  // safe bridge while an older isolate is being hydrated. A persisted,
  // genuinely expired observation must remain unavailable until refreshed.
  const isBootstrapRate = state.rateSource !== 'PERSISTED'
  if (isBootstrapRate && (!Number.isFinite(validUntil) || validUntil <= 0 || now.getTime() > validUntil)) {
    state.rateUpdatedAt = now.toISOString()
    state.rateValidUntil = endOfCaracasDay(now).toISOString()
    return
  }
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) state.rateUpdatedAt = now.toISOString()
  if (!Number.isFinite(validUntil) || validUntil <= 0) state.rateValidUntil = endOfCaracasDay(now).toISOString()
}

export function isRateUsable(state: CoruState, now = new Date()): boolean {
  normalizeRateMetadata(state, now)
  return state.currentRateMicros > 0 && (!state.rateValidUntil || now <= new Date(state.rateValidUntil))
}

export function getPublicRate(state: CoruState, now = new Date()): PublicRate {
  const available = isRateUsable(state, now)
  return {
    available,
    rateMicros: state.currentRateMicros > 0 ? state.currentRateMicros : null,
    mode: state.rateMode,
    updatedAt: state.rateUpdatedAt || null,
  }
}

export function getUsableRate(state: CoruState, now = new Date()): number {
  if (!isRateUsable(state, now)) throw new ExchangeRateError('RATE_UNAVAILABLE', 'La tasa de Bs no está disponible.')
  return state.currentRateMicros
}

export function setManualRate(state: CoruState, value: unknown, now = new Date()): { rateMicros: number; mode: RateMode; updatedAt: string; validUntil: string } {
  const rateMicros = typeof value === 'number' && Number.isInteger(value) && value > 1_000_000 ? value : parseRateToMicros(value)
  if (!rateMicros) throw new ExchangeRateError('RATE_INVALID', 'La tasa debe ser un decimal positivo válido.')
  state.currentRateMicros = rateMicros
  state.rateMode = 'MANUAL'
  state.rateSource = 'PERSISTED'
  state.rateUpdatedAt = now.toISOString()
  state.rateValidUntil = endOfCaracasDay(now).toISOString()
  return { rateMicros, mode: state.rateMode, updatedAt: state.rateUpdatedAt, validUntil: state.rateValidUntil }
}

export function setManualRateMicros(state: CoruState, value: unknown, now = new Date()) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new ExchangeRateError('RATE_INVALID', 'La tasa debe ser un entero positivo en micros.')
  return setManualRate(state, value, now)
}

export function setRateMode(state: CoruState, mode: RateMode): void {
  state.rateMode = mode
}

/**
 * Refreshes the automatic rate. A malformed provider response or network
 * failure never replaces the last valid rate, which keeps customer totals
 * deterministic for already-created intents.
 */
export async function refreshRate(state: CoruState, provider: ExchangeRateProvider, now = new Date()): Promise<{ updated: boolean; rateMicros: number; mode: RateMode; updatedAt: string; validUntil: string }> {
  if (state.rateMode === 'MANUAL') return { updated: false, rateMicros: state.currentRateMicros, mode: state.rateMode, updatedAt: state.rateUpdatedAt, validUntil: state.rateValidUntil }
  try {
    const candidate = parseRateToMicros(await provider.getRate())
    if (!candidate) return { updated: false, rateMicros: state.currentRateMicros, mode: state.rateMode, updatedAt: state.rateUpdatedAt, validUntil: state.rateValidUntil }
    state.currentRateMicros = candidate
    state.rateSource = 'PERSISTED'
    state.rateUpdatedAt = now.toISOString()
    state.rateValidUntil = endOfCaracasDay(now).toISOString()
    return { updated: true, rateMicros: candidate, mode: state.rateMode, updatedAt: state.rateUpdatedAt, validUntil: state.rateValidUntil }
  } catch (error) {
    // Keep the last valid observation for deterministic order totals, but
    // leave a server-side breadcrumb so a blocked provider/cron is visible in
    // Worker logs instead of silently presenting the bootstrap rate forever.
    console.warn('Automatic exchange-rate refresh failed', error instanceof Error ? error.message : 'unknown error')
    return { updated: false, rateMicros: state.currentRateMicros, mode: state.rateMode, updatedAt: state.rateUpdatedAt, validUntil: state.rateValidUntil }
  }
}
