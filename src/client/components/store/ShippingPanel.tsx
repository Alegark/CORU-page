import type { PersonalDeliveryPoint, ShippingMethod } from '../../../shared/types'
import { PersonalDeliveryPointList } from './PersonalDeliveryPointList'

export type ShippingPanelProps = {
  open: boolean
  method: ShippingMethod
  points: PersonalDeliveryPoint[]
  selectedPointId: string
  onSelectPoint: (point: PersonalDeliveryPoint) => void
  nationalCarrier: 'MRW' | 'ZOOM'
  onNationalCarrierChange: (carrier: 'MRW' | 'ZOOM') => void
}

export function ShippingPanel({
  open,
  method,
  points,
  selectedPointId,
  onSelectPoint,
  nationalCarrier,
  onNationalCarrierChange,
}: ShippingPanelProps) {
  if (!open || method === 'YUMMY') return null

  const label = method === 'PERSONAL' ? 'Entrega personal' : method === 'NATIONAL' ? 'Envío nacional' : 'Yummy'

  return (
    <div className="shipping-inline-panel" id="shipping-panel" data-open="true" role="region" aria-label={label}>
      <div className="shipping-inline-panel-inner">
        {method === 'PERSONAL' && (
          <>
            {points.length ? <PersonalDeliveryPointList points={points} selectedId={selectedPointId} onSelect={onSelectPoint} /> : <div className="inline-notice" role="status">No hay puntos personales activos en este momento.</div>}
          </>
        )}

        {method === 'NATIONAL' && (
          <>
          <div className="shipping-carrier-options" role="group" aria-label="Empresa de envío">
              {(['MRW', 'ZOOM'] as const).map((carrier) => <button key={carrier} className={nationalCarrier === carrier ? 'is-selected' : ''} type="button" aria-pressed={nationalCarrier === carrier} onClick={() => onNationalCarrierChange(carrier)}>{carrier}</button>)}
          </div>
          </>
        )}
      </div>
    </div>
  )
}
