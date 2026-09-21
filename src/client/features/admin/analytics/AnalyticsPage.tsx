import { useEffect, useMemo, useState } from 'react'
import { Icon, icons } from '../../../components/ui/Icon'
import { formatUsd } from '../../../../shared/commerce'
import { ApiClientError, fetchAdminAnalyticsSummary, fetchAdminProductAnalytics, type AdminAnalyticsProductInterest, type AdminAnalyticsRange, type AdminAnalyticsSummaryV2 } from '../../../api/admin'

type Period = 'today' | '3d' | '7d' | '30d' | 'month' | 'custom'
type TimelineMetric = 'uniqueVisits' | 'unitsAdded' | 'whatsappIntents'

const periodLabels: Array<{ value: Exclude<Period, 'custom'>; label: string }> = [
  { value: 'today', label: 'Hoy' },
  { value: '3d', label: '3 días' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: 'month', label: 'Mes actual' },
]

function caracasToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
  return values.year + '-' + values.month + '-' + values.day
}

function shiftDate(value: string, days: number): string {
  const date = new Date(value + 'T12:00:00-04:00')
  date.setUTCDate(date.getUTCDate() + days)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
  return values.year + '-' + values.month + '-' + values.day
}

function rangeForPeriod(period: Exclude<Period, 'custom'>): AdminAnalyticsRange {
  const today = caracasToday()
  if (period === 'today') return { from: today, to: today }
  if (period === '3d') return { from: shiftDate(today, -2), to: today }
  if (period === '30d') return { from: shiftDate(today, -29), to: today }
  if (period === 'month') return { from: today.slice(0, 8) + '01', to: today }
  return { from: shiftDate(today, -6), to: today }
}

function sourceLabel(source: AdminAnalyticsSummaryV2['sources'][number]['source']): string {
  return source === 'instagram' ? 'Instagram' : source === 'facebook' ? 'Facebook' : source === 'whatsapp' ? 'WhatsApp' : source === 'direct' ? 'Directo' : 'Otros'
}

function deviceLabel(device: AdminAnalyticsSummaryV2['devices'][number]['device']): string {
  return device === 'mobile' ? 'Móvil' : device === 'tablet' ? 'Tablet' : device === 'desktop' ? 'Escritorio' : 'Desconocido'
}

