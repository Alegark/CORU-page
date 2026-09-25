# SPEC

## §G GOAL
CORU v1.1 ! preservar tienda/admin v1 + añadir productos PREORDER, entrega STOCK y guía pública de tallas → flujos separados, simples, server-authoritative; diseño CORU exacto; Cloudflare+Turso+R2; sin checkout/pasarela/cuenta cliente/sistema logístico completo.

## §C CONSTRAINTS
- C1: stack ! React + TypeScript strict + Vite + Tailwind + Cloudflare Vite Plugin + Cloudflare Workers + Hono + Turso/libSQL + Drizzle + R2.
- C2: deploy ! Cloudflare Workers + Static Assets. ⊥ Vercel, Supabase, Express server, PostgreSQL.
- C3: SPA pública+admin ∈ mismo repo/dominio. API bajo `/api/*`.
- C4: Store ! mobile-first; desktop ! composición real, ⊥ mobile estirado.
- C5: `/admin*` + `/api/admin/*` ! Cloudflare Access; Worker admin API ! validar `Cf-Access-Jwt-Assertion` con issuer+AUD+JWKS. ⊥ auth/password DB propia v1.
- C6: admin login UI propia ∉ v1; Cloudflare Access maneja autenticación.
- C7: customer accounts/profile/favorites/history/payment gateway/checkout tradicional ∉ v1.
- C8: pedido se cierra conversando por WhatsApp; app registra intención antes de abrir WhatsApp.
- C9: USD = moneda canónica. `products.price_cents` integer ≥0. ⊥ float dinero.
- C10: Bs = presentación/importe de pedido cuando usuario elige `Bs`; tasa interna VES/USDT. UI ⊥ mencionar Binance/proveedor/“BCV”/“oficial”.
- C11: `ExchangeRateProvider` ! abstraction. Adapter v1 obtiene quote público `fiat=VES&asset=USDT&tradeType=BUY`; proveedor ⊥ expuesto en API pública/UI.
- C12: tasa automática ! refresh cron cada 10 min + botón admin refresh. última tasa válida ! cache persistente.
- C13: si tasa automática falla → última válida; si ninguna → manual si configurada; si ninguna → Bs unavailable, USD sigue funcionando.
- C14: `rate_micros` = integer VES/USD × 1_000_000. Conversión VES minor ! integer rounding determinista.
- C15: si checkout currency=`VES` → crear pedido ! snapshot tasa actual + total Bs + `rate_valid_until` fin del día `America/Caracas`.
- C16: cambio de tasa posterior el mismo día ⊥ altera pedido existente.
- C17: pedido VES PENDING con tasa vencida ⊥ confirmable hasta `refresh-rate`; refresh usa tasa vigente y actualiza total actual, preservando snapshot inicial.
- C18: aviso tasa ! solo cuando UI está en Bs: antes de crear pedido “Al generar tu pedido, el monto en Bs mantendrá la tasa asignada hasta finalizar hoy.” Después: “Tasa asegurada para tu pedido hasta finalizar hoy.”
- C19: producto v1 ! una sola talla informativa `size_label`; ⊥ variants table/size selector.
- C20: inventario STOCK ! `stock_quantity` integer ≥0 por producto.
- C21: STOCK public availability = `is_active && stock_quantity > 0 && primary_image_id != null`; stock 0 → oculto público, visible admin como `Agotado`.
- C22: PENDING order ⊥ reserva/descuenta stock.
- C23: DISCARDED order ⊥ modifica stock.
- C24: CONFIRMED STOCK order ! decrementar stock exactamente 1 vez, transacción atómica, ⊥ stock negativo.
- C25: confirmar STOCK order ! revalidar stock; insuficiente → HTTP 409 `INSUFFICIENT_STOCK`, no cambios parciales.
- C26: confirmed STOCK orders = ventas reales. PREORDER value/cash semantics follow C111. ⊥ tabla `sales` separada v1.
- C27: order intent se crea al pulsar “Pedir por WhatsApp”, antes de abrir `wa.me`.
- C28: order create ! `Idempotency-Key`; doble click/retry → mismo order, ⊥ duplicado.
- C29: order ref ! human-readable `CORU-000001` derivado de PK/sequence.
- C30: order snapshots ! nombre/SKU/talla/precio/promoción/totales; cambios futuros de producto ⊥ alteran históricos.
- C31: base order statuses = `PENDING|CONFIRMED|DISCARDED|CANCELLED`; rate expiry = estado derivado, no order status; PREORDER añade etapa operativa + estado de pago separados según I149.
- C32: edición de pedido pendiente ∉ v1. Si venta real difiere antes de concretarse → descartar intención y generar nueva intención; venta ya CONFIRMED → `cancel-sale`, ⊥ DISCARDED.
- C33: [AMEND 2026-09-24] cart ! `localStorage` versionado; currency preference ! `localStorage`; analytics session id ! `localStorage` key `coru_session_v2` with 30-min inactivity timeout + event marker `sessionModel: idle30-v1` (supersedes sessionStorage session).
- C34: promo engine ! server authority; client replica solo preview.
- C35: promo initial ! `BUNDLE_FIXED_PRICE`: category Anillos, qty=3, bundle=1000 cents, mixed=true, repeatable=true.
- C36: promo examples ! 1=$4,2=$8,3=$10,4=$14,5=$18,6=$20 cuando unit price=$4.
- C37: bundle grouping determinista: eligible units sort price desc, tie product id; cada group N → discount=`max(0,sum(unit)-bundlePrice)`.
- C38: ⊥ promo stacking v1. Admin ! impedir active overlap sobre mismo target/rango.
- C39: product/cart/order prices ! server recalculation; request client ⊥ trusted.
- C40: image upload v1 ! guardar el archivo original tal como se sube; no quitar fondo ni aplicar un procesador automático.
- C41: image input v1 = JPG/PNG/WEBP ≤15 MB; original ! R2 retained; UI recomienda 1200×1200 px sin convertirlo en requisito.
- C42: cada `product_image` ! `sort_order`; el panel permite subir/bajar imágenes y persiste el orden.
- C43: primera imagen aprobada por el flujo directo ! `primary_image_id`; el público puede recibir la galería ordenada y usa la primera como principal.
- C44: image failure ⊥ blocks editing product; product cannot be public without approved primary image.
- C45: design source ! `design/DESIGN.md` + `design/CORU_Design_System_v1.html`; if conflict functionality→SPEC, presentation→DESIGN.
- C46: brand master ! exact mascot/logo assets. ⊥ redraw/regenerate mascot; exactly 3 mint rays.
- C47: brand colors ! Mint `#39F79B`, Black `#000000`, White `#FFFFFF`, Light Mint `#E8FFF0`, Neutral `#F5F5F5`.
- C48: typography direction ! Inter Display → headings; Inter → UI/body; fallback Inter/system allowed.
- C49: dark mode ∉ v1. Ignore/remove `[data-theme="dark"]` from implementation despite reference HTML.
- C50: icons ! one family = Font Awesome Free packages; ⊥ CDN dependency in production.
- C51: accessibility ! focus visible, keyboard operable, semantic labels, target ≥44px, AA reasonable, reduced motion.
- C52: analytics ! anonymous; ⊥ name/email/phone/message content/IP persistence as business analytics data.
- C53: [AMEND 2026-09-24] analytics session id ! random UUID in `localStorage` `coru_session_v2` (30-min idle); anonymous visitor id ! `coru_visitor_v1` (`localStorage` + first-party cookie, 1 year) used only for unique-visitor counting; source normalized from `src|utm_source`: instagram|facebook|whatsapp|direct|other.
- C54: [AMEND 2026-09-24] event retention v1 = 180 days; cleanup ! runs on each cron tick (`*/10`, I64), idempotent delete of events older than 180 days; ⊥ orders.
- C55: events ! `catalog_view,product_view,add_to_cart,remove_from_cart,promotion_view,promotion_started,promotion_completed,cart_open,order_intent_created,whatsapp_checkout`.
- C56: confirmed/discarded outcomes ! derive from orders, not anonymous event claims.
- C57: privacy notice ! compact informational first-party notice; no blocking consent because v1 ⊥ third-party analytics/ads cookies.
- C58: if Meta Pixel/GA added later → explicit consent gate before load; out of v1.
- C59: public route deleted/hidden product → 404/not-found UI, ⊥ leak admin data.
- C60: admin product stock edits ! create inventory movement audit.
- C61: timezone business rules ! `America/Caracas`; ⊥ browser timezone for rate expiry.
- C62: API validation ! Zod schemas shared where useful; error envelope stable.
- C63: TypeScript `strict=true`; ⊥ `any` unless isolated adapter with comment.
- C64: pnpm ! package manager.
- C65: server state frontend ! TanStack Query; forms admin ! React Hook Form + Zod resolver; routing ! React Router.
- C66: tests ! Vitest + Testing Library; commerce/rate/order/inventory core ! unit/integration coverage before UI happy-path completion. Amended 2026-09-24: Playwright/Chromium browser E2E removed by owner decision; ⊥ browser runner in repo; post-deploy check = `smoke:production` on Cloudflare.
- C67: rate/image external calls ! timeout + structured error + retry policy; secrets server-only.
- C68: public mutation endpoints ! rate-limit at Worker/app level; analytics ! batch + payload caps.
- C69: STOCK shipping recoge solo datos mínimos del método elegido; ⊥ nombre/email/teléfono requeridos por la app; WhatsApp conversation permanece fuera de app.
- C70: store WhatsApp number/message ! configurable admin settings; phone ! E.164.
- C71: order currency = selected UI currency at intent creation (`USD|VES`).
- C72: USD order ! no rate validity requirement; VES order ! rate rules §C15–17.
- C73: admin nav ! add `Pedidos` between `Promociones` and `Analítica`.
- C74: admin Orders UI ! list/detail/actions confirmed in DESIGN; current reference HTML lacks this interface.
- C75: admin Products UI ! add stock column/field + `Agotado`; current reference HTML lacks inventory interface.
- C76: cart UI ! add Bs rate-protection copy + order-created feedback; current reference HTML lacks rate-lock state.
- C77: store/admin copy ! Spanish v1.
- C78: source repo references/examples ⊥ override this SPEC.
- C79: producto ! `fulfillment_type=STOCK|PREORDER`; visible label = `Disponible|Bajo pedido`.
- C80: PREORDER public availability = `is_active && primary_image_id != null`; `stock_quantity` ⊥ controla publicación/carrito/confirmación.
- C81: PREORDER confirm/action ⊥ inventory movement/decrement; stock permanece ≥0 pero sin semántica pública PREORDER.
- C82: PREORDER Store ! `Bajo pedido` + `Tiempo estimado de llegada: 3–4 semanas` + `El tiempo es estimado y puede variar.`; ⊥ fecha exacta/countdown/tracking.
- C83: PREORDER public ! material+medidas configuradas; ⊥ China/proveedor/vendedor/importación/courier/aduana/almacén/plataforma/costo adquisición/ruta logística.
- C84: PREORDER payment rule global v1.1 = 50% al solicitar + 50% al entregar; ⊥ porcentaje editable/financiamiento/cuotas/crédito.
- C85: PREORDER split ! `deposit_usd_cents=floor(total_usd_cents/2)`; `balance_usd_cents=total_usd_cents-deposit_usd_cents`; total = final server quote tras promo válida.
- C86: PREORDER obligations ! USD canonical snapshots; product price change ⊥ altera order.
- C87: PREORDER deposit paid in VES → current usable rate @ deposit record; expired intent rate ! refresh/recompute per existing rate rules.
- C88: PREORDER balance remains USD; paid in VES → current usable rate @ balance record; initial/deposit rate ⊥ freezes future balance.
- C89: PREORDER stages = `AWAITING_DEPOSIT|IN_PROCESS|READY|DELIVERED|CANCELLED`; payment = `UNPAID|DEPOSIT_PAID|PAID`.
- C90: valid pairs = `AWAITING_DEPOSIT+UNPAID`, `IN_PROCESS+DEPOSIT_PAID`, `READY+DEPOSIT_PAID`, `READY+PAID`, `DELIVERED+PAID`; `CANCELLED` may pair any payment state + required note if payment exists.
- C91: `record-deposit` success ! payment row + `deposit_paid_at` + `IN_PROCESS+DEPOSIT_PAID` atomically.
- C92: `mark-ready` ! `ready_at`; `record-balance` ! `balance_paid_at` + PAID; `mark-delivered` requires PAID + sets `delivered_at`; cancel ! `cancelled_at`.
- C93: PREORDER payment records manual Admin; ⊥ gateway/automatic charge/refund; cancellation after payment ! admin note, refund policy out of scope.
- C94: initial PREORDER request ! `shipping_method=null`; ⊥ address/map/Yummy/MRW/ZOOM/agency; delivery coordinated directly after READY.
- C95: ∀ order ! exactly 1 fulfillment snapshot; mixed STOCK+PREORDER cart may display both but creates 1 order per fulfillment group; submitted group success/failure ⊥ removes other group.
- C96: PREORDER `promo_eligible=false` default; explicit eligibility required; bundle ⊥ mixes STOCK+PREORDER units.
- C97: STOCK order creation ! one shipping method before WhatsApp: `PERSONAL|YUMMY|NATIONAL`.
- C98: PERSONAL ! Maracaibo + active CORU point selection; map = enhancement, accessible list ! source of truth; ⊥ device geolocation.
- C99: map provider ⊥ fixed by business model; coordinates persisted independent from renderer/provider.
- C100: YUMMY ! STOCK + Maracaibo; destination typed address required, lat/lng optional; ⊥ silent geolocation/scraping/invented private endpoint.
- C101: Yummy adapter only after official current docs+credentials validate contract; otherwise non-blocking copy = `Costo de delivery a confirmar por WhatsApp.`
- C102: Yummy quote = referential snapshot; ⊥ guaranteed/frozen/day-valid/rate-lock; destination change → stale + explicit re-quote.
- C103: Yummy quote ⊥ merchandise total/promo/revenue; optional estimated total including delivery ! informational only.
- C104: NATIONAL ! STOCK + all Venezuela; new public selection requires only carrier `MRW|ZOOM`; recipient/state/city/office details are coordinated by WhatsApp; historical location snapshots may remain nullable/readable; `Cobro a destino`.
- C105: MRW/ZOOM v1 ⊥ API/tariff/time estimate/guide creation/tracking; shipping fee ⊥ CORU total/revenue.
- C106: size guide ! public `/guia-de-tallas`, direct URL, Product Detail + footer/secondary link, mobile-first, no account/data capture.
- C107: guide units ! mm; method A inner diameter edge-interior→edge-interior, ⊥ metal thickness; method B finger circumference via non-elastic strip/thread/tape.
- C108: guide ⊥ unverified US/EU conversion table; the owner-approved CORU US 5–10 reference table (15.7–19.8 mm inner diameter and 49.3–62.1 mm circumference) is the sole approved exception and must not be expanded with inferred conversions; compare other measurements only against verified product data.
- C109: guide assets ! 2 own vector/SVG illustrations: ring+rule+inner-diameter arrows; finger+strip+mark+rule; white/black/Mint `#39F79B`; ⊥ mascot geometry reuse.
- C110: shipping/payment PII ⊥ analytics + frontend logs; store only operational minimum; privacy notice ! cover delivery data.
- C111: PREORDER metrics ! separate order value, cash collected, balance pending; uncollected balance ⊥ cash/revenue received.
- C112: fulfillment changed while cart open → server rejects stale semantics; client explains + reclassifies only via explicit understandable action; historical snapshots unchanged.
- C113: Yummy research pending ! official endpoint/input/currency/quote-id/validity/errors/rate-limits verification before live adapter.
- C114: ∀ order intent nuevo → `PENDING` hasta acción Admin válida; `expires_at=created_at+72h` UTC; al vencer sin revisión → `DISCARDED` con reason `EXPIRED_UNREVIEWED`.
- C115: auto-expiry C114 aplica STOCK PENDING y PREORDER `PENDING+AWAITING_DEPOSIT+UNPAID`; idempotente; ⊥ payment/inventory movement; fija `discarded_at`; PREORDER stage → `CANCELLED`.
- C116: PREORDER `record-deposit` = momento de concreción: `PENDING+AWAITING_DEPOSIT+UNPAID` → `CONFIRMED+IN_PROCESS+DEPOSIT_PAID`; etapas READY/DELIVERED preservan base CONFIRMED salvo `cancel-sale`.
- C117: `DISCARDED` ! solo intención nunca concretada, por Admin o vencimiento; `CANCELLED` ! venta previamente CONFIRMED anulada; ⊥ convertir CONFIRMED a DISCARDED.
- C118: Admin `cancel-sale` ! solo CONFIRMED + reason no vacío + actor/timestamp auditado; idempotency key !; repetición misma clave → mismo resultado; conflicto/otra clave tras cancelación → 409.
- C119: STOCK `cancel-sale` ! una transacción: bloquear order+movements → validar CONFIRMED → movimiento `SALE_REVERSAL` por línea enlazado al movimiento SALE → devolver cantidades → status CANCELLED; rollback total ante fallo; exactamente una reversión.
- C120: PREORDER `cancel-sale` ! `CANCELLED+CANCELLED` + payment status preservado + reason/auditoría; inventory delta=0; refund/adjustment financiero automático ∉ v1.
- C121: antiabuse order-intent defaults ! ≤5 intentos nuevos/dispositivo/60 min + ≤15/dispositivo/24 h + ≤10/IP/60 min; ventanas server-side; `Idempotency-Key` replay válido ⊥ consume cupo adicional.
- C122: device key ! cookie `coru_device` opaca aleatoria firmada por servidor, `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`; absent/invalid → reissue; body/header client device id ⊥ authority.
- C123: antiabuse privacy ! HMAC digests rotables de device token/IP, ⊥ valores raw; counter/event TTL ≤24 h; ⊥ orders/analytics/business export; secret server-only.
- C124: límite excedido → HTTP 429 `ORDER_INTENT_RATE_LIMITED` + `Retry-After` + `details.retryAfterSeconds`; no order/WhatsApp URL; UI preserves cart + states retry time.
- C125: rate check order ! resolve idempotent replay first → validate request → atomic antiabuse check/reserve → create order; failed validation ⊥ creates order; limiter unavailable → 503 `ORDER_INTENT_GUARD_UNAVAILABLE`, ⊥ fail-open.
- C126: frontend loading isolation ! Store público y Admin pueden vivir en el mismo repo/dominio, pero JS/CSS/assets exclusivos de `/admin/*` ⊥ formar parte del dependency graph inicial descargado por rutas públicas.
- C127: admin route boundary ! `/admin/*` debe cargarse detrás de lazy/module boundary o entrypoint separado equivalente; abrir `/`, `/producto/:slug` o `/guia-de-tallas` ⊥ solicitar módulos/chunks exclusivos de Admin.
- C128: admin-only dependencies ! librerías/módulos usados solo por Admin (charts, tablas complejas, gestión/procesamiento de imágenes, admin API clients/data loaders) ⊥ static import desde public entry/root; deben quedar detrás del admin boundary.
- C129: shared frontend ! Store/Admin pueden compartir tokens, UI primitives, tipos y utilidades pequeñas; shared code ⊥ arrastrar pantallas/services/dependencias exclusivas de Admin al public initial dependency graph.
- C130: public performance ! añadir funcionalidades exclusivamente administrativas ⊥ añadir su código/peso específico a JS/CSS inicial del Store; imágenes de catálogo ! derivados optimizados + lazy loading cuando estén fuera del viewport.
- C131: production bundle audit ! antes de release inspeccionar output/chunk graph de Vite + requests de red de rutas públicas y registrar tamaños de chunks públicos principales; antes de navegar a `/admin/*` ! cero requests de chunks exclusivos de Admin.
- C132: [AMEND 2026-09-24] implemented stack ! accepted deviation from C1/C65 pending owner decision: ⊥ Tailwind, React Router, TanStack Query, React Hook Form, Zod, Drizzle ORM runtime; ! custom router, custom shared validation, hand-written libSQL HTTP client, plain CSS tokens. C1/C65 remain historical targets; do not delete.

