export const analyticsTable = {
  table: 'analytics_events',
  names: ['catalog_view', 'product_view', 'cart_add', 'order_intent', 'order_confirmed', 'size_guide_view', 'shipping_method_selected', 'yummy_quote_requested', 'yummy_quote_succeeded', 'yummy_quote_failed', 'preorder_intent_created', 'preorder_deposit_recorded', 'preorder_ready', 'preorder_completed'],
  retentionDays: 180,
} as const
