import type { PersonalDeliveryPoint } from '../../shared/types'
import type { CoruState } from '../state'

export type DeliveryPointInput = {
  name: string
  address: string
  shortDescription?: string
  latitude?: number
  longitude?: number
  scheduleText?: string
  active?: boolean
  sortOrder?: number
}

export type DeliveryPointErrorCode = 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT'

export class DeliveryPointServiceError extends Error {
  constructor(public readonly code: DeliveryPointErrorCode, message: string) {
    super(message)
    this.name = 'DeliveryPointServiceError'
  }
}

function id(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function text(value: unknown, label: string, max: number, required = true): string | undefined {
  if (typeof value !== 'string') {
    if (required) throw new DeliveryPointServiceError('VALIDATION_ERROR', `${label} es obligatorio.`)
    return undefined
  }
  const result = value.trim()
  if (required && !result) throw new DeliveryPointServiceError('VALIDATION_ERROR', `${label} es obligatorio.`)
  if (result.length > max) throw new DeliveryPointServiceError('VALIDATION_ERROR', `${label} es demasiado largo.`)
  return result || undefined
}

function coordinate(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new DeliveryPointServiceError('VALIDATION_ERROR', `${label} no es válida.`)
  const limit = label.toLocaleLowerCase().includes('latitud') ? 90 : 180
  if (value < -limit || value > limit) throw new DeliveryPointServiceError('VALIDATION_ERROR', `${label} no es válida.`)
  return value
}

function sortOrder(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000) throw new DeliveryPointServiceError('VALIDATION_ERROR', 'El orden debe ser un entero no negativo.')
  return value
}

function normalized(input: DeliveryPointInput, current?: PersonalDeliveryPoint): PersonalDeliveryPoint {
  const name = text(input.name, 'El nombre', 100)!
  const address = text(input.address, 'La dirección', 240)!
  const shortDescription = text(input.shortDescription, 'La descripción corta', 180, false)
  const scheduleText = text(input.scheduleText, 'El horario', 160, false)
  const latitude = coordinate(input.latitude, 'La latitud')
  const longitude = coordinate(input.longitude, 'La longitud')
  if ((latitude === undefined) !== (longitude === undefined)) throw new DeliveryPointServiceError('VALIDATION_ERROR', 'La latitud y la longitud deben enviarse juntas.')
  return {
    id: current?.id ?? id('point'), name, address,
    ...(shortDescription ? { shortDescription } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(scheduleText ? { scheduleText } : {}),
    active: input.active ?? current?.active ?? true,
    sortOrder: input.sortOrder === undefined ? current?.sortOrder ?? 0 : sortOrder(input.sortOrder),
  }
}

export function listDeliveryPoints(state: CoruState, includeInactive = true): PersonalDeliveryPoint[] {
  return state.deliveryPoints.filter((point) => includeInactive || point.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map((point) => ({ ...point }))
}

export function createDeliveryPoint(state: CoruState, input: DeliveryPointInput): PersonalDeliveryPoint {
  const point = normalized(input)
  if (state.deliveryPoints.some((candidate) => candidate.name.toLocaleLowerCase() === point.name.toLocaleLowerCase())) throw new DeliveryPointServiceError('CONFLICT', 'Ya existe un punto con ese nombre.')
  state.deliveryPoints.push(point)
  return point
}

export function updateDeliveryPoint(state: CoruState, pointId: string, input: Partial<DeliveryPointInput>): PersonalDeliveryPoint {
  const current = state.deliveryPoints.find((point) => point.id === pointId)
  if (!current) throw new DeliveryPointServiceError('NOT_FOUND', 'Punto de entrega no encontrado.')
  const point = normalized({ ...current, ...input, name: input.name ?? current.name, address: input.address ?? current.address }, current)
  if (state.deliveryPoints.some((candidate) => candidate.id !== pointId && candidate.name.toLocaleLowerCase() === point.name.toLocaleLowerCase())) throw new DeliveryPointServiceError('CONFLICT', 'Ya existe un punto con ese nombre.')
  Object.assign(current, point)
  return { ...current }
}

/** DELETE archives the point so historical order snapshots remain meaningful. */
export function archiveDeliveryPoint(state: CoruState, pointId: string): PersonalDeliveryPoint {
  return updateDeliveryPoint(state, pointId, { active: false })
}

export function reorderDeliveryPoints(state: CoruState, ids: string[]): PersonalDeliveryPoint[] {
  const known = new Set(state.deliveryPoints.map((point) => point.id))
  if (ids.length !== known.size || ids.some((idValue) => !known.has(idValue)) || new Set(ids).size !== ids.length) throw new DeliveryPointServiceError('VALIDATION_ERROR', 'La lista de puntos no coincide con la configuración actual.')
  ids.forEach((idValue, index) => { const point = state.deliveryPoints.find((candidate) => candidate.id === idValue); if (point) point.sortOrder = index + 1 })
  return listDeliveryPoints(state)
}
