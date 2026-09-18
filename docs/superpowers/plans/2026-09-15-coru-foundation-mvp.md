# CORU Foundation + Interactive MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the documentation-only CORU handoff into a runnable, responsive Store/Admin vertical slice that demonstrates the approved purchase journey while preserving the business boundaries required for the later Cloudflare Worker implementation.

**Status:** Tasks 1–21 have local/demo coverage and are locally verified. Turso hydration, durable mutation hooks, the migration command, Photoroom, Worker-backed catalog/orders hydration and the Worker-backed WhatsApp CTA are connected behind explicit production bindings; the Binance P2P rate adapter is built in and Playwright golden-flow tests pass locally. The Worker is published as `coru` with static assets, the private production R2 bucket `coru-media-production`, the `coru-production` Turso database and the custom domain `coru.systems` configured. The domain nameserver delegation is propagating; the production database is intentionally empty until real catalog content is loaded, and commercial traffic plus the security gate remain deferred.

**Architecture:** A strict TypeScript React/Vite SPA owns presentation and a small local domain layer owns catalog, cart, promotion, currency and order-intent behavior. The UI is route-aware without coupling business calculations to components; the Hono Worker owns API authority and selects optional Turso/R2/Photoroom/rate adapters through explicit bindings, while the Vite preview retains a local fallback.

**Tech Stack:** pnpm, React, TypeScript strict, Vite, Hono, Vitest, Testing Library, Font Awesome package icons, CSS custom properties based on `design/DESIGN.md`.

**Spec:** `README.md`, `design/DESIGN.md`, `doc/SPEC_PLAN.md`; `doc/SPEC.md` is retained unchanged and currently corrupted (one repeated `R9|Design source|...` record), so no implementation rule is inferred from it.

## Global Constraints

- Light mode only; no dark-mode toggle, tokens or OS adaptation.
- Use exact supplied CORU brand geometry; do not redraw the mascot.
- Store is mobile-first; layouts reorganize at 640/768/1024/1280px rather than merely scaling.
- Public product availability requires active product, positive stock and an approved primary image.
- Product has one informational `size_label`; no variants or size selector.
- USD cents are canonical; the 3×$10 promotion is automatic, mixed and repeatable.
- Bs display is optional and never exposes provider, Binance, BCV or “official rate”.
- Pending order intents do not reserve or decrement stock; confirmation is the later sale operation.
- Interactive targets are at least 44×44px, keyboard operable and labelled.
- Mint is reserved for action, selection, promotion, focus and confirmation; avoid invented controls.

---

### Task 1: Runtime scaffold and build contract

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/main.tsx`
- Create: `src/worker/app.ts`
- Create: `src/worker/index.ts`
- Create: `tests/health.test.ts`

**Interfaces:**
- Produces `GET /api/health → { data: { ok: true } }`.
- Produces scripts `dev`, `build`, `preview`, `typecheck`, `test`.

- [ ] **Step 1: Write the failing health test**

```ts
import { describe, expect, it } from 'vitest'
import { app } from '../src/worker/app'

