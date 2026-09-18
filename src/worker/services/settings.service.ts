import type { StoreSettings } from '../../shared/types'
import type { CoruState } from '../state'

export type { StoreSettings } from '../../shared/types'

export class SettingsServiceError extends Error {
  constructor(public readonly code: 'VALIDATION_ERROR', message: string) {
    super(message)
    this.name = 'SettingsServiceError'
  }
}

export const defaultSettings: StoreSettings = {
  whatsappPhone: '584120000000',
  whatsappIntro: 'Hola, quiero pedir estos productos de CORU.',
  storeName: 'CORU',
  instagramUrl: '@coru',
  facebookUrl: 'CORU',
  privacyUrl: '/privacidad',
  storeActive: true,
}

function text(value: unknown, fallback: string, max: number): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new SettingsServiceError('VALIDATION_ERROR', 'Revisa los datos de configuración.')
  return value.trim()
}

function normalizePhone(value: unknown, fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw new SettingsServiceError('VALIDATION_ERROR', 'El número de WhatsApp debe estar en formato E.164.')
  const normalized = value.replace(/[\s()-]/g, '')
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new SettingsServiceError('VALIDATION_ERROR', 'El número de WhatsApp debe estar en formato E.164.')
  return normalized.slice(1)
}

export function getSettings(state: CoruState): StoreSettings {
  return { ...state.settings }
}

export function updateSettings(state: CoruState, input: Partial<StoreSettings>): StoreSettings {
  const current = state.settings
  current.whatsappPhone = normalizePhone(input.whatsappPhone, current.whatsappPhone)
  current.whatsappIntro = text(input.whatsappIntro, current.whatsappIntro, 240)
  current.storeName = text(input.storeName, current.storeName, 80)
  current.instagramUrl = text(input.instagramUrl, current.instagramUrl, 200)
  current.facebookUrl = text(input.facebookUrl, current.facebookUrl, 200)
  current.privacyUrl = text(input.privacyUrl, current.privacyUrl, 200)
  if (input.storeActive !== undefined) current.storeActive = Boolean(input.storeActive)
  return getSettings(state)
}
