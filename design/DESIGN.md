# CORU — DESIGN.md

## 0. Status and authority

**Status:** CORU Design System v1 foundation approved; v1.1 fulfillment/size-guide component contracts documented for implementation.

**Visual source of truth:** `design/CORU_Design_System_v1.html`

**Brand source of truth:**
- `design/CORU_LOGO/Logo_y_Vartiantes_CORU.svg`
- `design/CORU_LOGO/PaletaColoresCORU.svg`
- production derivatives under `public/brand/` must preserve supplied geometry.

**Functional/business authority:** `doc/SPEC.md`.

This document describes the **component system and visual rules** available to compose CORU interfaces. It is not a request to copy every composition shown in the HTML literally. When implementing a feature:

1. `doc/SPEC.md` decides what the product must do.
2. `DESIGN.md` decides how the interface should look and behave visually.
3. `design/CORU_Design_System_v1.html` is the canonical specimen board for tokens, components, states and responsive composition.
4. Existing Store/Admin compositions in the HTML are examples, not a complete list of product screens.

If an implementation requires a screen that is not explicitly mocked, compose it using the approved components below. Do not invent a second visual language.

---

# 1. Visual direction

CORU is youthful, affordable, urban and slightly alternative.

The system principle is:

> **Blanco para respirar. Negro para decidir. Mint para señalar.**

Store:
- visual and product-first;
- mobile-first;
- lightweight;
- fast to scan;
- promotional without looking cheap;
- not luxury/fine-jewelry.

Admin:
- same tokens and brand;
- denser and more operational;
- sober;
- structured for tables, forms, statuses and actions.

Avoid:
- luxury gold/beige aesthetics;
- generic SaaS blue/purple;
- childish styling;
- excessive mint surfaces;
- giant decorative heroes in the Store;
- components not present in this design system unless the existing primitives cannot express the requirement.

---

# 2. Brand assets

Use the supplied logo/mascot files exactly.

Mascot constraints:
- geometry locked;
- proportions locked;
- face locked;
- exactly **three** mint expression rays on the left;
- do not redraw, regenerate, reinterpret or replace it;
- no shadow, glow or decorative effect.

The wordmark/logo is an asset. Do not recreate it using the UI font.

---

# 3. Light mode only

CORU v1 uses:

```css
color-scheme: light;
```

There is no dark mode in v1.

Do not implement:
- theme toggle;
- `[data-theme="dark"]`;
- dark token overrides;
- dark-specific components;
- OS dark-mode adaptation.

---

# 4. Color tokens

Canonical values from the approved system:

```css
--color-brand: #39F79B;
--color-brand-strong: #39F79B; /* compatibility alias for Mint */

--color-ink: #000000;
--color-white: #FFFFFF;

--color-surface: #FFFFFF;
--color-surface-muted: #F5F5F5;
--color-surface-brand: #E8FFF0;

--color-border: #E5E7EB;
--color-border-strong: #CDD2D8;

--color-muted: #6B7280;
--color-subtle: #9CA3AF;

--color-success: #116A3A;
--color-success-surface: #E8FFF0;

--color-error: #B42318;
--color-error-surface: #FEE4E2;

--color-warning: #8A4B00;
--color-warning-surface: #FFF4D6;
```

Usage:
- white is the dominant surface;
- black creates structure and decisive actions;
- mint indicates action, selected state, promotion, focus and confirmation;
- light mint supports positive/informational states;
- neutral supports form fields, skeletons and grouped surfaces;
- semantic warning/error colors communicate operational states;
- never encode state with color alone.

Do not add arbitrary brand colors because a screen needs “more variety.”

---

# 5. Typography

Approved direction:

```css
--font-display: "Inter Display", Inter, system-ui, sans-serif;
--font-ui: Inter, system-ui, sans-serif;
```

Scale:

```text
xs    12px
sm    14px
md    16px
lg    18px
xl    20px
2xl   24px
3xl   32px
4xl   40px
5xl   48px
```

Line-height:
```text
tight 1.15
body  1.6
```