## §I INTERFACES
- I1 page: `/` → public catalog; header→promo→search→category rail→grid→floating cart mobile.
- I2 page: `/producto/:slug` → product detail; image gallery/name/price/size/promo/add.
- I3 page: `/privacidad` → concise privacy/local storage/anonymous analytics explanation.
- I4 overlay mobile: `CartSheet` ≤90dvh; lines/promo/subtotal/discount/total/rate copy/WhatsApp CTA.
- I5 overlay desktop: `CartDrawer` 420–460px; same commerce subcomponents.
- I6 page: `/admin` → dashboard.
- I7 page: `/admin/productos` → products table/cards + search/status/category/order + stock.
- I8 page: `/admin/productos/nuevo` → product editor.
- I9 page: `/admin/productos/:id` → product editor existing.
- I10 page: `/admin/productos/:id/imagenes` → original previews + recommended dimensions + explicit gallery ordering.
- I11 page: `/admin/categorias` → CRUD+ordering.
- I12 page: `/admin/promociones` → promotion list.
- I13 page: `/admin/promociones/nueva|:id` → promotion editor + rule preview.
- I14 page: `/admin/pedidos` → PENDING/CONFIRMED/DISCARDED/CANCELLED list; filters search ref/status/date/fulfillment.
- I15 page: `/admin/pedidos/:id` → snapshot items/totals/rate validity/timeline/actions.
- I16: [AMEND 2026-09-24] page: `/admin/analitica` → funnel/products/sources/promos/device/orders confirmed; KPI+timeline `whatsappIntents` ! count order records created in selected range (any status, Caracas day of `createdAt`); funnel `whatsappSessions`/`whatsappPerAddPct` remain event-based; with Turso, admin loads analytics by range (+1-day lookback) via DB, not full in-memory hydrate.
- I17 page: `/admin/ajustes` → WhatsApp/currency rate automatic|manual/store links/privacy URL.
- I18 UI: `ProductCard` props `{product,onOpen,onAdd,currency}`; no size selector.
- I19 UI: `CurrencyToggle` values `USD|VES`; label rendered `USD|Bs`.
- I20 UI: `RateLockNotice` states `pre_order|locked|expired`; visible only selected/ordered VES.
- I21 UI: `OrderCreatedFeedback` → reference + locked-until copy + fallback `Abrir WhatsApp`.
- I22 UI: `OrderStatusBadge` → Pendiente|Venta concretada|Descartado|Venta cancelada.
- I23 UI: `RateExpiredAdminNotice` → initial/current rate + old/new Bs + `Actualizar tasa`.
- I24 UI: `StockBadge` → En stock|Poco stock? optional visual|Agotado; v1 logic only numeric+out-of-stock mandatory.
- I25 UI: `PrivacyNotice` compact non-blocking; dismiss persists.
- I26 api public: `GET /api/catalog?q=&category=` → `{data:{products[],categories[],activePromotion?,currency}}`.
- I27 api public: `GET /api/products/:slug` → `{data:PublicProduct}`; 404 `PRODUCT_NOT_FOUND`.
- I28 api public: `GET /api/exchange-rate` → `{data:{available,mode:"automatic"|"manual",rate?,updatedAt?}}`; ⊥ provider name.
- I29 api public: `POST /api/orders/whatsapp` headers `Idempotency-Key: UUID` + server cookie I142; antiabuse I143-I144.
- I30 request order base: `{items:[{productId,quantity}],currency:"USD"|"VES",sessionId?,source?}` + fulfillment payload I107-I108.
- I31 response order: `{data:{orderId,reference,status,subtotalUsdCents,discountUsdCents,totalUsdCents,totalVesMinor?,rate?,rateValidUntil?,whatsappUrl}}`.
- I32 order error: 409 `{error:{code:"INSUFFICIENT_STOCK",message,details:{items:[{productId,requested,available}]}}}`.
- I33 order error: 409 `RATE_UNAVAILABLE` only for VES intent; USD flow remains available.
- I34 api public: `POST /api/analytics/events` → max 20 events/request, max body 32KB, 202.
- I35 api admin: all `/api/admin/*` ! Access middleware before handler.
- I36 api admin: `GET /api/admin/products?q=&status=&category=&sort=&page=` → paginated.
- I37 api admin: `POST /api/admin/products` → create.
- I38 api admin: `GET /api/admin/products/:id` → detail.
- I39 api admin: `PATCH /api/admin/products/:id` → fields incl `stockQuantity`.
- I40 api admin: `DELETE /api/admin/products/:id` → soft/archive preferred if referenced; hard delete only never-referenced.
- I41 api admin: `POST /api/admin/products/:id/stock-adjustments` body `{mode:"set"|"delta",quantity,note?}`.
- I42 api admin: `POST /api/admin/products/:id/images` raw/multipart → store original immediately as ready/approved + return image id/status/order.
- I43 api admin: `POST /api/admin/products/:id/images/reorder` body `{ids:string[]}` → persist explicit gallery order.
- I44 api public: `GET /api/products/:slug/images/:imageId` → serve an approved ordered image; `/image` remains the primary-image shortcut.
- I45 api admin: categories CRUD + `PATCH /api/admin/categories/reorder`.
- I46 api admin: promotions CRUD; create/update ! conflict validation.
- I47 api admin: `GET /api/admin/orders?status=&fulfillmentType=&q=&from=&to=&page=` → paginated; due PENDING lazily expires before serialization.
- I48 api admin: `GET /api/admin/orders/:id` → items/snapshots/rate validity.
- I49 api admin STOCK: `POST /api/admin/orders/:id/confirm` → atomic stock decrement + status CONFIRMED.
- I50 api admin: confirm response 409 `INSUFFICIENT_STOCK|ORDER_RATE_EXPIRED|ORDER_NOT_PENDING`.
- I51 api admin: `POST /api/admin/orders/:id/discard` body `{reason}` → PENDING→DISCARDED; PREORDER also stage→CANCELLED; reason audited.
- I52 api admin: `POST /api/admin/orders/:id/refresh-rate` → PENDING+VES only; updates current snapshot/total.
- I53 api admin: `GET /api/admin/analytics/summary?from=&to=`.
- I54 api admin: `GET /api/admin/analytics/products?from=&to=`.
- I55 api admin: `GET /api/admin/analytics/traffic?from=&to=`.
- I56 api admin: `GET /api/admin/settings`.
- I57 api admin: `PATCH /api/admin/settings` → WhatsApp/store/currency config.
- I58 api admin: `POST /api/admin/exchange-rate/refresh`.
- I59 api admin: `PUT /api/admin/exchange-rate/mode` body automatic|manual + manualRate?; response ⊥ provider name.
- I60 api: success envelope `{data:T}`; error envelope `{error:{code,message,details?}}`.
- I61 http: invalid body/query→422; unauth/invalid Access→403; missing→404; conflict→409; throttled→429; external dependency unavailable→503.
- I62: [AMEND 2026-09-24] env required prod: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `R2_* binding`, `TEAM_DOMAIN`, `POLICY_AUD`, `CORU_ABUSE_SECRET` (min 32 chars; HMAC for device cookie + abuse digests), `EXCHANGE_RATE_URL?`, `WHATSAPP_DEFAULT_NUMBER?`. Supersedes prior names `DEVICE_TOKEN_SECRET` / `ABUSE_HMAC_SECRET`. Without `CORU_ABUSE_SECRET` in production → `POST /api/orders/whatsapp` fails closed `503 ORDER_INTENT_GUARD_UNAVAILABLE`.
- I63 env internal rate adapter needs no API key for public quote endpoint; URL/constants server-only.
- I64: [AMEND 2026-09-24] cron: single schedule `*/10 * * * *` (wrangler.jsonc); same tick ! automatic rate refresh (when mode=AUTOMATIC) + overdue PENDING expiry sweep + analytics retention cleanup; action/read paths also enforce exact `expires_at`.
- I65 cron: daily analytics retention cleanup.
- I66 file: `src/client/design/tokens.css` = DESIGN token source in code; ⊥ dark tokens.
- I67 file: `src/db/schema/*` tables separated by domain.
- I68 db `categories`: `id,slug,name,is_active,sort_order,created_at,updated_at`.
- I69 db `products`: `id,sku,slug,name,description,category_id,price_cents,size_label,stock_quantity,is_active,promo_eligible,sort_order,primary_image_id,created_at,updated_at`.
- I70 db `product_images`: `id,product_id,original_key,processed_key,sort_order,status,approved_variant,mime,width,height,created_at,updated_at`.
- I71 db `promotions`: `id,name,type,target_category_id,quantity_required,bundle_price_cents,fixed_discount_cents,allow_mixed,repeatable,banner_enabled,banner_title,banner_subtitle,banner_cta,is_active,starts_at,ends_at,created_at,updated_at`.
- I72 db `orders`: `id,reference,idempotency_key,status,currency,subtotal_usd_cents,discount_usd_cents,total_usd_cents,promotion_id,promotion_name_snapshot,initial_rate_micros,current_rate_micros,initial_total_ves_minor,current_total_ves_minor,rate_locked_at,rate_valid_until,source,session_id,created_at,expires_at,confirmed_at,discarded_at,cancelled_at,discard_reason,cancel_reason`.
- I73 db `order_items`: `id,order_id,product_id,sku_snapshot,name_snapshot,size_snapshot,unit_price_cents,quantity,line_subtotal_cents`.
- I74 db `inventory_movements`: `id,product_id,order_id,type:"MANUAL"|"SALE"|"SALE_REVERSAL",reverses_movement_id?,delta,before_qty,after_qty,note,created_at`; one reversal max per SALE movement.
- I75 db `exchange_rates`: `id,rate_micros,kind:"automatic"|"manual",provider_code_internal?,fetched_at,created_at`; provider field ⊥ serialized to UI.
- I76 db `store_settings`: single row `whatsapp_number,whatsapp_message,rate_mode,manual_rate_micros,store_name,instagram_url,facebook_url,privacy_url,updated_at`.
- I77 db `analytics_events`: `id,session_id,event_name,product_id,promotion_id,order_id,source,device_class,metadata_json,occurred_at`.
- I78 db indexes ! `products(slug,sku,category_id,is_active)`, `orders(reference,status,created_at,expires_at,idempotency_key unique)`, `inventory_movements(reverses_movement_id unique where non-null)`, `analytics_events(occurred_at,event_name,product_id)`.
- I79 internal: `CommerceService.calculate(cart,products,promotions) -> CommerceQuote`.
- I80 internal: `ExchangeRateProvider.getCurrentRate() -> {rateMicros,fetchedAt}`.
- I81 internal: `ImageProcessingProvider.process(input) -> {bytes,mime,width,height}`.
- I82 internal: `OrderService.createWhatsAppIntent(input,idempotencyKey)`.
- I83 internal STOCK: `OrderService.confirm(orderId)` ! transaction.
- I84 internal STOCK: `InventoryService.adjust/consume`.
- I85 localStorage: `coru_cart_v1`, `coru_currency_v1`, `coru_privacy_notice_v1`.
- I86: [AMEND 2026-09-24] localStorage: `coru_session_v2` `{id,lastActivityAt}` (30-min idle) + `coru_visitor_v1`; sessionStorage: `coru_source_v1`; visitor also mirrored as first-party cookie `coru_visitor_v1` Max-Age=31536000. Events carrying a measured session ! `sessionModel: idle30-v1`.
- I87 public WhatsApp msg STOCK base ! reference/items/promo/USD total; if VES order → Bs total + “Monto válido con la tasa asignada hasta finalizar hoy.” + shipping variant I127-I130; ⊥ provider name.
- I88 admin order detail ! show USD always; VES fields when order currency VES.
- I89 format: USD `Intl.NumberFormat`; VES `es-VE`, 2 decimals; no hand-built thousands separators.
- I90 design breakpoint: base<640, sm≥640, md≥768, lg≥1024, xl≥1280, 2xl≥1536; content max 1240.
- I91 brand assets: `design/CORU_LOGO/Logo_y_Vartiantes_CORU.svg`, `design/CORU_LOGO/PaletaColoresCORU.svg`, approved production derivatives.
- I92 dependency: external image provider adapter swappable; core domain ⊥ import vendor SDK/types.
- I93 dependency: external rate provider adapter swappable; core domain ⊥ provider nomenclature.
- I94 page: `/guia-de-tallas` → direct public guide; 2 methods+tips+2 accessible vector illustrations; link Product Detail+footer/secondary nav.
- I95 UI: `FulfillmentBadge` → `Disponible|Bajo pedido`; contexts ProductCard/Product Detail/cart/Admin product/order.
- I96 UI: `PreorderTerms|DepositSummary` → `{totalUsdCents,depositUsdCents,balanceUsdCents,leadTime:"3–4 semanas",variant:"compact"|"detail"|"admin"}`.
- I97 UI: `ShippingMethodSelector` → single `PERSONAL|YUMMY|NATIONAL`; STOCK only.
- I98 UI: `PersonalDeliveryPointCard` → name/address/description?/schedule?/selected; list ! keyboard/selectable independent from map.
- I99 UI: `PersonalDeliveryPointMap|MapContainer` → points+selected+onSelect; provider-neutral, accessible list fallback.
- I100 UI: `DeliveryQuoteNotice` states `idle|loading|quoted|stale|unavailable|error`; copy ! estimated/subject to change.
- I101 UI: `NationalCarrierSelector` → carrier `MRW|ZOOM` only + coordination/cobro-a-destino notice; no public state/city/office inputs.
- I102 UI: `SizeGuideStep` → step number/title/short text/illustration slot.
- I103 UI: `MeasurementIllustrationContainer` → SVG/vector + accessible title/description + text fallback.
- I104 api public: `GET /api/catalog` public product adds `fulfillmentType,material?,measurementsText?,innerDiameterMm?,circumferenceMm?`; STOCK visibility uses I21, PREORDER uses C80.
- I105 api public: `GET /api/personal-delivery-points` → active points sorted only `{id,name,address,shortDescription?,latitude,longitude,scheduleText?,sortOrder}`.
- I106 api public?: `POST /api/shipping/yummy/quote` exists only behind verified official adapter; body `{addressText,latitude?,longitude?}`; origin server-owned; response `{status:"quoted",amountMinor,currency,quotedAt,externalId?}|{status:"unavailable"}`; ⊥ secret/provider internals.
- I107 order request STOCK: `{items,currency,shipping:{method:"PERSONAL",deliveryPointId}|{method:"YUMMY",addressText,latitude?,longitude?,quoteReference?}|{method:"NATIONAL",carrier:"MRW"|"ZOOM"},sessionId?,source?}`; legacy National location fields may be accepted optionally for compatibility but are not required for new orders.
- I108 order request PREORDER: `{items,currency,sessionId?,source?}`; `shipping` ! absent/null; server ! reject mixed fulfillment lines 409 `MIXED_FULFILLMENT`.
- I109 order response common adds `fulfillmentType`; PREORDER adds `depositUsdCents,balanceUsdCents,preorderStage,paymentStatus,leadTimeSnapshot`; STOCK adds shipping snapshot.
- I110 order error: 409 `FULFILLMENT_CHANGED` → `{items:[{productId,expected,current}]}`; client ! preserve cart + explain reclassification.
- I111 order error: 409 `DELIVERY_POINT_UNAVAILABLE` → current active points.
- I112 db `products` adds `fulfillment_type NOT NULL DEFAULT 'STOCK',material,measurements_text,inner_diameter_mm,circumference_mm`; mm fields nullable; PREORDER stock ignored.
- I113 db `orders` adds `fulfillment_type_snapshot NOT NULL`, `deposit_usd_cents,balance_usd_cents,preorder_stage,payment_status,lead_time_snapshot`, milestone timestamps, shipping fields I115; PREORDER fields nullable for STOCK; base mapping ! I149.
- I114 db `order_items` adds `material_snapshot,fulfillment_type_snapshot`; keeps name/SKU/size/price snapshots.
- I115 db STOCK shipping fields: `shipping_method,personal_delivery_point_id,delivery_address_text,delivery_lat,delivery_lng,delivery_quote_amount_minor,delivery_quote_currency,delivery_quote_quoted_at,delivery_quote_external_id,national_carrier,national_state,national_city,national_office_text`; all null initial PREORDER.
- I116 db `personal_delivery_points`: `id,name,address,short_description,latitude,longitude,schedule_text,is_active,sort_order,created_at,updated_at`.
- I117 db `order_payments`: `id,order_id,payment_kind:"DEPOSIT"|"BALANCE",usd_amount_cents,paid_currency:"USD"|"VES",paid_amount_minor,rate_micros?,recorded_at,note?,idempotency_key`; unique `(order_id,payment_kind)` + unique idempotency key.
- I118 api admin: personal delivery points CRUD + reorder/activate; credentials/config Yummy server-side only.
- I119 api admin: `POST /api/admin/orders/:id/record-deposit` + `Idempotency-Key`; requires base PENDING + `AWAITING_DEPOSIT+UNPAID` + not expired → payment + base CONFIRMED + `IN_PROCESS|DEPOSIT_PAID`.
- I120 api admin: `POST /api/admin/orders/:id/mark-ready`; requires `IN_PROCESS+DEPOSIT_PAID` → READY + `ready_at`.
- I121 api admin: `POST /api/admin/orders/:id/record-balance` + `Idempotency-Key`; requires `READY+DEPOSIT_PAID` → payment + PAID.
- I122 api admin: `POST /api/admin/orders/:id/mark-delivered` → requires `READY+PAID`; idempotent terminal transition.
- I123 api admin PREORDER: `POST /api/admin/orders/:id/cancel-sale` + `Idempotency-Key` body `{reason}`; requires base CONFIRMED + not DELIVERED → base/stage CANCELLED, payment preserved; ⊥ inventory/refund.
- I124 api admin: products list/editor adds fulfillment; PREORDER hides/disables stock management + reveals material/measurements/mm + fixed terms note.
- I125 api admin: orders list filter `fulfillmentType`; PREORDER detail ! stage/payment/value/deposit received/balance/request date/timeline/valid actions.
- I126 api admin analytics: PREORDER values ! expose `orderValueUsdCents,collectedUsdCents,outstandingUsdCents` separately; collected only recorded payments.
- I127 WhatsApp PERSONAL: reference/items/promo/USD(+VES) totals + `Entrega: Personal` + configured point name/address.
- I128 WhatsApp YUMMY quoted: reference/items/promo/USD(+VES) merchandise totals + destination + quoted amount/time + variable-tariff disclaimer.
- I129 WhatsApp YUMMY fallback: reference/items/promo/USD(+VES) merchandise totals + destination + `Costo del delivery: por confirmar`.
- I130 WhatsApp NATIONAL: reference/items/promo/USD(+VES) merchandise totals + carrier + `Datos del destinatario y oficina: por coordinar por WhatsApp` + `Modalidad: Cobro a destino`; historical location snapshots may be included; ⊥ tariff.
- I131 WhatsApp PREORDER: `Modalidad: Bajo pedido`, reference, items, `3–4 semanas`, total USD, deposit 50%, balance; selected Bs may include current deposit equivalent; ⊥ shipping/Yummy/MRW/ZOOM/provider/origin/logistics.
- I132 guide method A: choose fitting ring → flat surface → mm rule → measure inner edge-to-inner edge → exclude metal → repeat; result inner diameter mm.
- I133 guide method B: thin paper/non-elastic thread/flexible tape → wrap target finger without overtightening → mark meeting point → lay flat on mm rule → repeat; result approximate circumference mm.
- I134 guide tips: exact finger; allow knuckle; repeat; inner diameter only; finger size varies slightly by day; ask CORU if product measurement unclear; ⊥ medical claim.
- I135 guide illustration A: ring+rule+inner-edge arrows+`mm`; illustration B: finger+strip meeting mark+strip on rule+`mm`; alt/title ! describe measurement.
- I136: [AMEND 2026-09-24] analytics events add `size_guide_view,privacy_view,not_found_view,shipping_method_selected,yummy_quote_requested,yummy_quote_succeeded,yummy_quote_failed,preorder_intent_created,preorder_deposit_recorded,preorder_ready,preorder_completed`; product/order events may add allowlisted `fulfillment_type`.
- I137 analytics forbidden keys/data add address, coordinates, city, office, personal/payment notes, paid amounts/payment details.
- I138 UX PREORDER states: created/deposit pending/deposit recorded/in process/ready/balance pending/completed/cancelled.
- I139 UX shipping states: Yummy idle/loading/quoted/stale/unavailable/error; Personal none/selected/deactivated; National carrier missing/selected; shipping details live in a reversible nested panel.
- I140 migration: existing products/orders → `fulfillment_type=STOCK`; migration reversible; historical snapshots preserved.
- I141 api admin STOCK: `POST /api/admin/orders/:id/cancel-sale` + `Idempotency-Key` body `{reason}` → atomic status CANCELLED + SALE_REVERSAL movements + stock restore; 409 `ORDER_NOT_CONFIRMED|SALE_ALREADY_CANCELLED|SALE_REVERSAL_CONFLICT`.
- I142 http cookie: `Set-Cookie: coru_device=<opaque-signed-token>; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`; validation/server issuance ! before limiter key derivation.
- I143 internal: `OrderIntentAbuseGuard.checkAndReserve({deviceDigest,ipDigest,now,idempotencyKey})` → allowed|limited; atomic server counters C121; data TTL C123.
- I144 order error 429: `{error:{code:"ORDER_INTENT_RATE_LIMITED",message:"Has generado varios pedidos en poco tiempo. Intenta de nuevo en unos minutos.",details:{retryAfterSeconds}}}` + `Retry-After`.
- I145: [AMEND 2026-09-24] expiry: `OrderService.expirePending(now)` + lazy `expireIfDue(order,now)` → `PENDING && expires_at<=now` transitions per I149; scheduled on every `*/10` cron tick (I64), batched/idempotent; persisted conditionally when Turso is bound.
- I146 db `order_status_audit`: `id,order_id,from_status,to_status,reason,actor_type:"ADMIN"|"SYSTEM",actor_subject?,idempotency_key?,created_at`; cancellations/discards/expiry ! row.
- I147 db antiabuse store: ephemeral server counters/events keyed only HMAC digest+window/timestamps; expires ≤24 h; raw device token/IP ⊥ persisted.
- I148 UI: `OrderExpiryNotice` → due/expired copy; `RateLimitNotice` → message+retry countdown/text, cart preserved; ⊥ auto-retry loop.
- I149 order transition matrix:

