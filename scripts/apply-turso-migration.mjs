import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const databaseUrl = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

function isTxnControl(sql) {
  return /^(BEGIN|COMMIT|END)\b/i.test(sql.trim())
}

function parseAlterAddColumn(sql) {
  const match = sql.match(/^ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+ADD\s+COLUMN\s+["`]?(\w+)["`]?/i)
  if (!match) return null
  return { table: match[1], column: match[2] }
}

async function pipeline(endpoint, token, requests) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ baton: null, requests: [...requests, { type: 'close' }] }),
  })
  if (!response.ok) throw new Error(`Turso respondió ${response.status}.`)
  const payload = await response.json()
  if (!payload.results || payload.results.length !== requests.length + 1) throw new Error('Turso devolvió una respuesta incompleta.')
  const closeResult = payload.results[payload.results.length - 1]
  if (closeResult?.type === 'error' || closeResult?.error) throw new Error(closeResult.error?.message ?? 'Turso no pudo cerrar la sesión de base de datos.')
  return payload
}

async function tableColumns(endpoint, token, table) {
  const payload = await pipeline(endpoint, token, [{ type: 'execute', stmt: { sql: `PRAGMA table_info(${table})`, args: [] } }])
  const result = payload.results[0]
  const error = result.error ?? result.response?.error
  if (result.type === 'error' || error) throw new Error(error?.message ?? `No se pudo leer PRAGMA table_info(${table}).`)
  const executeResult = result.response?.result ?? result.result ?? {}
  const cols = executeResult.cols ?? []
  const nameIndex = cols.findIndex((column) => column.name === 'name')
  if (nameIndex < 0) return new Set()
  return new Set((executeResult.rows ?? []).map((row) => {
    const cell = row[nameIndex]
    if (cell && typeof cell === 'object' && 'value' in cell) return String(cell.value)
    return String(cell)
  }))
}

if (!databaseUrl || !authToken) {
  console.error('Faltan TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.')
  process.exitCode = 1
} else {
  console.warn('Antes de migraciones destructivas, asegúrate de tener un dump/backup reciente de la base Turso.')
  const migrationPath = resolve(process.cwd(), process.argv[2] ?? 'drizzle/0000_coru_v1.sql')
  const source = await readFile(migrationPath, 'utf8')
  const rawStatements = source
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement && !isTxnControl(statement))

  const endpoint = `${new URL(databaseUrl.replace(/^libsql:/, 'https:')).toString().replace(/\/$/, '')}/v2/pipeline`
  const statements = []
  for (const statement of rawStatements) {
    const alter = parseAlterAddColumn(statement)
    if (alter) {
      const columns = await tableColumns(endpoint, authToken, alter.table)
      if (columns.has(alter.column)) {
        console.log(`Omitiendo columna existente ${alter.table}.${alter.column}.`)
        continue
      }
    }
    statements.push(statement)
  }

  if (!statements.length) {
    console.log('Migración ya aplicada: no quedaron sentencias pendientes.')
  } else {
    try {
      const steps = [{ stmt: { sql: 'BEGIN', args: [] } }]
      statements.forEach((sql, index) => {
        steps.push({ stmt: { sql, args: [] }, condition: { type: 'ok', step: index } })
      })
      const commitIndex = steps.length
      steps.push({ stmt: { sql: 'COMMIT', args: [] }, condition: { type: 'ok', step: commitIndex - 1 } })
      steps.push({ stmt: { sql: 'ROLLBACK', args: [] }, condition: { type: 'not', cond: { type: 'ok', step: commitIndex } } })

      const payload = await pipeline(endpoint, authToken, [{ type: 'batch', batch: { steps } }])
      const batchEnvelope = payload.results[0]
      const envelopeError = batchEnvelope.error ?? batchEnvelope.response?.error
      if (batchEnvelope.type === 'error' || envelopeError) throw new Error(envelopeError?.message ?? 'Turso devolvió un error en el lote.')
      const batch = batchEnvelope.response?.result ?? batchEnvelope.result ?? {}
      const stepErrors = batch.step_errors ?? []
      for (let index = 0; index < stepErrors.length; index += 1) {
        const entry = stepErrors[index]
        if (!entry) continue
        const statementIndex = index - 1
        const label = statementIndex >= 0 && statementIndex < statements.length
          ? `sentencia ${statementIndex} (${statements[statementIndex].slice(0, 80)}${statements[statementIndex].length > 80 ? '…' : ''})`
          : `paso ${index}`
        console.error(`Migración falló en ${label}: ${entry.message ?? 'error desconocido'}`)
        process.exitCode = 1
        break
      }
      if (process.exitCode !== 1) {
        const commitResult = (batch.step_results ?? [])[commitIndex]
        const commitError = stepErrors[commitIndex]
        if (!commitResult || commitError) {
          console.error(`Migración falló: COMMIT no se aplicó (${commitError?.message ?? 'sin resultado'}).`)
          process.exitCode = 1
        } else {
          console.log(`Migración aplicada: ${statements.length} sentencias.`)
        }
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
