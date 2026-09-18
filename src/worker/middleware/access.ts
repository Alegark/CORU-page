import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { CoruEnv } from '../env'

export const requireAdmin = createMiddleware<CoruEnv>(async (c, next) => {
  const localBypass = c.env?.DEV_ADMIN_BYPASS === 'true' && c.env?.ENVIRONMENT !== 'production'
  const assertion = c.req.header('Cf-Access-Jwt-Assertion')
  if (!localBypass && !assertion) return c.json({ error: { code: 'ADMIN_AUTH_REQUIRED', message: 'Se requiere una sesión administrativa válida.' } }, 403)
  if (!localBypass) {
    const issuer = c.env?.TEAM_DOMAIN?.replace(/\/$/, '')
    const audience = c.env?.POLICY_AUD
    if (!issuer || !audience || !assertion) return c.json({ error: { code: 'ADMIN_AUTH_REQUIRED', message: 'La protección administrativa no está configurada.' } }, 403)
    try {
      const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
      await jwtVerify(assertion, jwks, { issuer, audience })
    } catch {
      return c.json({ error: { code: 'ADMIN_AUTH_REQUIRED', message: 'La sesión administrativa no es válida.' } }, 403)
    }
  }
  await next()
})
