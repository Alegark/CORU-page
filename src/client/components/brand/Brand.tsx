import { Link } from '../ui/Link'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand-lockup${compact ? ' brand-lockup-compact' : ''}`} href="/" aria-label="Ir a CORU">
      {compact ? <img className="brand-mascot" src="/brand/coru-mascot.svg" alt="" aria-hidden="true" /> : <><img className="brand-mascot" src="/brand/coru-mascot.svg" alt="" aria-hidden="true" /><span className="brand-name" aria-hidden="true">CORU</span></>}
    </Link>
  )
}

export function Mascot({ className = '' }: { className?: string }) {
  return <img className={`mascot${className ? ` ${className}` : ''}`} src="/brand/coru-mascot.svg" alt="" aria-hidden="true" />
}
