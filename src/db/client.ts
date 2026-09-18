/** Minimal libSQL/Turso HTTP client. It keeps the Worker free of Node-only
 * drivers while allowing repositories to run against a real database when
 * TURSO_DATABASE_URL/TURSO_AUTH_TOKEN are configured. */

export type SqlValue = string | number | boolean | null | Uint8Array
export type SqlResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[]
  rowsAffected: number
  lastInsertRowid?: string | number
}

export type SqlClient = {
  execute: <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, args?: SqlValue[]) => Promise<SqlResult<Row>>
  transaction: <T>(callback: (tx: SqlClient) => Promise<T>) => Promise<T>
}

export class DatabaseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'DatabaseError'
  }
}

type PipelineExecuteResult = { cols?: Array<{ name: string }>; rows?: unknown[][]; affected_row_count?: number; last_insert_rowid?: string | number }
type PipelineResponse = { results?: Array<{ type?: string; error?: { message?: string }; result?: PipelineExecuteResult; response?: { type?: string; error?: { message?: string }; result?: PipelineExecuteResult } }> }
type PipelineRequest = { sql: string; args: SqlValue[] }

function decodeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('type' in value) || !('value' in value)) return value
  const typed = value as { type?: unknown; value?: unknown }
  if (typed.type === 'null') return null
  if (typed.type === 'integer' || typed.type === 'float') {
    const numeric = typeof typed.value === 'number' ? typed.value : Number(typed.value)
    return Number.isFinite(numeric) ? numeric : typed.value
  }
  return typed.value
}

function encodeArg(value: SqlValue): unknown {
  if (value === null) return { type: 'null' }
  if (value instanceof Uint8Array) {
    let binary = ''
    value.forEach((byte) => { binary += String.fromCharCode(byte) })
    return { type: 'blob', value: btoa(binary) }
  }
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' }
  if (typeof value === 'number') return { type: 'integer', value: String(value) }
  return { type: 'text', value }
}

function toRows<Row extends Record<string, unknown>>(result: { cols?: Array<{ name: string }>; rows?: unknown[][]; affected_row_count?: number; last_insert_rowid?: string | number }): SqlResult<Row> {
  const cols = result.cols ?? []
  const rows = (result.rows ?? []).map((values) => Object.fromEntries(cols.map((column, index) => [column.name, decodeValue(values[index])])) as Row)
  return { rows, rowsAffected: result.affected_row_count ?? 0, ...(result.last_insert_rowid !== undefined ? { lastInsertRowid: result.last_insert_rowid } : {}) }
}

export function createTursoClient(databaseUrl: string, authToken: string, fetchImpl: typeof fetch = fetch): SqlClient {
  if (!databaseUrl || !authToken) throw new DatabaseError('La configuración de Turso está incompleta.')
  const parsed = new URL(databaseUrl.replace(/^libsql:/, 'https:'))
  if (parsed.protocol !== 'https:') throw new DatabaseError('La URL de Turso debe usar HTTPS.')
  const endpoint = `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}/v2/pipeline`
  const runPipeline = async (requests: PipelineRequest[]): Promise<SqlResult[]> => {
    const response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: requests.map(({ sql, args }) => ({ type: 'execute', stmt: { sql, args: args.map(encodeArg) } })) }) })
    if (!response.ok) throw new DatabaseError(`Turso respondió ${response.status}.`)
    const payload = await response.json() as PipelineResponse
    if (!payload.results || payload.results.length !== requests.length) throw new DatabaseError('Turso devolvió una respuesta incompleta.')
    return payload.results.map((result) => {
      const error = result.error ?? result.response?.error
      if (result.type === 'error' || error) throw new DatabaseError(error?.message ?? 'Turso devolvió un error.')
      return toRows(result.response?.result ?? result.result ?? {})
    })
  }
  const execute = async <Row extends Record<string, unknown>>(sql: string, args: SqlValue[] = []): Promise<SqlResult<Row>> => {
    const [result] = await runPipeline([{ sql, args }])
    return result as SqlResult<Row>
  }
  const client: SqlClient = {
    execute,
    transaction: async <T>(callback: (tx: SqlClient) => Promise<T>): Promise<T> => {
      const requests: PipelineRequest[] = []
      const tx: SqlClient = {
        execute: async <Row extends Record<string, unknown>>(sql: string, args: SqlValue[] = []) => {
          requests.push({ sql, args })
          return {} as SqlResult<Row>
        },
        transaction: async <Nested>(nested: (tx: SqlClient) => Promise<Nested>) => nested(tx),
      }
      const value = await callback(tx)
      await runPipeline([{ sql: 'BEGIN', args: [] }, ...requests, { sql: 'COMMIT', args: [] }])
      return value
    },
  }
  return client
}

export async function applyMigration(client: SqlClient, sql: string): Promise<void> {
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean)
  await client.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(statement)
  })
}
