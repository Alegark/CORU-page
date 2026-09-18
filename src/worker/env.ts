import type { SqlClient } from '../db/client'

export type AssetBinding = {
  fetch(request: Request): Promise<Response>
}

export type CoruBindings = {
  ASSETS?: AssetBinding
  DEV_ADMIN_BYPASS?: string
  ENVIRONMENT?: string
  TURSO_DATABASE_URL?: string
  TURSO_AUTH_TOKEN?: string
  TEAM_DOMAIN?: string
  POLICY_AUD?: string
  PHOTOROOM_API_KEY?: string
  EXCHANGE_RATE_URL?: string
  YUMMY_ADAPTER_ENABLED?: string
  YUMMY_API_URL?: string
  YUMMY_API_TOKEN?: string
  CORU_MEDIA?: unknown
  CORU_ABUSE_SECRET?: string
}

export type CoruEnv = {
  Bindings: CoruBindings
  Variables: {
    database?: SqlClient
  }
}
