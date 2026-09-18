export const promotionTable = {
  table: 'promotions',
  kinds: ['BUNDLE', 'FIXED_DISCOUNT'],
  checks: ['bundle_quantity IS NULL OR bundle_quantity > 0', 'bundle_price_cents IS NULL OR bundle_price_cents >= 0', 'fixed_discount_cents IS NULL OR fixed_discount_cents >= 0'],
} as const

export const promotionProductTable = {
  table: 'promotion_products',
  primaryKey: ['promotion_id', 'product_id'],
} as const
