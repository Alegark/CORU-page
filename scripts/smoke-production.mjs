const baseUrl = (process.env.CORU_SMOKE_URL ?? 'https://coru.systems').replace(/\/$/, '')

const checks = [
  { path: '/api/health', expected: [200], label: 'health' },
  { path: '/api/catalog', expected: [200], label: 'catalog' },
  { path: '/api/admin/products', expected: [302, 401, 403], label: 'admin guard' },
]

let failed = false

for (const check of checks) {
  try {
    const response = await fetch(`${baseUrl}${check.path}`, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    const body = await response.json().catch(() => null)
    const statusOk = check.expected.includes(response.status)
    const bodyOk = check.path === '/api/health' ? body?.data?.ok === true : check.path === '/api/catalog' ? Array.isArray(body?.data) : statusOk
    console.log(`${check.label}: ${response.status}${statusOk && bodyOk ? ' PASS' : ' FAIL'}`)
    if (!statusOk || !bodyOk) failed = true
  } catch (error) {
    failed = true
    console.log(`${check.label}: FAIL (${error instanceof Error ? error.message : 'request failed'})`)
  }
}

if (failed) {
  console.error(`Smoke production failed for ${baseUrl}`)
  process.exitCode = 1
} else {
  console.log(`Smoke production passed for ${baseUrl}`)
}
