import type { CoruState } from '../state'

const DEVICE_COOKIE = 'coru_device'
const DEVICE_MAX_AGE = 30 * 24 * 60 * 60
const WINDOW_HOUR = 60 * 60 * 1000
const WINDOW_DAY = 24 * WINDOW_HOUR

export type AbuseDecision = { allowed: true; deviceToken: string; setCookie?: string } | { allowed: false; code: 'ORDER_INTENT_RATE_LIMITED' | 'ORDER_INTENT_GUARD_UNAVAILABLE'; retryAfterSeconds?: number; deviceToken: string; setCookie?: string }

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  array.forEach((value) => { binary += String.fromCharCode(value) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4))
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch { return undefined }
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
}

async function digest(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`digest:${value}`)))
}

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

function cookieValue(request: Request): string | undefined {
  const raw = request.headers.get('Cookie') ?? ''
  const match = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${DEVICE_COOKIE}=`))
  return match?.slice(DEVICE_COOKIE.length + 1) || undefined
}

function cookieHeader(value: string): string { return `${DEVICE_COOKIE}=${value}; Max-Age=${DEVICE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax` }

async function signedToken(secret: string): Promise<string> {
  const value = randomToken()
  return `${value}.${await hmac(secret, value)}`
}

async function validToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false
  const [value, signature] = token.split('.')
  if (!value || !signature || !fromBase64Url(value) || !fromBase64Url(signature)) return false
  const expected = await hmac(secret, value)
  return expected === signature
}

export async function ensureDeviceToken(request: Request, secret: string): Promise<{ token: string; setCookie?: string; valid: boolean }> {
  const existing = cookieValue(request)
  if (await validToken(secret, existing)) return { token: existing!, valid: true }
  const token = await signedToken(secret)
  return { token, setCookie: cookieHeader(token), valid: false }
}

function clientIp(request: Request): string {
  // Cloudflare supplies CF-Connecting-IP at the edge. The fallback is only
  // useful for local tests and never leaves the digest boundary.
  return request.headers.get('CF-Connecting-IP')?.trim() || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'local'
}

function assess(state: CoruState, key: string, now: number, windowMs: number, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const current = state.abuseCounters.get(key)
  const entry = !current || now - current.windowStartedAt >= windowMs ? { digest: key, windowStartedAt: now, count: 0 } : current
  if (entry.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStartedAt + windowMs - now) / 1000)) }
  return { allowed: true, retryAfterSeconds: 0 }
}

function commit(state: CoruState, key: string, now: number, windowMs: number): void {
  const current = state.abuseCounters.get(key)
  const entry = !current || now - current.windowStartedAt >= windowMs ? { digest: key, windowStartedAt: now, count: 0 } : current
  entry.count += 1
  state.abuseCounters.set(key, entry)
}

function prune(state: CoruState, now: number): void {
  for (const [key, entry] of state.abuseCounters) if (now - entry.windowStartedAt > WINDOW_DAY) state.abuseCounters.delete(key)
}

/**
 * Server-side order-intent guard. It stores only HMAC digests and reserves all
 * three rolling buckets before order creation. Idempotency replay is resolved by
 * the route before this function is called, so replay does not consume quota.
 */
export async function checkAndReserveOrderIntent(state: CoruState, request: Request, now = new Date(), secret = state.abuseSecret ?? 'coru-local-development-secret'): Promise<AbuseDecision> {
  if (!secret) return { allowed: false, code: 'ORDER_INTENT_GUARD_UNAVAILABLE', deviceToken: '' }
  const device = await ensureDeviceToken(request, secret)
  const ip = clientIp(request)
  const [deviceDigest, ipDigest] = await Promise.all([digest(secret, device.token), digest(secret, ip)])
  const timestamp = now.getTime()
  prune(state, timestamp)
  const hourDeviceKey = `device:${deviceDigest}:hour`
  const dayDeviceKey = `device:${deviceDigest}:day`
  const hourIpKey = `ip:${ipDigest}:hour`
  const hourDevice = assess(state, hourDeviceKey, timestamp, WINDOW_HOUR, 5)
  const dayDevice = assess(state, dayDeviceKey, timestamp, WINDOW_DAY, 15)
  const hourIp = assess(state, hourIpKey, timestamp, WINDOW_HOUR, 10)
  if (!hourDevice.allowed || !dayDevice.allowed || !hourIp.allowed) {
    // Reservation is monotonic for the isolate; a denied request never creates
    // an order and its response advertises the tightest retry horizon.
    return { allowed: false, code: 'ORDER_INTENT_RATE_LIMITED', retryAfterSeconds: Math.max(hourDevice.retryAfterSeconds, dayDevice.retryAfterSeconds, hourIp.retryAfterSeconds), deviceToken: device.token, ...(device.setCookie ? { setCookie: device.setCookie } : {}) }
  }
  commit(state, hourDeviceKey, timestamp, WINDOW_HOUR)
  commit(state, dayDeviceKey, timestamp, WINDOW_DAY)
  commit(state, hourIpKey, timestamp, WINDOW_HOUR)
  return { allowed: true, deviceToken: device.token, ...(device.setCookie ? { setCookie: device.setCookie } : {}) }
}

export function resetOrderAbuse(state: CoruState): void { state.abuseCounters.clear() }
