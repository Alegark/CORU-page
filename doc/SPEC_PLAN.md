# CORU v1 + v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use a plan-driven/TDD execution workflow. Read `SPEC.md` and `../design/DESIGN.md` before every task. Do not change product rules because a UI mockup is easier to implement.

**Goal:** Preserve CORU v1 production behavior and add PREORDER, STOCK delivery selection and a public size guide without weakening inventory, money, privacy or server-authority rules.

**Architecture:** One Cloudflare-deployed TypeScript project. React SPA serves public Store and `/admin`; Hono Worker owns all business authority and external integrations. Turso/libSQL stores business data, R2 stores originals/derivatives, Cloudflare Access protects admin paths, and domain services isolate pricing, rate, image and inventory rules.

**Tech Stack:** pnpm · React · TypeScript strict · Vite · Tailwind · React Router · TanStack Query · React Hook Form · Zod · Hono · Cloudflare Vite Plugin/Workers/Static Assets/R2/Access · Turso/libSQL · Drizzle ORM · jose · Vitest · Testing Library · Playwright.

**Spec:** `./SPEC.md`  
**Visual contract:** `../design/DESIGN.md`

## 0. Global constraints

- Light mode only.
- Public UI must never mention Binance, provider name, BCV or “official rate”.
- Product has one informational `size_label`; no variants.
- USD cents are canonical money.
- PENDING order never reserves/decrements stock and auto-discards after exactly 72 h if still unreviewed.
- CONFIRMED STOCK order decrements stock once inside one DB transaction; `cancel-sale` restores it once through linked reversal movements; PREORDER never changes inventory.
- Base order lifecycle is `PENDING → CONFIRMED → CANCELLED` for a later undone sale, or `PENDING → DISCARDED` for an intent that never became a sale.
- PREORDER becomes CONFIRMED only when Admin records its deposit atomically.
- New order intents are guarded server-side by idempotency + signed device cookie limits + IP limits; raw device/IP values never persist.
- STOCK Bs order locks its order rate until end of creation day in `America/Caracas`; PREORDER deposit and later balance each use the usable rate at their own payment time.
- Server recalculates prices/promotions/stock before creating order.
- Exact supplied CORU logo/mascot; never regenerate.
- Store and Admin share tokens but not density/layout.
- No Vercel, Supabase or Express.

---

# 1. Proposed repository map

```text
/
├─ README.md
├─ doc/
│  ├─ SPEC.md
│  └─ SPEC_PLAN.md
├─ design/
│  ├─ DESIGN.md
│  └─ CORU_Design_System_v1.html
├─ package.json
├─ pnpm-lock.yaml
├─ tsconfig.json
├─ vite.config.ts
├─ wrangler.jsonc
├─ drizzle.config.ts
├─ public/
│  └─ brand/
│     ├─ coru-logo.svg
│     └─ coru-mascot.svg
├─ drizzle/
│  └─ *.sql
├─ src/
│  ├─ client/
│  │  ├─ main.tsx
│  │  ├─ app/
│  │  │  ├─ App.tsx
│  │  │  ├─ router.tsx
│  │  │  └─ providers.tsx
│  │  ├─ design/
│  │  │  ├─ tokens.css
│  │  │  └─ globals.css
│  │  ├─ components/
│  │  │  ├─ ui/
│  │  │  ├─ store/
│  │  │  └─ admin/
│  │  ├─ features/
│  │  │  ├─ catalog/
│  │  │  ├─ cart/
│  │  │  ├─ currency/
│  │  │  ├─ promotions/
│  │  │  ├─ orders/
│  │  │  ├─ products/
│  │  │  ├─ analytics/
│  │  │  ├─ settings/
│  │  │  └─ media/
│  │  └─ lib/
│  │     ├─ api.ts
│  │     ├─ storage.ts
│  │     └─ format.ts
│  ├─ worker/
│  │  ├─ index.ts
│  │  ├─ app.ts
│  │  ├─ env.ts
│  │  ├─ middleware/
│  │  │  ├─ access.ts
│  │  │  ├─ errors.ts
│  │  │  └─ rate-limit.ts
│  │  ├─ routes/
│  │  │  ├─ public/
│  │  │  └─ admin/
│  │  ├─ services/
│  │  │  ├─ commerce.service.ts
│  │  │  ├─ inventory.service.ts
│  │  │  ├─ order.service.ts
│  │  │  ├─ exchange-rate.service.ts
│  │  │  ├─ image-processing.service.ts
│  │  │  ├─ whatsapp.service.ts
│  │  │  └─ analytics.service.ts
│  │  ├─ adapters/
│  │  │  ├─ exchange-rate/binance-p2p.adapter.ts
│  │  │  ├─ images/photoroom.adapter.ts
│  │  │  └─ media/r2.adapter.ts
│  │  └─ repositories/
│  │     ├─ product.repository.ts
│  │     ├─ category.repository.ts
│  │     ├─ promotion.repository.ts
│  │     ├─ order.repository.ts
│  │     ├─ inventory.repository.ts
│  │     ├─ settings.repository.ts
│  │     └─ analytics.repository.ts
│  ├─ db/
│  │  ├─ client.ts
│  │  ├─ schema/
│  │  │  ├─ categories.ts
│  │  │  ├─ products.ts
│  │  │  ├─ product-images.ts
│  │  │  ├─ promotions.ts
│  │  │  ├─ orders.ts
│  │  │  ├─ inventory-movements.ts
│  │  │  ├─ order-status-audit.ts
│  │  │  ├─ order-intent-rate-counters.ts
│  │  │  ├─ exchange-rates.ts
│  │  │  ├─ settings.ts
│  │  │  └─ analytics-events.ts
│  │  └─ schema.ts
│  └─ shared/
│     ├─ contracts/
│     ├─ schemas/
│     ├─ types/
│     └─ constants/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
```

