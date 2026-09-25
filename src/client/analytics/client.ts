import { sendAnalytics } from '../api/public'
import { shouldDropClientAnalytics } from '../../shared/analytics-bots'
import { getSessionId, getSource, getVisitorId, isInternalBrowser } from '../../shared/storage'
import type { AnalyticsEvent } from '../../shared/types'

type AnalyticsProperty = string | number | boolean

const MAX_BATCH = 20
const MAX_BODY_BYTES = 32_768
const forbidden = new Set(['name', 'phone', 'email', 'address', 'message', 'customertext', 'customer_text', 'coordinates', 'latitude', 'longitude', 'paymentnote', 'payment_note', 'ip', 'token'])

function safeProperties(properties?: Record<string, unknown>): Record<string, AnalyticsProperty> | undefined {
  if (!properties) return undefined
  const entries = Object.entries(properties).filter(([key, value]) => {
    const lowerKey = key.toLowerCase()
    return !forbidden.has(lowerKey) && !/customer|phone|email|address|coordinate|payment|rawip|device.?token/.test(lowerKey) && (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
  })
  if (!entries.length) return undefined
  return Object.fromEntries(entries.slice(0, 20).map(([key, value]) => [key.slice(0, 40), typeof value === 'string' ? value.slice(0, 120) : value])) as Record<string, AnalyticsProperty>
}

class AnalyticsClient {
  private queue: AnalyticsEvent[] = []
  private flushTimer: number | undefined

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { void this.flush() })
  }

  track(name: AnalyticsEvent['name'], properties?: Record<string, unknown>): void {
    if (isInternalBrowser() || shouldDropClientAnalytics()) return
    const cleanedProperties = safeProperties({ ...properties, device: deviceClass(), visitorId: getVisitorId(), sessionModel: 'idle30-v1' })
    this.queue.push({ name, sessionId: getSessionId(), source: getSource(), occurredAt: new Date().toISOString(), ...(cleanedProperties ? { properties: cleanedProperties } : {}) })
    if (this.queue.length >= MAX_BATCH) void this.flush()
    else if (typeof window !== 'undefined' && this.flushTimer === undefined) this.flushTimer = window.setTimeout(() => { this.flushTimer = undefined; void this.flush() }, 1_000)
  }

  async flush(): Promise<void> {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    if (!this.queue.length) return
    const events = this.queue.splice(0, MAX_BATCH)
    await this.sendBatch(events)
  }

  private async sendBatch(events: AnalyticsEvent[]): Promise<void> {
    if (!events.length) return
    const body = JSON.stringify({ events })
    if (body.length > MAX_BODY_BYTES) {
      if (events.length === 1) return
      const mid = Math.ceil(events.length / 2)
      await this.sendBatch(events.slice(0, mid))
      await this.sendBatch(events.slice(mid))
      return
    }
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const sent = navigator.sendBeacon('/api/analytics', new Blob([body], { type: 'application/json' }))
        if (sent) return
      }
      await sendAnalytics(events)
    } catch {
      // Analytics is strictly non-blocking; commerce interactions continue.
    }
  }
}

function deviceClass(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof window === 'undefined') return 'desktop'
  if (window.innerWidth < 768) return 'mobile'
  if (window.innerWidth < 1024) return 'tablet'
  return 'desktop'
}

export const analytics = new AnalyticsClient()
