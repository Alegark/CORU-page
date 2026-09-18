import { Icon, icons } from '../ui/Icon'
import type { Order } from '../../../shared/types'

export function OrderCreatedFeedback({ order, onClose }: { order: Order; onClose: () => void }) {
  return (
    <section className="order-feedback" role="status" aria-live="polite">
      <div className="feedback-icon"><Icon icon={icons.check} /></div>
      <div className="feedback-body">
        <span className="eyebrow">Pedido creado</span>
        <h3>{order.reference}</h3>
        <p>{order.currency === 'Bs' ? 'Tasa asegurada para tu pedido hasta finalizar hoy.' : 'Tu pedido quedó listo para continuar por WhatsApp.'}</p>
        <a className="button button-primary" href={order.whatsappUrl} target="_blank" rel="noreferrer"><Icon icon={icons.whatsapp} /> Abrir WhatsApp</a>
      </div>
      <button className="icon-button feedback-close" type="button" onClick={onClose} aria-label="Cerrar confirmación"><Icon icon={icons.xmark} /></button>
    </section>
  )
}
