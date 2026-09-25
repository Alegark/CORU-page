import type { Product } from '../../shared/types'
import type { SqlClient } from '../client'

type ProductRow = Record<string, unknown> & {
  id: string; slug: string; name: string; category_name: string; size_label: string; price_cents: number; stock_quantity: number; is_active: number; promo_eligible: number; image_approved: number; artwork: string; description: string; material: string
}

function toProduct(row: ProductRow): Product {
  const category = row.category_name
  const artwork = ['orbita', 'star', 'cross', 'skull', 'pearl', 'chain'].includes(row.artwork) ? row.artwork as Product['artwork'] : 'orbita'
  const fulfillmentType = row.fulfillment_type === 'PREORDER' ? 'PREORDER' as const : 'STOCK' as const
  return { id: row.id, slug: row.slug, name: row.name, category, sizeLabel: row.size_label, priceCents: Number(row.price_cents), stockQuantity: Number(row.stock_quantity), active: Number(row.is_active) === 1, promoEligible: Number(row.promo_eligible) === 1, primaryImageApproved: Number(row.image_approved) === 1, artwork, description: row.description, material: row.material, fulfillmentType, ...(typeof row.measurements_text === 'string' && row.measurements_text ? { measurementsText: row.measurements_text } : {}), ...(typeof row.inner_diameter_mm === 'number' ? { innerDiameterMm: row.inner_diameter_mm } : {}), ...(typeof row.circumference_mm === 'number' ? { circumferenceMm: row.circumference_mm } : {}), ...(typeof row.us_size === 'string' && row.us_size ? { usSize: row.us_size } : {}), ...(typeof row.lead_time === 'string' && row.lead_time ? { leadTime: row.lead_time } : {}) }
}

const select = `SELECT p.id, p.slug, p.name, c.name AS category_name, p.size_label, p.price_cents, p.stock_quantity, p.is_active, p.promo_eligible, p.fulfillment_type, p.measurements_text, p.inner_diameter_mm, p.circumference_mm, p.us_size, p.lead_time, CASE WHEN pi.is_approved = 1 THEN 1 ELSE 0 END AS image_approved, p.artwork, p.description, p.material FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN product_images pi ON pi.id = p.primary_image_id`

export class CatalogRepository {
  constructor(private readonly db: SqlClient) {}

  async listPublic(): Promise<Product[]> {
    const result = await this.db.execute<ProductRow>(`${select} WHERE p.is_active = 1 AND (p.fulfillment_type = 'PREORDER' OR p.stock_quantity > 0) AND c.is_active = 1 AND p.primary_image_id IS NOT NULL AND pi.is_approved = 1 ORDER BY p.created_at DESC`)
    return result.rows.map(toProduct)
  }

  async listAll(): Promise<Product[]> {
    const result = await this.db.execute<ProductRow>(`${select} ORDER BY p.created_at DESC`)
    return result.rows.map(toProduct)
  }

  async findBySlug(slug: string): Promise<Product | undefined> {
    const result = await this.db.execute<ProductRow>(`${select} WHERE p.slug = ? LIMIT 1`, [slug])
    return result.rows[0] ? toProduct(result.rows[0]) : undefined
  }

  async setStock(productId: string, quantity: number, updatedAt: string): Promise<void> {
    const result = await this.db.execute('UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?', [quantity, updatedAt, productId])
    if (result.rowsAffected !== 1) throw new Error('PRODUCT_NOT_FOUND')
  }
}
