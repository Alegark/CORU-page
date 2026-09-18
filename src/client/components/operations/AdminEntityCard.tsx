import type { ReactNode } from 'react'

export function AdminEntityCard({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <article className="admin-entity-card"><div>{children}</div>{action}</article>
}

