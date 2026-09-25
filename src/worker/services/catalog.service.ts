import type { Product, ProductArtwork, ProductCategory, Category, FulfillmentType } from '../../shared/types'
import { deriveRingMeasurements } from '../../shared/ring-size'
import type { CoruState } from '../state'
import { orderProductImages } from './image.service'

export type CatalogErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT'

export class CatalogServiceError extends Error {
  constructor(public readonly code: CatalogErrorCode, message: string) {
    super(message)
    this.name = 'CatalogServiceError'
  }
}

function id(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function ensureCategory(state: CoruState, value: unknown): ProductCategory {
  if (typeof value !== 'string' || value.trim().length === 0) throw new CatalogServiceError('VALIDATION_ERROR', 'La categoría no es válida.')
  const category = state.categories.find((entry) => entry.name === value.trim() && entry.active)
  if (!category) throw new CatalogServiceError('VALIDATION_ERROR', 'La categoría no está activa.')
  return value.trim()
}

function ensureArtwork(value: unknown): ProductArtwork {
  const allowed: ProductArtwork[] = ['orbita', 'star', 'cross', 'skull', 'pearl', 'chain']
  if (typeof value !== 'string' || !allowed.includes(value as ProductArtwork)) throw new CatalogServiceError('VALIDATION_ERROR', 'El arte del producto no es válido.')
  return value as ProductArtwork
}

function requiredText(value: unknown, label: string, max = 240): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) throw new CatalogServiceError('VALIDATION_ERROR', `${label} es obligatorio.`)
  return value.trim()
}

function nonNegativeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new CatalogServiceError('VALIDATION_ERROR', `${label} debe ser un entero no negativo.`)
  return value
}

export type ProductInput = {
  name: string
  slug?: string
  category: ProductCategory
  sizeLabel: string
  priceCents: number
  stockQuantity?: number
  active?: boolean
  primaryImageApproved?: boolean
  promoEligible?: boolean
  artwork: ProductArtwork
  description?: string
  material?: string
  fulfillmentType?: FulfillmentType
  measurementsText?: string | null
  innerDiameterMm?: number | null
  circumferenceMm?: number | null
  usSize?: string | null
  leadTime?: string | null
}

function normalizedMeasurement(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round((value + Number.EPSILON) * 10) / 10
    : undefined
}

function normalizedUsSize(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const result = value.trim().slice(0, 20)
  return result || undefined
}

function ringMeasurementFields(input: { innerDiameterMm?: number | null; circumferenceMm?: number | null; usSize?: string | null }): Pick<Product, 'innerDiameterMm' | 'circumferenceMm' | 'usSize'> {
  const innerDiameterMm = normalizedMeasurement(input.innerDiameterMm)
  const explicitCircumference = normalizedMeasurement(input.circumferenceMm)
  const explicitUsSize = normalizedUsSize(input.usSize)
  if (innerDiameterMm === undefined) {
    return {
      ...(explicitCircumference === undefined ? {} : { circumferenceMm: explicitCircumference }),
      ...(explicitUsSize === undefined ? {} : { usSize: explicitUsSize }),
    }
  }
  const derived = deriveRingMeasurements(innerDiameterMm)
  return {
    innerDiameterMm,
    circumferenceMm: explicitCircumference ?? derived.circumferenceMm,
    usSize: explicitUsSize ?? derived.usSize,
  }
}

function assertUnique(state: CoruState, slug: string, idToIgnore?: string): void {
  if (state.products.some((product) => product.id !== idToIgnore && product.slug === slug)) throw new CatalogServiceError('CONFLICT', 'Ya existe un producto con ese slug.')
}

export function listAdminProducts(state: CoruState): Product[] {
  return state.products.map((product) => {
    const primaryImage = orderProductImages([...state.images.values()].filter((image) => image.productId === product.id))[0]
    if (!primaryImage) return { ...product }

    // The admin list is behind the access boundary, so it can use the private
    // preview route. This also keeps photos visible for hidden or sold-out
    // products, where the public media route intentionally returns 404.
    const imageUrl = `/api/admin/products/${encodeURIComponent(product.id)}/images/${encodeURIComponent(primaryImage.id)}/preview`
    return { ...product, imageUrl, imageUrls: [imageUrl], imageSources: [{ id: primaryImage.id, src: imageUrl }] }
  })
}

