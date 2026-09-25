import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANALYTICS_EVENT_NAMES } from '../src/shared/analytics-events'

describe('analytics event name single source of truth', () => {
  it('keeps the migration CHECK constraint aligned with ANALYTICS_EVENT_NAMES', () => {
    const sql = readFileSync(resolve(process.cwd(), 'drizzle/0006_coru_analytics_public_views.sql'), 'utf8')
    const match = sql.match(/CHECK\s*\(\s*name\s+IN\s*\(([^)]+)\)\s*\)/i)
    expect(match).toBeTruthy()
    const fromSql = match![1].split(',').map((part) => part.trim().replace(/^'|'$/g, ''))
    expect(fromSql).toEqual([...ANALYTICS_EVENT_NAMES])
  })
})
