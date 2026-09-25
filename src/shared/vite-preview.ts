/** True for local Vite preview / localhost SPA (no Worker origin). */
export function isVitePreview(): boolean {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  const port = window.location.port
  return (hostname === 'localhost' || hostname === '127.0.0.1') && (port === '' || port === '4173' || port === '4174')
}
