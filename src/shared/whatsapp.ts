import type { Order } from './types'

export type WhatsappMessageOrder = Pick<Order, 'reference' | 'items' | 'quote' | 'fulfillmentTypeSnapshot' | 'shipping' | 'depositUsdCents' | 'balanceUsdCents' | 'leadTimeSnapshot'>

type WhatsappMessageOptions = {
  intro?: string
  totalBs?: number
}

function formatUsdMessage(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatBsTotalMessage(minor: number): string {
  const amount = (minor / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `Bs. ${amount}`
}

/** Builds the customer-facing order summary opened by the WhatsApp CTA. */
export function formatWhatsappOrderMessage(order: WhatsappMessageOrder, options: WhatsappMessageOptions = {}): string {
  const intro = options.intro?.trim() || 'Hola, quiero pedir estos productos de CORU.'
  const lines: string[] = [intro, '', '📦 *PRODUCTOS*']

  order.items.forEach((item) => {
    const size = item.sizeLabel ? ` [${item.sizeLabel}]` : ''
    lines.push(`- ${item.quantity} uds × ${item.name}${size}`)
    lines.push(`  ${formatUsdMessage(item.unitPriceCents)} × ${item.quantity} = ${formatUsdMessage(item.lineTotalCents)}`)
  })

  lines.push('', '━━━━━━━━━━━━━━', '📋 *DATOS DE ENTREGA Y FACTURA*', `- Referencia: *${order.reference}*`)

  if (order.fulfillmentTypeSnapshot === 'PREORDER') {
    lines.push('- Entrega: por coordinar por WhatsApp')
  } else if (order.shipping) {
    if (order.shipping.method === 'PERSONAL') {
      const point = order.shipping.deliveryPointName ?? order.shipping.deliveryPointId
      lines.push(`- Entrega: Personal · ${point}${order.shipping.deliveryPointAddress ? ` · ${order.shipping.deliveryPointAddress}` : ''}`)
    }
    if (order.shipping.method === 'NATIONAL') {
      const locationLines = [
        order.shipping.state,
        order.shipping.city,
        order.shipping.officeText,
      ]
      lines.push(`- Entrega: Envío nacional · ${order.shipping.carrier}`, '- Cobro: a destino', locationLines.filter(Boolean).join(' · ') ? `- Destino: ${locationLines.filter(Boolean).join(' · ')}` : '- Datos del destinatario y oficina: por coordinar por WhatsApp')
    }
    if (order.shipping.method === 'YUMMY') {
      lines.push('- Entrega: Yummy')
    }
  }

  lines.push('', '━━━━━━━━━━━━━━', '💰 *RESUMEN DE PAGO*')
  if (order.quote.appliedPromotion) lines.push(`- Promoción: ${order.quote.appliedPromotion.name}`)
  lines.push(`- Subtotal: ${formatUsdMessage(order.quote.subtotalCents)}`)
  if (order.quote.discountCents > 0) lines.push(`- Descuento: −${formatUsdMessage(order.quote.discountCents)}`)
  lines.push(`- TOTAL EN USD: *${formatUsdMessage(order.quote.totalCents)}*`)
  if (options.totalBs !== undefined) lines.push(`- TOTAL EN BS: *${formatBsTotalMessage(options.totalBs)}*`, '- Tasa asegurada hasta finalizar hoy.')

  const notes: string[] = []
  if (order.fulfillmentTypeSnapshot === 'PREORDER') {
    notes.push(`- Tiempo estimado de envío: ${order.leadTimeSnapshot ?? '3–4 semanas'}`, '- Forma de pago: 50% inicial · 50% al entregar')
  } else if (order.shipping?.method === 'YUMMY') {
    notes.push('- Envía tu ubicación por WhatsApp para cotizar el delivery.', '- La tarifa de Yummy puede variar según la hora y disponibilidad.')
  }
  if (notes.length) lines.push('', '📝 *NOTAS*', ...notes)
  return lines.join('\n')
}
