import type { ApiError, ApiSuccess } from '../../shared/contracts'

export class ApiClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly details?: unknown) {
    super(message)
    this.name = 'ApiClientError'
  }
}

export type PublicRateResponse = { available: boolean; rateMicros: number | null; mode: 'AUTOMATIC' | 'MANUAL'; updatedAt: string | null }

export async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(input, { ...init, cache: init?.cache ?? 'no-store', headers: { Accept: 'application/json', ...(init?.headers ?? {}) } }) } catch { throw new ApiClientError('NETWORK_ERROR', 'No pudimos conectar con la tienda.', 0) }
  const payload = await response.json().catch(() => null) as ApiSuccess<T> | ApiError | null
  if (!response.ok || !payload || !('data' in payload)) {
    const error = payload && 'error' in payload ? payload.error : undefined
    throw new ApiClientError(error?.code ?? 'HTTP_ERROR', error?.message ?? 'La solicitud no pudo completarse.', response.status, error?.details)
  }
  return payload.data
}