---

# 2. Task sequence

## Task 1 — Scaffold runtime and developer contract

**Files**
- Create `package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`.
- Create `src/client/main.tsx`, `src/worker/index.ts`, `src/worker/app.ts`.
- Create `src/worker/env.ts`.
- Test `tests/integration/health.test.ts`.

**Produces**
- One Vite dev command running React + Worker in workerd.
- Hono `GET /api/health`.
- Typed Cloudflare bindings.
- scripts: `dev`, `build`, `preview`, `test`, `test:e2e`, `typecheck`, `lint`, `db:generate`, `db:migrate`, `deploy`.

**Acceptance**
- `pnpm typecheck` passes.
- `pnpm build` produces static client + Worker.
- `GET /api/health` → 200 `{data:{ok:true}}`.
- No secret appears in client build.

**Commit:** `chore: scaffold CORU cloudflare app`

---

## Task 2 — Design tokens, brand assets and routing shell

**Files**
- Create `src/client/design/tokens.css`, `globals.css`.
- Create `src/client/app/router.tsx`.
- Create shared UI primitives under `src/client/components/ui/`.
- Copy approved logo/mascot into `public/brand/`.

**Rules**
- Do not implement dark mode.
- Preserve supplied SVG geometry.
- Use semantic CSS vars from DESIGN.
- Install Font Awesome packages; no CDN in production.

**Routes**
- `/`
- `/producto/:slug`
- `/privacidad`
- `/admin/*`

**Tests**
- component test verifies 44px minimum primary action.
- router test verifies unknown public route → NotFound.
- snapshot/DOM test verifies no dark-mode toggle.

**Commit:** `feat: add CORU visual foundation`

---

## Task 3 — Database schema and migrations

**Files**
- `src/db/schema/*.ts`
- `src/db/client.ts`
- `drizzle.config.ts`
- generated `drizzle/*.sql`.

**Tables**
- categories
- products
- product_images
- promotions
- orders
- order_items
- inventory_movements
- exchange_rates
- store_settings
- analytics_events

**Critical checks**
- `price_cents >= 0`
- `stock_quantity >= 0`
- `quantity > 0`
- unique product slug/SKU
- unique order reference/idempotency key
- order status enum/check
- `expires_at = created_at + 72 h` for new orders; cancellation/discard/audit fields
- one `SALE_REVERSAL` per original `SALE` movement
- ephemeral HMAC-only antiabuse counters expire within 24 h
- indexes from SPEC §I78.

**Tests**
- migration applies to clean libSQL DB.
- uniqueness/check constraints fail as expected.

**Commit:** `feat: define CORU database schema`

---

## Task 4 — API contracts, validation and error envelope

**Files**
- `src/shared/schemas/*`
- `src/shared/contracts/*`
- `src/worker/middleware/errors.ts`
- `src/worker/routes/public/index.ts`
- `src/worker/routes/admin/index.ts`.

**Contract**
```ts
type ApiSuccess<T> = { data: T }

type ApiError = {
  error: {
    code: string
    message: string
    details?: unknown
  }
}
```

**Rules**
- Zod validates body/query/params.
- UI branches on `error.code`, not message.
- 422 validation; 404 absent; 409 business conflict; 429 throttle; 503 external dependency.
- never echo stack/secret.

**Tests**
- invalid order quantity → 422.
- unknown route → stable error.
- handler exception → 500 generic error.

**Commit:** `feat: add typed API contracts`

---

## Task 5 — Cloudflare Access middleware

**Files**
- `src/worker/middleware/access.ts`.
- Protect all admin route groups.

