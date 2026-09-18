import { describe, expect, it } from 'vitest'
import { app } from '../src/worker/app'

describe('health contract', () => {
  it('returns the stable success envelope', async () => {
    const response = await app.request('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ok: true } })
  })
})
