import { Brand } from '../../components/brand/Brand'
import { Icon, icons } from '../../components/ui/Icon'
import { Link } from '../../components/ui/Link'
import { SIZE_GUIDE_FINGER_STEPS, SIZE_GUIDE_RING_STEPS, SIZE_GUIDE_ROWS } from '../../../shared/size-guide'

export function SizeGuidePage() {
  return <div className="simple-page app-shell size-guide-page">
    <header className="simple-header page-container size-guide-header">
      <Brand />
      <Link className="button button-ghost size-guide-back" href="/">Volver a la colección</Link>
    </header>
    <main id="main-content" className="page-container guide-content">
      <section className="size-guide-hero" aria-labelledby="size-guide-title">
        <div className="size-guide-hero-copy">
          <span className="eyebrow">Guía práctica</span>
          <h1 id="size-guide-title" className="display-heading">¿Cómo saber tu talla de anillo?</h1>
          <p className="size-guide-hero-lead">Mídela en casa fácilmente antes de comprar en CORU.</p>
        </div>
        <div className="size-guide-hero-art"><img className="size-guide-hero-image" src="/coru-ring-hero.png" alt="Anillo CORU plateado y negro listo para medir." /></div>
      </section>

        <section className="size-guide-section size-guide-method-one" aria-labelledby="method-one-title">
          <div className="size-guide-section-heading">
            <span className="eyebrow">Diámetro interior</span>
            <h2 id="method-one-title" className="display-heading">Método 1: mide un anillo que ya uses</h2>
        </div>
        <div className="size-guide-method-layout">
          <div className="size-guide-method-art">
            <img className="size-guide-method-image" src="/coru-medir-anillo.png" alt="Anillo CORU sobre una regla para medir el diámetro interior." />
          </div>
          <ol className="size-guide-steps">
            {SIZE_GUIDE_RING_STEPS.map((step, index) => <li key={step}><span className="size-guide-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}
          </ol>
        </div>
        <aside className="size-guide-callout" role="note"><Icon icon={icons.info} aria-hidden="true" /><p>No midas el borde exterior, solo el espacio interno del anillo.</p></aside>
      </section>

        <section className="size-guide-section size-guide-method-two" aria-labelledby="method-two-title">
          <div className="size-guide-section-heading size-guide-method-two-heading">
            <span className="eyebrow">Circunferencia</span>
            <h2 id="method-two-title" className="display-heading">Método 2: mide tu dedo</h2>
          </div>
          <div className="size-guide-finger-layout">
            <figure className="size-guide-finger-art">
              <img src="/coru-medir-dedo.svg" alt="Medición de la circunferencia del dedo con una tira y una regla." />
            </figure>
            <ol className="size-guide-finger-steps">
              {SIZE_GUIDE_FINGER_STEPS.map((step, index) => <li key={step}><span className="size-guide-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}
            </ol>
          </div>
      </section>

      <section className="size-guide-section size-guide-table-section" aria-labelledby="size-table-title">
        <div className="size-guide-section-heading"><span className="eyebrow">Referencia CORU</span><h2 id="size-table-title" className="display-heading">Tabla de tallas CORU</h2></div>
        <div className="size-guide-table-card surface-card">
          <div className="size-guide-table-scroll">
            <table>
              <caption className="sr-only">Tallas de anillo CORU en sistema US, diámetro interior y circunferencia.</caption>
              <thead><tr><th scope="col">Talla US</th><th scope="col">Diámetro interior (cm)</th><th scope="col">Circunferencia (cm)</th></tr></thead>
              <tbody>{SIZE_GUIDE_ROWS.map(([size, diameter, circumference]) => <tr key={size}><th scope="row">{size}</th><td>{diameter}</td><td>{circumference}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="size-guide-table-note">Todas las medidas están expresadas en centímetros.</p>
        </div>
      </section>

      <section className="size-guide-section size-guide-important" aria-labelledby="important-tips-title">
        <div className="size-guide-section-heading"><span className="eyebrow">Antes de elegir</span><h2 id="important-tips-title" className="display-heading">Tips importantes</h2></div>
        <ul className="size-guide-important-list">
          <li>Si el anillo es ancho, puede sentirse más ajustado.</li>
          <li>Si dudas entre dos tallas, elige la mayor.</li>
          <li>Si usas un anillo como referencia, asegúrate de que sea del mismo dedo.</li>
        </ul>
      </section>

      <section className="size-guide-help" aria-labelledby="size-guide-help-title">
        <div><span className="eyebrow">¿Necesitas ayuda?</span><h2 id="size-guide-help-title">Si aún tienes dudas, escríbenos y te ayudamos a elegir tu talla.</h2><p className="size-guide-help-links"><Link href="/anillos">Ver anillos</Link> · <Link href="/entregas-maracaibo">Entregas en Maracaibo</Link></p></div>
        <Link className="button button-primary" href="/">Volver a la tienda <Icon icon={icons.arrowRight} aria-hidden="true" /></Link>
      </section>
    </main>
  </div>
}
