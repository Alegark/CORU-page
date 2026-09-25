export type AnalyticsTrafficSource = 'instagram' | 'facebook' | 'whatsapp' | 'search' | 'direct' | 'other'

const SEARCH_EXPLICIT = new Set(['google', 'google_business', 'gbp', 'bing', 'search'])

export function normalizeSource(value: unknown): AnalyticsTrafficSource {
  const source = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (source === 'instagram' || source === 'ig') return 'instagram'
  if (source === 'facebook' || source === 'fb') return 'facebook'
  if (source === 'whatsapp' || source === 'wa') return 'whatsapp'
  if (SEARCH_EXPLICIT.has(source)) return 'search'
  if (!source || source === 'direct' || source === 'directo') return 'direct'
  return 'other'
}

function hostnameOf(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase()
  } catch {
    return raw.toLowerCase().split('/')[0]?.replace(/:\d+$/, '') ?? ''
  }
}

function hostMatches(host: string, roots: string[]): boolean {
  return roots.some((root) => host === root || host.endsWith('.' + root))
}

function isInstagramHost(host: string): boolean {
  return hostMatches(host, ['instagram.com'])
}

function isFacebookHost(host: string): boolean {
  return hostMatches(host, ['facebook.com', 'fb.me', 'fb.com'])
}

function isWhatsAppHost(host: string): boolean {
  return hostMatches(host, ['wa.me', 'whatsapp.com'])
}

function isSearchHost(host: string): boolean {
  const h = host.replace(/^www\./, '')
  if (h === 'bing.com' || h.endsWith('.bing.com')) return true
  if (h === 'duckduckgo.com' || h.endsWith('.duckduckgo.com')) return true
  if (h === 'yahoo.com' || h.endsWith('.yahoo.com')) return true
  // google.* any TLD (google.com, google.co.ve) and google property hosts
  if (h === 'google.com' || h.startsWith('google.') || h.endsWith('.google.com')) return true
  return false
}

export type TrafficSourceHints = {
  search?: string
  referrer?: string
  userAgent?: string
  locationHost?: string
}

/** First-touch detection when a session starts (or when no explicit src is present). */
export function detectTrafficSource(hints: TrafficSourceHints = {}): AnalyticsTrafficSource {
  const params = new URLSearchParams(hints.search ?? '')
  const explicit = params.get('src')?.trim().toLowerCase() || params.get('utm_source')?.trim().toLowerCase()
  if (explicit) return normalizeSource(explicit)

  const ua = hints.userAgent ?? ''
  if (/Instagram/i.test(ua)) return 'instagram'
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook'

  const referrerHost = hostnameOf(hints.referrer ?? '')
  if (params.has('igsh') || params.has('igshid')) return 'instagram'
  if (params.has('fbclid')) {
    if (isInstagramHost(referrerHost)) return 'instagram'
    return 'facebook'
  }

  if (!referrerHost) return 'direct'
  if (isInstagramHost(referrerHost)) return 'instagram'
  if (isFacebookHost(referrerHost)) return 'facebook'
  if (isWhatsAppHost(referrerHost)) return 'whatsapp'
  if (isSearchHost(referrerHost)) return 'search'

  const locationHost = (hints.locationHost ?? '').toLowerCase().replace(/^www\./, '')
  const normalizedReferrer = referrerHost.replace(/^www\./, '')
  if (!locationHost || normalizedReferrer === locationHost || normalizedReferrer.endsWith('.' + locationHost)) return 'direct'
  return 'other'
}

export function trafficSourceHintsFromWindow(): TrafficSourceHints {
  if (typeof window === 'undefined') return {}
  return {
    search: window.location.search,
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    locationHost: window.location.hostname,
  }
}
