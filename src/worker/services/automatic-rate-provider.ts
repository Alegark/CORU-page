import { createHttpRateProvider, createRateProviderWithFallback } from './exchange-rate.service'
import { createBinanceP2pProvider } from './exchange-rate/binance-p2p.adapter'

/** The configured relay is primary; Binance P2P remains an independently queried fallback. */
export function createAutomaticRateProvider(relayUrl?: string) {
  const fallback = createBinanceP2pProvider()
  const primary = relayUrl ? createHttpRateProvider(relayUrl) : fallback
  return createRateProviderWithFallback(primary, relayUrl ? fallback : undefined)
}