|event|fulfillment|from base|from stage/payment|to base|to stage/payment|inventory|
|---|---|---|---|---|---|---|
|create intent|STOCK|none|n/a|PENDING|n/a|0|
|create intent|PREORDER|none|none|PENDING|AWAITING_DEPOSIT+UNPAID|0|
|admin confirm|STOCK|PENDING|n/a|CONFIRMED|n/a|SALE decrement|
|record deposit|PREORDER|PENDING|AWAITING_DEPOSIT+UNPAID|CONFIRMED|IN_PROCESS+DEPOSIT_PAID|0|
|mark ready / record balance / deliver|PREORDER|CONFIRMED|valid pair C90|CONFIRMED|next valid pair C90|0|
|admin discard|STOCK|PENDING|n/a|DISCARDED|n/a|0|
|admin discard|PREORDER|PENDING|AWAITING_DEPOSIT+UNPAID|DISCARDED|CANCELLED+UNPAID|0|
|72h expiry|STOCK|PENDING|n/a|DISCARDED|n/a|0|
|72h expiry|PREORDER|PENDING|AWAITING_DEPOSIT+UNPAID|DISCARDED|CANCELLED+UNPAID|0|
|cancel-sale|STOCK|CONFIRMED|n/a|CANCELLED|n/a|SALE_REVERSAL restore|
|cancel-sale|PREORDER|CONFIRMED|IN_PROCESS\|READY + DEPOSIT_PAID\|PAID|CANCELLED|CANCELLED + payment preserved|0|

