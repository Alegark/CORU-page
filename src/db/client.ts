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
type BatchResult = { step_results?: Array<PipelineExecuteResult | null>; step_errors?: Array<{ message?: string } | null> }
type PipelineResponse = { results?: Array<{ type?: string; error?: { message?: string }; result?: PipelineExecuteResult | BatchResult; response?: { type?: string; error?: { message?: string }; result?: PipelineExecuteResult | BatchResult } }> }
type PipelineRequest = { sql: string; args: SqlValue[] }
type BatchCondition = { type: 'ok'; step: number } | { type: 'not'; cond: BatchCondition }
type BatchStep = { stmt: { sql: string; args: unknown[] }; condition?: BatchCondition }

function decodeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('type' in value)) return value
  const typed = value as { type?: unknown; value?: unknown }
  if (typed.type === 'null') return null
  if (!('value' in typed)) return value
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
  if (typeof value === 'number') return Number.isInteger(value) ? { type: 'integer', value: String(value) } : { type: 'float', value }
  return { type: 'text', value }
}

function toRows<Row extends Record<string, unknown>>(result: { cols?: Array<{ name: string }>; rows?: unknown[][]; affected_row_count?: number; last_insert_rowid?: string | number }): SqlResult<Row> {
  const cols = result.cols ?? []
  const rows = (result.rows ?? []).map((values) => Object.fromEntries(cols.map((column, index) => [column.name, decodeValue(values[index])])) as Row)
  return { rows, rowsAffected: result.affected_row_count ?? 0, ...(result.last_insert_rowid !== undefined ? { lastInsertRowid: result.last_insert_rowid } : {}) }
}

function isTxnControl(sql: string): boolean {
  return /^(BEGIN|COMMIT|END)\b/i.test(sql.trim())
}

export function createTursoClient(databaseUrl: string, authToken: string, fetchImpl: typeof fetch = fetch): SqlClient {
  if (!databaseUrl || !authToken) throw new DatabaseError('La configuración de Turso está incompleta.')
  const parsed = new URL(databaseUrl.replace(/^libsql:/, 'https:'))
  if (parsed.protocol !== 'https:') throw new DatabaseError('La URL de Turso debe usar HTTPS.')
  const endpoint = `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}/v2/pipeline`
  const postPipeline = async (requests: unknown[]): Promise<PipelineResponse> => {
    // Hrana over HTTP is a stateful stream even when a request is short-lived.
    // Opening it explicitly and closing it in the same pipeline is required by
    // Turso for write requests (read-only requests happened to be tolerated
    // without these protocol envelopes).
    const response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ baton: null, requests: [...requests, { type: 'close' }] }) })
    if (!response.ok) throw new DatabaseError(`Turso respondió ${response.status}.`)
    const payload = await response.json() as PipelineResponse
    if (!payload.results || payload.results.length !== requests.length + 1) throw new DatabaseError('Turso devolvió una respuesta incompleta.')
    const closeResult = payload.results[payload.results.length - 1]
    if (closeResult?.type === 'error' || closeResult?.error) throw new DatabaseError(closeResult.error?.message ?? 'Turso no pudo cerrar la sesión de base de datos.')
    return payload
  }
  const runPipeline = async (requests: PipelineRequest[]): Promise<SqlResult[]> => {
    const wireRequests = requests.map(({ sql, args }) => ({ type: 'execute', stmt: { sql, args: args.map(encodeArg) } }))
    const payload = await postPipeline(wireRequests)
    return payload.results!.slice(0, requests.length).map((result) => {
      const error = result.error ?? result.response?.error
      if (result.type === 'error' || error) throw new DatabaseError(error?.message ?? 'Turso devolvió un error.')
      return toRows((result.response?.result ?? result.result ?? {}) as PipelineExecuteResult)
    })
  }
  const runBatch = async (steps: BatchStep[]): Promise<void> => {
    const payload = await postPipeline([{ type: 'batch', batch: { steps } }])
    const batchEnvelope = payload.results![0]
    const envelopeError = batchEnvelope.error ?? batchEnvelope.response?.error
    if (batchEnvelope.type === 'error' || envelopeError) throw new DatabaseError(envelopeError?.message ?? 'Turso devolvió un error en el lote.')
    const batch = (batchEnvelope.response?.result ?? batchEnvelope.result ?? {}) as BatchResult
    const stepErrors = batch.step_errors ?? []
    const firstError = stepErrors.find((entry) => entry && entry.message)
    if (firstError) throw new DatabaseError(firstError.message ?? 'Turso devolvió un error en el lote.')
    const commitIndex = steps.length - 2
    const commitResult = (batch.step_results ?? [])[commitIndex]
    const commitError = stepErrors[commitIndex]
    if (!commitResult || commitError) throw new DatabaseError(commitError?.message ?? 'La transacción no se confirmó.')
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
      // Conditional Hrana batch: a failing step skips later OK-conditioned
      // steps, COMMIT only runs if statements succeeded, and ROLLBACK closes
      // an open transaction when COMMIT did not.
      const steps: BatchStep[] = [{ stmt: { sql: 'BEGIN', args: [] } }]
      requests.forEach((request, index) => {
        steps.push({ stmt: { sql: request.sql, args: request.args.map(encodeArg) }, condition: { type: 'ok', step: index } })
      })
      const commitIndex = steps.length
      steps.push({ stmt: { sql: 'COMMIT', args: [] }, condition: { type: 'ok', step: commitIndex - 1 } })
      steps.push({ stmt: { sql: 'ROLLBACK', args: [] }, condition: { type: 'not', cond: { type: 'ok', step: commitIndex } } })
      await runBatch(steps)
      return value
    },
  }
  return client
}

export async function applyMigration(client: SqlClient, sql: string): Promise<void> {
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter((statement) => statement && !isTxnControl(statement))
  await client.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(statement)
  })
}
