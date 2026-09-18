# CORU v1 + expansion — Caveman spec

§G Goal

CORU = mobile-first public catalog + lightweight Admin → WhatsApp order intents.
v1.1 adds PREORDER, STOCK delivery selection, size guide; preserve v1 rules.

§C Constraints

- light mode; exact supplied logo/mascot; no dark mode.
- Store/Admin share tokens, not density/layout.
- USD integer cents canonical; ⊥ floats for money.
- `PENDING` intent ≠ sale; STOCK confirmation decrements inventory once, atomically.
- Bs rate source/provider stays server-side; public copy ⊥ Binance/BCV/official-rate.
- no customer account, online payment, customer tracking, variants, coupon percentages.
- no provider/import/logistics disclosure for PREORDER.
- PREORDER deposit fixed 50% in v1.1; ⊥ per-product percentage setting.
- PREORDER delivery selected only after product ready; initial request `shipping_method=null`.
- Yummy integration only with verified official contract/credentials; ⊥ invented endpoint, scraping or fake quote.
- MRW/ZOOM: agency/city/state + destination charge; ⊥ tariff/time/tracking API.
- delivery address/coordinates/office/payment notes ∉ analytics.
- guide uses mm; ⊥ unverified international size-conversion table.

§I Interfaces

api: GET `/api/health` → 200 `{data:{ok:true}}`
api: GET `/api/catalog` → active public products; STOCK requires stock > 0; PREORDER ignores stock.
api: GET `/api/categories` → active categories.
api: GET `/api/products/:slug` → public product or 404.
api: GET `/api/exchange-rate` → public-safe rate state; ⊥ provider identity.
api: GET `/api/personal-delivery-points` → active points only.
api: POST `/api/shipping/yummy/quote` → verified adapter quote or unavailable fallback; origin server-owned.
api: POST `/api/orders/whatsapp` + `Idempotency-Key` → PENDING order intent; server revalidates product, price, promo, fulfillment and shipping.
api: POST `/api/analytics` → anonymous allowlisted events; PII rejected.
api: admin CRUD personal delivery points → active, ordered, Maracaibo-only configuration.
api: admin PREORDER actions → `record-deposit`, `mark-ready`, `record-balance`, `mark-delivered`, `cancel`.
route: `/` → Store.
route: `/producto/:slug` → Product Detail.
route: `/guia-de-tallas` → public mobile-first guide; direct URL.
route: `/privacidad` → privacy notice/page.
route: `/admin/*` → Cloudflare Access protected Admin.

data: Product → `{fulfillmentType: STOCK|PREORDER, material, measurementsText, innerDiameterMm?, circumferenceMm?}`.
data: Order snapshot → `fulfillmentTypeSnapshot`, item name/SKU/size/price/material, quote, currency/rate.
data: PREORDER order → `depositUsdCents`, `balanceUsdCents`, `preorderStage`, `paymentStatus`, `leadTimeSnapshot='3–4 semanas'`.
data: order_payments → `{id, orderId, paymentKind: DEPOSIT|BALANCE, usdAmountCents, paidCurrency: USD|VES, paidAmountMinor, rateMicros?, recordedAt, note?}`.
data: personal_delivery_points → `{id,name,address,shortDescription?,latitude,longitude,scheduleText?,active,sortOrder,createdAt,updatedAt}`.
data: STOCK shipping → `shippingMethod: PERSONAL|YUMMY|NATIONAL|null`, point/destination/quote/carrier fields nullable.
data: Yummy snapshot → `deliveryQuoteAmountMinor`, `deliveryQuoteCurrency`, `deliveryQuoteQuotedAt`, `deliveryQuoteExternalId?`; ⊥ `expiresAt` without provider contract.
event: `size_guide_view|shipping_method_selected|yummy_quote_requested|yummy_quote_succeeded|yummy_quote_failed|preorder_intent_created|preorder_deposit_recorded|preorder_ready|preorder_completed`; add `fulfillment_type` where relevant.

§R Research

R1: Yummy public material confirms B2B last-mile/API onboarding, not a stable public quote contract → implementation requires current official docs + credentials; fallback WhatsApp.
R2: no MRW/ZOOM quote/tracking contract approved → store agency choice + destination charge only.
R3: existing CORU visual authority = `design/DESIGN.md` + `design/CORU_Design_System_v1.html`; compose components, ⊥ full-screen specimen copies.

