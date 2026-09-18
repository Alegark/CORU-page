import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const databaseUrl = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!databaseUrl || !authToken) {
  console.error('Faltan TURSO_DATABASE_URL y TURSO_AUTH_TOKEN.')
  process.exitCode = 1
} else {
  const migrationPath = resolve(process.cwd(), process.argv[2] ?? 'drizzle/0000_coru_v1.sql')
  const source = await readFile(migrationPath, 'utf8')
  const statements = source
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
  const endpoint = `${new URL(databaseUrl.replace(/^libsql:/, 'https:')).toString().replace(/\/$/, '')}/v2/pipeline`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: statements.map((sql) => ({ type: 'execute', stmt: { sql, args: [] } })) }),
  })
  if (!response.ok) {
    console.error(`Turso respondió ${response.status}.`)
    process.exitCode = 1
  } else {
    const payload = await response.json()
    const failed = (payload.results ?? []).find((result) => result.type === 'error' || result.error)
    if (failed) {
      console.error(failed.error?.message ?? 'La migración devolvió un error.')
      process.exitCode = 1
    } else {
      console.log(`Migración aplicada: ${statements.length} sentencias.`)
    }
  }
}
