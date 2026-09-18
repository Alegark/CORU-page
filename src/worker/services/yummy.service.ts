import type { YummyQuoteRequest, YummyQuoteResponse } from '../../shared/contracts'
import type { Currency } from '../../shared/types'
import type { CoruBindings } from '../env'

export const YUMMY_FALLBACK_COPY = 'Costo de delivery a confirmar por WhatsApp.' as const

export type YummyProvider = {
  quote(input: YummyQuoteRequest): Promise<Extract<YummyQuoteResponse, { status: 'quoted' }>>
}

function validRequest(input: YummyQuoteRequest): YummyQuoteRequest {
  const addressText = input.addressText.trim()
  if (addressText.length < 5 || addressText.length > 400) throw new Error('La dirección de Yummy no es válida.')
  if ((input.latitude === undefined) !== (input.longitude === undefined)) throw new Error('Las coordenadas de Yummy deben enviarse juntas.')
  if (input.latitude !== undefined && (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90)) throw new Error('La latitud no es válida.')
  if (input.longitude !== undefined && (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180)) throw new Error('La longitud no es válida.')
  return { addressText, ...(input.latitude !== undefined ? { latitude: input.latitude } : {}), ...(input.longitude !== undefined ? { longitude: input.longitude } : {}) }
}

function parseQuote(value: unknown): Extract<YummyQuoteResponse, { status: 'quoted' }> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  const amountMinor = candidate.amountMinor
  const currency = candidate.currency
  if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor) || amountMinor < 0 || (currency !== 'USD' && currency !== 'Bs')) return undefined
  const quotedAt = typeof candidate.quotedAt === 'string' && !Number.isNaN(Date.parse(candidate.quotedAt)) ? candidate.quotedAt : new Date().toISOString()
  const externalId = typeof candidate.externalId === 'string' && candidate.externalId.trim() ? candidate.externalId.trim().slice(0, 120) : undefined
  return { status: 'quoted', amountMinor, currency: currency as Currency, quotedAt, ...(externalId ? { externalId } : {}) }
}

/**
 * Provider boundary. No URL, endpoint shape or credentials are assumed by
 * default; the public flow remains usable with the documented WhatsApp
 * fallback until an approved official contract is configured.
 */
export function createYummyProvider(env: CoruBindings): YummyProvider | undefined {
  if (env.YUMMY_ADAPTER_ENABLED !== 'true' || !env.YUMMY_API_URL || !env.YUMMY_API_TOKEN) return undefined
  return {
    async quote(input) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      try {
        const response = await fetch(env.YUMMY_API_URL!, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${env.YUMMY_API_TOKEN}` },
          body: JSON.stringify({ origin: 'CORU · Maracaibo', destination: validRequest(input) }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Yummy provider responded ${response.status}`)
        const parsed = parseQuote(await response.json())
        if (!parsed) throw new Error('Yummy provider returned an invalid quote.')
        return parsed
      } finally { clearTimeout(timeout) }
    },
  }
}

export async function quoteYummyDelivery(env: CoruBindings, input: YummyQuoteRequest): Promise<YummyQuoteResponse> {
  let request: YummyQuoteRequest
  try { request = validRequest(input) } catch { return { status: 'error', fallbackCopy: YUMMY_FALLBACK_COPY } }
  const provider = createYummyProvider(env)
  if (!provider) return { status: 'unavailable', fallbackCopy: YUMMY_FALLBACK_COPY }
  try { return await provider.quote(request) } catch { return { status: 'error', fallbackCopy: YUMMY_FALLBACK_COPY } }
}
