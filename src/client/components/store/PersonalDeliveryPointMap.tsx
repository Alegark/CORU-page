import type { PersonalDeliveryPoint } from '../../../shared/types'

function mapUrl(point: PersonalDeliveryPoint): string | null {
  if (point.latitude === undefined || point.longitude === undefined) return null
  const delta = 0.0035
  const bbox = [point.longitude - delta, point.latitude - delta, point.longitude + delta, point.latitude + delta].join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${point.latitude},${point.longitude}`
}

function compactAddress(address: string): string {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  return parts.slice(0, 2).join(' · ')
}

export function PersonalDeliveryPointMap({ points, selectedId, onSelect }: { points: PersonalDeliveryPoint[]; selectedId?: string; onSelect: (point: PersonalDeliveryPoint) => void }) {
  const selected = points.find((point) => point.id === selectedId) ?? points[0]
  const src = selected ? mapUrl(selected) : null

  return <div className="delivery-point-picker">
    <div className="delivery-point-map" aria-label={src ? `Mapa de ${selected?.name ?? 'puntos de entrega'}` : 'Mapa no disponible; usa la lista de puntos de entrega'}>
      {src ? <iframe key={selected.id} className="delivery-point-map-frame" title={`Mapa de ${selected.name}`} src={src} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : <div className="delivery-map-fallback">El mapa no está disponible. Selecciona un punto de la lista.</div>}
    </div>
    <div className="delivery-point-map-caption">Mapa centrado en <strong>{selected?.name ?? 'el punto seleccionado'}</strong></div>
    <div className="delivery-point-list" role="listbox" aria-label="Puntos de entrega personales">
      {points.map((point, index) => <button key={point.id} type="button" role="option" aria-selected={point.id === selectedId} className={`delivery-point-card${point.id === selectedId ? ' is-selected' : ''}`} onClick={() => onSelect(point)}>
        <span className="delivery-point-card-index" aria-hidden="true">{index + 1}</span>
        <span className="delivery-point-card-copy"><span className="delivery-point-card-title">{point.name}</span><small title={point.address}>{compactAddress(point.address)}</small></span>
        <span className="delivery-point-card-check" aria-hidden="true">{point.id === selectedId ? '✓' : '＋'}</span>
      </button>)}
    </div>
  </div>
}