Use:
- display font for headings, metrics and emphasized totals;
- UI font for body, controls, tables and forms;
- tabular numerals where useful for financial/admin values;
- persistent labels on inputs.

---

# 6. Spacing, shape and elevation

Spacing scale:
```text
4, 8, 12, 16, 20, 24, 32, 40, 48, 64
```

Mobile defaults:
```text
page padding: 16px
card padding: 12–16px
grid gap: 12px
section spacing: 24–32px
```

Radii:
```text
control 12px
input   16px
button  18px
card    20px
modal   24px
sheet   28px
pill    999px
```

Elevation:
```css
--shadow-card: 0 8px 24px rgb(0 0 0 / .06);
--shadow-drawer: -12px 0 32px rgb(0 0 0 / .12);
```

Elevation must stay contained. Do not turn the system into stacked floating cards.

---

# 7. Motion

```text
fast      140ms
standard  200ms
sheet     280ms
```

Approved easing:
```css
cubic-bezier(.2,.8,.2,1)
```

Honor `prefers-reduced-motion`.

Motion is feedback, not decoration.

---

# 8. Responsive breakpoints

```text
base   0px
sm     640px
md     768px
lg     1024px
xl     1280px
2xl    1536px
```

Maximum content width:
```text
1240px
```

Responsive rule:

> **Reorganizar, no escalar.**

Examples:
- Store grid: 2 mobile → 3 medium → 4 desktop.
- Mobile cart: bottom sheet.
- Desktop cart: right drawer.
- Admin sidebar: drawer on narrow widths.
- Admin tables: responsive list/card representation when the table no longer fits.
- Forms: multiple columns desktop → one column mobile.

---

# 9. Accessibility contract

Interactive target:
```text
minimum 44×44px
```

Required:
- `:focus-visible`;
- semantic HTML;
- accessible labels;
- icon-only actions have accessible names;
- keyboard operability;
- Escape closes drawers/dialogs where relevant;
- focus returns to trigger;
- states are not communicated only with color;
- error messages are associated with their field;
- important dynamic status should use appropriate live-region behavior;
- reduced motion support.

---

# 10. Icons

One icon family:
**Font Awesome Free**.

The design specimen loads Font Awesome from CDN only as a self-contained board. Production implementation should use package-managed icons/assets rather than depend on that CDN.

Typical icons:
- search;
- cart/bag;
- plus/minus;
- trash;
- close;
- check;
- arrows;
- chevrons;
- filter/sliders;
- WhatsApp;
- charts;
- product/box;
- tags;
- promotion/bolt;
- order/reference;
- settings;
- warning/info.

Do not mix multiple icon families.

---

# 11. General primitives

## Button

Variants:
```text
primary
secondary
ghost
danger
disabled/loading
```

Rules:
- primary = main conversion/action;
- secondary black = strong alternate action;
- ghost = supporting action;
- danger = destructive;
- disabled must visibly lose affordance;
- primary/secondary button height ~48px.

## IconButton

Use for add, close, edit, menu, copy and other compact actions.

## Input

States:
```text
default
filled
focus
error
disabled
```

Rules:
- persistent label;
- placeholder is not a replacement for the label;
- helper/error sits close to field;
- focus uses mint.

## SearchInput

Input + left search icon.

## FilterChip

States:
```text
default
selected
hover
disabled
```

## SegmentedControl / CurrencyToggle

Used for choices such as:
```text
USD | Bs
Automática | Manual
```

## Badge

General variants:
```text
neutral
brand
success
warning
error
```

Use the domain-specific status component when one exists.

## QuantityStepper

Structure:
```text
[−][quantity][+]
```

One component throughout Store/Cart.

---

# 12. Store-specific components

## ProductCard

Approved content:
- product image;
- optional promo/category badge;
- name;
- one informational `size_label`;
- price;
- direct mint add action.

Behavior:
- card/body opens detail;
- `+` directly adds to cart;
- no size selector;
- no favorite;
- no rating;
- no customer/account action;
- unavailable state exists for edge cases/specimen use.

Fulfillment extension:
- `FulfillmentBadge` is always explicit: `Disponible` for `STOCK`, `Bajo
  pedido` for `PREORDER`;
