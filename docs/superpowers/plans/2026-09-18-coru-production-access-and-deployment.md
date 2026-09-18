# CORU production deployment + Cloudflare Access plan

> This plan is the execution record for the production cutover. It keeps the
> administrative login in Cloudflare Access; CORU does not create or store a
> second username/password system.

## Goal

Publish the current CORU Worker and static catalogue on `coru.systems`, make
the public API resolve through the Worker, and protect `/admin*` plus
`/api/admin/*` with Cloudflare Access. The Worker must validate the Access JWT
(`Cf-Access-Jwt-Assertion`) using the configured issuer and audience before
serving administrative data or mutations.

## Status at start

- The Worker already contains the `requireAdmin` middleware and the JWT
  validation contract.
- The React admin screen already consumes the protected admin API.
- Wrangler is authenticated to the CORU Cloudflare account.
- The production hostname is published, but the live `/api/catalog` response
  must be rechecked after the new Worker deployment.
- `TEAM_DOMAIN` and `POLICY_AUD` are deployment inputs from the Access
  application; they must not be invented or committed as secrets.

## Execution phases

### 1. Cloudflare Access login (required before production admin use)

1. Create a Self-hosted Access application for `https://coru.systems/admin*`
   and `https://coru.systems/api/admin/*` (or the equivalent path-scoped
   applications supported by the account).
2. Add an allow policy for the owner's verified email only. Keep the policy
   narrow; do not expose the public catalogue behind Access.
3. Record the Access team issuer URL as `TEAM_DOMAIN` and the application's
   audience tag as `POLICY_AUD` in the Worker production variables.
4. Verify that an unauthenticated request returns `403` from the Worker and
   that a browser entering `/admin` is sent through the Cloudflare-hosted
   login. No custom login page or password table is added to CORU.

### 2. Build and deploy

1. Run typecheck, the full test suite, the Worker type check, and the Wrangler
   dry run.
2. Build the client assets and deploy `coru` with the production bindings,
   R2 bucket, Turso URL/token, Access variables, and cron trigger.
3. Keep `DEV_ADMIN_BYPASS` absent/false in production.

### 3. Production smoke checks

1. `GET /api/health` returns `200`.
2. `GET /api/catalog` returns the stable `200` API envelope (an empty catalogue
   is valid until real products are loaded).
3. Missing/invalid Access credentials cannot read or mutate admin endpoints.
4. The authorized browser can open `/admin`, list products/orders, and perform
   the intended admin mutations.
5. The public cart still applies the 3-for-$10 promotion, creates a pending
   order intent, opens the configured WhatsApp handoff, and leaves stock
   unchanged until the order is confirmed in admin.

### 4. Data and operations follow-up

- Load only real catalogue records through the protected admin flow; do not
  seed demo products into production.
- Configure Yummy credentials/adapter separately if exact delivery quotes are
  required. Without those credentials the UI must retain the explicit
  “confirmar por WhatsApp” fallback.
- Document the deployment version, Access application/policy, smoke evidence,
  and rollback target in `docs/OPERATIONS.md`.

## Execution result (18-09-2026)

- Cloudflare Access Free is active with the self-hosted application `CORU
  Admin`; the `CORU Owner` policy protects `/admin*` and `/api/admin/*` for the
  operator identity. The public catalogue is not behind Access. The Cloudflare
  identity provider is the only configured login method; One-time PIN was
  removed after the authenticated admin login was verified.
- Worker version `b74c1cfc-7b2f-4961-aaf8-2c5024267110` is published on the
  `coru.systems` custom domain with the production Turso URL, R2 binding and
  Access variables.
- Worker version `31b79c49-ab55-449e-9881-52e78bbb4f23` supersedes it and adds the
  visible `Cerrar sesión` link in the admin header, targeting the official
  Cloudflare Access logout endpoint.
- Turso `coru-production` initially had only the v1 schema. The expansion
  `drizzle/0001_coru_fulfillment.sql` was then applied from the authenticated
  Turso SQL console, preserving existing rows and creating the delivery,
  payment, audit and abuse-counter tables plus indexes.
- The post-migration smoke passed: `/api/health` 200, `/api/catalog` 200 and
  `/api/admin/products` 302 to the Access login. An authenticated Cloudflare
  session opened the admin panel successfully; the mutation smoke remains the
  final operator check.
- Worker version `4903a0b7-ef28-4976-90eb-f48489203f21` supersedes the prior
  deployment and includes the approved CORU mascot as an SVG favicon, the
  anonymous traffic summary endpoint `/api/admin/analytics/traffic`, the
  Yummy delivery-rate disclaimer shown in checkout and WhatsApp, and the
  separated size-guide/privacy links in the storefront. The
  production smoke passed again (`health: 200`, `catalog: 200`, `admin guard:
  302`). Yummy remains behind its server-side adapter until Yummy supplies the
  official endpoint contract and credentials; the WhatsApp fallback stays
  available.

## Stop/rollback conditions

- Stop before deployment if Access issuer/audience values or required Turso
  secrets are unavailable.
- Roll back the Worker to the last known-good deployment if `/api/health` or
  `/api/catalog` fails, or if an authorized Access session cannot reach admin.
- Never enable the local admin bypass on the public hostname.
