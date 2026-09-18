import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './client/app/App'
import './client/design/tokens.css'
import './client/design/globals.css'
import './client/design/app.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
