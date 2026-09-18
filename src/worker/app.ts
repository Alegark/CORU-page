import { Hono } from 'hono'
import type { CoruEnv } from './env'
import { adminApi } from './routes/admin'
import { publicApi } from './routes/public'
import { ensureStateHydrated } from './persistence'
import { state } from './state'

export const app = new Hono<CoruEnv>()

// Local/demo requests have no bindings and continue immediately. When Turso
// is configured, hydrate the isolate before any public or admin route reads
// state and expose the adapter to routes through Hono's typed context.
app.use('/api/*', async (c, next) => {
  try {
    const database = await ensureStateHydrated(state, c.env ?? {})
    if (database) c.set('database', database)
  } catch {
    return c.json({ error: { code: 'PERSISTENCE_UNAVAILABLE', message: 'La persistencia no está disponible.' } }, 503)
  }
  await next()
})

app.get('/api/health', (c) => c.json({ data: { ok: true } }))
app.route('/', publicApi)
app.route('/', adminApi)

app.notFound(async (c) => {
  if (!c.req.path.startsWith('/api/') && c.env?.ASSETS) return c.env.ASSETS.fetch(c.req.raw)
  return c.json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }, 404)
})

app.onError((_error, c) =>
  c.json({ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' } }, 500),
)
