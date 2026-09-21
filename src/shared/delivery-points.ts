import type { PersonalDeliveryPoint } from './types'

/**
 * Publicly agreed initial delivery points for Maracaibo. Coordinates keep the
 * provider-neutral map useful while the accessible address list remains the
 * source of truth for the customer.
 */
export const defaultPersonalDeliveryPoints: PersonalDeliveryPoint[] = [
  {
    id: 'coru-punto-central',
    name: 'C.C. El Gran Ruby',
    address: 'M9QP+73M C.C El Gran Ruby, Maracaibo 4002, Zulia, Venezuela',
    shortDescription: 'Entrega personal · confirma por WhatsApp.',
    latitude: 10.6882025,
    longitude: -71.614846875,
    active: true,
    sortOrder: 1,
  },
  {
    id: 'coru-la-paragua',
    name: 'Centro Comercial La Paragua',
    address: 'M9VG+2W4, Maracaibo 4002, Zulia, Venezuela',
    shortDescription: 'Entrega personal · confirma por WhatsApp.',
    latitude: 10.6925025,
    longitude: -71.622696875,
    active: true,
    sortOrder: 2,
  },
  {
    id: 'coru-la-campana',
    name: 'C.C. La Campana',
    address: 'C.C La Campana, Av. 12, Maracaibo 4002, Zulia, Venezuela',
    shortDescription: 'Entrega personal · confirma por WhatsApp.',
    latitude: 10.6900659,
    longitude: -71.618214,
    active: true,
    sortOrder: 3,
  },
]