**Implementation contract**
- read `Cf-Access-Jwt-Assertion`.
- `jose.createRemoteJWKSet(TEAM_DOMAIN/cdn-cgi/access/certs)`.
- `jwtVerify` with issuer=`TEAM_DOMAIN`, audience=`POLICY_AUD`.
- fail closed when env/header invalid.
- local dev bypass allowed only when explicit `DEV_ADMIN_BYPASS=true` and environment is local; production config must not define it.

**Tests**
- missing token → 403.
- wrong AUD → 403.
- valid mocked JWKS token → handler.
- public API untouched.

**Commit:** `feat: secure admin API with Cloudflare Access`

---

## Task 6 — Category and product repositories + catalog API

**Files**
- repositories for categories/products.
- public catalog/product routes.
- admin category/product CRUD routes.

**Availability query (STOCK baseline; Task 25 extends PREORDER)**
```text
is_active = true
AND primary_image_id IS NOT NULL
AND (
  fulfillment_type = PREORDER
  OR (fulfillment_type = STOCK AND stock_quantity > 0)
)
```

**Public product DTO excludes**
- stock exact count
- internal image keys
- admin flags
- audit fields.

**Admin DTO includes**
- stock
- image status
- promo eligibility
- active state.

**Tests**
- STOCK with stock 0 absent catalog; PREORDER with stock 0 remains eligible.
- inactive absent catalog.
- no image absent catalog.
- admin still sees all.
- pending historical order unaffected by product rename later.

**Commit:** `feat: add catalog and product management`

---

## Task 7 — Inventory service and stock admin

**Files**
- `inventory.service.ts`
- `inventory.repository.ts`
- admin stock route.
- Product editor/list additions.

**Interface**
```ts
setStock(productId, quantity, note?)
adjustStock(productId, delta, note?)
consumeForOrder(tx, orderItems)
```

**Rules**
- manual changes write `inventory_movements`.
- sale movement type `SALE`.
- manual set computes delta from before/after.
- negative result rejected.
- InventoryField/stock actions apply only to STOCK; PREORDER hides/disables inventory management and never writes SALE movements.

**UI**
- Products table column `Stock`.
- badges `En stock` / `Agotado`.
- product form numeric stock field.
- stock=0 is not product deletion.

**Tests**
- set 3→1 writes delta -2.
- adjust -4 when 1 → 409.
- stock 0 hides public product.

**Commit:** `feat: add inventory tracking`

---

## Task 8 — Image storage and gallery ordering

**Files**
- R2 adapter.
- direct original image upload endpoint.
- `sort_order` persistence and reorder endpoint.
- admin gallery UI with previews and up/down controls.

**Input**
- JPG/PNG/WEBP.
- max 15MB.
- original always saved first.

**Display guidance**
- recommend 1200×1200 px in the admin UI.
- preserve the uploaded composition and background exactly as provided.

**R2 keys**
```text
products/{productId}/original/{imageId}.{ext}
```

**Failure**
- the original is the public approved variant for new uploads.
- legacy processed records remain readable for compatibility.
- allow retry.
- allow approve original.

**Tests**
- provider mocked.
- R2 failure leaves DB consistent.
- processing failure retains original.
- unapproved image never public.

**Commit:** `feat: add product image pipeline`

---

## Task 9 — Promotion engine

**Files**
- `commerce.service.ts`
- promotion repository/routes.
- unit tests with table cases.

**Core type**
```ts
type CommerceQuote = {
  subtotalCents: number
  discountCents: number
  totalCents: number
  appliedPromotion?: {
    id: string
    name: string
    groupsApplied: number
  }
}
```

**3x$10**
- eligible category Anillos.
- group size 3.
- bundle price 1000.
- repeated groups.
- eligible units sorted price descending/tie product id.
- remainder regular.

**Mandatory test matrix**
- 0→0
- 1×400→400
- 2×400→800
- 3×400→1000
- 4×400→1400
- 5×400→1800
- 6×400→2000
- mixed eligible/noneligible.
- varying eligible prices.
- bundle never increases price.
- overlap rejected admin.
- fulfillment groups priced separately; bundle never mixes STOCK and PREORDER units.

**Commit:** `feat: add deterministic promotion engine`

---

## Task 10 — Exchange-rate service

**Files**
- `exchange-rate.service.ts`
- provider interface.
- internal P2P adapter.
- exchange rate repository.
- scheduled handler.
- admin rate routes.

**Public behavior**
- `/api/exchange-rate` exposes rate/mode/timestamp/availability only.
- never provider label.

**Refresh**
- scheduled every 10 minutes.
- validate rate >0 and parse exact decimal.
- convert to `rate_micros`.
- invalid response does not replace prior rate.
- manual mode bypasses provider for customer calculation.
- admin manual rate validated >0.

