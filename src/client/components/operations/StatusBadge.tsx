import type { OrderStatus } from '../../../shared/types'

const labels: Record<OrderStatus, string> = { PENDING: 'Pendiente', CONFIRMED: 'Venta concretada', DISCARDED: 'Descartado', CANCELLED: 'Venta cancelada' }

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><span />{labels[status]}</span>
}
