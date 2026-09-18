import type { Promotion, PromotionKind } from '../../shared/types'
import type { CoruState } from '../state'

export class PromotionServiceError extends Error {
  constructor(public readonly code: 'VALIDATION_ERROR' | 'CONFLICT' | 'NOT_FOUND', message: string) {
    super(message)
    this.name = 'PromotionServiceError'
  }
}

function id(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `promotion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function positiveInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new PromotionServiceError('VALIDATION_ERROR', `${label} debe ser un entero positivo.`)
  return value
}

function nonNegativeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new PromotionServiceError('VALIDATION_ERROR', `${label} debe ser un entero no negativo.`)
  return value
}

export type PromotionInput = {
  name: string
  kind: PromotionKind
  targetCategory?: string
  bundleQuantity?: number
  bundlePriceCents?: number
  fixedDiscountCents?: number
  active?: boolean
  startsAt?: string
  endsAt?: string
}

function validate(input: PromotionInput): Omit<Promotion, 'id'> {
  if (typeof input.name !== 'string' || !input.name.trim()) throw new PromotionServiceError('VALIDATION_ERROR', 'El nombre de la promoción es obligatorio.')
  if (input.kind !== 'BUNDLE' && input.kind !== 'FIXED_DISCOUNT') throw new PromotionServiceError('VALIDATION_ERROR', 'El tipo de promoción no es válido.')
  if (input.kind === 'BUNDLE') {
    const bundleQuantity = positiveInt(input.bundleQuantity, 'La cantidad del combo')
    const bundlePriceCents = nonNegativeInt(input.bundlePriceCents, 'El precio del combo')
    const startsAt = input.startsAt?.trim()
    const endsAt = input.endsAt?.trim()
    if (startsAt && Number.isNaN(Date.parse(startsAt))) throw new PromotionServiceError('VALIDATION_ERROR', 'La fecha de inicio no es válida.')
    if (endsAt && Number.isNaN(Date.parse(endsAt))) throw new PromotionServiceError('VALIDATION_ERROR', 'La fecha de fin no es válida.')
    if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) throw new PromotionServiceError('VALIDATION_ERROR', 'La promoción termina antes de comenzar.')
    return { name: input.name.trim().slice(0, 120), kind: input.kind, targetCategory: input.targetCategory?.trim() || 'Anillos', bundleQuantity, bundlePriceCents, active: input.active ?? false, ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}) }
  }
  const fixedDiscountCents = nonNegativeInt(input.fixedDiscountCents, 'El descuento')
  const startsAt = input.startsAt?.trim()
  const endsAt = input.endsAt?.trim()
  if (startsAt && Number.isNaN(Date.parse(startsAt))) throw new PromotionServiceError('VALIDATION_ERROR', 'La fecha de inicio no es válida.')
  if (endsAt && Number.isNaN(Date.parse(endsAt))) throw new PromotionServiceError('VALIDATION_ERROR', 'La fecha de fin no es válida.')
  if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) throw new PromotionServiceError('VALIDATION_ERROR', 'La promoción termina antes de comenzar.')
  return { name: input.name.trim().slice(0, 120), kind: input.kind, ...(input.targetCategory?.trim() ? { targetCategory: input.targetCategory.trim() } : {}), fixedDiscountCents, active: input.active ?? false, ...(input.startsAt?.trim() ? { startsAt: input.startsAt.trim() } : {}), ...(input.endsAt?.trim() ? { endsAt: input.endsAt.trim() } : {}) }
}

function assertNoOverlap(state: CoruState, candidate: Omit<Promotion, 'id'>, ignoreId?: string): void {
  if (!candidate.active) return
  const start = candidate.startsAt ? new Date(candidate.startsAt).getTime() : Number.NEGATIVE_INFINITY
  const end = candidate.endsAt ? new Date(candidate.endsAt).getTime() : Number.POSITIVE_INFINITY
  const overlaps = state.promotions.some((promotion) => {
    if (promotion.id === ignoreId || !promotion.active) return false
    const sameScope = promotion.targetCategory === candidate.targetCategory || !promotion.targetCategory || !candidate.targetCategory
    if (!sameScope) return false
    const otherStart = promotion.startsAt ? new Date(promotion.startsAt).getTime() : Number.NEGATIVE_INFINITY
    const otherEnd = promotion.endsAt ? new Date(promotion.endsAt).getTime() : Number.POSITIVE_INFINITY
    return start <= otherEnd && otherStart <= end
  })
  if (overlaps) throw new PromotionServiceError('CONFLICT', 'Ya existe una promoción activa que se solapa con esta regla.')
}

export function listPromotions(state: CoruState): Promotion[] {
  return state.promotions.map((promotion) => ({ ...promotion }))
}

export function createPromotion(state: CoruState, input: PromotionInput): Promotion {
  const candidate = validate(input)
  if (candidate.targetCategory && !state.categories.some((category) => category.active && category.name === candidate.targetCategory)) throw new PromotionServiceError('VALIDATION_ERROR', 'La categoría objetivo no está activa.')
  assertNoOverlap(state, candidate)
  const promotion = { id: id(), ...candidate }
  state.promotions.push(promotion)
  return promotion
}

export function updatePromotion(state: CoruState, promotionId: string, input: Partial<PromotionInput>): Promotion {
  const current = state.promotions.find((promotion) => promotion.id === promotionId)
  if (!current) throw new PromotionServiceError('NOT_FOUND', 'Promoción no encontrada.')
  const candidate = validate({ ...current, ...input })
  if (candidate.targetCategory && !state.categories.some((category) => category.active && category.name === candidate.targetCategory)) throw new PromotionServiceError('VALIDATION_ERROR', 'La categoría objetivo no está activa.')
  assertNoOverlap(state, candidate, promotionId)
  Object.assign(current, candidate)
  return current
}

export function deactivatePromotion(state: CoruState, promotionId: string): Promotion {
  return updatePromotion(state, promotionId, { active: false })
}
