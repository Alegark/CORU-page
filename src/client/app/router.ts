import type { MouseEvent } from 'react'
import { resolveRoute, type Route } from '../../shared/routes'

export type { Route }
export { resolveRoute }

export function navigate(path: string): void {
  if (window.location.pathname === path) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** True when the click should be handled as in-app SPA navigation. */
export function shouldHandleSpaClick(event: Pick<MouseEvent, 'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  return !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
}

export function handleSpaNavigate(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  if (!shouldHandleSpaClick(event)) return
  if (event.currentTarget.getAttribute('target') === '_blank') return
  const url = new URL(href, window.location.origin)
  if (url.origin !== window.location.origin) return
  event.preventDefault()
  navigate(`${url.pathname}${url.search}${url.hash}`)
}
