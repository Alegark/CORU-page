export const orderTable = {
  table: 'orders',
  statuses: ['PENDING', 'CONFIRMED', 'DISCARDED', 'CANCELLED'],
  currencies: ['USD', 'Bs'],
  checks: ['subtotal_cents >= 0', 'discount_cents >= 0', 'total_cents >= 0'],
} as const

export const orderItemTable = {
  table: 'order_items',
  checks: ['quantity > 0', 'unit_price_cents >= 0', 'line_total_cents >= 0'],
} as const
