# CORU

CORU v1 is a mobile-first web catalog for rings/accessories with a lightweight admin. Customers browse, build a cart, receive automatic bundle pricing, and continue the purchase in WhatsApp. Pressing the WhatsApp CTA first creates a **pending order intent**; the admin later marks it as a real sale or discards it.

This repository is intentionally spec-driven.

## Read in this order

1. `doc/SPEC.md` — machine-oriented Cavekit/Caveman contract; business/technical authority.
2. `design/DESIGN.md` — visual/UI authority.
3. `doc/SPEC_PLAN.md` — implementation sequence.
4. `design/CORU_Design_System_v1.html` — supplied visual prototype/reference.
5. approved logo/mascot assets in `design/CORU_LOGO/` and `public/brand/`.

If UI reference conflicts with the spec:
- behavior/business rules → `doc/SPEC.md`
- visual presentation → `design/DESIGN.md`
- explicit v1 overrides in these docs win over older prototype states

## Core flow

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
   Concretar       Descartar
      ↓
 decrement stock atomically
      ↓
 CONFIRMED = real sale
```

## Important v1 decisions

### Product model
- one size per ring (`size_label`)
- no variants table
- real integer stock
- stock 0 hides product publicly
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

Pending:
- created immediately before WhatsApp opens
- does not reserve stock
- does not decrement stock

Confirmed:
- represents a real sale
- decrements stock exactly once
- all stock changes happen atomically

Discarded:
- no stock effect

### Images
- originals stored in R2
- existing background-removal service used through provider abstraction
- v1 adapter: Photoroom
- processed result: square, centered, white background
- admin approves processed or original

### Admin auth
- Cloudflare Access
- no custom username/password database
- Worker validates Access JWT for admin API

### Analytics
- anonymous
- no customer account
- no customer PII required
- intent and confirmed sale are separate metrics

### Dark mode
Not part of v1 even though the supplied prototype contains experimental dark tokens.

## Stack

```text
Frontend
React
TypeScript
Vite
Tailwind CSS
React Router
TanStack Query
React Hook Form
Zod

Backend
Cloudflare Workers
Hono
Cloudflare Vite Plugin

Data
Turso / libSQL
Drizzle ORM
Cloudflare R2

Security
Cloudflare Access
jose JWT verification

External adapters
internal exchange-rate provider
Photoroom image processing

Testing
Vitest
Testing Library
Playwright
```

## Target routes

Public:
```text
/
/producto/:slug
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
PHOTOROOM_API_KEY
```

Cloudflare binding:
```text
R2 bucket for CORU media
```

Local-only optional:
```text
DEV_ADMIN_BYPASS=true
```

Never define that bypass in production.

The internal automatic exchange-rate provider currently uses a public endpoint and does not need a customer-visible API key. Its name/details stay server-side.

## Planned commands

After Task 1 scaffold:

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm preview
pnpm db:generate
pnpm db:migrate
pnpm deploy
```

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

The admin can:
1. manage catalog/category/promo,
2. process product images,
3. maintain stock,
4. see pending orders,
5. discard non-sales,
6. confirm real sales,
7. automatically reduce inventory,
8. handle expired Bs rates,
9. see real confirmed-sale analytics.

That is CORU v1.
