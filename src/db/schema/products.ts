export const productTable = {
  table: 'products',
  requiredColumns: ['id', 'category_id', 'sku', 'slug', 'name', 'description', 'material', 'artwork', 'size_label', 'price_cents', 'stock_quantity', 'fulfillment_type', 'measurements_text', 'inner_diameter_mm', 'circumference_mm', 'lead_time', 'is_active', 'promo_eligible', 'primary_image_id', 'created_at', 'updated_at'],
  checks: ['price_cents >= 0', 'stock_quantity >= 0', 'is_active IN (0, 1)', 'promo_eligible IN (0, 1)'],
} as const

export const productImageTable = {
  table: 'product_images',
  requiredColumns: ['sort_order'],
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: 15 * 1024 * 1024,
} as const