§V Invariants

V1: ∀ public product → `active` & approved primary image & active category.
V2: STOCK public/cart/confirm → `stockQuantity > 0`; `stockQuantity` never negative.
V3: PREORDER public/cart/confirm ∉ `stockQuantity`; PREORDER confirmation never changes inventory.
V4: PREORDER public copy includes `Bajo pedido`, `3–4 semanas`, estimated/variable disclaimer.
V5: PREORDER exposes material + measurements when configured; ⊥ provider/origin/import/logistics copy.
V6: `depositUsdCents=floor(totalUsdCents/2)`; `balanceUsdCents=totalUsdCents-depositUsdCents`; deposit + balance = total.
V7: PREORDER deposit rule global 50%; ⊥ product-level percentage.
V8: PREORDER Bs deposit converts current deposit USD snapshot; later balance converts with later current rate; initial rate ⊥ balance lock.
V9: PREORDER stages ∈ `AWAITING_DEPOSIT|IN_PROCESS|READY|DELIVERED|CANCELLED`; payment ∈ `UNPAID|DEPOSIT_PAID|PAID`.
V10: valid PREORDER pairs = `AWAITING_DEPOSIT+UNPAID`, `IN_PROCESS+DEPOSIT_PAID`, `READY+DEPOSIT_PAID`, `READY+PAID`, `DELIVERED+PAID`; DELIVERED ∴ payment PAID.
V11: duplicate payment/retry safe; deposit/balance each record once; pending balance never negative; cancellation after payment requires admin note; ⊥ automatic refund.
V12: ∀ order → exactly one `fulfillmentTypeSnapshot`; mixed STOCK+PREORDER never becomes one order.
V13: cart may show both groups; process one group preserves other; no silent removal.
V14: PREORDER promo eligibility explicit; default false; STOCK bundle never mixes PREORDER.
V15: STOCK order requires shipping method before creation; PREORDER initial request has no shipping method/address/quote.
V16: PERSONAL → active configured point; server loads point by id; stale/deactivated point rejected with fresh list.
V17: YUMMY → destination required; quote optional; failure/unavailable never blocks order; quote is referential, not merchandise revenue.
V18: destination change → prior Yummy quote stale; new quote requested before presenting current estimate.
V19: NATIONAL → carrier ∈ MRW|ZOOM + state + city; office optional; charge-to-destination; no calculated tariff/time/tracking.
V20: shipping fields ∉ PREORDER initial snapshot; PREORDER delivery coordinated after READY.
V21: product price/edit after order creation never changes order snapshots.
V22: WhatsApp STOCK copy includes selected delivery context; PREORDER copy includes total, 50/50, lead time and ⊥ shipping/provider data.
V23: guide route stable/direct, explains inner diameter + finger circumference in mm; ⊥ personal measurement storage and unverified conversion table.
V24: analytics rejects address, coordinates, office, personal notes and sensitive payment data.
V25: no precise device geolocation without explicit permission; typed address remains valid fallback.
V26: API/provider secrets server-side only; browser never authoritative for price, stock, payment, point, quote or carrier.

§T Tasks

id|status|task|cites
T1|x|preserve v1 Store/Admin/Worker foundations|V1,V2,V21,V26
T2|~|extend Product contracts/schema with fulfillment + measurements|V2,V3,V5
T3|.|add PREORDER quote/deposit math + order snapshots|V6,V7,V8,V21
T4|.|split mixed cart into STOCK/PREORDER groups|V12,V13,V14
T5|.|render PREORDER badge/terms and safe WhatsApp copy|V4,V5,V22
T6|.|add STOCK shipping selector and personal points API/config|V15,V16,V19
T7|.|add Yummy provider abstraction + safe fallback|R1,V17,V18,V26
T8|.|add national carrier fields/copy without tariff APIs|V19,V20
T9|.|add Admin PREORDER/payment actions + payment idempotency|V9,V10,V11
T10|.|add public `/guia-de-tallas` + Product Detail/footer links|V23
T11|.|add analytics names/dimension + PII guards|V24,V25
T12|.|add migrations, API, Store/Admin/E2E invariants|V1-V26
T13|.|update privacy copy for delivery data|V20,V24,V25

§B Bugs

id|date|cause|fix