## §R RESEARCH
id|topic|finding|src
R1|Cavekit format|SPEC root; fixed §G/§C/§I/§R/§V/§T/§B; caveman encoding; §V testable|https://raw.githubusercontent.com/JuliusBrussee/cavekit/main/FORMAT.md
R2|Cloudflare Vite|official plugin runs Worker in workerd + builds static SPA/assets|https://developers.cloudflare.com/workers/vite-plugin/
R3|Workers static assets|SPA + Worker API deploy as one unit; SPA fallback supported|https://developers.cloudflare.com/workers/static-assets/
R4|Cloudflare Access|paths/hostnames can be protected before Worker|https://developers.cloudflare.com/workers/configuration/cloudflare-access/
R5|Access JWT|Worker should validate `Cf-Access-Jwt-Assertion`; `jose` example uses issuer+audience+remote JWKS|https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
R6|Turso+Drizzle|Drizzle supports libSQL/Turso via `@libsql/client`|https://orm.drizzle.team/docs/sqlite/connect-turso
R7|Photoroom|API supports background removal; white background, padding/output sizing available|https://try-api.photoroom.com/?background.color=FFFFFF&padding=0.15&removeBackground=true
R8|Binance internal rate|public C2C quote endpoint no auth: `/bapi/c2c/v1/public/c2c/agent/quote-price`; params fiat/asset/tradeType|https://www.binance.com/en/skills/detail/binance/p2p
R9|Design source legacy|pre-expansion SPEC referenced Store/Admin specimen lacking Orders/stock/rate-lock; legacy path absent current repo|historical `reference/sistema_coru.html`
R10|Design source|final approved CORU v1 component/specimen board: foundations, Store/Admin patterns, Commerce & Operations components and React/Tailwind contract|local `design/CORU_Design_System_v1.html`
R11|Yummy scope|public material confirms B2B last-mile + Maracaibo + API onboarding; public example ⊥ stable quote contract; live quote requires current official docs+credentials|source `CORU_AMPLIACION_BAJO_PEDIDO_ENVIOS_GUIA_TALLAS.md` §24,§74
R12|PREORDER legacy status gap|CLOSED 2026-09-18: intent=PENDING; deposit→CONFIRMED; pre-deposit discard/72h expiry→DISCARDED+CANCELLED+UNPAID; post-confirm cancel→base/stage CANCELLED|owner clarification 2026-09-18 + I149
R13|Recovery provenance|downloaded malformed SPEC = 1,055 duplicate R9 records, no other recoverable v1 content; v1 restored from readable pre-expansion SPEC|local `C:/Users/diego/Downloads/SPEC.md` + `CORU_SPEC_ANTES_DE_ULTIMA_EXPANSION.md`