**Bs conversion**
```text
ves_minor = roundHalfUp(usd_cents * rate_micros / 1_000_000)
```

**Tests**
- $4 at 250 → Bs 1,000.00.
- provider 0/NaN rejected.
- fallback last valid.
- no rate + VES intent → RATE_UNAVAILABLE.
- USD unaffected.

**Commit:** `feat: add internal Bs conversion rate`

---

## Task 11 — Cart, currency and privacy state

**Files**
- cart context/reducer.
- currency provider.
- storage helpers.
- `PrivacyNotice`.
- source normalization helper.

**Storage**
- `coru_cart_v1`
- `coru_currency_v1`
- `coru_privacy_notice_v1`
- session `coru_session_v1`
- session `coru_source_v1`

**Rules**
- corrupt local JSON resets.
- cart stores `{productId,quantity}` only; prices rehydrate from server.
- Bs toggle requests current rate.
- if rate unavailable, display USD and disable Bs with nonfatal message.

**Tests**
- persistence/version migration.
- corrupt storage.
- source query normalization.
- privacy notice dismiss.

**Commit:** `feat: add cart and currency state`

---

## Task 12 — Public Store screens

**Files**
- Catalog page.
- Product detail.
- ProductCard/Grid.
- Search/chips.
- CartSheet/Drawer/FloatingCart.
- rate notice.

**Mobile**
- 2 columns.
- filter rail horizontal.
- floating cart.
- bottom sheet.

**Desktop**
- 4 columns.
- full header/search.
- drawer.
- no floating cart required.

**Missing design addition**
`RateLockNotice(pre_order)` directly below totals and before WhatsApp CTA when selected currency = Bs. Here `pre_order` means “before order creation”; it is not the `PREORDER` fulfillment type.

**Copy**
> Al generar tu pedido, el monto en Bs mantendrá la tasa asignada hasta finalizar hoy.

**Tests**
- add direct from ProductCard.
- card click opens detail.
- no size selector.
- promo progress.
- keyboard drawer close.

**Commit:** `feat: build CORU storefront`

---

## Task 13 — WhatsApp order-intent creation

**Files**
- `order.service.ts`
- order repository.
- WhatsApp service.
- `POST /api/orders/whatsapp`.

**Server steps**
1. require `Idempotency-Key`; valid replay returns the existing order before consuming a limiter slot.
2. validate/reissue signed opaque `coru_device` cookie; never trust a body/header device id.
3. normalize and validate request/product lines.
4. atomically reserve an abuse slot: device max 5/60 min and 15/24 h; IP max 10/60 min.
5. reject hidden/missing; require stock only for STOCK; require active+approved image for PREORDER.
6. calculate server quote.
7. if VES, get usable rate and snapshot.
8. determine Caracas rate day end and order `expires_at=created_at+72 h`.
9. insert order+items transaction.
10. generate `CORU-000001`.
11. generate WhatsApp message/URL.
12. return persisted order response.

For v1.1, the endpoint rejects mixed fulfillment lines, validates STOCK shipping, omits shipping for PREORDER and generates the matching WhatsApp variant.

**No stock decrement.**

**WhatsApp message**
- reference
- item snapshots
- promo
- USD total
- if VES: Bs total + validity sentence
- no provider.

**Tests**
- duplicate idempotency returns same id.
- duplicate idempotency does not increment device/IP counters.
- 6th device/60 min, 16th device/24 h and 11th IP/60 min requests return 429 with matching positive `Retry-After` and no order.
- unsigned/malformed/deleted device cookie is never accepted as a caller-chosen key; server reissues safely.
- raw IP/device token never reaches order, analytics or durable counter rows; digest counter data expires within 24 h.
- limiter unavailable returns 503 and does not create an order.
- stale client price irrelevant.
- same-day rate change does not change order.
- double click produces one record.
- stock unchanged.

**Commit:** `feat: create WhatsApp order intents`

---

## Task 14 — Order-created Store feedback

**Files**
- `OrderCreatedFeedback`
- cart CTA flow.

**Flow**
- disable CTA while request in flight.
- on response, store transient created-order result.
- attempt to open returned WhatsApp URL.
- if browser blocks opening, show button `Abrir WhatsApp`.
- never call order endpoint again for fallback button.

**VES copy**
> Tasa asegurada para tu pedido hasta finalizar hoy.

**Tests**
- popup blocked still exposes same order ref.
- fallback does not create duplicate.
- USD order does not show rate copy.

**Commit:** `feat: add order handoff feedback`

---

## Task 15 — Admin Pedidos interface (new design surface)

**Files**
- admin nav.
- OrdersPage.
- OrderDetailPage.
- order status/rate components.

**Nav order**
```text
Resumen
Productos
Categorías
Promociones
Pedidos
Analítica
Ajustes
```

