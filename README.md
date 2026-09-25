# CORU

CORU v1 is a mobile-first web catalog for rings/accessories with a lightweight admin. Customers browse, build a cart, receive automatic bundle pricing, and continue the purchase in WhatsApp. Pressing the WhatsApp CTA first creates a **pending order intent**; the admin later marks it as a real sale or discards it. An unreviewed intent expires after 72 hours.

This repository is intentionally spec-driven.

The current expansion keeps the v1 flow and specifies two explicit fulfillment
paths: `STOCK` (available now) and `PREORDER` (bajo pedido). The documentation
contract is recovered and expanded; the fulfillment expansion is implemented —
see [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md). It does
not add customer accounts or an online payment gateway.

## Read in this order

1. `doc/SPEC.md` — machine-oriented Cavekit/Caveman contract; business/technical authority.
2. `design/DESIGN.md` — visual/UI authority.
3. `doc/SPEC_PLAN.md` — implementation sequence.
4. `design/CORU_Design_System_v1.html` — supplied visual prototype/reference.
5. approved logo/mascot assets in `design/CORU_LOGO/` and `public/brand/`.

`doc/SPEC.md` was recovered from the readable pre-expansion contract
`CORU_SPEC_ANTES_DE_ULTIMA_EXPANSION.md` and then extended monotonically
(`C79+`, `I94+`, `R10+`, `V71+`, `T23+`). The malformed download contained
only 1,055 copies of one `R9` record; its unique design-source fact is retained
as `R10`. The superseded short rewrite remains recoverable at
`doc/SPEC.rewrite-backup-2026-09-18.md`.

If UI reference conflicts with the spec:
- behavior/business rules → `doc/SPEC.md`
- visual presentation → `design/DESIGN.md`
- explicit v1 overrides in these docs win over older prototype states

## Core STOCK flow

```text
Instagram / Facebook / WhatsApp / direct
               ↓
            Catalog
               ↓
       Product / Add direct
               ↓
             Cart
               ↓
       Promo calculated
               ↓
        USD or Bs display
               ↓
      Pedir por WhatsApp
               ↓
 server creates PENDING order
               ↓
       WhatsApp conversation
               ↓
        Admin / Pedidos
          ↙          ↘
   Concretar       Descartar / vence a las 72 h
      ↓                         ↓
 decrement stock atomically
      ↓
 CONFIRMED = real sale
      ↓
 cancel-sale (si hace falta)
      ↓
 CANCELLED + devolución atómica de stock
```

## Important v1 decisions

### Product model
- one size per ring (`size_label`)
- no variants table
- STOCK has real integer stock
- STOCK with stock 0 hides publicly; PREORDER visibility ignores stock
- USD cents canonical

### Promo
Initial:
- 3 rings for $10
- mixed eligible rings
- repeatable
- automatic
- no coupon
- server authoritative

### Currency
- customer chooses `USD | Bs`
- Bs uses an internally retrieved current rate
- **the UI never names the source and never calls it BCV/official**
- if a Bs order is generated, its rate is locked until end of that day in `America/Caracas`
- later live rate changes do not change that existing order
- next day a still-pending Bs order needs rate refresh before sale confirmation

### Orders
Statuses:
- `PENDING`
- `CONFIRMED`
- `DISCARDED`
- `CANCELLED`

Pending:
- created immediately before WhatsApp opens
- does not reserve stock
- does not decrement stock
- remains pending until Admin reviews it
- automatically becomes `DISCARDED` after 72 hours if still unreviewed

Confirmed:
- represents a real sale
- STOCK decrements stock exactly once
- all STOCK changes happen atomically; PREORDER never changes inventory

Discarded:
- no stock effect
- means an intent never became a sale, whether rejected by Admin or expired

Cancelled:
- means a previously confirmed sale was later undone
- requires an Admin reason and immutable audit entry
- STOCK restores the exact sold quantities once through atomic reversal movements
- PREORDER never restores stock because it never decremented inventory

### Order-intent abuse protection

