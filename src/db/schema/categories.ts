export const categoryTable = {
  table: 'categories',
  requiredColumns: ['id', 'slug', 'name', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  checks: ['sort_order >= 0', 'is_active IN (0, 1)'],
} as const