- a PREORDER card may show the compact `3–4 semanas` estimate;
- the badge is a semantic status, not a decorative promo chip, and remains
  readable in the two-column mobile grid;
- PREORDER cards keep the same add action and never display an inventory
  quantity or an origin/provider claim.

## ProductGrid

Responsive:
```text
mobile 2 columns
md     3 columns
desktop 4 columns
```

## PromoBanner

States:
```text
default
progress
completed
```

Initial example:
```text
3 ANILLOS POR $10
```

## PromoProgress

Shows progress toward the bundle.

## ProductGallery

Used in product detail:
- primary image;
- thumbnail row;
- consistent product background;
- image is dominant.

## FloatingCart

Mobile Store pattern.

## CartLine

Contains:
- thumbnail;
- name;
- size label;
- price;
- QuantityStepper.

## CartSummary

Contains:
- subtotal;
- discount;
- total.

For richer order contexts, use `OrderSummary / TotalsBlock`.

For a PREORDER group, append `PreorderTerms / DepositSummary` with the
canonical USD total, 50% deposit, remaining balance and variable `3–4 semanas`
estimate. Do not present delivery selection in the initial PREORDER cart.

## CartSheet

Mobile:
- bottom sheet;
- ~85–90dvh maximum;
- clear CTA area.

## CartDrawer

Desktop:
- right drawer;
- ~420–460px;
- same business subcomponents as mobile sheet.

When a cart contains both fulfillment types, the drawer/sheet groups lines by
fulfillment and gives each group its own action. Sending one group must leave
the other group visible and untouched.

---

# 13. Commerce & Operations component library

Legacy entries below describe approved v1 specimens. Sections 13.4–13.10 are
v1.1 component contracts required by `doc/SPEC.md`; they are not evidence that
the HTML specimen board already contains their final rendered examples.

## 13.1 OrderStatusBadge

Variants:
```text
Pendiente
Venta concretada
Descartado
Venta cancelada
```

Use in order lists, detail views, compact cards and summaries.

Keep outcome semantics explicit: `Descartado` is an intent that never became a
sale; `Venta cancelada` is a formerly confirmed sale. Never reuse the same
badge/copy for both.

## 13.2 RateStatusBadge

Variants:
```text
Válida hoy
Actualizada
Vencida
```

Use only when rate context exists.

## 13.3 StockStatusBadge

Variants:
```text
En stock
Poco stock
Agotado
```

Can optionally show quantity.

**Stock `0` is valid and maps to `Agotado`. It is not a validation error.**

## 13.4 FulfillmentBadge

Variants:
```text
Disponible
Bajo pedido
```

Use on ProductCard, Product Detail, cart group headings and Admin product/order
lists. `Bajo pedido` uses the approved mint accent but must not be confused
with `StockStatusBadge` or a promotion.

## 13.5 PreorderTerms / DepositSummary

States:
```text
compact card
expanded detail
admin payment summary
```

Content:
- total in canonical USD;
- `50% ahora` deposit and remaining balance;
- `Tiempo estimado de llegada: 3–4 semanas`;
- estimated/variable disclaimer;
- no provider, import or logistics disclosure.

The component explains the rule; it never accepts payment or invents a
product-specific percentage.

## 13.6 ShippingMethodSelector

Three explicit choices for STOCK only:
```text
Personal
Yummy
Nacional
```

Use a radio/segmented selection with a visible summary panel. The selected
method must remain visible in the order review and WhatsApp CTA context.

## 13.7 PersonalDeliveryPointCard

Displays name, address, schedule and short description. Selection uses a
single clear selected state and supports keyboard focus. Coordinates are used
only by `PersonalDeliveryPointMap`; they are not rendered as raw telemetry.

## 13.8 PersonalDeliveryPointMap / MapContainer

Map is a progressive enhancement. The accessible list is the source of truth
and must remain usable when a map cannot load. Keep marker labels, focus order
and selected-point styling synchronized.

## 13.9 DeliveryQuoteNotice

States:
```text
idle
loading
available
unavailable / confirmar por WhatsApp
stale destination
error
```