The public order endpoint keeps idempotency and also uses server-side device/IP
limits. The server issues a signed, opaque `HttpOnly` device cookie; a client
cannot choose a trusted device identifier. Default limits are 5 new intents per
device per rolling hour, 15 per device per rolling day and 10 per IP per rolling
hour. A valid idempotent replay returns the existing order without using another
slot.

Only short-lived HMAC digests are stored for these counters (maximum 24 hours),
never raw IPs or raw device tokens, and they do not enter orders or analytics.
A blocked request returns `429`, `Retry-After` and a clear retry duration while
preserving the cart; unavailable protection fails closed with `503`.

## Fulfillment expansion (v1.1)

### STOCK and PREORDER

Every product declares one fulfillment type:

- `STOCK`: public visibility and confirmation require positive real stock;
  confirmation decrements inventory once.
- `PREORDER`: public visibility and confirmation do not depend on stock and
  never decrement it. Store copy says **Bajo pedido**, includes the estimated
  `3–4 semanas` lead time and marks the estimate as variable, and shows the
  configured material/measurements without exposing provider, import or
  logistics details.

PREORDER uses one global 50/50 rule. The server calculates
`floor(totalUsdCents / 2)` as the deposit and the remainder as the balance.
USD is canonical; a Bs deposit uses the rate at the time it is recorded and a
later balance uses the rate current at that later payment. There is no
per-product percentage and no automatic charge.

PREORDER lifecycle stages are `AWAITING_DEPOSIT`, `IN_PROCESS`, `READY`,
`DELIVERED` and `CANCELLED`, with payment states `UNPAID`, `DEPOSIT_PAID` and
`PAID`. Admin records deposits/balances manually and a delivery cannot be
marked delivered before the balance is paid. Delivery is intentionally unset
on the initial PREORDER request.

The PREORDER mapping is now explicit: a new request is
`PENDING + AWAITING_DEPOSIT + UNPAID`; recording the deposit atomically makes it
`CONFIRMED + IN_PROCESS + DEPOSIT_PAID`. Admin rejection or 72-hour expiry
before the deposit produces `DISCARDED + CANCELLED + UNPAID`. Cancelling a sale
after the deposit produces base/stage `CANCELLED`, preserves its payment state
for audit and never writes an inventory movement.

### Delivery for STOCK

STOCK checkout requires one of:

- `PERSONAL`: an active configured Maracaibo delivery point;
- `YUMMY`: a server-side adapter/quote when an official contract and
  credentials are available, otherwise a non-blocking “costo de delivery a
  confirmar por WhatsApp” fallback;
- `NATIONAL`: MRW or ZOOM plus state and city, with an optional office. The
  destination charge is handled operationally; CORU does not invent tariff,
  time or tracking APIs.

Shipping data is included in the STOCK WhatsApp context, but addresses,
coordinates, offices and payment notes are excluded from analytics. A mixed
cart may show both fulfillment types, but checkout creates independent orders
and never combines them into one order.

### Size guide

`/guia-de-tallas` is a direct public, mobile-first route linked from Product
Detail and the secondary/footer navigation. It explains inner diameter and
finger circumference in millimetres with accessible measurement illustrations.
It does not store a customer measurement or present an unverified
international-conversion table.

### Images
- originals stored in R2 as uploaded (no automatic background removal)
- first gallery image is the primary image; admin can reorder the gallery
- Photoroom remains an optional legacy adapter only when `PHOTOROOM_API_KEY` is set; new uploads do not require it

### Admin auth
- Cloudflare Access
- no custom username/password database
- Worker validates Access JWT for admin API

### Analytics
- anonymous
- no customer account
- shipping stores only the minimum operational delivery data required by the
  selected STOCK method
- addresses, coordinates, city/office and payment notes never enter analytics
- intent and confirmed sale are separate metrics
- discarded intents, active confirmed sales and cancelled sales remain separate
- raw IP/device identifiers and abuse counters never enter analytics
- `catalog_view` records anonymous page visits; the admin traffic view exposes
  visits, distinct sessions and pages per session through
  `/api/admin/analytics/traffic`, with 180-day retention