**List columns desktop**
- Ref
- Fecha
- Items
- Total
- Moneda
- Tasa state
- Status
- Actions

**Mobile**
- list cards, never compressed table.

**Detail**
- reference/status/timestamps
- item snapshots
- promo snapshot
- USD totals
- VES initial/current totals when relevant
- rate valid-until
- stock conflict warning
- pending expiry time/reason and immutable transition audit.
- actions `Concretar venta`, `Descartar`, `Actualizar tasa`, `Cancelar venta` only when allowed.
- `Cancelar venta` is destructive, requires a reason and clearly previews STOCK quantity restoration; PREORDER states that inventory is unaffected.

**Tests**
- filters.
- expired rate display.
- due PENDING is expired before display/action even if scheduled sweep is delayed.
- destructive cancellation requires reason and confirmation.
- terminal DISCARDED/CANCELLED actions disabled.

**Commit:** `feat: add admin orders workflow`

---

## Task 16 — Confirm/discard/expiry/cancel STOCK order backend

**Confirm transaction**
1. fetch `PENDING` STOCK order.
2. if VES verify rate not expired.
3. load each current product stock.
4. verify all quantities.
5. insert inventory movements.
6. decrement all stock.
7. set `CONFIRMED`, `confirmed_at`.
8. commit.

**Discard**
- PENDING→DISCARDED only.
- stock unchanged.
- require reason for Admin discard and write status audit.

**Pending expiry**
- set `expires_at=created_at+72 h` on creation.
- scheduled sweep every 15 minutes plus lazy enforcement on reads/actions.
- PENDING→DISCARDED with fixed reason `EXPIRED_UNREVIEWED`, system audit and no stock/payment changes.

**Cancel confirmed sale**
1. require `Idempotency-Key`, non-empty reason and current status CONFIRMED.
2. lock order and original SALE movements.
3. create one linked `SALE_REVERSAL` per SALE line with exact opposite quantity.
4. restore all STOCK quantities and set CANCELLED in the same transaction.
5. write actor, reason and timestamp to immutable status audit.
6. rollback everything on any failure; same-key retry returns same result.

**Refresh rate**
- PENDING+VES only.
- load current usable rate.
- preserve initial.
- update current rate/total/validity to current Caracas day end.

**Tests**
- exact-once confirmation.
- two pending orders last unit: first pass, second 409.
- rate expired 409.
- refreshed rate then confirm.
- 72 h boundary and delayed-cron lazy expiry.
- confirm-vs-expiry/discard concurrency commits exactly one transition.
- cancellation restores exact quantities once; retry/concurrency cannot double-restock.
- PREORDER cancellation writes no movement.
- CONFIRMED cannot be hidden as DISCARDED; DISCARDED/CANCELLED remain terminal.

**Commit:** `feat: confirm CORU sales atomically`

---

## Task 17 — Admin products/categories/promotions UI completion

**Product UI**
- stock field.
- stock column/badge.
- image state.
- active.
- promo eligibility.

**Category UI**
- CRUD.
- reorder.
- active state.

**Promotion UI**
- list.
- editor.
- bundle/fixed-discount modes.
- target category/products.
- quantity/benefit.
- mixed/repeat/banner.
- 1/2/3/6 quantity preview.
- overlap errors.

**Tests**
- forms Zod/RHF.
- server error rendering.
- responsive cards.

**Commit:** `feat: complete commerce administration`

---

## Task 18 — Analytics ingestion

**Files**
- analytics client.
- endpoint/service/repository.
- retention cron.

**Client**
- batch max 20.
- sendBeacon/fetch keepalive when appropriate.
- failures swallowed after debug log.
- session/source included.
- no customer text/phone/name.

**Retention**
- events older than 180d deleted.
- orders/inventory never deleted by analytics cleanup.

**Tests**
- body >32KB rejected.
- unknown event rejected or normalized per schema.
- PII keys explicitly denied.

**Commit:** `feat: add anonymous commerce analytics`

---

## Task 19 — Dashboard and Analytics with real sales

**Dashboard metrics**
- Productos activos
- Pedidos pendientes
- Ventas concretadas
- Ingresos confirmados
- WhatsApp intents optional secondary

**Analytics**
- catalog→product→cart→order intent funnel.
- confirmed/discarded order conversion.
- product views/add/order/confirmed units.
- source bars.
- promo started/completed/confirmed.
- device class.

**Rule**
Never label PENDING order as sale. For PREORDER, keep order value, cash actually recorded and outstanding balance separate; uncollected balance is not revenue received.

**Tests**
- confirmed-only revenue.
- discard excluded.
- date range uses Caracas business date display.

**Commit:** `feat: surface CORU commerce analytics`

---

## Task 20 — Settings