export function createProduct(state: CoruState, input: ProductInput): Product {
  const name = requiredText(input.name, 'El nombre')
  const slug = slugify(input.slug || name)
  if (!slug) throw new CatalogServiceError('VALIDATION_ERROR', 'El slug no es válido.')
  assertUnique(state, slug)
  const category = ensureCategory(state, input.category)
  const product: Product = {
    id: id('product'), slug, name, category,
    sizeLabel: requiredText(input.sizeLabel, 'La información de talla', 80),
    priceCents: nonNegativeInt(input.priceCents, 'El precio'),
    stockQuantity: input.stockQuantity === undefined ? 0 : nonNegativeInt(input.stockQuantity, 'El stock'),
    active: input.active ?? true,
    primaryImageApproved: input.primaryImageApproved ?? false,
    promoEligible: input.promoEligible ?? category === 'Anillos',
    artwork: ensureArtwork(input.artwork),
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 500) : '',
    material: typeof input.material === 'string' ? input.material.trim().slice(0, 120) : '',
    fulfillmentType: input.fulfillmentType ?? 'STOCK',
    ...(typeof input.measurementsText === 'string' && input.measurementsText.trim() ? { measurementsText: input.measurementsText.trim().slice(0, 240) } : {}),
    ...ringMeasurementFields(input),
    ...(typeof input.leadTime === 'string' && input.leadTime.trim() ? { leadTime: input.leadTime.trim().slice(0, 80) } : {}),
  }
  state.products.push(product)
  return product
}

export function updateProduct(state: CoruState, productId: string, input: Partial<ProductInput>): Product {
  const product = state.products.find((candidate) => candidate.id === productId)
  if (!product) throw new CatalogServiceError('NOT_FOUND', 'Producto no encontrado.')
  if (input.name !== undefined) product.name = requiredText(input.name, 'El nombre')
  if (input.slug !== undefined) {
    const slug = slugify(input.slug)
    if (!slug) throw new CatalogServiceError('VALIDATION_ERROR', 'El slug no es válido.')
    assertUnique(state, slug, productId)
    product.slug = slug
  }
  if (input.category !== undefined) product.category = ensureCategory(state, input.category)
  if (input.sizeLabel !== undefined) product.sizeLabel = requiredText(input.sizeLabel, 'La información de talla', 80)
  if (input.priceCents !== undefined) product.priceCents = nonNegativeInt(input.priceCents, 'El precio')
  if (input.stockQuantity !== undefined) product.stockQuantity = nonNegativeInt(input.stockQuantity, 'El stock')
  if (input.active !== undefined) product.active = Boolean(input.active)
  if (input.primaryImageApproved !== undefined) product.primaryImageApproved = Boolean(input.primaryImageApproved)
  if (input.promoEligible !== undefined) product.promoEligible = Boolean(input.promoEligible)
  if (input.artwork !== undefined) product.artwork = ensureArtwork(input.artwork)
  if (input.description !== undefined) product.description = typeof input.description === 'string' ? input.description.trim().slice(0, 500) : ''
  if (input.material !== undefined) product.material = typeof input.material === 'string' ? input.material.trim().slice(0, 120) : ''
  if (input.fulfillmentType !== undefined) {
    if (input.fulfillmentType !== 'STOCK' && input.fulfillmentType !== 'PREORDER') throw new CatalogServiceError('VALIDATION_ERROR', 'La modalidad no es válida.')
    product.fulfillmentType = input.fulfillmentType
    if (input.fulfillmentType === 'PREORDER' && !product.leadTime) product.leadTime = '3–4 semanas'
  }
  if (input.measurementsText !== undefined) {
    const measurementsText = typeof input.measurementsText === 'string' ? input.measurementsText.trim().slice(0, 240) : ''
    if (measurementsText) product.measurementsText = measurementsText
    else delete product.measurementsText
  }
  if (input.innerDiameterMm !== undefined) {
    // A new diameter is the base measurement. Omitted companions are
    // recalculated; the UI sends them explicitly when the operator wants to
    // keep a manual override.
    const measurements = ringMeasurementFields({
      innerDiameterMm: input.innerDiameterMm,
      circumferenceMm: input.circumferenceMm,
      usSize: input.usSize,
    })
    if (measurements.innerDiameterMm === undefined) delete product.innerDiameterMm
    else product.innerDiameterMm = measurements.innerDiameterMm
    if (measurements.circumferenceMm === undefined) delete product.circumferenceMm
    else product.circumferenceMm = measurements.circumferenceMm
    if (measurements.usSize === undefined) delete product.usSize
    else product.usSize = measurements.usSize
  } else if (input.circumferenceMm !== undefined || input.usSize !== undefined) {
    if (input.circumferenceMm !== undefined) {
      const circumferenceMm = normalizedMeasurement(input.circumferenceMm)
      if (circumferenceMm === undefined) delete product.circumferenceMm
      else product.circumferenceMm = circumferenceMm
    }
    if (input.usSize !== undefined) {
      const usSize = normalizedUsSize(input.usSize)
      if (usSize === undefined) delete product.usSize
      else product.usSize = usSize
    }
  }
  if (input.leadTime !== undefined) product.leadTime = typeof input.leadTime === 'string' && input.leadTime.trim() ? input.leadTime.trim().slice(0, 80) : undefined
  return product
}