Use for Yummy only. A quote is a delivery estimate, never part of the
merchandise subtotal or promotion math.

## 13.10 NationalCarrierSelector

Requires carrier (`MRW` or `ZOOM`), state and city; office is optional. Do not
show fabricated tariff, delivery time or tracking controls.

## SizeGuideStep (v1.1)

Structure:
- visible step number;
- short action title;
- one focused instruction block;
- persistent `mm` unit where a measurement is named;
- `illustration` slot;
- optional compact tip.

The two methods remain separate: measuring an existing ring's **inner**
diameter and measuring finger circumference. The component never renders a
customer measurement input or an international conversion result.

## MeasurementIllustrationContainer (v1.1)

States:
```text
vector ready
vector unavailable / text-line fallback
```

Asset A shows ring + rule + arrows from inner edge to inner edge + `mm`.
Asset B shows finger + non-elastic strip/mark + strip extended over a rule +
`mm`. Use white, black and Mint `#39F79B`, simple high-contrast lines and an
accessible title/description. Do not reuse or alter mascot geometry.

## 13.11 InventoryField / StockValue

Approved specimen states:
```text
normal
warning
error
agotado
disabled
```

Examples:
- normal: `24`;
- warning: `3`;
- error: `-1`;
- agotado: `0`;
- disabled: temporarily blocked.

## 13.12 OrderReference

Variants:
```text
normal
compact
with copy action
```

Example:
```text
CORU-000123
```

## 13.13 OrderMetaBlock

Compact metadata pairs:
- date;
- time;
- source;
- currency;
- rate + RateStatusBadge when currency is Bs.

Do not show a rate when the order currency is USD.

## 13.14 OrderItemRow

Desktop:
- thumbnail;
- product name;
- SKU;
- size label;
- quantity;
- unit price;
- subtotal.

Compact/mobile:
- reduced secondary columns;
- preserves identity, quantity/price context and subtotal.

## 13.15 OrderSummary / TotalsBlock

Contains:
- subtotal;
- promotion/discount;
- total;
- optional secondary currency/value context.

Total is the dominant value.

## 13.16 TransactionComparison

Variants:
```text
neutral
attention
changed
```

Used for before/after values such as original vs refreshed amount.

## 13.17 RateNotice / RateLockNotice

States:
```text
informative/default
protected
expired
compact expired
```

Structure:
- icon;
- title;
- supporting text;
- optional action.

Business copy comes from `doc/SPEC.md`; specimen copy demonstrates hierarchy.

## 13.18 ConflictState / InlineConflict

Representations:
```text
compact
panel
```

Supports:
- icon;
- title;
- explanation;
- optional affected-items list;
- primary/secondary actions.

Use for product availability, stock conflict, stale data and blocked operations.

## 13.19 OrderCreatedFeedback

Forms:
```text
card/inline
compact mobile
with OrderReference
with primary CTA
```

Use after a persisted order intent is created.

## 13.20 AdminEntityCard

Generic responsive admin entity card.

Supports:
- thumbnail/icon;
- title;
- metadata;
- badges;
- emphasized value;
- action/menu.

Use it to transform admin tables into mobile lists where possible.

## 13.21 DataPair / DescriptionList

Arrangements:
```text
grid
horizontal
compact
```

Approved metadata examples:
- Fecha;
- Referencia;
- Canal;
- Estado;
- Moneda;
- Tasa;
- Fecha de actualización.

CORU v1 does not require a `Cliente` field/entity for this component.

## 13.22 Timeline / StatusHistory

Secondary short history:
```text
2–4 events
```

Example event types:
- order created;
- rate protected;
- sale confirmed;
- expired after 72 hours;
- discarded by Admin;
- sale cancelled;
- STOCK inventory restored.

Do not turn it into a CRM feed.

## 13.23 ConfirmationDialog

Variants:
```text
normal
important
destructive
conflict
```

Supports:
- title;
- copy;
- optional summary;
- secondary action;
- primary action.

Use existing variants before creating another modal type.

