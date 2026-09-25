import { describe, expect, it } from 'vitest'
import { applyMigration, createTursoClient, type SqlClient } from '../src/db/client'

describe('libSQL client seam', () => {
  it('encodes pipeline responses as named rows', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const client = createTursoClient('https://db.example.test', 'token', async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body) })
      return new Response(JSON.stringify({ results: [{ type: 'ok', result: { cols: [{ name: 'value' }], rows: [['ok']], affected_row_count: 1 } }, { type: 'ok', response: { type: 'close' } }] }), { status: 200 })
    })
    const result = await client.execute<{ value: string }>('SELECT ?', ['ok'])
    expect(result.rows).toEqual([{ value: 'ok' }])
    expect(calls[0].url).toBe('https://db.example.test/v2/pipeline')
    expect(calls[0].body).toContain('SELECT ?')
  })

  it('unwraps Turso v2 envelopes and typed cell values', async () => {
    const client = createTursoClient('https://db.example.test', 'token', async () => new Response(JSON.stringify({ results: [{ type: 'ok', response: { type: 'execute', result: { cols: [{ name: 'name' }, { name: 'active' }], rows: [[{ type: 'text', value: 'Pruebas' }, { type: 'integer', value: '1' }]], affected_row_count: 0 } } }, { type: 'ok', response: { type: 'close' } }] }), { status: 200 }))
    const result = await client.execute<{ name: string; active: number }>('SELECT name, active FROM categories')
    expect(result.rows).toEqual([{ name: 'Pruebas', active: 1 }])
  })

  it('encodes null bind parameters with the Turso value tag', async () => {
    let body = ''
    const client = createTursoClient('https://db.example.test', 'token', async (_input, init) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ results: [{ type: 'ok', result: { cols: [], rows: [], affected_row_count: 1 } }, { type: 'ok', response: { type: 'close' } }] }), { status: 200 })
    })
    await client.execute('INSERT INTO products (primary_image_id) VALUES (?)', [null])
    expect(body).toContain('"type":"null"')
  })

  it('encodes decimal bind parameters as floats', async () => {
    let body = ''
    const client = createTursoClient('https://db.example.test', 'token', async (_input, init) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ results: [{ type: 'ok', result: { cols: [], rows: [], affected_row_count: 1 } }, { type: 'ok', response: { type: 'close' } }] }), { status: 200 })
    })
    await client.execute('UPDATE products SET inner_diameter_mm = ? WHERE id = ?', [17.3, 'ring-1'])
    const payload = JSON.parse(body) as { requests: Array<{ stmt: { args: Array<{ type: string; value?: string }> } }> }
    expect(payload.requests[0].stmt.args).toEqual([
      { type: 'float', value: 17.3 },
      { type: 'text', value: 'ring-1' },
    ])
  })

  it('wraps migration statements in a transaction', async () => {
    const statements: string[] = []
    const fake: SqlClient = {
      execute: async (sql) => { statements.push(sql); return { rows: [], rowsAffected: 0 } },
      transaction: async (callback) => callback(fake),
    }
    await applyMigration(fake, 'CREATE TABLE one (id INTEGER);\nCREATE TABLE two (id INTEGER);')
    expect(statements).toEqual(['CREATE TABLE one (id INTEGER)', 'CREATE TABLE two (id INTEGER)'])
  })

  it('strips explicit BEGIN/COMMIT/END from migrations', async () => {
    const statements: string[] = []
    const fake: SqlClient = {
      execute: async (sql) => { statements.push(sql); return { rows: [], rowsAffected: 0 } },
      transaction: async (callback) => callback(fake),
    }
    await applyMigration(fake, 'BEGIN;\nCREATE TABLE one (id INTEGER);\nCOMMIT;')
    expect(statements).toEqual(['CREATE TABLE one (id INTEGER)'])
  })

  it('sends transactions as a conditional Hrana batch', async () => {
    let body = ''
    const client = createTursoClient('https://db.example.test', 'token', async (_input, init) => {
      body = String(init?.body)
      return new Response(JSON.stringify({
        results: [{
          type: 'ok',
          response: {
            type: 'batch',
            result: {
              step_results: [{ affected_row_count: 0 }, { affected_row_count: 1 }, { affected_row_count: 1 }, { affected_row_count: 0 }, null],
              step_errors: [null, null, null, null, null],
            },
          },
        }, { type: 'ok', response: { type: 'close' } }],
      }), { status: 200 })
    })
    await client.transaction(async (tx) => {
      await tx.execute('INSERT INTO products (id) VALUES (?)', ['a'])
      await tx.execute('INSERT INTO products (id) VALUES (?)', ['b'])
    })
    const payload = JSON.parse(body) as { requests: Array<{ type: string; batch?: { steps: Array<{ stmt: { sql: string }; condition?: unknown }> } }> }
    expect(payload.requests[0].type).toBe('batch')
    const steps = payload.requests[0].batch!.steps
    expect(steps.map((step) => step.stmt.sql)).toEqual(['BEGIN', 'INSERT INTO products (id) VALUES (?)', 'INSERT INTO products (id) VALUES (?)', 'COMMIT', 'ROLLBACK'])
    expect(steps[1].condition).toEqual({ type: 'ok', step: 0 })
    expect(steps[2].condition).toEqual({ type: 'ok', step: 1 })
    expect(steps[3].condition).toEqual({ type: 'ok', step: 2 })
    expect(steps[4].condition).toEqual({ type: 'not', cond: { type: 'ok', step: 3 } })
    expect(payload.requests[1]).toEqual({ type: 'close' })
  })

  it('throws when a middle batch step errors instead of committing', async () => {
    const client = createTursoClient('https://db.example.test', 'token', async () => new Response(JSON.stringify({
      results: [{
        type: 'ok',
        response: {
          type: 'batch',
          result: {
            step_results: [{ affected_row_count: 0 }, { affected_row_count: 1 }, null, null, { affected_row_count: 0 }],
            step_errors: [null, null, { message: 'UNIQUE constraint failed' }, null, null],
          },
        },
      }, { type: 'ok', response: { type: 'close' } }],
    }), { status: 200 }))
    await expect(client.transaction(async (tx) => {
      await tx.execute('INSERT INTO products (id) VALUES (?)', ['a'])
      await tx.execute('INSERT INTO products (id) VALUES (?)', ['a'])
    })).rejects.toThrow(/UNIQUE constraint failed/)
  })
})
