import type { PersonalDeliveryPoint } from '../../../shared/types'

function projection(points: PersonalDeliveryPoint[], point: PersonalDeliveryPoint): { x: number; y: number } {
  const withCoordinates = points.filter((entry) => entry.latitude !== undefined && entry.longitude !== undefined)
  if (!withCoordinates.length || point.latitude === undefined || point.longitude === undefined) return { x: 50, y: 50 }
  const longitudes = withCoordinates.map((entry) => entry.longitude!)
  const latitudes = withCoordinates.map((entry) => entry.latitude!)
  const minLon = Math.min(...longitudes); const maxLon = Math.max(...longitudes)
  const minLat = Math.min(...latitudes); const maxLat = Math.max(...latitudes)
  const lonSpan = Math.max(0.01, maxLon - minLon); const latSpan = Math.max(0.01, maxLat - minLat)
  return { x: 12 + ((point.longitude - minLon) / lonSpan) * 76, y: 88 - ((point.latitude - minLat) / latSpan) * 76 }
}

export function PersonalDeliveryPointMap({ points, selectedId, onSelect }: { points: PersonalDeliveryPoint[]; selectedId?: string; onSelect: (point: PersonalDeliveryPoint) => void }) {
  const mapped = points.filter((point) => point.latitude !== undefined && point.longitude !== undefined)
  return <div className="delivery-point-picker"><div className="delivery-point-map" role="img" aria-label={mapped.length ? 'Mapa de puntos de entrega CORU' : 'Mapa no disponible; usa la lista de puntos de entrega'}>{mapped.length ? <svg viewBox="0 0 100 100" aria-hidden="true"><path className="delivery-map-shape" d="M4 72 16 58 25 63 34 42 48 50 58 28 72 35 83 16 96 25 91 46 98 61 83 72 74 92 57 82 42 95 29 78 14 86Z" />{mapped.map((point) => { const position = projection(mapped, point); const selected = point.id === selectedId; return <circle key={point.id} className={`delivery-map-marker${selected ? ' is-selected' : ''}`} cx={position.x} cy={position.y} r={selected ? 4.2 : 3} onClick={() => onSelect(point)} /> })}</svg> : <div className="delivery-map-fallback">El mapa es opcional. Selecciona un punto de la lista.</div>}</div><div className="delivery-point-list" role="listbox" aria-label="Puntos de entrega personales">{points.map((point) => <button key={point.id} type="button" role="option" aria-selected={point.id === selectedId} className={`delivery-point-card${point.id === selectedId ? ' is-selected' : ''}`} onClick={() => onSelect(point)}><span className="delivery-point-card-title">{point.name}</span><span>{point.address}</span>{point.scheduleText && <small>{point.scheduleText}</small>}{point.shortDescription && <small>{point.shortDescription}</small>}</button>)}</div></div>
}
