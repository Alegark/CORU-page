export type CoruRingSizeReference = {
  usSize: string
  innerDiameterMm: number
  circumferenceMm: number
}

/** The US conversion rows approved for CORU catalogue entry. */
export const CORU_RING_SIZE_REFERENCE: readonly CoruRingSizeReference[] = [
  { usSize: '5', innerDiameterMm: 15.7, circumferenceMm: 49.3 },
  { usSize: '6', innerDiameterMm: 16.5, circumferenceMm: 51.9 },
  { usSize: '7', innerDiameterMm: 17.3, circumferenceMm: 54.4 },
  { usSize: '8', innerDiameterMm: 18.1, circumferenceMm: 57.0 },
  { usSize: '9', innerDiameterMm: 18.9, circumferenceMm: 59.5 },
  { usSize: '10', innerDiameterMm: 19.8, circumferenceMm: 62.1 },
]

function roundMillimeters(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10
}

/** The catalog UI accepts centimeters while stored product measurements stay in millimeters. */
export function centimetersToMillimeters(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('La medida debe ser un número mayor que cero.')
  }
  return roundMillimeters(value * 10)
}

export function millimetersToCentimeters(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('La medida debe ser un número mayor que cero.')
  }
  return Math.round((value / 10 + Number.EPSILON) * 100) / 100
}

export function formatCentimeters(value: number): string {
  return `${millimetersToCentimeters(value).toFixed(2)} cm`
}

/** Customer-facing size shared by cards, cart, order snapshots and WhatsApp; a generic `sizeLabel` yields to the structured US size. */
export function formatProductSizeLabel(product: { sizeLabel?: string; usSize?: string }, fallback = 'Talla no especificada'): string {
  const raw = product.sizeLabel?.trim() ?? ''
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
  const isGenericSize = !raw || /^talla\s+unica(?:\b|$)/.test(normalized)
  if (!isGenericSize) return /^us\b/i.test(raw) ? `Talla ${raw}` : raw
  const usSize = product.usSize?.trim().replace(/^talla\s*/i, '').trim()
  if (usSize) return /^us\b/i.test(usSize) ? `Talla ${usSize}` : `Talla US ${usSize}`
  return fallback
}

const MAX_REFERENCE_DISTANCE_MM = 0.45

export function deriveRingMeasurements(innerDiameterMm: number): { circumferenceMm: number; usSize?: string } {
  if (typeof innerDiameterMm !== 'number' || !Number.isFinite(innerDiameterMm) || innerDiameterMm <= 0) {
    throw new Error('El diámetro interno debe ser un número mayor que cero.')
  }
  const reference = CORU_RING_SIZE_REFERENCE.find((row) => Math.abs(row.innerDiameterMm - innerDiameterMm) < 0.0001)
  if (reference) return { circumferenceMm: reference.circumferenceMm, usSize: reference.usSize }
  const closest = CORU_RING_SIZE_REFERENCE.reduce((candidate, row) => {
    if (!candidate) return row
    return Math.abs(row.innerDiameterMm - innerDiameterMm) < Math.abs(candidate.innerDiameterMm - innerDiameterMm) ? row : candidate
  }, undefined as CoruRingSizeReference | undefined)
  const usSize = closest && Math.abs(closest.innerDiameterMm - innerDiameterMm) <= MAX_REFERENCE_DISTANCE_MM ? closest.usSize : undefined
  return { circumferenceMm: roundMillimeters(Math.PI * innerDiameterMm), ...(usSize ? { usSize } : {}) }
}
