import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/client/app/App'

describe('cart preservation outside catalog routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
    window.history.pushState({}, '', '/')
  })

  it('keeps saved lines when a page without a catalog (privacy, size guide) is loaded directly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { available: false, rateMicros: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    window.localStorage.setItem('coru_cart_v1', JSON.stringify([{ productId: 'coru-an-001', quantity: 2 }]))
    window.history.pushState({}, '', '/privacidad')
    render(<App />)
    expect(await screen.findByRole('heading', { name: /privacidad sin letra pequeña/i })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(JSON.parse(window.localStorage.getItem('coru_cart_v1') ?? '[]')).toEqual([{ productId: 'coru-an-001', quantity: 2 }])
  })
})
