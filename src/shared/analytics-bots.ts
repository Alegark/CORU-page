/** Shared bot / link-preview UA detection for client and Worker drops. */
export const ANALYTICS_BOT_UA_RE = /bot|crawler|spider|crawling|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp\/|slurp|bingpreview/i

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && userAgent.length > 0 && ANALYTICS_BOT_UA_RE.test(userAgent)
}

export function shouldDropClientAnalytics(): boolean {
  if (typeof navigator === 'undefined') return false
  if (navigator.webdriver === true) return true
  return isBotUserAgent(navigator.userAgent)
}
