import { describe, expect, it } from 'vitest'
import { applyMigration, createTursoClient, type SqlClient } from '../src/db/client'

describe('libSQL client seam', () => {
  it('encodes pipeline responses as named rows', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const client = createTursoClient('https://db.example.test', 'token', async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body) })
      return new Response(JSON.stringify({ results: [{ type: 'ok', result: { cols: [{ name: 'value' }], rows: [['ok']], affected_row_count: 1 } }] }), { status: 200 })
    })
    const result = await client.execute<{ value: string }>('SELECT ?', ['ok'])
    expect(result.rows).toEqual([{ value: 'ok' }])
    expect(calls[0].url).toBe('https://db.example.test/v2/pipeline')
    expect(calls[0].body).toContain('SELECT ?')
  })

  it('unwraps Turso v2 envelopes and typed cell values', async () => {
    const client = createTursoClient('https://db.example.test', 'token', async () => new Response(JSON.stringify({ results: [{ type: 'ok', response: { type: 'execute', result: { cols: [{ name: 'name' }, { name: 'active' }], rows: [[{ type: 'text', value: 'Pruebas' }, { type: 'integer', value: '1' }]], affected_row_count: 0 } } }] }), { status: 200 }))
    const result = await client.execute<{ name: string; active: number }>('SELECT name, active FROM categories')
    expect(result.rows).toEqual([{ name: 'Pruebas', active: 1 }])
  })

  it('encodes null bind parameters with the Turso value tag', async () => {
    let body = ''
    const client = createTursoClient('https://db.example.test', 'token', async (_input, init) => {
      body = String(init?.body)
      return new Response(JSON.stringify({ results: [{ type: 'ok', result: { cols: [], rows: [], affected_row_count: 1 } }] }), { status: 200 })
    })
    await client.execute('INSERT INTO products (primary_image_id) VALUES (?)', [null])
    expect(body).toContain('"type":"null"')
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
})
