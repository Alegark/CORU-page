import type { CartLine, CommerceQuote, Currency, Product, Promotion } from './types'

export const PROMOTION_ID = 'promo-3x10'
export const BUNDLE_SIZE = 3
export const BUNDLE_PRICE_CENTS = 1000

type Unit = { productId: string; priceCents: number }

export type PromotionRule = Pick<Promotion, 'id' | 'name' | 'kind' | 'targetCategory' | 'bundleQuantity' | 'bundlePriceCents' | 'fixedDiscountCents'>

const defaultPromotion: PromotionRule = { id: PROMOTION_ID, name: '3 anillos por $10', kind: 'BUNDLE', targetCategory: 'Anillos', bundleQuantity: BUNDLE_SIZE, bundlePriceCents: BUNDLE_PRICE_CENTS }

export function quoteCart(lines: CartLine[], products: Product[], promotion: PromotionRule | null | undefined = defaultPromotion): CommerceQuote {
  const activePromotion = promotion === undefined ? defaultPromotion : promotion
  const productById = new Map(products.map((product) => [product.id, product]))
  const normalized = new Map<string, number>()
  for (const line of lines) {
    if (!line.productId || line.quantity <= 0) continue
    normalized.set(line.productId, (normalized.get(line.productId) ?? 0) + Math.floor(line.quantity))
  }

  let subtotalCents = 0
  let fixedPromotionSubtotal = 0
  const eligibleUnits: Unit[] = []
  for (const [productId, quantity] of normalized) {
    const product = productById.get(productId)
    if (!product) continue
    subtotalCents += product.priceCents * quantity
    const isStock = (product.fulfillmentType ?? 'STOCK') === 'STOCK'
    if (isStock && activePromotion?.kind === 'FIXED_DISCOUNT' && (!activePromotion.targetCategory || product.category === activePromotion.targetCategory)) fixedPromotionSubtotal += product.priceCents * quantity
    if (isStock && activePromotion && product.promoEligible && (!activePromotion.targetCategory || product.category === activePromotion.targetCategory)) {
      for (let index = 0; index < quantity; index += 1) eligibleUnits.push({ productId, priceCents: product.priceCents })
    }
  }

  eligibleUnits.sort((a, b) => b.priceCents - a.priceCents || a.productId.localeCompare(b.productId))
  if (activePromotion?.kind === 'FIXED_DISCOUNT') {
    const discountCents = Math.min(fixedPromotionSubtotal, activePromotion.fixedDiscountCents ?? 0)
    return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents, ...(discountCents > 0 ? { appliedPromotion: { id: activePromotion.id, name: activePromotion.name, groupsApplied: 1 } } : {}) }
  }
  const bundleSize = activePromotion?.bundleQuantity ?? BUNDLE_SIZE
  const bundlePrice = activePromotion?.bundlePriceCents ?? BUNDLE_PRICE_CENTS
  const groupsApplied = bundleSize > 0 ? Math.floor(eligibleUnits.length / bundleSize) : 0
  const bundledUnits = groupsApplied * bundleSize
  const bundledSubtotal = eligibleUnits.slice(0, bundledUnits).reduce((sum, unit) => sum + unit.priceCents, 0)
  const eligibleRemainder = eligibleUnits.slice(bundledUnits).reduce((sum, unit) => sum + unit.priceCents, 0)
  const nonEligibleSubtotal = subtotalCents - eligibleUnits.reduce((sum, unit) => sum + unit.priceCents, 0)
  const totalCents = Math.min(subtotalCents, nonEligibleSubtotal + eligibleRemainder + groupsApplied * bundlePrice)
  const discountCents = Math.max(0, subtotalCents - totalCents)

  return {
    subtotalCents,
    discountCents,
    totalCents,
    ...(groupsApplied > 0 && activePromotion ? { appliedPromotion: { id: activePromotion.id, name: activePromotion.name, groupsApplied } } : {}),
  }
}

export function convertUsdCentsToBs(usdCents: number, rateMicros: number): number {
  if (!Number.isFinite(rateMicros) || rateMicros <= 0) return 0
  return Math.floor((usdCents * rateMicros + 500_000) / 1_000_000)
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace('.00', '')}`
}

export function formatBs(minor: number): string {
  return `Bs ${(minor / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Format a USD-denominated amount using the currently selected storefront currency. */
export function formatCurrencyAmount(usdCents: number, currency: Currency, rateMicros?: number | null): string {
  if (currency === 'Bs' && rateMicros && rateMicros > 0) return formatBs(convertUsdCentsToBs(usdCents, rateMicros))
  return formatUsd(usdCents)
}
