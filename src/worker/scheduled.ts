import type { CoruBindings } from './env'
import { createHttpRateProvider, refreshRate } from './services/exchange-rate.service'
import { createBinanceP2pProvider } from './services/exchange-rate/binance-p2p.adapter'
import { purgeAnalytics } from './services/analytics.service'
import { state } from './state'
import { ensureStateHydrated, persistRate, purgePersistedAnalytics, persistOrderStatus } from './persistence'
import { expirePendingOrders } from './services/order.service'

type ScheduledEventLike = { scheduledTime?: number }
type ExecutionContextLike = { waitUntil?: (promise: Promise<unknown>) => void }

/**
 * Cloudflare Cron entry point. The URL is an operator-controlled server
 * binding; provider response details never cross the public API boundary.
 */
export async function scheduled(event: ScheduledEventLike, env: CoruBindings, ctx: ExecutionContextLike): Promise<void> {
  const now = event.scheduledTime ? new Date(event.scheduledTime) : new Date()
  let database
  try {
    database = await ensureStateHydrated(state, env)
  } catch {
    return
  }
  const purged = purgeAnalytics(state, now)
  const expired = expirePendingOrders(state, now)
  if (database && expired.length) {
    for (const order of expired) ctx.waitUntil?.(persistOrderStatus(database, order, state).catch(() => undefined))
  }
  if (database && purged > 0) {
    const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString()
    if (ctx.waitUntil) ctx.waitUntil(purgePersistedAnalytics(database, cutoff).catch(() => undefined))
  }
  if (state.rateMode !== 'AUTOMATIC') return
  const provider = env.EXCHANGE_RATE_URL ? createHttpRateProvider(env.EXCHANGE_RATE_URL) : createBinanceP2pProvider()
  const refresh = refreshRate(state, provider, now)
  const result = await refresh
  if (ctx.waitUntil) {
    ctx.waitUntil(Promise.resolve(result).then((value) => value.updated && database ? persistRate(database, state) : undefined).catch(() => undefined))
  }
}
