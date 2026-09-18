/**
 * Database shape kept framework-neutral until the Turso adapter is enabled.
 * The SQL migration in `drizzle/` is the executable source for local review.
 */
export type DatabaseTable =
  | 'categories'
  | 'products'
  | 'product_images'
  | 'promotions'
  | 'promotion_products'
  | 'orders'
  | 'order_items'
  | 'inventory_movements'
  | 'exchange_rates'
  | 'store_settings'
  | 'analytics_events'

export type DatabaseSchema = Record<DatabaseTable, Record<string, unknown>>