For `Cancelar venta`, use `destructive`: show current status, required reason
field and irreversible audit consequence. STOCK additionally previews exact
quantities that will return to inventory; PREORDER explicitly says
`Esta cancelación no modifica inventario.` The primary action remains disabled
until the trimmed reason is valid.

## 13.24 OrderExpiryNotice / RateLimitNotice

`OrderExpiryNotice` states:
```text
pending with exact expiry date/time
expired automatically
discarded manually
```

Use in Admin order detail/timeline. Avoid a live second-by-second countdown;
show clear local date/time and semantic outcome.

`RateLimitNotice` states:
```text
too many attempts / retry available in N minutes
protection temporarily unavailable / retry later
```

Use beside the WhatsApp CTA after 429/503. Preserve cart and selected delivery
data, keep copy neutral, expose the server retry duration, and never auto-loop
or suggest deleting cookies/changing networks.

---

# 14. Feedback and common states

Approved:
- loading/skeleton;
- empty;
- error;
- toast;
- success feedback.

Domain-specific operational conflicts use `ConflictState` when structured remediation is needed.

---

# 15. Store composition rules

## Mobile Home

Order:
```text
Header
Promo
Search
Category/filter rail
Product grid
Floating cart
```

Do not add:
- profile;
- favorites;
- bottom navigation;
- customer login;
- unrelated links.

## Desktop Home

Composition:
```text
Header: logo | search | currency/cart
Promo
Filters
Title/count
Product grid
```

## Product Detail

Mobile:
- gallery;
- promo/category state if applicable;
- name;
- price;
- size information;
- `FulfillmentBadge`;
- for PREORDER: `PreorderTerms / DepositSummary`, material, measurements and
  variable lead-time copy;
- for STOCK: fulfillment availability; shipping selection belongs to the
  cart/order review before its WhatsApp CTA;
- link `Ver guía de tallas` beside size/measurement information;
- short description;
- add action.

Desktop:
- gallery/info split is acceptable.

No size selector.

## Size guide (`/guia-de-tallas`)

Mobile-first composition:
```text
Title and short reassurance
Measurement method: inner diameter (mm)
Measurement method: finger circumference (mm)
Two vector illustration containers with text alternatives
Practical reminder to measure twice
```

`SizeGuideStep` uses one focused instruction per block and keeps the unit
visible in every measurement label. `MeasurementIllustrationContainer` may
render a supplied vector or a resilient text/line fallback; it must not imply
an international size conversion or ask the customer to save a measurement.

Method A sequence: fitting ring → flat surface → millimetre rule → inner edge
to inner edge → exclude metal thickness → repeat. Method B sequence: thin
paper/non-elastic thread/flexible tape → wrap target finger without squeezing
→ mark meeting point → extend over millimetre rule → repeat. Tips mention the
exact finger, knuckle clearance and asking CORU when product measurements do
not match clearly; no medical claims.

Link the guide from Product Detail and the Store footer/secondary navigation.

## Cart

Mobile:
- CartSheet.

Desktop:
- CartDrawer.

Compose from:
- CartLine;
- QuantityStepper;
- promotion feedback;
- CartSummary / OrderSummary;
- FulfillmentBadge;
- PreorderTerms / DepositSummary when the group is PREORDER;
- ShippingMethodSelector, PersonalDeliveryPointCard/MapContainer,
  DeliveryQuoteNotice or NationalCarrierSelector when the group is STOCK;
- RateNotice where required;
- WhatsApp CTA;
- OrderCreatedFeedback after persistence.

---

# 16. Admin visual system

Admin uses the same foundations at higher information density.

Approved patterns include:
- sidebar shell;
- sidebar→drawer;
- topbar/breadcrumb;
- metrics;
- tables;
- filters/search;
- mobile list cards;
- forms;
- switches;
- upload/dropzone;
- image processor comparison;
- pipeline states;
- promotion-rule previews;
- analytics bars/funnel;
- settings blocks;
- destructive area;
- dialog patterns.

The Admin compositions in the specimen board are examples from an earlier functional state. They do **not** limit final navigation/features. `doc/SPEC.md` remains authoritative for final areas such as `Pedidos`.