## §V INVARIANTS
- V1: ∀ admin API req → valid Access JWT before handler.
- V2: ∀ public STOCK catalog product → `is_active=true && stock_quantity>0 && primary_image_id!=null`.
- V3: `stock_quantity` ! integer ≥0 always.
- V4: create PENDING order → stock delta = 0.
- V5: discard PENDING order → stock delta = 0.
- V6: confirm PENDING STOCK order → one transaction: verify state+stock(+rate if VES) → movements → decrement → CONFIRMED.
- V7: ∀ STOCK order → at most one PENDING→CONFIRMED transition; retries ⊥ second decrement.
- V8: insufficient any STOCK line → confirm transaction rollback all.
- V9: order snapshots ⊥ mutate when product/category/promo changes.
- V10: client-sent prices/discounts/totals ⊥ accepted.
- V11: `Idempotency-Key` duplicate → same order/ref.
- V12: money USD ! integer cents; VES ! integer minor; rate ! integer micros.
- V13: VES PENDING order same `America/Caracas` day → later live rate ⊥ changes `current_rate_micros`.
- V14: VES PENDING after `rate_valid_until` → confirm ! 409 until refresh.
- V15: rate refresh ! preserve `initial_rate_micros`+`initial_total_ves_minor`.
- V16: UI/API customer-facing ⊥ provider name, Binance, BCV, “official rate”.
- V17: USD order ! works when rate unavailable.
- V18: VES order ⊥ created with no usable automatic/last-valid/manual rate.
- V19: promo engine same input → same quote deterministic.
- V20: promo repeatable bundle ! complete groups only; leftover units regular price.
- V21: promo discount ≤ eligible subtotal; total ≥0.
- V22: overlapping active promos same target/time ⊥ accepted.
- V23: product v1 ! one `size_label`; ⊥ variant selector/table.
- V24: cart persisted versioned; corrupt payload → reset safely.
- V25: analytics failure ⊥ blocks cart/order/WhatsApp.
- V26: analytics payload ⊥ PII.
- V27: order creation success ! persist before returning WhatsApp URL.
- V28: WhatsApp URL ! generated server-side from server quote/order snapshot.
- V29: new image upload ! original stored in R2 without background processing.
- V30: gallery reorder ! all product image positions remain unique and persisted.
- V31: product public image ! points to the first approved ordered object; failed/unapproved image ⊥ public primary.
- V32: logo/mascot geometry ! exact supplied asset; ⊥ generated replacement.
- V33: dark mode classes/tokens ⊥ production requirement v1.
- V34: UI touch action ≥44px where interactive mobile.
- V35: focus-visible ! keyboard accessible for all controls.
- V36: modal/drawer ! Escape+focus management where applicable.
- V37: public unavailable product order attempt → 409; cart remains editable.
- V38: disabling product ⊥ deletes historical order item.
- V39: confirmed order product later deleted/archived → historical snapshot remains readable.
- V40: manual STOCK set/adjust ! inventory movement record.
- V41: confirmed STOCK order ! inventory movement per order line.
- V42: rate provider timeout/failure → no overwrite of last valid rate with null/zero.
- V43: automatic rate `rateMicros<=0` ! rejected.
- V44: public `GET /api/exchange-rate` ⊥ internal provider metadata.
- V45: privacy notice dismissal local only; ⊥ server profile.
- V46: source normalization unknown→`other`; absent→`direct`.
- V47: `/admin` data ⊥ rendered from public endpoints when admin endpoint required.
- V48: API errors ! stable `code`; UI ⊥ branch on human message.
- V49: DB migration ! versioned Drizzle SQL; ⊥ schema push direct prod.
- V50: prod secrets ⊥ checked into git/client bundle.
- V51: R2 originals ⊥ public direct URL; derivatives may be public via controlled media route/domain.
- V52: order reference ! unique.
- V53: SKU+slug ! unique.
- V54: qty request ! integer 1..99 per line; duplicate product ids ! normalized/merged server-side.
- V55: order ! at least 1 item.
- V56: deleted/hidden product at intent creation ! rejected; out-of-stock rejection ! STOCK only; details returned.
- V57: confirm STOCK sale may succeed if product since hidden but stock remains sufficient; visibility ≠ historical sale validity.
- V58: DISCARDED ! terminal non-sale; CONFIRMED may transition only to CANCELLED via `cancel-sale`; CANCELLED ! terminal; PREORDER operational progression while base CONFIRMED follows I149.
- V59: order rate refresh ! only PENDING+VES.
- V60: analytics retention cleanup ! delete events older than 180 days, ⊥ orders.
- V61: admin dashboard STOCK “ventas/ingresos” ! derive CONFIRMED only; PREORDER cash ! recorded payments only per V105.
- V62: [AMEND 2026-09-24] KPI/timeline “WhatsApp intents” (`whatsappIntents`) ! count order records of any status (`PENDING|CONFIRMED|DISCARDED|CANCELLED`) whose `createdAt` falls in the selected range (Caracas day); ⊥ client `order_intent` event count for that KPI; funnel session metrics (`whatsappSessions`, `whatsappPerAddPct`) may remain event-based; “ventas activas” ! CONFIRMED only; cancelled value/cash reported separately, ⊥ active revenue.
- V63: selected Bs pre-order notice ! appears before CTA; locked notice ! only after intent response.
- V64: if popup/deep-link fails, order feedback ! expose retry `Abrir WhatsApp`, ⊥ create second order.
- V65: customer STOCK cart quantity ! cannot exceed latest known stock; PREORDER ignores stock; server remains authority.
- V66: E2E STOCK golden path ! mobile catalog→3 items→promo→VES→shipping→order→admin confirm→stock decrement.
- V67: E2E STOCK race path ! two pending orders on last unit; first confirm succeeds, second 409.
- V68: E2E rate path ! VES order retains rate same day; expires next business day; refresh required.
- V69: design implementation ! no favorites/profile/bottom nav/size selector.
- V70: admin Orders + stock UI ! implemented before project accepted.
- V71: ∀ product → `fulfillment_type ∈ STOCK|PREORDER`; ∀ order/item historical snapshot → one immutable fulfillment type.
- V72: STOCK public/cart/create → active + approved primary image + requested qty ≤ current positive stock.
- V73: PREORDER public/cart/create → active + approved primary image; `stock_quantity` value ⊥ availability condition.
- V74: PREORDER create/deposit/ready/balance/deliver/cancel → inventory delta = 0.
- V75: PREORDER public/card/detail/cart → explicit `Bajo pedido` + `3–4 semanas` + estimated/variable disclaimer before CTA.
- V76: PREORDER public/Admin customer-facing/WhatsApp copy ⊥ supplier/origin/import/logistics/acquisition disclosure.
- V77: configured PREORDER material+measurements ! public; absent optional mm fields ⊥ invented/conversion-derived.
- V78: PREORDER quote → `deposit=floor(finalTotal/2)` + `balance=finalTotal-deposit`; deposit+balance=finalTotal; integers only.
- V79: PREORDER VES deposit/balance each use usable rate @ respective payment record; deposit rate ⊥ future balance conversion.
- V80: PREORDER stage/payment pair ! one of C90; DELIVERED → PAID.
- V81: milestone action success → state+timestamp(+payment row where applicable) one transaction; failure → no partial write.
- V82: `mark-delivered` with balance >0 or payment != PAID → 409; ⊥ delivered timestamp.
- V83: cancellation after any payment → admin note required; ⊥ automatic refund or invented refund policy.
- V84: duplicate payment/delivery retry → same result; `(order_id,payment_kind)` unique; outstanding balance never <0.
- V85: order items ! same fulfillment type; mixed input → 409 `MIXED_FULFILLMENT`, ⊥ partial order.
- V86: checkout one fulfillment group success/failure → other cart group unchanged.
- V87: PREORDER promo eligibility explicit; default false; bundle groups ⊥ mix STOCK+PREORDER; 50/50 uses discounted server total.
- V88: STOCK order create → exactly one valid shipping method + method-specific required data before WhatsApp URL.
- V89: PREORDER initial create payload/snapshot → `shipping_method=null` + shipping fields null; quote/provider calls = 0.
- V90: PERSONAL → selected active Maracaibo point loaded server-side by id; client name/address ⊥ authority.
- V91: point deactivated between select+submit → 409 + refreshed active list; no order created.
- V92: personal delivery selection ! accessible list; map load/failure ⊥ blocks selection.
- V93: YUMMY → typed destination required; quote optional; missing credentials/provider failure → fallback + order creation remains available.
- V94: Yummy quote snapshot ! referential only; merchandise total/promo/canonical revenue unchanged; ⊥ guaranteed/frozen copy.
- V95: Yummy destination/coordinates change → previous quote stale; current estimate requires explicit re-quote.
- V96: NATIONAL → new public order requires carrier `MRW|ZOOM` only; recipient/state/city/office are coordinated through WhatsApp; `Cobro a destino` always visible; historical snapshots remain readable.
- V97: NATIONAL → web-calculated tariff/time/tracking/guide = none; carrier fee ⊥ CORU merchandise total/revenue.
- V98: client shipping point/price/quote/carrier validation ⊥ authority; server revalidates all method data.
- V99: generated WhatsApp message ! variant I127-I131 matching persisted server snapshot; ⊥ raw coordinates/provider secrets.
- V100: `/guia-de-tallas` direct public route ! reachable without account + linked Product Detail+footer/secondary mobile navigation.
- V101: guide ! inner diameter + finger circumference steps in mm; diameter means inner edge→inner edge, ⊥ outer diameter.
- V102: guide ⊥ unverified international conversion table + ⊥ customer measurement persistence/form requirement; the exact owner-approved CORU US 5–10 table is permitted as a static reference and is not a customer measurement form.
- V103: guide assets ! accessible mobile-readable vector/text fallback; ⊥ logo/mascot geometry modification/reuse.
- V104: analytics allowlist may receive fulfillment/shipping method non-PII; ⊥ address/coordinates/city/office/notes/payment data.
- V105: PREORDER admin metrics → order value, recorded cash, outstanding balance distinct; unrecorded balance ⊥ collected revenue.
- V106: product fulfillment changes while cart open → stale request rejected+explained; historical orders remain original snapshot.
- V107: product price/material/name/size/fulfillment edit after order create ⊥ historical snapshots.
- V108: shipping data retention ! operational minimum + privacy notice disclosure; frontend logs ⊥ delivery address/coordinates.
- V109: device precise geolocation ⊥ automatic; explicit permission required if future helper exists; typed address remains fallback.
- V110: Yummy/API/map credentials ! server-only; ⊥ browser bundle/UI/analytics/logs.
- V111: Yummy live quote ! disabled until R11 contract verified; fallback behavior ! production-ready independent from provider.
- V112: payment expected USD/paid minor/rate ! server-calculated from order obligation + recorded currency; client amount ⊥ authority; outstanding balance never negative.
- V113: create order → `expires_at=created_at+72h`; ∀ PENDING action/read with `now>=expires_at` → expiry transition before other mutation/response.
- V114: PENDING expiry → exactly once DISCARDED + `discarded_at` + `EXPIRED_UNREVIEWED` audit; inventory/payment deltas = 0; PREORDER → `CANCELLED+UNPAID`.
- V115: base transition ! exactly one I149 edge; CONFIRMED ⊥ DISCARDED; DISCARDED/CANCELLED ⊥ return active.
- V116: PREORDER deposit transaction ! base PENDING→CONFIRMED + stage/payment transition + payment row + timestamp atomically; expired/order-not-pending → rollback 409.
- V117: STOCK `cancel-sale` success ! one transaction creates positive `SALE_REVERSAL` matching each original SALE absolute qty, links each movement, restores stock, writes audit, sets CANCELLED.
- V118: ∀ SALE movement → ≤1 SALE_REVERSAL; duplicate same idempotency key → same result; concurrent/different retry ⊥ double restock.
- V119: PREORDER `cancel-sale` → base/stage CANCELLED + reason/audit, payment preserved, inventory movement count unchanged.
- V120: discard/cancel reason ! non-empty trimmed server-validated; system expiry reason fixed; actor/time ! audit; audit ⊥ editable/deletable via app.
- V121: device antiabuse → 6th new intent/rolling 60 min or 16th/rolling 24 h rejected; IP antiabuse → 11th/rolling 60 min rejected; concurrent checks atomic.
- V122: valid `Idempotency-Key` replay resolved before limiter → same order/ref + limiter count unchanged; new key ! new attempt.
- V123: arbitrary/malformed/unsigned `coru_device` ⊥ limiter authority; server reissues valid opaque signed token; no JS read required.
- V124: antiabuse storage/logs/analytics ⊥ raw IP/device token; HMAC digests expire ≤24 h; secret ⊥ client.
- V125: limited request → 429 + stable code + correct positive `Retry-After`/`retryAfterSeconds`; order count unchanged; cart preserved.
- V126: limiter unavailable/error → 503 stable code + no order; ⊥ bypass protection/fail-open.
- V127: concurrent confirm/deposit/discard/expiry/cancel operations serialize on current persisted state; exactly one valid transition commits.
- V128: E2E lifecycle ! STOCK PENDING→CONFIRMED→CANCELLED restores exact stock once; PREORDER PENDING expires or deposit→CONFIRMED→CANCELLED with inventory delta 0.
- V129: production public entry dependency closure ⊥ módulos/styles/assets exclusivos de `/admin/*`.
- V130: navegación directa a `/`, `/producto/:slug` o `/guia-de-tallas` ⊥ solicita chunks exclusivos de Admin antes de navegación a `/admin/*`.
- V131: dependencia exclusiva de Admin, incl. admin API/data loaders + CSS Admin, ⊥ static import desde Store/public root; ! permanecer detrás del admin lazy boundary.
- V132: feature únicamente administrativa puede crear/aumentar chunks Admin, pero ⊥ incorporar su código/bytes específicos a public initial chunks.
- V133: build gate bundle isolation ! `pnpm build` + inspección chunk graph prueban V129-V132; shared tokens/UI primitives permitidos como common chunks. Amended 2026-09-24: browser network check (Playwright) removed with C66; chunk-graph inspection of the build output remains the gate.
- V134: visitor id (`coru_visitor_v1`) + session id (`coru_session_v2`) ! opaque random identifiers; ⊥ PII (name/email/phone/IP/message); purpose disclosed on `/privacidad`; visitor ! unique-visitor counting only; session ! idle30 analytics only.
- V135: multi-row DB writes ! atomic conditional Hrana `batch` (BEGIN → statements conditioned on prior ok → COMMIT if all ok else ROLLBACK); admin order transitions ! conditional on persisted status/stage/payment (`UPDATE … WHERE id=? AND status=<expected> […]`); stock changes ! deltas guarded by the same transition marker; stale concurrent write → 409 `ORDER_CONFLICT`; persistence unavailable → 503 `PERSISTENCE_UNAVAILABLE`.

