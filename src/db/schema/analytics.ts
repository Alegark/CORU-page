import { ANALYTICS_EVENT_NAMES } from '../../shared/analytics-events'

export const analyticsTable = {
  table: 'analytics_events',
  names: ANALYTICS_EVENT_NAMES,
  retentionDays: 180,
} as const