/** Permanently removes an inactive product and keeps inventory history intact. */
export function deleteProduct(state: CoruState, productId: string): Product {
  const index = state.products.findIndex((product) => product.id === productId)
  if (index < 0) throw new CatalogServiceError('NOT_FOUND', 'Producto no encontrado.')
  const product = state.products[index]
  if (product.active) throw new CatalogServiceError('CONFLICT', 'Oculta el producto antes de eliminarlo.')
  if (state.movements.some((movement) => movement.productId === productId)) throw new CatalogServiceError('CONFLICT', 'No se puede eliminar un producto con movimientos de inventario.')
  state.products.splice(index, 1)
  return { ...product }
}

export function listCategories(state: CoruState): Category[] {
  return [...state.categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map((category) => ({ ...category }))
}

export function createCategory(state: CoruState, input: { name: string; slug?: string; sortOrder?: number; active?: boolean }): Category {
  const name = requiredText(input.name, 'El nombre de la categoría', 80)
  const slug = slugify(input.slug || name)
  if (!slug) throw new CatalogServiceError('VALIDATION_ERROR', 'El slug no es válido.')
  if (state.categories.some((category) => category.slug === slug || category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new CatalogServiceError('CONFLICT', 'Ya existe una categoría con ese nombre o slug.')
  const sortOrder = input.sortOrder === undefined ? state.categories.length + 1 : nonNegativeInt(input.sortOrder, 'El orden')
  const category = { id: id('category'), name, slug, sortOrder, active: input.active ?? true }
  state.categories.push(category)
  return category
}

export function updateCategory(state: CoruState, categoryId: string, input: Partial<{ name: string; slug: string; sortOrder: number; active: boolean }>): Category {
  const category = state.categories.find((candidate) => candidate.id === categoryId)
  if (!category) throw new CatalogServiceError('NOT_FOUND', 'Categoría no encontrada.')
  if (input.name !== undefined) {
    const name = requiredText(input.name, 'El nombre de la categoría', 80)
    if (state.categories.some((candidate) => candidate.id !== categoryId && candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new CatalogServiceError('CONFLICT', 'Ya existe una categoría con ese nombre.')
    const previousName = category.name
    category.name = name
    // Keep the denormalized product/promotion category labels coherent with
    // the category record. Historical order snapshots remain untouched.
    state.products.forEach((product) => { if (product.category === previousName) product.category = name })
    state.promotions.forEach((promotion) => { if (promotion.targetCategory === previousName) promotion.targetCategory = name })
  }
  if (input.slug !== undefined) {
    const slug = slugify(input.slug)
    if (!slug) throw new CatalogServiceError('VALIDATION_ERROR', 'El slug no es válido.')
    if (state.categories.some((candidate) => candidate.id !== categoryId && candidate.slug === slug)) throw new CatalogServiceError('CONFLICT', 'Ya existe una categoría con ese slug.')
    category.slug = slug
  }
  if (input.sortOrder !== undefined) category.sortOrder = nonNegativeInt(input.sortOrder, 'El orden')
  if (input.active !== undefined) category.active = Boolean(input.active)
  return category
}

/** Permanently removes an unused category. Categories with products or
 * promotion rules remain archive-only so their historical references stay
 * intact. */
export function removeCategory(state: CoruState, categoryId: string): Category {
  const category = state.categories.find((candidate) => candidate.id === categoryId)
  if (!category) throw new CatalogServiceError('NOT_FOUND', 'Categoría no encontrada.')
  if (state.products.some((product) => product.category === category.name)) throw new CatalogServiceError('CONFLICT', 'No puedes eliminar una categoría que tiene productos.')
  if (state.promotions.some((promotion) => promotion.targetCategory === category.name)) throw new CatalogServiceError('CONFLICT', 'No puedes eliminar una categoría vinculada a una promoción.')
  state.categories = state.categories.filter((candidate) => candidate.id !== categoryId)
  return { ...category, active: false }
}
