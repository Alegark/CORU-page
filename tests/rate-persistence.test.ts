import { describe, expect, it } from 'vitest'
import type { SqlClient, SqlValue } from '../src/db/client'
import { hydrateRateRefreshStatus, persistRateRefreshStatus } from '../src/worker/persistence'
import { resetState, state } from '../src/worker/state'

describe('exchange-rate refresh status persistence', () => {
  it('restores the last automatic-provider error for the admin panel', async () => {
    let storedValue: string | null = null
    let database: SqlClient
    database = {
      execute: async <Row extends Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
        if (sql.startsWith('SELECT value_json')) return { rows: (storedValue ? [{ value_json: storedValue }] : []) as unknown as Row[], rowsAffected: 0 }
        if (sql.startsWith('INSERT INTO store_settings')) { storedValue = String(args[1]); return { rows: [] as Row[], rowsAffected: 1 } }
        throw new Error(`Unexpected SQL: ${sql}`)
      },
      transaction: async <T>(callback: (tx: SqlClient) => Promise<T>) => callback(database),
    }

    resetState()
    state.rateRefreshAttemptedAt = '2026-09-22T19:05:00.000Z'
    state.rateRefreshError = 'Falló el proveedor configurado (HTTP 502) y también Binance P2P (HTTP 403).'
    await persistRateRefreshStatus(database, state)
    state.rateRefreshAttemptedAt = null
    state.rateRefreshError = null

    await hydrateRateRefreshStatus(state, database)

    expect(state.rateRefreshAttemptedAt).toBe('2026-09-22T19:05:00.000Z')
    expect(state.rateRefreshError).toContain('HTTP 502')
    expect(state.rateRefreshError).toContain('HTTP 403')
  })
})