**Sections**
- WhatsApp: E.164 destination + message intro.
- Moneda: current rate, last update, Automatic/Manual, refresh.
- Store: name/social links/privacy link.

**Never display**
- provider name
- Binance
- BCV
- “official”.

**Rate mode UI**
Automatic/Manual only.

**Tests**
- manual rate valid positive.
- provider metadata absent JSON and DOM.
- phone validation.

**Commit:** `feat: add store settings`

---

## Task 21 — Error, empty, stock-race and privacy states

Implement explicit UX for:
- catalog loading/error/empty.
- product not found.
- cart empty.
- product went out of stock.
- rate unavailable.
- rate expired admin.
- pending order due/expired.
- order intent 429 with server retry duration.
- order intent guard unavailable 503 without cart loss.
- confirmed sale cancellation success/conflict.
- image process failed.
- no analytics.
- no orders.
- delete confirmation.
- save success/error.
- privacy notice.

**Commit:** `feat: complete operational states`

---

## Task 22 — E2E golden paths

**Playwright scenarios**

### Golden mobile
1. open 390px viewport.
2. add 3 eligible rings.
3. assert total $10.
4. switch Bs.
5. assert pre-order rate notice.
6. click WhatsApp.
7. assert order ref+locked notice.
8. intercept navigation if necessary.
9. open admin mocked/auth test environment.
10. confirm order.
11. assert stock decremented and sold-out product absent Store.

### Inventory race
- stock=1.
- create order A + B.
- confirm A.
- confirm B → conflict.

### Rate
- create VES order @250.
- provider becomes260 same day.
- detail remains250.
- advance next day.
- confirm blocked.
- refresh→260.
- confirm succeeds.

### Desktop
- 1440 Store grid/drawer.
- admin Orders table.

**Commit:** `test: cover CORU critical flows`

---

## Task 23 — Security, accessibility and performance gate

**Security**
- Access validation.
- no secrets browser.
- upload MIME+size.
- signed server-issued device cookie + atomic device/IP order-intent limits.
- no raw IP/device token/digest in orders, analytics or application logs.
- rate-limit data TTL ≤24 h and unavailable guard fails closed.
- SQL parameterized via ORM.
- CSP/headers where compatible.
- no public R2 originals.

**Accessibility**
- axe automated smoke.
- keyboard Store/Admin.
- focus restoration drawers/modals.
- reduced motion.
- labels/error association.

**Performance**
- lazy product images.
- explicit image dimensions/aspect ratio.
- route lazy-load admin.
- avoid shipping admin bundle for first public render where practical.

**Commit:** `fix: harden CORU production quality`

---

## Task 24 — Deployment and operations

**Environments**
- local
- preview/staging
- production

**Separate**
- Turso databases
- R2 buckets/prefixes
- Access apps/AUD
- secrets.

**Production deploy order**
1. backup/confirm DB.
2. apply migrations.
3. deploy Worker/assets.
4. verify health.
5. test public catalog.
6. test admin Access.
7. verify cron/rate.
8. upload/process sample.
9. create/discard test order.

**Commit:** `chore: configure CORU deployment`

---

# 2.1 v1.1 expansion — PREORDER, delivery and size guide

The following work extends the v1 plan without changing the existing stock,
pricing, rate-lock or Access boundaries. It is intentionally ordered so that
the data contract and server invariants land before the Store/Admin controls.

**Resolved documentation gate:** `SPEC.md` R12 is closed. Implement the exact
I149 matrix: intent starts PENDING; PREORDER deposit makes it CONFIRMED;
pre-deposit discard/72-hour expiry makes it DISCARDED; cancellation after any
confirmed sale makes it CANCELLED. Do not collapse these outcomes.

## Task 25 — Fulfillment-aware domain and migration

- add `fulfillment_type` (`STOCK | PREORDER`) to products;
- add material, measurements and optional millimetre measurements;
- add fulfillment/order snapshots, lead-time, deposit/balance and payment
  records;
- add milestone timestamps `deposit_paid_at`, `ready_at`, `balance_paid_at`,
  `delivered_at`, `cancelled_at`;
- add base `CANCELLED`, `expires_at`, discard/cancel reasons, status-audit rows
  and linked SALE_REVERSAL movement uniqueness;
- add short-lived HMAC-keyed device/IP abuse counters/events with ≤24 h TTL;
- add shipping, personal delivery point and Yummy quote snapshot columns;
- protect `order_payments` with an idempotency key and one DEPOSIT/one BALANCE
  uniqueness per order;
- add reversible migrations and repository/contract validation;
- keep existing v1 products explicitly `STOCK`.

**Cites:** `SPEC.md` I112–I117, I140, I146–I147, V71, V107, V120, V124

**Commit:** `feat: add fulfillment and preorder persistence`

