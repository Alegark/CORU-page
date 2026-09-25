export type InitialRateState = { rateMicros: number | null; rateAvailable: boolean }

/** Demo currency exists only in local Vite preview; production starts unavailable. */
export function initialRateForLocation(location: { hostname: string; port: string }): InitialRateState {
  const localPreview = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && ['', '4173', '4174'].includes(location.port)
  return localPreview ? { rateMicros: 36_420_000, rateAvailable: true } : { rateMicros: null, rateAvailable: false }
}
