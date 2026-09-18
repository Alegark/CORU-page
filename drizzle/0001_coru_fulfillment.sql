PRAGMA foreign_keys = OFF;

ALTER TABLE products ADD COLUMN fulfillment_type TEXT NOT NULL DEFAULT 'STOCK' CHECK (fulfillment_type IN ('STOCK', 'PREORDER'));
ALTER TABLE products ADD COLUMN measurements_text TEXT;
ALTER TABLE products ADD COLUMN inner_diameter_mm REAL;
ALTER TABLE products ADD COLUMN circumference_mm REAL;
ALTER TABLE products ADD COLUMN lead_time TEXT;

ALTER TABLE order_items RENAME TO order_items_v1;
ALTER TABLE orders RENAME TO orders_v1;
CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'DISCARDED', 'CANCELLED')),
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
  expires_at TEXT,
  confirmed_at TEXT,
  discarded_at TEXT,
  cancelled_at TEXT,
  discard_reason TEXT,
  cancel_reason TEXT,
  fulfillment_type_snapshot TEXT NOT NULL DEFAULT 'STOCK' CHECK (fulfillment_type_snapshot IN ('STOCK', 'PREORDER')),
  lead_time_snapshot TEXT,
  deposit_usd_cents INTEGER,
  balance_usd_cents INTEGER,
  preorder_stage TEXT CHECK (preorder_stage IS NULL OR preorder_stage IN ('AWAITING_DEPOSIT', 'IN_PROCESS', 'READY', 'DELIVERED', 'CANCELLED')),
  payment_status TEXT CHECK (payment_status IS NULL OR payment_status IN ('UNPAID', 'DEPOSIT_PAID', 'PAID')),
  shipping_method TEXT CHECK (shipping_method IS NULL OR shipping_method IN ('PERSONAL', 'YUMMY', 'NATIONAL')),
  personal_delivery_point_id TEXT,
  delivery_address_text TEXT,
  delivery_lat REAL,
  delivery_lng REAL,
  delivery_quote_amount_minor INTEGER,
  delivery_quote_currency TEXT,
  delivery_quote_quoted_at TEXT,
  delivery_quote_external_id TEXT,
  national_carrier TEXT CHECK (national_carrier IS NULL OR national_carrier IN ('MRW', 'ZOOM')),
  national_state TEXT,
  national_city TEXT,
  national_office_text TEXT
);
INSERT INTO orders (id, reference, status, currency, idempotency_key, rate_micros, rate_valid_until, subtotal_cents, discount_cents, total_cents, promotion_id, promotion_name, promotion_groups, whatsapp_url, created_at, confirmed_at)
SELECT id, reference, status, currency, idempotency_key, rate_micros, rate_valid_until, subtotal_cents, discount_cents, total_cents, promotion_id, promotion_name, promotion_groups, whatsapp_url, created_at, confirmed_at FROM orders_v1;
DROP TABLE orders_v1;

CREATE TABLE order_items (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  size_label_snapshot TEXT NOT NULL,
  material_snapshot TEXT,
  fulfillment_type_snapshot TEXT NOT NULL DEFAULT 'STOCK' CHECK (fulfillment_type_snapshot IN ('STOCK', 'PREORDER')),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
);
INSERT INTO order_items (id, order_id, product_id, name_snapshot, size_label_snapshot, unit_price_cents, quantity, line_total_cents)
SELECT id, order_id, product_id, name_snapshot, size_label_snapshot, unit_price_cents, quantity, line_total_cents FROM order_items_v1;
DROP TABLE order_items_v1;

ALTER TABLE inventory_movements RENAME TO inventory_movements_v1;
CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  order_id TEXT REFERENCES orders(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('SALE', 'SALE_REVERSAL', 'MANUAL_SET', 'MANUAL_ADJUST')),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reverses_movement_id TEXT UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO inventory_movements (id, product_id, order_id, movement_type, delta, note, created_at)
SELECT id, product_id, order_id, movement_type, delta, note, created_at FROM inventory_movements_v1;
DROP TABLE inventory_movements_v1;

ALTER TABLE analytics_events RENAME TO analytics_events_v1;
CREATE TABLE analytics_events (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (name IN ('catalog_view', 'product_view', 'cart_add', 'order_intent', 'order_confirmed', 'size_guide_view', 'shipping_method_selected', 'yummy_quote_requested', 'yummy_quote_succeeded', 'yummy_quote_failed', 'preorder_intent_created', 'preorder_deposit_recorded', 'preorder_ready', 'preorder_completed')),
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  properties_json TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO analytics_events (id, name, session_id, source, properties_json, occurred_at, created_at)
SELECT id, name, session_id, source, properties_json, occurred_at, created_at FROM analytics_events_v1;
DROP TABLE analytics_events_v1;

CREATE TABLE IF NOT EXISTS personal_delivery_points (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  short_description TEXT,
  latitude REAL,
  longitude REAL,
  schedule_text TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_payments (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_kind TEXT NOT NULL CHECK (payment_kind IN ('DEPOSIT', 'BALANCE')),
  usd_amount_cents INTEGER NOT NULL CHECK (usd_amount_cents > 0),
  paid_currency TEXT NOT NULL CHECK (paid_currency IN ('USD', 'Bs')),
  paid_amount_minor INTEGER NOT NULL CHECK (paid_amount_minor > 0),
  rate_micros INTEGER,
  recorded_at TEXT NOT NULL,
  note TEXT,
  idempotency_key TEXT UNIQUE,
  UNIQUE(order_id, payment_kind)
);

CREATE TABLE IF NOT EXISTS order_audits (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_intent_abuse_counters (
  digest TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (digest, window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment ON orders(fulfillment_type_snapshot, status, created_at);
CREATE INDEX IF NOT EXISTS idx_movements_reversal ON inventory_movements(reverses_movement_id);
CREATE INDEX IF NOT EXISTS idx_order_audits_order ON order_audits(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments(order_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_points_active ON personal_delivery_points(is_active, sort_order);

PRAGMA foreign_keys = ON;
