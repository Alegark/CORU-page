DROP TABLE IF EXISTS analytics_events_v2;

CREATE TABLE analytics_events_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (name IN ('catalog_view', 'product_view', 'cart_add', 'order_intent', 'order_confirmed', 'size_guide_view', 'privacy_view', 'not_found_view', 'shipping_method_selected', 'yummy_quote_requested', 'yummy_quote_succeeded', 'yummy_quote_failed', 'preorder_intent_created', 'preorder_deposit_recorded', 'preorder_ready', 'preorder_completed')),
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  properties_json TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO analytics_events_v2 (id, name, session_id, source, properties_json, occurred_at, created_at)
SELECT id, name, session_id, source, properties_json, occurred_at, created_at FROM analytics_events;

DROP TABLE analytics_events;
ALTER TABLE analytics_events_v2 RENAME TO analytics_events;
CREATE INDEX IF NOT EXISTS idx_analytics_occurred ON analytics_events(occurred_at);