## §T TASKS
id|status|task|cites
T1|x|scaffold React+Vite+CF Worker+Hono+TS strict+pnpm; scripts/env/typegen|C1,C2,C63,C64,R2,R3
T2|x|install design tokens/assets/components baseline; remove dark mode|C45-C50,V32-V36
T3|x|define Drizzle schema+migrations+seed + repository boundaries|I68-I78,V3,V49,V52,V53
T4|~|build API foundation: Hono groups/Zod/error envelope/server abuse guard|C62,C68,C121-C125,I60-I61,I142-I144,V48,V121-V126
T5|x|build Cloudflare Access JWT middleware/admin route protection|C5,I35,V1,R4,R5
T6|x|build catalog/categories public API + admin CRUD + product availability|I26-I27,I36-I45,V2,V38
T7|x|build inventory service/movements + admin stock UI|C20-C25,I41,I74,V3-V8,V40,V41
T8|x|build R2 original image upload + ordered gallery flow|C40-C44,I42-I44,I81,V29-V31
T9|x|build promotion engine + admin promotion CRUD/conflict validation|C34-C38,I46,I79,V19-V22
T10|x|build exchange-rate provider/cache/cron/manual fallback/admin settings|C10-C18,I28,I58-I59,I64,I80,V12-V18,V42-V44,R8
T11|x|build cart/currency/source/privacy state + public Store Home/Product|I1-I5,I18-I25,I85-I90,V24,V34-V36,V45-V46,V69
T12|x|build order-intent service/API/idempotency/rate lock/WhatsApp+device guard|C27-C32,C121-C125,I29-I33,I72-I73,I82,I87,I142-I144,V9-V18,V27-V28,V52,V54-V56,V63-V64,V121-V126
T13|x|build admin Pedidos list/detail + refresh/discard/confirm/cancel-sale actions|C73-C76,C114-C120,I14-I15,I22-I23,I47-I52,I88,I141,I146,I148-I149,V58-V59,V70,V113-V120
T14|x|build atomic confirm/cancel-sale inventory handling + concurrency races|I74,I83-I84,I141,V6-V8,V41,V57,V67,V117-V118,V127
T15|x|build anonymous analytics ingestion/retention + admin analytics/dashboard real sales|C52-C56,I34,I53-I55,I77,V25-V26,V60-V62
T16|x|build admin settings WhatsApp/store/privacy/currency integration|I17,I56-I59,I76,C70
T17|x|add not-found/error/loading/empty/stock-changed/rate-unavailable states|C59,I20-I25,V37,V64
T18|x|add unit+integration tests commerce/rate/order/inventory/auth/media adapters|V1-V70
T19|x|~~add Playwright golden/race/rate/mobile+desktop admin smoke tests~~ dropped 2026-09-24 (C66 amended); V66-V68 flows covered by Vitest service/API tests + production smoke|V66-V70
T20|x|configure dev/preview/prod envs, R2/Turso bindings, migrations, cron, build/deploy|C1-C2,I62-I65,V49-V51
T21|~|run accessibility/performance/security QA; fix drift vs SPEC+DESIGN|C51,C67-C68,V34-V36,V48-V51
T22|~|final docs/seed/operational checklist + Cavekit `/check --all` equivalent review|G,C1-C78,I1-I93,V1-V70
T23|~|implement closed base/PREORDER transition matrix + audit semantics|R12,C89-C93,C114-C120,I146,I149,V113-V120,V127
T24|~|add fulfillment/order/payment/shipping/audit/abuse schema + reversible STOCK backfill migration|I112-I117,I140,I146-I147,V71,V107,V120,V124
T25|x|extend contracts/validation/catalog queries for fulfillment + measurement fields|C79-C83,I104,I107-I110,V71-V77
T26|~|build PREORDER quote/deposit math + resolved base/stage/payment transactions/idempotency|C84-C94,C114-C120,I109,I117,I119-I123,I149,V78-V84,V113-V120,V127
T27|~|split mixed cart+checkout by fulfillment; preserve unsubmitted group; handle fulfillment races|C95-C96,C112,I108,I110,V85-V87,V106
T28|x|build PREORDER Store/Product Detail/cart terms + safe WhatsApp variant|C82-C83,I95-I96,I131,V75-V77,V99
T29|x|build STOCK shipping selector + PERSONAL points public API/map+list/Admin CRUD|C97-C99,I97-I99,I105,I116,I118,V88-V92
T30|x|build Yummy provider boundary + verified-adapter gate + non-blocking fallback/requote states|C100-C103,C113,I100,I106,I128-I129,V93-V95,V110-V111,R11
T31|x|build NATIONAL selection/validation/WhatsApp/Admin detail without tariff integration|C104-C105,I101,I107,I130,V96-V99
T32|~|extend Admin product/order screens + expiry/cancel-sale/PREORDER stages/payments/timeline/metrics|C89-C93,C111,C114-C120,I124-I126,I138,I141,I146,I148-I149,V80-V84,V105,V113-V120
T33|x|build `/guia-de-tallas` route+links+exact steps/tips+2 accessible CORU vectors|C106-C109,I94,I102-I103,I132-I135,V100-V103
T34|~|extend analytics allowlist/dimensions + privacy/log guards for delivery/payment/antiabuse data|C110,C123,I136-I137,I147,V104,V108-V110,V124
T35|~|add unit/integration/E2E matrix: PREORDER,mixed cart,shipping,Yummy,national,guide,expiry,cancel,abuse,races|V71-V128
T36|.|run doc drift check + migration dry-run + typecheck/tests/build/a11y/responsive gates; deploy only by separate authorization|I1-I149,V1-V128
T37|x|build exact 72h pending expiry sweep + lazy enforcement + status audit|C114-C117,I145-I146,I149,V113-V116,V120,V127
T38|x|build signed device cookie + atomic device/IP antiabuse counters + 429/503 Store feedback|C121-C125,I142-I144,I147-I148,V121-V126
T39|~|build `cancel-sale`: STOCK atomic SALE_REVERSAL restock; PREORDER no-restock cancellation|C117-C120,I141,I146,I149,V117-V120,V127-V128
T40|x|isolate Store/Admin client loading: move admin route tree+data loaders behind lazy boundary, split admin-only API/CSS/dependencies, inspect Vite production chunk graph + public Playwright/network requests; record main public chunk sizes|C126-C131,V129-V133
T41|x|redesign STOCK cart shipping as compact nested panel; make new NATIONAL requests carrier-only; preserve historical snapshots; verify responsive/focus/motion/WhatsApp behavior|C97-C105,I97-I107,I130,I139,V88-V99

