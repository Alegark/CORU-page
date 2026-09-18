import { describe, expect, it } from 'vitest'
import { BINANCE_P2P_SEARCH_URL, createBinanceP2pProvider } from '../src/worker/services/exchange-rate/binance-p2p.adapter'

describe('Binance P2P exchange-rate adapter', () => {
  it('requests VES/USDT buy ads and returns the median valid price', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        code: '000000',
        data: [
          { adv: { asset: 'USDT', fiatUnit: 'VES', price: '955.650' } },
          { adv: { asset: 'USDT', fiatUnit: 'VES', price: '959.000' } },
          { adv: { asset: 'USDT', fiatUnit: 'VES', price: '959.000' } },
          { adv: { asset: 'USDT', fiatUnit: 'VES', price: '959.200' } },
          { adv: { asset: 'USDT', fiatUnit: 'VES', price: '959.300' } },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const provider = createBinanceP2pProvider({ fetcher })
    await expect(provider.getRate()).resolves.toBe('959')

    expect(calls).toHaveLength(1)
    expect(calls[0].input).toBe(BINANCE_P2P_SEARCH_URL)
    expect(calls[0].init?.method).toBe('POST')
    const requestHeaders = calls[0].init?.headers as Record<string, string>
    expect(requestHeaders.Accept).toContain('application/json')
    expect(requestHeaders['Content-Type']).toBe('application/json')
    expect(requestHeaders.Origin).toBe('https://www.binance.com')
    expect(requestHeaders.Referer).toBe('https://www.binance.com/en/p2p')
    expect(requestHeaders['User-Agent']).toBe('binance-wallet/1.0.0 (Skill)')
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      asset: 'USDT',
      fiat: 'VES',
      tradeType: 'BUY',
      rows: 5,
    })
  })

  it('rejects an empty or invalid Binance response', async () => {
    const fetcher = async (): Promise<Response> => new Response(JSON.stringify({ code: '000000', data: [{ adv: { price: 'not-a-rate' } }] }), { status: 200 })
    const provider = createBinanceP2pProvider({ fetcher })

    await expect(provider.getRate()).rejects.toThrow(/tasa/i)
  })
})