## Task 26 — PREORDER calculation and lifecycle service

- implement canonical USD cents total/deposit/balance math;
- convert only the deposit with the rate used at payment when paid in Bs;
- implement lifecycle/payment transitions and idempotent manual payment records;
- make record-deposit atomically move base PENDING→CONFIRMED, create the payment
  and move to `IN_PROCESS + DEPOSIT_PAID`; make mark-delivered require
  base CONFIRMED + `READY + PAID`;
- expire `PENDING + AWAITING_DEPOSIT + UNPAID` after 72 h to
  `DISCARDED + CANCELLED + UNPAID` with no payment/inventory mutation;
- cancel a post-deposit PREORDER as base/stage CANCELLED while preserving its
  payment state and writing no stock reversal;
- keep delivery unset until the item reaches `READY`;
- keep PREORDER out of stock decrement and stock conflict logic.

**Cites:** `SPEC.md` V78–V84, V112–V120, V127

**Commit:** `feat: implement preorder lifecycle and deposit accounting`

## Task 27 — Mixed-cart grouping and order-intent API

- represent STOCK and PREORDER lines together in the cart;
- split them into independent server order intents at checkout;
- preserve an unsubmitted group if the other group succeeds or fails;
- revalidate price, promotion, fulfillment and shipping server-side;
- keep WhatsApp copy distinct for each group.
- reject a stale fulfillment type and require an explicit, understandable cart
  reclassification without changing historical orders.

**Cites:** `SPEC.md` V85–V87, V99, V106

**Commit:** `feat: split mixed carts into fulfillment orders`

## Task 28 — Public PREORDER Store/Product Detail experience

- expose public PREORDER products even when inventory is zero;
- show `Bajo pedido`, `3–4 semanas`, estimated/variable copy, material and
  measurements;
- add deposit summary and terms before the WhatsApp CTA;
- keep provider, import and logistics details out of public copy;
- preserve the approved light, mobile-first CORU composition.

**Cites:** `SPEC.md` V73–V77, V99

**Commit:** `feat: add preorder storefront states`

## Task 29 — STOCK shipping selection

- require shipping selection for STOCK order creation;
- implement PERSONAL with active Maracaibo delivery points;
- implement NATIONAL with MRW/ZOOM carrier selection only; coordinate recipient,
  state/city and office details through WhatsApp;
- document NATIONAL coverage as all Venezuela and Yummy/PERSONAL initial scope
  as Maracaibo;
- preserve destination-charge and no-tariff/no-time/no-tracking rules;
- show shipping context in the generated WhatsApp message.

**Cites:** `SPEC.md` V88–V92, V96–V99

**Commit:** `feat: add stock shipping selection`

## Task 30 — Personal delivery point administration

- expose active ordered points publicly;
- add Admin CRUD for name, address, description, coordinates, schedule,
  active state and sort order;
- reject stale/deactivated point ids server-side and return a fresh list;
- render map plus accessible list using the configured coordinates only.

**Cites:** `SPEC.md` V90–V92, V108–V110

**Commit:** `feat: manage personal delivery points`

## Task 31 — Yummy adapter boundary and fallback

- create a provider adapter interface with a server-owned origin;
- use the verified official contract only when documentation and credentials
  exist;
- otherwise return an unavailable/fallback state without blocking WhatsApp;
- keep the exact fallback copy `Costo de delivery a confirmar por WhatsApp.`;
- treat quotes as referential delivery estimates, never merchandise revenue;
- invalidate a quote when the destination changes.

**Cites:** `SPEC.md` R11, V93–V95, V110–V111

**Commit:** `feat: isolate yummy delivery quote adapter`

## Task 32 — Admin product, order and payment workflows

- add the fulfillment toggle and PREORDER fields to the product editor;
- show fulfillment badges and filters in product/order lists;
- add payment recording and guarded PREORDER stage actions;
- show base order status separately from PREORDER stage/payment, following the
  exact transition matrix;
- add required-reason `Cancelar venta` with audit/timeline feedback; explain
  that PREORDER cancellation does not restore stock;
- enforce no `DELIVERED` transition before the balance is paid;
- show order value, recorded cash and outstanding balance as separate metrics;
- add delivery-point settings to Admin.

**Cites:** `SPEC.md` V80–V84, V90–V91, V105, V112–V120, V127

**Commit:** `feat: add preorder admin operations`

## Task 33 — Size guide route and measurement content

- add `/guia-de-tallas` as a direct public route;
- explain inner diameter and finger circumference in millimetres;
- implement the exact two step sequences/tips from `SPEC.md` I132–I134;
- add ring+rule/inner-diameter and finger+strip+rule vector illustrations with
  accessible text alternatives;
- link from Product Detail and the footer/secondary navigation;
- do not add unverified international conversion tables or store measurements.

