export function RateState({ expired = false }: { expired?: boolean }) {
  return <span className={`rate-state${expired ? ' rate-expired' : ''}`}><span />{expired ? 'Expirada' : 'Válida hoy'}</span>
}

