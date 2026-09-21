import { useEffect, useRef } from 'react'
import { Brand } from '../../components/brand/Brand'
import { Icon, icons } from '../../components/ui/Icon'
import { navigate } from '../../app/router'
import { analytics } from '../../analytics/client'

const ringMethodSteps = [
  'Coloca un anillo que te quede bien sobre una regla.',
  'Mide el diámetro interior del anillo, de borde interno a borde interno, en línea recta.',
  'Anota la medida en milímetros y compárala con la tabla de tallas.',
]

const fingerMethodSteps = [
  'Prepara una tira de papel, hilo o cinta no elástica.',
  'Rodea la base del dedo donde usarás el anillo.',
  'Marca donde se une la tira y estírala.',
  'Mide esa longitud en milímetros con una regla.',
  'Compárala con la tabla de tallas.',
]

const sizeRows = [
  ['5', '15.7 mm', '49.3 mm'],
  ['6', '16.5 mm', '51.9 mm'],
  ['7', '17.3 mm', '54.4 mm'],
  ['8', '18.1 mm', '57.0 mm'],
  ['9', '18.9 mm', '59.5 mm'],
  ['10', '19.8 mm', '62.1 mm'],
] as const

export function SizeGuidePage() {
  const tracked = useRef(false)
  useEffect(() => { if (tracked.current) return; tracked.current = true; analytics.track('size_guide_view') }, [])
  return <div className="simple-page app-shell size-guide-page">
    <header className="simple-header page-container size-guide-header">
      <Brand />
      <button className="button button-ghost size-guide-back" type="button" onClick={() => navigate('/')}>Volver a la colección</button>
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
            {ringMethodSteps.map((step, index) => <li key={step}><span className="size-guide-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}
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
              {fingerMethodSteps.map((step, index) => <li key={step}><span className="size-guide-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}
            </ol>
          </div>
      </section>

      <section className="size-guide-section size-guide-table-section" aria-labelledby="size-table-title">
        <div className="size-guide-section-heading"><span className="eyebrow">Referencia CORU</span><h2 id="size-table-title" className="display-heading">Tabla de tallas CORU</h2></div>
        <div className="size-guide-table-card surface-card">
          <div className="size-guide-table-scroll">
            <table>
              <caption className="sr-only">Tallas de anillo CORU en sistema US, diámetro interior y circunferencia.</caption>
              <thead><tr><th scope="col">Talla US</th><th scope="col">Diámetro interior</th><th scope="col">Circunferencia</th></tr></thead>
              <tbody>{sizeRows.map(([size, diameter, circumference]) => <tr key={size}><th scope="row">{size}</th><td>{diameter}</td><td>{circumference}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="size-guide-table-note">Todas las medidas están expresadas en milímetros.</p>
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
        <div><span className="eyebrow">¿Necesitas ayuda?</span><h2 id="size-guide-help-title">Si aún tienes dudas, escríbenos y te ayudamos a elegir tu talla.</h2></div>
        <button className="button button-primary" type="button" onClick={() => navigate('/')}>Volver a la tienda <Icon icon={icons.arrowRight} aria-hidden="true" /></button>
      </section>
    </main>
  </div>
}