### Dark mode
Not part of v1 even though the supplied prototype contains experimental dark tokens.

## Stack

```text
Frontend
React
TypeScript
Vite
plain CSS tokens (custom router; no Tailwind / React Router / TanStack Query / RHF / Zod in the implemented stack)

Backend
Cloudflare Workers
Hono
Cloudflare Vite Plugin

Data
Turso / libSQL
hand-written libSQL HTTP client + SQL migrations under drizzle/
Cloudflare R2

Security
Cloudflare Access
jose JWT verification

External adapters
internal exchange-rate provider (EXCHANGE_RATE_URL relay in production)
optional legacy Photoroom when PHOTOROOM_API_KEY is set
Yummy quote adapter only after official contract/credentials; WhatsApp fallback otherwise

Testing
Vitest
Testing Library
```

## Target routes

Public:
```text
/
/producto/:slug
/guia-de-tallas
/privacidad
```

Admin:
```text
/admin
/admin/productos
/admin/productos/nuevo
/admin/productos/:id
/admin/productos/:id/imagenes
/admin/categorias
/admin/promociones
/admin/promociones/nueva
/admin/promociones/:id
/admin/pedidos
/admin/pedidos/:id
/admin/analitica
/admin/ajustes
```

## Required environment/bindings

Server only:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
TEAM_DOMAIN
POLICY_AUD
CORU_ABUSE_SECRET
EXCHANGE_RATE_URL
```

Cloudflare binding:
```text
R2 bucket for CORU media
```

Optional / conditional:
```text
PHOTOROOM_API_KEY          # legacy image processing only; not required for new uploads
YUMMY_ADAPTER_ENABLED      # false until official Yummy contract is validated
YUMMY_API_URL              # server-side; only after official docs/credentials
YUMMY_API_TOKEN            # Wrangler secret; only after official docs/credentials
```

Local-only optional:
```text
DEV_ADMIN_BYPASS=true
```

Never define that bypass in production. Before the next production deploy, set
`CORU_ABUSE_SECRET` with `npx wrangler secret put CORU_ABUSE_SECRET` (minimum
32 characters). Without it, production `POST /api/orders/whatsapp` fails closed
with `503 ORDER_INTENT_GUARD_UNAVAILABLE`.

The automatic exchange-rate provider reads Binance's official C2C VES/USDT quote through a server-side JSON endpoint and does not need a customer-visible API key. Production uses the operator-controlled, read-only relay configured in `EXCHANGE_RATE_URL` because direct Worker egress to Binance is restricted; the built-in Binance adapter remains the fallback for environments where direct access is allowed. Provider details stay server-side and are never returned by the public API. A new automatic observation that deviates more than 25% from a real observation younger than 24 hours is rejected; the last valid rate is kept.

Yummy bindings (`YUMMY_*`) match [`docs/OPERATIONS.md`](docs/OPERATIONS.md): the
non-blocking WhatsApp fallback does not require them; live quoting stays off
until official onboarding docs and credentials confirm the contract.

The Worker Cron trigger is a single schedule `*/10 * * * *` (`wrangler.jsonc`).
The same handler refreshes the automatic rate (when mode is automatic), sweeps
overdue pending orders, and runs analytics retention cleanup. Order
reads/actions also enforce the exact 72-hour threshold before doing anything
else. Invalid provider responses keep the last valid rate. When
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are present, the Worker hydrates the
isolate from Turso and persists orders, inventory, settings, rates, images and
analytics; without them it stays in the local in-memory adapter. Device/IP
abuse counters are server-only, HMAC-keyed via `CORU_ABUSE_SECRET` and expire
within 24 hours.

Operational setup and the environment publication order live in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Commands

SPEC names `pnpm` as the package manager. When pnpm is not installed, the same
scripts work with npm (`npm install`, `npm run dev`, `npm test`, …).

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm preview
pnpm worker:dev
pnpm worker:types
pnpm worker:dry-run
pnpm db:migrate # requiere TURSO_DATABASE_URL y TURSO_AUTH_TOKEN
```