**Cites:** `SPEC.md` V100–V103

**Commit:** `feat: add millimetre size guide`

## Task 34 — Analytics, privacy and acceptance coverage

- add fulfillment/shipping/preorder event names with allowlisted dimensions;
- reject addresses, coordinates, offices and payment notes from analytics;
- reject raw IP/device tokens, their HMAC digests and limiter counters from
  orders/analytics/log payloads;
- update privacy copy for delivery data and operational retention;
- add unit, integration and E2E coverage for all `SPEC.md` invariants;
- cover payment retries, milestone timestamps, fulfillment changes in cart,
  WhatsApp variants, PREORDER collected-vs-outstanding metrics, exact 72-hour
  expiry, antiabuse boundaries and confirm/discard/cancel races;
- verify reduced motion, keyboard flow, 390px and 1440px compositions.

**Cites:** `SPEC.md` V104–V110, V113–V128

**Commit:** `test: cover fulfillment delivery and size guide flows`

## Task 35 — Expansion release gate

- run typecheck, unit/integration tests, build and worker dry-run;
- apply the reversible migration before the Worker deploy;
- smoke public PREORDER, STOCK shipping and guide routes;
- smoke Admin Access, payment/lifecycle guards and delivery-point CRUD;
- smoke pending expiry, device/IP throttling response and STOCK cancellation
  stock restoration in a non-production fixture;
- verify production separately from local/preview validation.
- deployment requires a separate explicit release authorization; documentation
  completion alone is not deployment approval.

**Cites:** `SPEC.md` V71–V128

**Commit:** `chore: release fulfillment expansion`

## Follow-up — compact cart shipping selector

Read and implement `docs/superpowers/plans/2026-09-18-coru-cart-shipping-subpanel.md`.
It is the current UI/UX and contract brief for the public STOCK cart. It keeps the shipping choice
inline in the footer and expands only the options needed by Personal or Envío nacional; Yummy keeps
only its address field. Products, totals and the WhatsApp CTA remain visible. It also supersedes the older NATIONAL state/city/office inputs:
new requests require only `carrier: MRW|ZOOM`, while nullable historical snapshots remain readable.

The brief is implemented in the current working tree and covered by the responsive,
accessibility, contract and WhatsApp tests described there. It must remain part of the release
checklist before any production publication.

## Follow-up — anonymous catalog analytics

- persist an anonymous browser identifier without collecting IP, contact or device-token data;
- count `Visitantes únicos` once per identifier in the selected range;
- count `Visitas totales` from every `catalog_view` event in the selected range;
- exclude `product_view` and `size_guide_view` events from the general visit total;
- ignore historical catalog events without a visitor identifier for unique-visitor metrics;
- retain product-interest metrics separately from the general catalog visit KPI;
- keep the one-time pre-today analytics cleanup documented and disabled after execution.

**Verification:** 116 tests, typecheck, production build, Worker dry-run and Cloudflare smoke passed on 21-09-2026.

---

# 3. Definition of done

Project is not done until:

- `SPEC.md` R12/I149 mapping is implemented exactly and has no status drift;
- every SPEC §V invariant has a test or explicit manual verification;
- no stale variant/size-selector code exists;
- no dark-mode implementation exists;
- no UI exposes rate provider;
- Orders admin interface exists;
- stock is real; confirmed STOCK sales decrement once and cancelled STOCK sales restore once;
- 3x$10 server quote and Store preview agree;
- VES rate lock survives live-rate changes same day;
- expired VES rate blocks sale confirmation;
- original images and their explicit gallery order survive persistence;
- mobile 390px and desktop 1440px golden flows pass;
- Cloudflare Access blocks admin without valid JWT;
- build/typecheck/tests pass;
- `SPEC.md`, `DESIGN.md`, code and migrations have no unresolved drift.
- PREORDER and STOCK are visibly and behaviorally distinct;
- mixed carts create independent fulfillment orders without losing either group;
- STOCK shipping is selected before WhatsApp and preserves the selected context;
- PREORDER deposit/balance math and guarded manual payment lifecycle are
  covered by tests;
- unreviewed STOCK and pre-deposit PREORDER intents expire after 72 h to
  DISCARDED without stock/payment mutation;
- confirmed sales use CANCELLED, never DISCARDED, and require reason+audit;
- order-intent idempotency/device/IP abuse limits return stable retry guidance,
  fail closed and retain no raw device/IP identifiers;
- PREORDER value, collected cash and outstanding balance remain separate in
  Admin/analytics;
- `/guia-de-tallas` is reachable directly and linked from the Store;
- delivery addresses/coordinates/offices never enter analytics payloads;
- no Yummy, MRW or ZOOM integration is presented as live without an approved
  provider contract and server-side credentials.
