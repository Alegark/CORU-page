import type { AnalyticsEvent } from './types'

const SKEW_MS = 10 * 60 * 1000
const FUTURE_SLACK_MS = 2 * 60 * 1000

/**
 * Clamp client occurredAt values that skew more than 10 minutes from server now,
 * or any future stamp beyond +2 minutes. When clamping a batch, remap relative
 * to the latest event so order is preserved (latest → now, earlier → earlier).
 */
export function clampAnalyticsTimestamps<T extends Pick<AnalyticsEvent, 'occurredAt'>>(events: T[], nowMs = Date.now()): T[] {
  if (!events.length) return events
  const times = events.map((event) => Date.parse(event.occurredAt))
  const needsClamp = times.some((time) => !Number.isFinite(time) || time > nowMs + FUTURE_SLACK_MS || time < nowMs - SKEW_MS)
  if (!needsClamp) return events
  const safeTimes = times.map((time) => Number.isFinite(time) ? time : nowMs)
  const latest = Math.max(...safeTimes)
  const minAllowed = nowMs - SKEW_MS
  return events.map((event, index) => {
    const adjusted = Math.min(nowMs, Math.max(minAllowed, nowMs - (latest - safeTimes[index]!)))
    return { ...event, occurredAt: new Date(adjusted).toISOString() }
  })
}