There is no browser E2E suite: Playwright/Chromium was removed on 24-09-2026.
Verification is Vitest + Testing Library, `pnpm build`, `pnpm worker:dry-run`
and the post-deploy `pnpm smoke:production` against Cloudflare.

`pnpm worker:dev` starts the Hono Worker locally on port 8787 with local
bindings. `pnpm worker:types` checks the generated Wrangler bindings and
`pnpm worker:dry-run` validates the Worker/assets upload without publishing.

## Design System v1

Final visual reference:

```text
design/CORU_Design_System_v1.html
```

It contains:
- Foundations/tokens
- General UI primitives
- Store components and responsive compositions
- Commerce & Operations components for orders, inventory, rate status, conflicts and confirmations
- Admin operational patterns
- React + Tailwind implementation guardrails

The Design System is a **component library and composition reference**, not a requirement that every final product screen already exist as a mockup. Screens defined by `doc/SPEC.md` should be composed from these approved components.

Authority:
- `doc/SPEC.md` → business logic, data, flows and final feature/navigation requirements
- `design/DESIGN.md` → visual/component behavior
- `design/CORU_Design_System_v1.html` → canonical specimens

Illustrative values/copy in the HTML do not override the SPEC.

## Cavekit/Caveman workflow

`doc/SPEC.md` follows the Cavekit section structure:

```text
§G Goal
§C Constraints
§I Interfaces
§R Research
§V Invariants
§T Tasks
§B Bugs
```

During implementation:
- do not silently change `doc/SPEC.md` to make code pass
- a discovered business-rule bug should become/strengthen an invariant
- task statuses can move `.` → `~` → `x`
- after major builds, compare code against §I and §V
- keep the spec under control rather than creating multiple contradictory specs

## What v1 does NOT include

- online payments
- customer accounts
- favorites
- customer order tracking
- CRM
- POS
- invoices
- supplier management
- multi-role admin
- WhatsApp inbox/API automation
- dark mode
- multi-size variants
- percentage coupons/promos
- stock reservation from WhatsApp intent

The fulfillment expansion also deliberately excludes:

- MRW/ZOOM API tariffs, time estimates or tracking;
- a live Yummy integration without its approved official contract and
  server-side credentials;
- supplier/import/logistics disclosure for PREORDER;
- automatic payment capture, gateway integration or automatic refunds;
- customer delivery tracking, silent device geolocation or stored personal
  measurements;
- mixed STOCK+PREORDER promotions or per-product preorder percentages.

## Definition of success

A customer can:
1. arrive from social media,
2. browse rings,
3. add items,
4. see 3x$10 apply,
5. choose USD or Bs,
6. receive the rate-protection explanation in Bs,
7. create a pending order,
8. open WhatsApp with a structured message.

For the fulfillment expansion, the customer can additionally distinguish
available pieces from `Bajo pedido`, review the 50/50 PREORDER summary, choose
valid STOCK delivery context before WhatsApp, and reach the millimetre size
guide. A mixed cart preserves the unsubmitted group when the other group is
sent.

The admin can:
1. manage catalog/category/promo,
2. process product images,
3. maintain stock,
4. see pending orders,
5. discard non-sales or let unreviewed intents expire after 72 hours,
6. confirm real sales,
7. cancel a confirmed sale with a required reason and audit trail,
8. automatically reduce STOCK inventory on confirmation and restore it exactly once on STOCK cancellation,
9. handle expired Bs rates,
10. see confirmed, discarded and cancelled outcomes separately.

For the fulfillment expansion, Admin must additionally distinguish STOCK from
PREORDER, manage personal delivery points, record deposit/balance idempotently,
advance only valid PREORDER stages and report order value, cash collected and
outstanding balance separately. Recording the deposit is the precise transition
from pending intent to confirmed PREORDER sale.

That is the CORU v1.1 target.
