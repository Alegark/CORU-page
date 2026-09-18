PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  sku TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  material TEXT NOT NULL DEFAULT '',
  artwork TEXT NOT NULL DEFAULT 'orbita',
  size_label TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  promo_eligible INTEGER NOT NULL DEFAULT 0 CHECK (promo_eligible IN (0, 1)),
  primary_image_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  original_key TEXT NOT NULL,
  processed_key TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  processing_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (processing_status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
  is_approved INTEGER NOT NULL DEFAULT 0 CHECK (is_approved IN (0, 1)),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BUNDLE', 'FIXED_DISCOUNT')),
  target_category_id TEXT REFERENCES categories(id),
  bundle_quantity INTEGER CHECK (bundle_quantity IS NULL OR bundle_quantity > 0),
  bundle_price_cents INTEGER CHECK (bundle_price_cents IS NULL OR bundle_price_cents >= 0),
  fixed_discount_cents INTEGER CHECK (fixed_discount_cents IS NULL OR fixed_discount_cents >= 0),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotion_products (
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'DISCARDED')),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'Bs')),
  idempotency_key TEXT NOT NULL UNIQUE,
  rate_micros INTEGER CHECK (rate_micros IS NULL OR rate_micros > 0),
  rate_valid_until TEXT,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  promotion_id TEXT,
  promotion_name TEXT,
  promotion_groups INTEGER CHECK (promotion_groups IS NULL OR promotion_groups > 0),
  whatsapp_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  size_label_snapshot TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  order_id TEXT REFERENCES orders(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('SALE', 'MANUAL_SET', 'MANUAL_ADJUST')),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY NOT NULL,
  rate_micros INTEGER NOT NULL CHECK (rate_micros > 0),
  mode TEXT NOT NULL CHECK (mode IN ('AUTOMATIC', 'MANUAL')),
  observed_at TEXT NOT NULL,
  valid_until TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (name IN ('catalog_view', 'product_view', 'cart_add', 'order_intent', 'order_confirmed')),
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  properties_json TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(is_active, stock_quantity, primary_image_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, created_at);
CREATE INDEX IF NOT EXISTS idx_promotion_products_product ON promotion_products(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product_created ON inventory_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rates_observed ON exchange_rates(observed_at);
CREATE INDEX IF NOT EXISTS idx_analytics_occurred ON analytics_events(occurred_at);