## §B BUGS
id|date|cause|fix
B1|2026-09-24|Hrana `transaction()` could COMMIT after a failed statement (non-atomic multi-statement writes)|single conditional Hrana `batch`: BEGIN → OK-conditioned steps → COMMIT only if all ok else ROLLBACK; covered by `tests/db.client.test.ts`
B2|2026-09-24|stale isolate could overwrite newer Turso order state; stock used absolute writes; persistence errors swallowed|admin order routes refresh from Turso first; conditional `UPDATE … WHERE status/stage/payment`; stock as deltas guarded by transition marker; await persist; 409 `ORDER_CONFLICT` / 503 `PERSISTENCE_UNAVAILABLE`
B3|2026-09-24|order hydration omitted `order_payments` and `order_audits`|hydrate both tables with orders; covered by persistence path in `src/worker/persistence.ts`
B4|2026-09-24|anti-abuse HMAC used a hard-coded fallback secret in production paths|env `CORU_ABUSE_SECRET` (min 32); production without it → 503 `ORDER_INTENT_GUARD_UNAVAILABLE`; local/tests use development constant
B5|2026-09-xx|epoch (1970) placeholder rate metadata disabled Bs despite a usable initial rate|hydration discards epoch rate metadata; see `docs/IMPLEMENTATION_STATUS.md`
B6|2026-09-24|analytics CHECK constraint lacked new event names (`privacy_view`, `not_found_view`, …)|migration `drizzle/0006_coru_analytics_public_views.sql` rebuilds CHECK while preserving rows; local only until applied to Turso
