import { Icon, icons } from '../ui/Icon'

export function RateLockNotice({ available }: { available: boolean }) {
  return available ? <div className="rate-notice protected"><Icon icon={icons.info} /><div><strong>Tasa protegida hoy</strong><p>Al generar tu pedido, el monto en Bs mantendrá la tasa asignada hasta finalizar hoy.</p></div></div> : <div className="rate-notice"><Icon icon={icons.info} /><div><strong>Bs no disponible por ahora</strong><p>La tasa no está disponible. Puedes continuar viendo el carrito en USD.</p></div></div>
}