For new admin screens:
- reuse `AdminEntityCard` for mobile list transformations;
- reuse order components for `Pedidos`;
- reuse `InventoryField` + StockStatusBadge for product stock;
- reuse DataPair/Timeline for read-only detail;
- reuse ConfirmationDialog/ConflictState for transitions/conflicts;
- show `FulfillmentBadge` beside product/order identity;
- use `PreorderTerms / DepositSummary` for payment records and remaining
  balance;
- show PREORDER stage and payment as two labelled semantic badges/fields;
  never collapse them into the legacy OrderStatusBadge;
- show base status beside PREORDER stage/payment; new PREORDER starts
  `Pendiente / Esperando anticipo / Sin pagar`, deposit changes base status to
  `Venta concretada`, pre-deposit expiry becomes
  `Descartado / Cancelado / Sin pagar`, and post-deposit cancellation becomes
  `Venta cancelada / Cancelado` with payment state preserved;
- expose only actions valid for the current stage/payment pair; READY with an
  unpaid balance visibly blocks delivery;
- PENDING detail shows exact 72-hour expiry; due intent refreshes to Descartado
  before other actions can appear;
- confirmed order exposes `Cancelar venta` in destructive area; require reason,
  preview STOCK restoration or PREORDER no-inventory effect, then append the
  immutable audit event to Timeline;
- separate `Valor del pedido`, `Cobrado` and `Saldo pendiente`; uncollected
  balance must not use the confirmed-revenue emphasis;
- use `PersonalDeliveryPointCard` in delivery-point settings;
- do not require a separate full-screen mockup when approved components already cover the interaction.

---

# 17. Product/media patterns

## Product form

Use:
- persistent labels;
- helper text;
- explicit errors;
- responsive multi-column→single-column composition;
- InventoryField for STOCK only.

Fulfillment section:
- one obvious STOCK/PREORDER control;
- PREORDER reveals material, measurements and optional millimetre fields;
- PREORDER hides/disables InventoryField and renders a fixed terms note:
  `Tiempo estimado: 3–4 semanas` + `Pago: 50% al solicitar y 50% al entregar`;
- helper copy explains that PREORDER ignores stock and uses the global 50/50
  deposit rule;
- no provider/import/logistics fields are added to the public-facing form.

## UploadDropzone

States:
```text
default
processing
error
```

## Image processor

Composition:
```text
Original | Resultado
```

Pipeline pattern supports:
```text
upload
remove background
white background
center/padding
optimize
```

Processing/approval behavior remains defined by `doc/SPEC.md`.

---

# 18. Analytics patterns

Use:
- metric cards;
- horizontal bars;
- compact funnel;
- tables/lists;
- concise comparisons.

Business metric definitions come from `doc/SPEC.md`.

---

# 19. Settings patterns

Use:
- form sections;
- segmented controls;
- rate card;
- switches;
- delivery-point CRUD cards with map/list progressive enhancement;
- danger section;
- buttons.

Provider/business terminology is not controlled by visual specimens; actual copy follows `doc/SPEC.md`.

---

# 20. React + Tailwind implementation contract

## One token source

Colors, spacing, radii and motion live in CSS variables.

## Explicit props

Examples:

```tsx
<Button variant="primary" />
<OrderStatusBadge status="pending" />
<RateStatusBadge status="valid" />
<StockStatusBadge status="out" quantity={0} />
<FulfillmentBadge type="preorder" />
<PreorderTerms totalUsdCents={0} depositUsdCents={0} />
<ShippingMethodSelector method="personal" />
<RateNotice state="protected" compact />
<ConfirmationDialog variant="conflict" />
```

Do not infer semantic state from raw colors.

## Semantics first

Prefer semantic HTML and accessible state.

## Responsive by composition

Breakpoints reorganize layouts instead of scaling them.

## Reuse ProductCard

One implementation with explicit props/state.

## Store/Admin share tokens, not density

Do not force them into identical layouts.

## No invented v1 controls

Avoid:
- size selector;
- bottom nav;
- profile/favorites/customer account;
- dark-mode toggle.

## Mint discipline

Mint marks action, selected state, promotion, focus and confirmation.

