import type { Product } from './types'

export const COLLECTION_PUBLISH_MIN = 4
export const RINGS_CATEGORY = 'Anillos'

export type CollectionDefinition = {
  slug: string
  h1: string
  intro: string
  match: RegExp
}

/** Thematic collections (published only with ≥ COLLECTION_PUBLISH_MIN matching rings). */
export const COLLECTION_DEFINITIONS: readonly CollectionDefinition[] = [
  {
    slug: 'calaveras',
    h1: 'Anillos de calavera',
    intro: 'Calaveras con detalle y presencia. Piezas plateadas para darle carácter a cualquier combo.',
    match: /calavera/,
  },
  {
    slug: 'corazones',
    h1: 'Anillos de corazón',
    intro: 'Corazones con un giro: alados, góticos o en cadena. Para usar solos o combinados.',
    match: /corazon/,
  },
  {
    slug: 'flores',
    h1: 'Anillos de flores',
    intro: 'Flores, lotos y girasoles en metal plateado. Detalle fino para mezclar con piezas más pesadas.',
    match: /\b(flor|flores|loto|girasol(es)?)\b/,
  },
  {
    slug: 'sello',
    h1: 'Anillos sello',
    intro: 'Anillos sello con símbolos, piedras y grabados. Presencia desde el primer vistazo.',
    match: /\bsello\b/,
  },
  {
    slug: 'piedra-negra',
    h1: 'Anillos con piedra negra',
    intro: 'Piedras negras cuadradas u ovaladas sobre metal plateado. Contraste directo.',
    match: /piedra negra/,
  },
  {
    slug: 'abiertos',
    h1: 'Anillos abiertos',
    intro: 'Diseños abiertos: serpientes, alas, mariposas y más, con el frente al aire.',
    match: /\babiert[oa]s?\b/,
  },
  {
    slug: 'animales',
    h1: 'Anillos de animales',
    intro: 'Ranas, serpientes, dragones, murciélagos y mariposas. Bichos con actitud.',
    match: /\b(rana|serpiente|dragon|murcielago|mariposa)s?\b/,
  },
  {
    slug: 'goticos',
    h1: 'Anillos góticos',
    intro: 'Calaveras, murciélagos, dragones y llamas. Lo más oscuro de la colección.',
    match: /\b(calavera|murcielago|dragon|gotic[oa]|llamas|picas)\b/,
  },
] as const

export const ALL_RINGS_COLLECTION = {
  slug: 'anillos',
  path: '/anillos',
  h1: 'Todos los anillos',
  intro: 'La colección completa de anillos CORU, lista para combinar.',
} as const

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalizeCollectionText(value: string): string {
  return stripAccents(value).toLowerCase()
}

export type CollectionProduct = Pick<Product, 'name' | 'description' | 'category'>

export function productMatchesCollection(product: CollectionProduct, definition: CollectionDefinition): boolean {
  if (product.category !== RINGS_CATEGORY) return false
  const haystack = normalizeCollectionText(`${product.name} ${product.description}`)
  return definition.match.test(haystack)
}

export function productsForCollection<T extends CollectionProduct>(products: T[], definition: CollectionDefinition): T[] {
  return products.filter((product) => productMatchesCollection(product, definition))
}

export function allRingProducts<T extends CollectionProduct>(products: T[]): T[] {
  return products.filter((product) => product.category === RINGS_CATEGORY)
}

export function isCollectionPublished(productCount: number, umbrella = false): boolean {
  return umbrella ? productCount >= 1 : productCount >= COLLECTION_PUBLISH_MIN
}

export function getCollectionDefinition(slug: string): CollectionDefinition | undefined {
  return COLLECTION_DEFINITIONS.find((entry) => entry.slug === slug)
}

export function publishedCollections<T extends CollectionProduct>(products: T[]): Array<CollectionDefinition & { products: T[] }> {
  return COLLECTION_DEFINITIONS
    .map((definition) => ({ ...definition, products: productsForCollection(products, definition) }))
    .filter((entry) => isCollectionPublished(entry.products.length))
}

export function collectionPath(slug?: string): string {
  return slug ? `/anillos/${encodeURIComponent(slug)}` : '/anillos'
}

/** First published thematic collection that includes the product (definition order). */
export function firstPublishedCollectionForProduct<T extends CollectionProduct & { id?: string }>(product: T, catalog: T[]): (CollectionDefinition & { products: T[] }) | undefined {
  return publishedCollections(catalog).find((entry) => entry.products.some((candidate) => candidate === product || candidate.id === product.id || candidate.name === product.name))
}

export function relatedProductsFromCollection<T extends CollectionProduct & { id?: string; slug?: string }>(
  product: T,
  catalog: T[],
  limit = 4,
): { collection: CollectionDefinition | typeof ALL_RINGS_COLLECTION; products: T[] } {
  const published = publishedCollections(catalog)
  const match = published.find((entry) => entry.products.some((candidate) => candidate.id === product.id || candidate.name === product.name))
  const pool = (match?.products ?? allRingProducts(catalog)).filter((candidate) => candidate.id !== product.id && candidate.name !== product.name)
  return {
    collection: match ?? ALL_RINGS_COLLECTION,
    products: pool.slice(0, limit),
  }
}