function AnalyticsKpi({ icon, label, value, note }: { icon: typeof icons.chart; label: string; value: string; note: string }) {
  return <article className="analytics-kpi-card"><span className="analytics-kpi-icon"><Icon icon={icon} /></span><span className="eyebrow">{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function ProductInterestList({ products }: { products: AdminAnalyticsProductInterest[] }) {
  if (!products.length) return <div className="analytics-empty-inline">Aún no hay productos consultados en este período.</div>
  return <div className="product-interest-list">{products.map((product, index) => <div className="product-interest-row" key={product.productId}><span className="product-interest-rank">{index + 1}</span><div className="product-interest-copy"><strong>{product.name}</strong><small>{product.views.toLocaleString('es-VE')} consultas · {product.unitsAdded.toLocaleString('es-VE')} agregados · {product.addSessions.toLocaleString('es-VE')} sesiones</small><div className="analytics-progress"><span style={{ width: product.relativeInterestPct + '%' }} /></div></div><strong className="product-interest-score">{product.relativeInterestPct}%</strong></div>)}</div>
}

function AnalyticsTimeline({ summary }: { summary: AdminAnalyticsSummaryV2 }) {
  const [metric, setMetric] = useState<TimelineMetric>('uniqueVisits')
  const metricLabels: Record<TimelineMetric, string> = { uniqueVisits: 'Visitas únicas', unitsAdded: 'Agregados', whatsappIntents: 'WhatsApp' }
  const values = summary.timeline.map((bucket) => bucket[metric])
  const max = Math.max(1, ...values)
  return <section className="admin-panel analytics-timeline"><div className="panel-header"><div><span className="eyebrow">Actividad durante el período</span><h2>Ritmo de interés</h2></div><div className="analytics-segmented" role="group" aria-label="Métrica de actividad">{(Object.keys(metricLabels) as TimelineMetric[]).map((key) => <button key={key} className={metric === key ? 'is-active' : ''} type="button" onClick={() => setMetric(key)}>{metricLabels[key]}</button>)}</div></div>{summary.timeline.length ? <div className="analytics-bars" role="img" aria-label={'Actividad: ' + metricLabels[metric]}>{summary.timeline.map((bucket) => <div className="analytics-bar-column" key={bucket.bucket}><div className="analytics-bar-value" style={{ height: Math.max(6, (bucket[metric] / max) * 100) + '%' }} title={String(bucket[metric])} /><small>{bucket.bucket}</small></div>)}</div> : <div className="analytics-empty-inline">No hay actividad registrada en este período.</div>}</section>
}

export function AnalyticsPage() {
  const today = caracasToday()
  const [period, setPeriod] = useState<Period>('7d')
  const [customFrom, setCustomFrom] = useState(shiftDate(today, -6))
  const [customTo, setCustomTo] = useState(today)
  const [range, setRange] = useState<AdminAnalyticsRange>(() => rangeForPeriod('7d'))
  const [summary, setSummary] = useState<AdminAnalyticsSummaryV2 | null>(null)
  const [products, setProducts] = useState<AdminAnalyticsProductInterest[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setRefreshing(true)
    Promise.all([fetchAdminAnalyticsSummary(range), fetchAdminProductAnalytics(range)]).then(([nextSummary, nextProducts]) => {
      if (!active) return
      setSummary(nextSummary)
      setProducts(nextProducts.products)
      setError('')
    }).catch((requestError) => {
      if (!active) return
      setError(requestError instanceof ApiClientError ? requestError.message : 'No pudimos actualizar la analítica.')
    }).finally(() => {
      if (!active) return
      setLoading(false)
      setRefreshing(false)
    })
    return () => { active = false }
  }, [range, reloadKey])

  const hasActivity = Boolean(summary && (summary.kpis.uniqueVisits || summary.kpis.unitsAdded || summary.kpis.whatsappIntents || summary.realOrders.pending || summary.realOrders.confirmed || summary.realOrders.discarded || summary.realOrders.cancelled))
  const funnel = useMemo(() => summary ? [['Tienda visitada', summary.funnel.catalogSessions], ['Producto visto', summary.funnel.productViewSessions], ['Agregó al carrito', summary.funnel.addSessions], ['Intento por WhatsApp', summary.funnel.whatsappSessions], ['Venta concretada', summary.funnel.confirmedOrders]] as const : [], [summary])
  const funnelMax = Math.max(1, ...funnel.map(([, value]) => value))
  const retry = () => setReloadKey((key) => key + 1)

  function choosePeriod(next: Period): void {
    setPeriod(next)
    if (next !== 'custom') setRange(rangeForPeriod(next))
  }

  function applyCustomRange(): void {
    if (!customFrom || !customTo) return
    setRange({ from: customFrom, to: customTo })
  }

  return <div className="analytics-page">
    <div className="admin-page-head"><div><span className="eyebrow">Señales anónimas</span><h1>Actividad del catálogo</h1><p>Visitas, productos consultados e intención de compra.</p></div><span className="analytics-retention-note">Datos anónimos · retención 180 días</span></div>
    <section className="analytics-toolbar" aria-label="Filtrar período"><div className="analytics-periods">{periodLabels.map((item) => <button key={item.value} type="button" className={period === item.value ? 'is-active' : ''} onClick={() => choosePeriod(item.value)}>{item.label}</button>)}<button type="button" className={period === 'custom' ? 'is-active' : ''} onClick={() => choosePeriod('custom')}>Personalizado</button></div><button className="button button-secondary analytics-refresh" type="button" onClick={retry} disabled={refreshing}><Icon icon={icons.rotate} /> {refreshing ? 'Actualizando…' : 'Actualizar'}</button></section>
    {period === 'custom' && <div className="analytics-custom-range"><label>Desde<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>Hasta<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label><button className="button button-primary" type="button" onClick={applyCustomRange}>Aplicar</button></div>}
    {loading && <div className="inline-notice" role="status" aria-live="polite">Cargando actividad…</div>}
    {refreshing && !loading && <div className="analytics-refreshing" role="status" aria-live="polite">Actualizando período…</div>}
    {error && <div className="inline-notice is-error" role="alert"><Icon icon={icons.warning} /> <span>No pudimos actualizar la analítica.</span><button type="button" onClick={retry}>Reintentar</button></div>}
    {summary && <><section className="analytics-kpis"><AnalyticsKpi icon={icons.chart} label="Visitantes únicos" value={summary.kpis.uniqueVisits.toLocaleString('es-VE')} note="catálogo · 1 por dispositivo en el período" /><AnalyticsKpi icon={icons.search} label="Visitas totales" value={summary.kpis.totalVisits.toLocaleString('es-VE')} note="entradas al catálogo" /><AnalyticsKpi icon={icons.plus} label="Unidades agregadas" value={summary.kpis.unitsAdded.toLocaleString('es-VE')} note="incrementos reales" /><AnalyticsKpi icon={icons.whatsapp} label="Intentos por WhatsApp" value={summary.kpis.whatsappIntents.toLocaleString('es-VE')} note="pedidos iniciados" /></section><div className="analytics-main-grid"><section className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Interés por producto</span><h2>Productos con mayor interés</h2></div><span className="panel-meta">máximo 10</span></div>{hasActivity ? <ProductInterestList products={products} /> : <div className="analytics-empty">Aún no hay actividad en este período. Cuando haya visitas y acciones en el catálogo aparecerán aquí.</div>}</section><section className="admin-panel analytics-commercial"><div className="panel-header"><div><span className="eyebrow">Intención, no ventas</span><h2>Resumen comercial</h2></div></div><div className="analytics-commercial-list"><div><span>Unidades agregadas</span><strong>{summary.commercial.unitsAdded.toLocaleString('es-VE')}</strong></div><div><span>{summary.commercial.potentialValueEstimated ? 'Valor potencial estimado' : 'Valor potencial'}</span><strong>{formatUsd(summary.commercial.potentialValueCents)}</strong></div><div><span>WhatsApp / agregar</span><strong>{summary.commercial.whatsappPerAddPct}%</strong></div></div>{summary.commercial.potentialValueEstimated && <p className="admin-panel-note">Parte del período usa el precio actual porque eventos anteriores no guardaban snapshot de precio.</p>}<div className="analytics-callout">Estas métricas muestran intención de compra. Las ventas reales se calculan desde Pedidos.</div></section></div><div className="analytics-secondary-grid"><section className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Embudo</span><h2>De visita a venta</h2></div></div><div className="analytics-funnel">{funnel.map(([label, value]) => <div className="analytics-funnel-row" key={label}><div><span>{label}</span><strong>{value.toLocaleString('es-VE')}</strong></div><div className="analytics-progress"><span style={{ width: Math.round((value / funnelMax) * 100) + '%' }} /></div></div>)}</div></section><section className="admin-panel"><div className="panel-header"><div><span className="eyebrow">Audiencia</span><h2>Fuentes y dispositivos</h2></div></div><div className="analytics-audience-grid"><div><strong>Fuentes</strong>{summary.sources.length ? summary.sources.map((entry) => <div className="analytics-audience-row" key={entry.source}><span>{sourceLabel(entry.source)}</span><b>{entry.visits.toLocaleString('es-VE')} · {entry.percentage}%</b></div>) : <small>Sin fuentes en este período.</small>}</div><div><strong>Dispositivos</strong>{summary.devices.length ? summary.devices.map((entry) => <div className="analytics-audience-row" key={entry.device}><span>{deviceLabel(entry.device)}</span><b>{entry.visits.toLocaleString('es-VE')} · {entry.percentage}%</b></div>) : <small>Sin dispositivos en este período.</small>}</div></div></section></div><AnalyticsTimeline summary={summary} /><section className="admin-panel analytics-real-orders"><div className="panel-header"><div><span className="eyebrow">Pedidos</span><h2>Resultados reales</h2></div><span className="panel-meta">desde Pedidos</span></div><div className="analytics-orders-grid"><div><strong>{summary.realOrders.confirmed}</strong><span>Concretados</span><small>{formatUsd(summary.realOrders.confirmedStockRevenueCents)} en stock</small></div><div><strong>{summary.realOrders.pending}</strong><span>Pendientes</span></div><div><strong>{summary.realOrders.discarded}</strong><span>Descartados</span></div><div><strong>{summary.realOrders.cancelled}</strong><span>Cancelados</span></div></div></section></>}
  </div>
}