---

# 21. Recommended React component inventory

```text
components/
├─ ui/
│  ├─ Button
│  ├─ IconButton
│  ├─ Input
│  ├─ SearchInput
│  ├─ FilterChip
│  ├─ SegmentedControl
│  ├─ Badge
│  ├─ QuantityStepper
│  ├─ Toast
│  ├─ Skeleton
│  ├─ EmptyState
│  ├─ ErrorState
│  ├─ Drawer
│  ├─ BottomSheet
│  └─ Dialog
├─ store/
│  ├─ StoreHeader
│  ├─ CurrencyToggle
│  ├─ PromoBanner
│  ├─ PromoProgress
│  ├─ ProductCard
│  ├─ ProductGrid
│  ├─ ProductGallery
│  ├─ FloatingCart
│  ├─ CartLine
│  ├─ CartSummary
│  ├─ FulfillmentBadge
│  ├─ PreorderTerms
│  ├─ DepositSummary
│  ├─ ShippingMethodSelector
│  ├─ PersonalDeliveryPointCard
│  ├─ PersonalDeliveryPointMap
│  ├─ DeliveryQuoteNotice
│  ├─ NationalCarrierSelector
│  ├─ SizeGuideStep
│  ├─ MeasurementIllustrationContainer
│  └─ WhatsAppCTA
├─ operations/
│  ├─ OrderStatusBadge
│  ├─ RateStatusBadge
│  ├─ StockStatusBadge
│  ├─ InventoryField
│  ├─ OrderReference
│  ├─ OrderMetaBlock
│  ├─ OrderItemRow
│  ├─ OrderSummary
│  ├─ TransactionComparison
│  ├─ RateNotice
│  ├─ ConflictState
│  ├─ OrderCreatedFeedback
│  ├─ OrderExpiryNotice
│  ├─ RateLimitNotice
│  ├─ AdminEntityCard
│  ├─ DataPair
│  ├─ Timeline
│  └─ ConfirmationDialog
└─ admin/
   ├─ AdminShell
   ├─ AdminSidebar
   ├─ AdminTopbar
   ├─ MetricCard
   ├─ AdminTable
   ├─ AdminToolbar
   ├─ FormSection
   ├─ UploadDropzone
   ├─ ImageProcessorPreview
   ├─ Pipeline
   └─ AnalyticsFunnel
```

Names may vary slightly in code; responsibilities/states should remain explicit.

---

# 22. Specimen-vs-business clarifications

- Example prices, rates and dates in the HTML are specimen content.
- Older Admin composition examples in the HTML do not override `doc/SPEC.md`.
- A full visual mockup is not required for every screen when approved components can compose it.
- `StockStatusBadge` / `InventoryField` do not define stock policy.
- `RateStatusBadge` / `RateNotice` do not define rate/provider policy.
- `OrderStatusBadge` does not define order transitions.
- `ConfirmationDialog` does not decide whether an operation is allowed.
- Store/Admin demo copy is illustrative unless explicitly locked in `doc/SPEC.md`.
- fulfillment labels, deposit math, shipping eligibility and size-guide
  content are locked by `doc/SPEC.md`; specimens only define their hierarchy and
  responsive presentation.

---

# 23. Final v1.1 design acceptance

Implementation is visually compliant when it:

- uses one token source;
- uses approved brand assets;
- remains light-only;
- reuses approved primitives;
- uses Commerce & Operations components for orders/inventory/rate/conflicts;
- distinguishes `Disponible` and `Bajo pedido` with `FulfillmentBadge`;
- keeps PREORDER terms/deposit summary separate from STOCK shipping selection;
- provides an accessible size-guide composition in millimetres;
- keeps Store mobile-first and Admin operational;
- reorganizes layouts responsively;
- preserves 44px mobile targets;
- maintains accessible semantics;
- introduces no unsupported customer/account/size/dark-mode UI;
- does not create a second component language for screens not explicitly mocked.

`design/CORU_Design_System_v1.html` remains the approved v1 specimen board;
the v1.1 component/state additions in this document supplement it until their
own rendered specimens are approved.
