import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { CoruEnv } from '../env'

type RemoteJwks = ReturnType<typeof createRemoteJWKSet>
const jwksByIssuerUrl = new Map<string, RemoteJwks>()

function jwksForIssuer(issuer: string): RemoteJwks {
  const certsUrl = `${issuer}/cdn-cgi/access/certs`
  const cached = jwksByIssuerUrl.get(certsUrl)
  if (cached) return cached
  const jwks = createRemoteJWKSet(new URL(certsUrl))
  jwksByIssuerUrl.set(certsUrl, jwks)
  return jwks
}

/** Test hook: clears the module-scoped JWKS cache between cases. */
export function resetAccessJwksCacheForTests(): void { jwksByIssuerUrl.clear() }

/** Test hook: returns the cached JWKS function for an issuer, if any. */
export function getCachedAccessJwksForTests(issuer: string): RemoteJwks | undefined {
  return jwksByIssuerUrl.get(`${issuer.replace(/\/$/, '')}/cdn-cgi/access/certs`)
}

export const requireAdmin = createMiddleware<CoruEnv>(async (c, next) => {
  const localBypass = c.env?.DEV_ADMIN_BYPASS === 'true' && c.env?.ENVIRONMENT !== 'production'
  const assertion = c.req.header('Cf-Access-Jwt-Assertion')
  if (!localBypass && !assertion) return c.json({ error: { code: 'ADMIN_AUTH_REQUIRED', message: 'Se requiere una sesión administrativa válida.' } }, 403)
  if (!localBypass) {
    const issuer = c.env?.TEAM_DOMAIN?.replace(/\/$/, '')
    const audience = c.env?.POLICY_AUD
    if (!issuer || !audience || !assertion) return c.json({ error: { code: 'ADMIN_AUTH_REQUIRED', message: 'La protección administrativa no está configurada.' } }, 403)
    try {
      const jwks = jwksForIssuer(issuer)
      await jwtVerify(assertion, jwks, { issuer, audience })
    } catch {
      return c.json({ error: { code: 'ADMIN_AUTH_REQUIRED', message: 'La sesión administrativa no es válida.' } }, 403)
    }
  }
  await next()
})
