import { useEffect, useState } from 'react'
import { Brand } from '../../components/brand/Brand'
import { Link } from '../../components/ui/Link'
import { fetchPersonalDeliveryPoints } from '../../api/public'
import { defaultPersonalDeliveryPoints } from '../../../shared/delivery-points'
import { NATIONAL_SHIPPING_COPY, YUMMY_DELIVERY_COPY } from '../../../shared/shipping-copy'
import { isVitePreview } from '../../../shared/vite-preview'
import type { PersonalDeliveryPoint } from '../../../shared/types'

export function DeliveryPage() {
  const [points, setPoints] = useState<PersonalDeliveryPoint[]>(() => isVitePreview() ? defaultPersonalDeliveryPoints.map((point) => ({ ...point })) : [])
  const [loading, setLoading] = useState(() => !isVitePreview())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isVitePreview()) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchPersonalDeliveryPoints(controller.signal)
      .then((remote) => {
        if (!controller.signal.aborted) setPoints(remote)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPoints([])
          setError('No pudimos cargar los puntos de entrega.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="info-page app-shell delivery-page">
      <header className="simple-header page-container">
        <Brand />
        <Link className="button button-ghost" href="/">Volver a la tienda</Link>
      </header>
      <main id="main-content" className="page-container info-content delivery-content">
        <span className="eyebrow">CORU · Entregas</span>
        <h1 className="display-heading">Entregas en Maracaibo</h1>
        <p className="info-lead">Elige cómo recibir tu pedido. Confirmamos todo por WhatsApp.</p>

        <section className="delivery-section" aria-labelledby="personal-delivery-title">
          <h2 id="personal-delivery-title">Entrega personal</h2>
          {loading ? <p className="delivery-copy">Cargando puntos de entrega…</p> : null}
          {error ? <p className="delivery-copy" role="alert">{error}</p> : null}
          {!loading && !error && (
            <ul className="delivery-point-list">
              {points.map((point) => (
                <li key={point.id}>
                  <strong>{point.name}</strong>
                  <span>{point.address}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="delivery-section" aria-labelledby="yummy-delivery-title">
          <h2 id="yummy-delivery-title">Delivery en Maracaibo</h2>
          <p className="delivery-copy">{YUMMY_DELIVERY_COPY}</p>
        </section>

        <section className="delivery-section" aria-labelledby="national-delivery-title">
          <h2 id="national-delivery-title">Envío nacional</h2>
          <p className="delivery-copy">{NATIONAL_SHIPPING_COPY}</p>
        </section>

        <section className="delivery-section" aria-labelledby="how-to-order-title">
          <h2 id="how-to-order-title">Cómo pedir</h2>
          <ol className="delivery-steps">
            <li>Agrega tus piezas al carrito.</li>
            <li>Elige cómo recibirlas.</li>
            <li>Envía tu pedido por WhatsApp y te confirmamos.</li>
          </ol>
        </section>

        <p><Link className="button button-primary" href="/">Ver la colección</Link></p>
      </main>
    </div>
  )
}
