import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function nodeSupportsSqlite(): boolean {
  const match = process.versions.node.match(/^(\d+)\.(\d+)/)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 22 || (major === 22 && minor >= 5)
}

function stripTxnControl(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement && !/^(BEGIN|COMMIT|END)\b/i.test(statement))
}

function loadDatabaseSync(): (new (path: string) => {
  exec(sql: string): void
  prepare(sql: string): { run: (...args: unknown[]) => void; all: (...args: unknown[]) => unknown[] }
  close(): void
}) | null {
  try {
    const require = createRequire(import.meta.url)
    const mod = require('node:sqlite') as { DatabaseSync?: new (path: string) => {
      exec(sql: string): void
      prepare(sql: string): { run: (...args: unknown[]) => void; all: (...args: unknown[]) => unknown[] }
      close(): void
    } }
    return mod.DatabaseSync ?? null
  } catch {
    return null
  }
}

const DatabaseSync = nodeSupportsSqlite() ? loadDatabaseSync() : null

describe('drizzle migrations', () => {
  it.skipIf(!DatabaseSync)('applies 0000..0006 in order and preserves analytics through the privacy_view expansion', () => {
    // When skipped: node:sqlite DatabaseSync is unavailable in this Vitest runtime.
    const db = new DatabaseSync!(':memory:')
    const drizzleDir = resolve(process.cwd(), 'drizzle')
    const files = readdirSync(drizzleDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
    expect(files[0]).toBe('0000_coru_v1.sql')
    expect(files.at(-1)).toBe('0006_coru_analytics_public_views.sql')

    for (const file of files) {
      if (file === '0006_coru_analytics_public_views.sql') {
        db.prepare(`INSERT INTO analytics_events (id, name, session_id, source, properties_json, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          'evt-1', 'catalog_view', 'sess-1', 'direct', null, '2026-09-22T10:00:00.000Z', '2026-09-22T10:00:00.000Z',
        )
        db.prepare(`INSERT INTO analytics_events (id, name, session_id, source, properties_json, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          'evt-2', 'product_view', 'sess-2', 'direct', null, '2026-09-22T10:01:00.000Z', '2026-09-22T10:01:00.000Z',
        )
      }
      for (const statement of stripTxnControl(readFileSync(resolve(drizzleDir, file), 'utf8'))) db.exec(statement)
    }

    const rows = db.prepare('SELECT id, name FROM analytics_events ORDER BY occurred_at ASC').all() as Array<{ id: string; name: string }>
    expect(rows).toEqual([
      { id: 'evt-1', name: 'catalog_view' },
      { id: 'evt-2', name: 'product_view' },
    ])

    db.prepare(`INSERT INTO analytics_events (id, name, session_id, source, properties_json, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'evt-3', 'privacy_view', 'sess-3', 'direct', null, '2026-09-22T10:02:00.000Z', '2026-09-22T10:02:00.000Z',
    )
    const privacy = db.prepare(`SELECT name FROM analytics_events WHERE name = 'privacy_view'`).all() as Array<{ name: string }>
    expect(privacy).toEqual([{ name: 'privacy_view' }])
    db.close()
  })
})
