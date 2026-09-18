import { formatRate, parseRateToMicros, type ExchangeRateProvider } from '../exchange-rate.service'

/** Public Binance P2P search endpoint used only by the Worker. */
export const BINANCE_P2P_SEARCH_URL = 'https://www.binance.com/bapi/c2c/v2/friendly/c2c/adv/search'
const BINANCE_P2P_FALLBACK_URLS = [
  'https://c2c.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
  'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
]

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type BinanceP2pProviderOptions = {
  endpoint?: string
  fetcher?: Fetcher
  asset?: string
  fiat?: string
  rows?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function extractPrices(payload: unknown, asset: string, fiat: string): number[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return []
  return payload.data.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.adv)) return []
    const adv = entry.adv
    if (typeof adv.asset === 'string' && adv.asset.toUpperCase() !== asset.toUpperCase()) return []
    if (typeof adv.fiatUnit === 'string' && adv.fiatUnit.toUpperCase() !== fiat.toUpperCase()) return []
    const micros = parseRateToMicros(adv.price)
    return micros ? [micros] : []
  })
}

/**
 * Reads VES per USDT from Binance's public P2P buy-ad book. The median of the
 * returned valid ads avoids letting one anomalous offer set the customer rate.
 * Provider details stay inside the Worker and never cross the public API.
 */
export function createBinanceP2pProvider(options: BinanceP2pProviderOptions = {}): ExchangeRateProvider {
  const endpoint = options.endpoint ?? BINANCE_P2P_SEARCH_URL
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const asset = options.asset ?? 'USDT'
  const fiat = options.fiat ?? 'VES'
  const rows = Math.max(1, Math.min(20, Math.trunc(options.rows ?? 5)))

  return {
    getRate: async (signal?: AbortSignal) => {
      const endpoints = options.endpoint ? [endpoint] : [endpoint, ...BINANCE_P2P_FALLBACK_URLS]
      let lastError: Error | undefined
      for (const target of endpoints) {
        try {
          const response = await fetcher(target, {
            method: 'POST',
            // Binance's public P2P endpoint is protected by the same edge
            // checks as the browser application. These browser-compatible
            // headers keep Cloudflare Workers from receiving an empty/blocked
            // response while still using the public, unauthenticated API.
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Accept-Language': 'es-VE,es;q=0.9,en-US;q=0.8,en;q=0.7',
              'Content-Type': 'application/json',
              'User-Agent': 'binance-wallet/1.0.0 (Skill)',
              Origin: 'https://www.binance.com',
              Referer: 'https://www.binance.com/en/p2p',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin',
            },
            body: JSON.stringify({
              asset,
              countries: [],
              fiat,
              filterType: 'all',
              page: 1,
              payTypes: [],
              proMerchantAds: false,
              publisherType: null,
              rows,
              shieldMerchantAds: false,
              tradeType: 'BUY',
            }),
            signal,
          })
          if (!response.ok) {
            lastError = new Error(`Binance P2P status ${response.status}`)
            continue
          }
          const payload = await response.json() as unknown
          if (isRecord(payload) && payload.code !== undefined && payload.code !== '000000' && payload.code !== 0) {
            lastError = new Error('Binance P2P respondió con un código inválido.')
            continue
          }
          const prices = extractPrices(payload, asset, fiat).sort((left, right) => left - right)
          if (prices.length === 0) {
            lastError = new Error('Binance P2P no devolvió una tasa válida.')
            continue
          }
          return formatRate(prices[Math.floor(prices.length / 2)]!)
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Binance P2P request failed')
        }
      }
      throw lastError ?? new Error('Binance P2P no devolvió una tasa válida.')
    },
  }
}
