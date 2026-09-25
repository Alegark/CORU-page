import type { CoruBindings } from './env'
import { refreshRate } from './services/exchange-rate.service'
import { createAutomaticRateProvider } from './services/automatic-rate-provider'
import { purgeAnalytics } from './services/analytics.service'
import { state } from './state'
import { captureOrderExpectation, ensureStateHydrated, hydrateOrdersFromDatabase, persistOrderTransition, persistRate, persistRateRefreshStatus, purgePersistedAnalytics } from './persistence'
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

  const expireWork = (async () => {
    if (database) await hydrateOrdersFromDatabase(state, database)
    const pending = state.orders.filter((order) => order.status === 'PENDING')
    const expectations = new Map(pending.map((order) => [order.id, captureOrderExpectation(order)]))
    const expired = expirePendingOrders(state, now)
    if (!database || !expired.length) return
    for (const order of expired) {
      const expected = expectations.get(order.id) ?? { status: 'PENDING' as const, preorderStage: null, paymentStatus: null }
      try {
        const result = await persistOrderTransition(database, order, expected, [])
        if (!result.applied) await hydrateOrdersFromDatabase(state, database)
      } catch (error) {
        console.error('Scheduled order expiry persistence failed', error)
        await hydrateOrdersFromDatabase(state, database).catch((hydrateError) => {
          console.error('Scheduled order rehydrate after expiry failure failed', hydrateError)
        })
      }
    }
  })()
  if (ctx.waitUntil) ctx.waitUntil(expireWork)
  else await expireWork

  if (database && purged > 0) {
    const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString()
    if (ctx.waitUntil) ctx.waitUntil(purgePersistedAnalytics(database, cutoff).catch((error) => { console.error('Scheduled analytics purge failed', error) }))
  }
  if (state.rateMode !== 'AUTOMATIC') return
  const provider = createAutomaticRateProvider(env.EXCHANGE_RATE_URL)
  const result = await refreshRate(state, provider, now)
  if (database) {
    const persistence = Promise.all([
      ...(result.updated ? [persistRate(database, state)] : []),
      persistRateRefreshStatus(database, state),
    ]).catch((error) => { console.error('Automatic exchange-rate status persistence failed', error) })
    if (ctx.waitUntil) ctx.waitUntil(persistence)
    else await persistence
  }
}
