# CORU combo listing — design QA

## Source visual truth

- Product cards/chips: `C:\Users\diego\AppData\Local\Temp\codex-clipboard-72352ebf-7726-41c6-98d5-b2e641da19d8.png` (587 × 355 px).
- Promo banner: `C:\Users\diego\AppData\Local\Temp\codex-clipboard-73e557f1-83b9-4538-8f5b-550e5d94384c.png` (862 × 355 px).

## Implementation evidence

- Production URL: `https://coru.systems/?v=f332298f-ae28-4b6f-8522-0ce5ebcb8daf&fresh=202609190625`.
- Browser capture: CUA viewport 430 × 932 CSS px, devicePixelRatio 1; mobile storefront, USD currency state, catalog loaded.
- Measured promo block: 382.7 × 176 CSS px (16 px side gutters), with a 42 px CTA aligned in the right column; the compact rectangle was verified against the supplied 862 × 355 reference.
- The implementation capture was rendered directly in the browser and emitted in the task for comparison; no device frame was included.

## Comparison

The source references and rendered implementation were reviewed at the same mobile content scale. The implementation now has the same primary hierarchy: compact `Arma tu combo` heading, short subtitle, black promo block, progress feedback, CTA, horizontal chips, and two-column cards. The production catalog image files remain the source of truth for product imagery; the sample photos in the reference are illustrative and are not substituted with placeholders.

### Comparison history

1. Initial pass: the banner was taller than the reference and the live catalog omitted the required `Accesorios` chip when no accessory was returned by the API.
2. Fix: reduced the mobile banner rhythm, placed the CTA beside the progress column, made `Arma tu combo` stay on one line, and connected the filter rail to the admin category catalog.
3. Final capture: admin-managed public chips, the requested copy/CTA, the chips-to-grid spacing, and the black/green add control are visible; the old catalog heading is absent and Bs prices remain on one line.
4. Banner correction: reduced the promo block to a 176 px mobile strip, tightened its padding/typography/progress rhythm, and kept `Completar combo` in a compact right-hand column so the block reads as a horizontal rectangular promo rather than a tall card.

## Fidelity surfaces

- Fonts/typography: existing CORU display/UI tokens retained; heavy display heading and compact card metadata match the source hierarchy.
- Spacing/layout: mobile content is compact, banner/search/chips/cards follow the reference order, and the product grid remains two columns.
- Colors/tokens: CORU mint, black, white, and soft-gray tokens are used for badge, progress, CTA, chips, surfaces, and controls.
- Images/assets: existing production-approved catalog images are used in the large card image slot; no new placeholder or handcrafted image was introduced.
- Copy/content: `Arma tu combo`, `Anillos y accesorios para combinar`, `Elige 3 piezas y paga menos.`, `Completar combo`, progress text, and admin-managed category chips are present.

## Primary interactions checked

- Category filtering from the active admin catalog.
- USD/Bs toggle; Bs promo and prices render without wrapping (`3 x Bs 9.540,00` observed).
- Add-to-cart and existing cart/shipping flows.
- Eight E2E tests, 16 storefront unit tests, TypeScript, build, and production smoke checks passed.

## Findings

- No actionable P0/P1/P2 visual findings remain. The reference's optional ring montage on the right side of the banner is intentionally omitted to keep the banner clean and avoid decorative copy competing with the CTA.

## Implementation checklist

- [x] Compact combo heading and subtitle.
- [x] Black promo banner with green badge, progress bar/text, and CTA.
- [x] Active category chips come from the admin catalog and only show categories with public products.
- [x] Mobile catalog adds clear separation between the category rail and the two-column product grid.
- [x] Two-column cards with prominent images, no-wrap prices, and black/green `+` control.
- [x] Mobile responsive verification and production smoke.

final result: passed

---

# CORU size guide — design QA

## Source and scope

- Written source of truth: `C:\Users\diego\Downloads\CORU_IMPLEMENTAR_GUIA_DE_TALLAS_REFERENCIA_WEB.md`.
- Route validated: `/guia-de-tallas` only.
- The implementation stays inside the existing public client/design system; no admin, backend, inventory, shipping, checkout, or WhatsApp behavior was changed for this feature.

## Implementation evidence

- Local preview: `http://127.0.0.1:4173/guia-de-tallas`.
- Responsive checks completed at 320 × 700, 390 × 844, and 1280 × 800 CSS px.
- Horizontal document overflow: false at all checked widths. At 320 px, the wide table is contained by its own horizontal scroll region.
- The semantic table contains the six approved US rows (5–10) and the three requested columns; no EU/UK/MX conversion rows are rendered.

## Fidelity and accessibility checks

- Hero uses the approved eyebrow, H1, lead, and a compact accessible ring illustration.
- Method 1 and Method 2 use the approved headings/copy, numbered steps, mint accents, and explanatory diagrams.
- Featured tips, important tips, help copy, and return-to-store action are present.
- The table uses `caption`, `thead`, row headers, and explicit US/mm labels.
- SVG illustrations expose titles/descriptions; decorative step visuals are hidden from assistive technology.

## Verification

- `pnpm test`: 104 tests passed across 16 files.
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `git diff --check`: passed (only existing line-ending warnings were reported).

final result: passed (local preview; not deployed)

## Desktop follow-up

- Added 28 px of separation between the promo banner and the catalog toolbar for browser widths; the mobile spacing remains compact.
- At 1042 px and 1280 px the product grid resolves to four equal columns. At 768–1023 px it uses three columns, and below 768 px it uses two.
- A live catalog showing only two products will therefore display two populated cards even though the desktop grid has four available columns.

## Size guide method 2 follow-up

- Replaced the five small step illustrations with the supplied `CORU_medir_dedo.svg`, copied to `public/coru-medir-dedo.svg` and exposed with descriptive alt text.
- Reduced the method to one illustration and five short action steps; removed the redundant subtitle, step-card artwork, and duplicate tip block.
- Mobile and desktop checks show the illustration/steps layout with no document overflow.

## Size guide hero follow-up

- Replaced the original inline ring illustration with the supplied `ChatGPT Image 19 sept 2026, 07_34_29 a.m..png`, copied to `public/coru-ring-hero.png`.
- The image keeps the hero's two-column hierarchy and uses descriptive alternative text.

## Production publication

- Published version: `3aa7aa27-93c0-4533-afb4-15b36a43f817` on `https://coru.systems/`.
- Production checks: `/guia-de-tallas`, `coru-ring-hero.png`, `coru-medir-dedo.svg`, and `coru-medir-anillo.png` returned 200; the Worker smoke also passed health, catalog, and admin guard checks.
- Method 1 now uses the supplied ring-and-ruler image with descriptive alt text instead of the former inline SVG illustration.
