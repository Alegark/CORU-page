import { useState } from 'react'
import { dismissPrivacy, isPrivacyDismissed } from '../../../shared/storage'
import { Icon, icons } from '../ui/Icon'

export function PrivacyNotice() {
  const [visible, setVisible] = useState(() => !isPrivacyDismissed())
  if (!visible) return null

  return (
    <aside className="privacy-notice" aria-label="Aviso de privacidad">
      <div className="privacy-notice-content">
        <span className="privacy-notice-icon" aria-hidden="true"><Icon icon={icons.info} /></span>
        <div>
          <strong>Tu privacidad importa.</strong>
          <p>Usamos lo mínimo para preparar tu pedido y mejorar la colección. Sin cuentas ni seguimiento invasivo.</p>
        </div>
      </div>
      <div className="privacy-notice-actions">
        <a className="text-link" href="/privacidad">Leer más</a>
        <button className="button button-secondary" type="button" onClick={() => { dismissPrivacy(); setVisible(false) }}>Entendido</button>
      </div>
    </aside>
  )
}
