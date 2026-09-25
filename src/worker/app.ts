import { Hono } from 'hono'
import type { CoruEnv } from './env'
import { adminApi } from './routes/admin'
import { publicApi } from './routes/public'
import { seoRoutes } from './routes/seo'
import { ensureStateHydrated, purgePersistedAnalyticsBefore } from './persistence'
import { state } from './state'

export const app = new Hono<CoruEnv>()
const appliedAnalyticsPurges = new WeakMap<object, string>()

const SECURITY_HEADERS: Array<[string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['X-Frame-Options', 'DENY'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'],
]

function validAnalyticsPurgeCutoff(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const normalized = value.trim()
  return Number.isFinite(Date.parse(normalized)) ? normalized : undefined
}

// Baseline browser hardening for every Worker response. Existing route values
// (e.g. media nosniff) are left untouched.
app.use('*', async (c, next) => {
  await next()
  if (!c.res) return
  for (const [name, value] of SECURITY_HEADERS) if (!c.res.headers.has(name)) c.res.headers.set(name, value)
  if (c.env?.ENVIRONMENT === 'production' && !c.res.headers.has('Strict-Transport-Security')) {
    c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
})

// Local/demo requests have no bindings and continue immediately. When Turso
// is configured, hydrate the isolate before any public or admin route reads
// state and expose the adapter to routes through Hono's typed context.
app.use('/api/*', async (c, next) => {
  try {
    const database = await ensureStateHydrated(state, c.env ?? {})
    if (database) {
      c.set('database', database)
      const cutoff = validAnalyticsPurgeCutoff(c.env?.ANALYTICS_PURGE_BEFORE)
      if (cutoff && appliedAnalyticsPurges.get(database) !== cutoff) {
        await purgePersistedAnalyticsBefore(database, cutoff)
        const cutoffMs = Date.parse(cutoff)
        state.analytics = state.analytics.filter((event) => Date.parse(event.occurredAt) >= cutoffMs)
        appliedAnalyticsPurges.set(database, cutoff)
      }
    }
  } catch (error) {
    console.error('CORU persistence bootstrap failed', error)
    return c.json({ error: { code: 'PERSISTENCE_UNAVAILABLE', message: 'La persistencia no está disponible.' } }, 503)
  }
  await next()
})

// Versioned public media is resolved directly from the hydrated image map so
// an edge cache hit never needs a catalog/database read. The first miss still
// initializes the isolate once, just like the API boundary above.
app.use('/media/*', async (c, next) => {
  try {
    await ensureStateHydrated(state, c.env ?? {})
  } catch (error) {
    console.error('CORU media persistence bootstrap failed', error)
    return c.json({ error: { code: 'PERSISTENCE_UNAVAILABLE', message: 'La persistencia no está disponible.' } }, 503)
  }
  await next()
})

app.get('/api/health', (c) => c.json({ data: { ok: true } }))
app.route('/', publicApi)
app.route('/', adminApi)
app.route('/', seoRoutes)

app.notFound(async (c) => {
  if (!c.req.path.startsWith('/api/') && c.env?.ASSETS) {
    // ASSETS.fetch may return an immutable Response; clone into a mutable one
    // so the security-header middleware can set missing headers.
    const asset = await c.env.ASSETS.fetch(c.req.raw)
    return new Response(asset.body, asset)
  }
  return c.json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }, 404)
})

app.onError((_error, c) =>
  c.json({ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' } }, 500),
)