describe('health contract', () => {
  it('returns the stable success envelope', async () => {
    const response = await app.request('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ok: true } })
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm test -- tests/health.test.ts`
Expected: FAIL because the Hono app and package scripts do not exist.

- [ ] **Step 3: Add the minimal Vite/React/Hono runtime**

Define the package scripts and strict compiler options. Export a Hono `app` from `src/worker/app.ts`, mount `/api/health`, and export the Cloudflare-compatible default handler from `src/worker/index.ts`. Mount React from `src/main.tsx` and keep the initial root element empty until Task 2.

- [ ] **Step 4: Run typecheck, build and the focused test**

Run: `pnpm typecheck`; `pnpm test -- tests/health.test.ts`; `pnpm build`
Expected: all commands PASS and the client bundle contains no server-only environment names.

- [ ] **Step 5: Commit**

```bash
git add package.json index.html tsconfig.json vite.config.ts src tests
git commit -m "chore: scaffold CORU cloudflare app"
```

### Task 2: Brand assets, tokens and route shell

**Files:**
- Create: `public/brand/coru-mascot.svg`
- Create: `public/brand/coru-wordmark.svg`
- Create: `src/client/design/tokens.css`
- Create: `src/client/design/globals.css`
- Create: `src/client/app/App.tsx`
- Create: `src/client/app/router.ts`
- Modify: `src/main.tsx`
- Test: `tests/router.test.tsx`

**Interfaces:**
- `resolveRoute(pathname: string)` returns `home | product | privacy | admin | not-found`.
- `App` renders route shells without changing `window.location` for internal navigation.

- [ ] **Step 1: Write route and light-mode tests**

```tsx
import { describe, expect, it } from 'vitest'
import { resolveRoute } from '../src/client/app/router'

describe('route shell', () => {
  it('maps the public and admin paths', () => {
    expect(resolveRoute('/')).toBe('home')
    expect(resolveRoute('/producto/estrella-rota')).toBe('product')
    expect(resolveRoute('/privacidad')).toBe('privacy')
    expect(resolveRoute('/admin/pedidos')).toBe('admin')
    expect(resolveRoute('/missing')).toBe('not-found')
  })
})
```

- [ ] **Step 2: Add extracted exact logo assets and token CSS**

Extract the mascot master geometry from `design/CORU_LOGO/Logo_y_Vartiantes_CORU.svg` into a transparent, viewBox-sized asset and preserve its three mint rays. Create the wordmark asset from the supplied lockup rather than retyping it in a UI font. Define every color, spacing, radius, shadow and motion variable from `design/DESIGN.md`; set `color-scheme: light` and add reduced-motion rules.

- [ ] **Step 3: Build accessible route shell and NotFound**

Implement semantic skip link, `main`, route-level live region and a plain NotFound state. Ensure all button/link hit areas are at least 44px and no dark-mode selectors or account/favorites controls exist.

- [ ] **Step 4: Run tests and inspect the bundle**

Run: `pnpm test -- tests/router.test.tsx`; `pnpm typecheck`; `rg -n "dark|theme|BCV|Binance|official" src`
Expected: route test/typecheck PASS; forbidden UI terms absent and no dark-mode implementation exists.

### Task 3: Domain model, promotion, currency and cart persistence

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/catalog.ts`
- Create: `src/shared/commerce.ts`
- Create: `src/shared/storage.ts`
- Create: `src/client/features/cart/CartContext.tsx`
- Test: `tests/commerce.test.ts`
- Test: `tests/storage.test.ts`

**Interfaces:**
- `quoteCart(lines, products): CommerceQuote` calculates subtotal, discount, total and applied 3×$10 groups.
- `convertUsdCentsToBs(usdCents, rateMicros): number` uses half-up integer rounding.
- `loadCart()/saveCart()` persist only `{ productId, quantity }` under `coru_cart_v1`.
- `createOrderIntent(lines, currency, rate)` returns a local pending reference and WhatsApp URL without changing stock.

- [ ] **Step 1: Write the promotion/currency tests**

```ts
it.each([
  [0, 0], [1, 400, 400], [2, 800, 800], [3, 1000, 1000],
  [4, 1400, 1400], [5, 1800, 1800], [6, 2400, 2000],
])('prices eligible units', (quantity, subtotal = quantity * 400, total) => {
  const result = quoteCart([{ productId: 'orbita', quantity }], demoProducts)
  expect(result.subtotalCents).toBe(subtotal)
  expect(result.totalCents).toBe(total)
})

it('converts USD cents with half-up rounding', () => {
  expect(convertUsdCentsToBs(400, 250_000_000)).toBe(100_000)
})
```

- [ ] **Step 2: Implement deterministic pure domain functions**

Keep product data and price math independent from React. Sort eligible units by descending price and product id, apply repeated groups of three at 1000 cents, leave remainders regular, and never increase the regular price. Treat stock zero as valid admin data but filter it from the public catalog.

- [ ] **Step 3: Add versioned storage and cart context**

Guard JSON parsing, reset corrupt payloads, persist currency/session/source keys, and make quantity updates clamp to available stock in the local demo. Rehydrate prices from the in-memory catalog instead of persisting prices.

- [ ] **Step 4: Run focused tests**

Run: `pnpm test -- tests/commerce.test.ts tests/storage.test.ts`
Expected: PASS, including mixed eligible/noneligible products, repeatable groups, corrupt JSON reset and rate-unavailable fallback to USD.

### Task 4: Public Store and product detail

**Files:**
- Create: `src/client/components/ui/*`
- Create: `src/client/components/store/*`
- Create: `src/client/features/catalog/StorePage.tsx`
- Create: `src/client/features/catalog/ProductPage.tsx`
- Modify: `src/client/app/App.tsx`
- Test: `tests/store.test.tsx`

**Interfaces:**
- `StorePage` composes header → promo → search → category rail → responsive product grid → cart affordance.
- `ProductCard` exposes direct add and body-to-detail navigation; it never renders a size selector.
- `CartSheet` is the mobile bottom sheet; `CartDrawer` is the desktop right drawer.

- [ ] **Step 1: Write Store interaction tests**

```tsx
it('adds three eligible rings and shows the bundle total', async () => {
  render(<StorePage />)
  await user.click(screen.getByRole('button', { name: /agregar calavera orbital/i }))
  await user.click(screen.getByRole('button', { name: /agregar estrella rota/i }))
  await user.click(screen.getByRole('button', { name: /agregar cruz orbital/i }))
  expect(screen.getByText('$10')).toBeInTheDocument()
  expect(screen.queryByLabelText(/talla|size/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Implement approved primitives and Store composition**

Use CSS tokens, Font Awesome package icons, labelled inputs, filter chips, quantity steppers and mint primary actions. Use supplied mascot/wordmark assets. Keep the Store white and product-first; do not add a hero, bottom navigation, profile, favorites or customer account UI.

- [ ] **Step 3: Implement currency/rate notice and cart overlays**

USD is the default. Bs is disabled with a nonfatal notice when no rate exists. When selected, render the exact pre-order copy below totals and before WhatsApp CTA: `Al generar tu pedido, el monto en Bs mantendrá la tasa asignada hasta finalizar hoy.`

- [ ] **Step 4: Verify responsive behavior and accessibility**

Run: `pnpm test -- tests/store.test.tsx`; `pnpm build`
Manually inspect 390px and 1440px layouts: 2/4-column grids, floating cart on mobile, bottom sheet on mobile, right drawer on desktop, Escape closes overlays and focus returns to the trigger.

### Task 5: Local WhatsApp order-intent feedback

**Files:**
- Create: `src/client/features/orders/orderIntent.ts`
- Create: `src/client/components/store/OrderCreatedFeedback.tsx`
- Modify: `src/client/components/store/CartOverlay.tsx`
- Test: `tests/order-intent.test.tsx`

**Interfaces:**
- `createOrderIntent` is idempotent for one generated key and returns `{ reference, status: 'PENDING', whatsappUrl, currency, totalCents }`.
- `OrderCreatedFeedback` shows reference/rate lock and a fallback `Abrir WhatsApp` button without creating another order.

- [ ] **Step 1: Write duplicate/fallback tests**

Test that double-clicking the CTA returns one reference, stock remains unchanged, Bs feedback includes `Tasa asegurada para tu pedido hasta finalizar hoy.`, and USD feedback does not.

- [ ] **Step 2: Implement idempotent local intent store and structured message**

Normalize duplicate lines, recalculate the quote, capture the selected rate for Bs, create `CORU-000001`-style references, and encode an explicit message containing reference, line snapshots, promotion and totals. Keep provider metadata out of the URL and UI.

- [ ] **Step 3: Implement popup-blocked fallback and success state**

Disable the CTA while creating, attempt `window.open` once, retain the response in component state, and expose the fallback link without repeating the creation function.

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/order-intent.test.tsx`; `pnpm typecheck`
Expected: PASS.

### Task 6: Admin operational shell

**Files:**
- Create: `src/client/features/admin/AdminShell.tsx`
- Create: `src/client/features/admin/AdminPages.tsx`
- Create: `src/client/components/operations/*`
- Modify: `src/client/app/App.tsx`
- Test: `tests/admin.test.tsx`

**Interfaces:**
- Admin nav order: Resumen, Productos, Categorías, Promociones, Pedidos, Analítica, Ajustes.
- `AdminShell` renders sidebar→drawer on narrow screens and keeps the Store/Admin token source shared.
- Order statuses are explicit: Pendiente, Venta concretada, Descartado.

- [ ] **Step 1: Write admin navigation and status tests**

Assert all seven navigation labels, responsive entity cards instead of compressed mobile tables, and disabled terminal actions.

- [ ] **Step 2: Implement dashboard, products, categories and promotions views**

Use metric cards, AdminEntityCard, inventory field/badges, image state, active state, promo eligibility, category ordering and the 1/2/3/6 promotion preview. Keep forms labelled and keyboard operable.

- [ ] **Step 3: Implement Pedidos list/detail and explicit transitions**

Render reference/date/items/total/currency/rate-state/status/actions; detail shows snapshots and rate notice. In the local demo, Concretar venta changes pending → confirmed and decrements in-memory stock exactly once; Descartar changes pending → discarded without stock effect; expired Bs blocks confirmation and offers Actualizar tasa.

- [ ] **Step 4: Implement analytics, settings and operational states**

Show confirmed-only revenue, funnel/source/device/promo cards, WhatsApp/rate/store settings, plus loading/empty/error/conflict/confirmation states. Never label pending intents as sales and never show provider/BCV/Binance terminology.

- [ ] **Step 5: Run tests and build**

Run: `pnpm test -- tests/admin.test.tsx`; `pnpm typecheck`; `pnpm build`
Expected: PASS.

### Task 7: Verification and handoff

**Files:**
- Create: `docs/IMPLEMENTATION_STATUS.md`
- Modify: `README.md` only if commands or actual paths need clarification; do not rewrite product rules.
- Test: `tests/e2e/golden-flow.spec.mjs`

- [x] **Step 1: Add Playwright golden-flow coverage**

Prepared the 390px three-ring → `$10` → Bs notice → pending WhatsApp reference flow and the 1440px Store/Admin smoke flow. The suite is excluded from Vitest and runs when `@playwright/test` plus a browser are installed.

- [x] **Step 2: Run all local gates**

`pnpm typecheck`, `pnpm test` (44 tests), `pnpm build` and `pnpm test:e2e` (2 Playwright tests) pass locally. The E2E command now handles the Windows `pnpm.cmd` shim explicitly; a missing runner/browser still produces an environment-only skip.

- [x] **Step 3: Record scope boundaries**

Documented optional Turso hydration/durable hooks, the migration command and environment publication order in `docs/OPERATIONS.md`. Cloudflare Access/security and a real deployed Worker remain outside this block. The corrupted `doc/SPEC.md` remains unmodified.
