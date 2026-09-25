import type { PersonalDeliveryPoint, Product, Promotion } from './types'
import { formatUsd } from './commerce'
import { SIZE_GUIDE_ROWS, SIZE_GUIDE_RING_STEPS, SIZE_GUIDE_FINGER_STEPS } from './size-guide'
import { formatProductSizeLabel } from './ring-size'
import {
  ALL_RINGS_COLLECTION,
  allRingProducts,
  collectionPath,
  getCollectionDefinition,
  isCollectionPublished,
  productsForCollection,
  publishedCollections,
  relatedProductsFromCollection,
  type CollectionDefinition,
} from './collections'
import { NATIONAL_SHIPPING_COPY, YUMMY_DELIVERY_COPY } from './shipping-copy'

export const SITE_ORIGIN = 'https://coru.systems'
export const SITE_NAME = 'CORU'
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-default.jpg`
export const SITE_LOGO_URL = `${SITE_ORIGIN}/brand/coru-logo.svg`

export const BRAND_INSTAGRAM_URL = 'https://www.instagram.com/corucore.jpg/'
export const BRAND_FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61594548357564'

export const HOME_TITLE = 'Anillos en Maracaibo · CORU'
export const HOME_DESCRIPTION_BASE = 'Anillos plateados con actitud: calaveras, serpientes, corazones y más. Entrega en Maracaibo y envíos a toda Venezuela. Pide por WhatsApp.'
export const DELIVERY_DESCRIPTION_FALLBACK = 'Entrega personal en C.C. El Gran Ruby, C.C. La Paragua y C.C. La Campana, delivery en Maracaibo y envíos nacionales por MRW o ZOOM.'

const TITLE_MAX = 60
const DESCRIPTION_MAX = 160

export type SeoRouteKind = 'home' | 'product' | 'collection' | 'delivery' | 'size-guide' | 'privacy' | 'not-found' | 'admin'

/** Product shape accepted by SEO builders (full Product or public catalog DTO). */
export type SeoProduct = Pick<Product, 'id' | 'slug' | 'name' | 'category' | 'description' | 'material' | 'priceCents' | 'sizeLabel'> & {
  stockQuantity?: number
  fulfillmentType?: Product['fulfillmentType']
  usSize?: string
  measurementsText?: string
  imageUrl?: string
  imageUrls?: string[]
  imageSources?: Product['imageSources']
}

export type SeoDeliveryPoint = Pick<PersonalDeliveryPoint, 'name' | 'address'>

export type SeoPageInput = {
  kind: SeoRouteKind
  path: string
  product?: SeoProduct | null
  products?: SeoProduct[]
  promotion?: Pick<Promotion, 'kind' | 'bundleQuantity' | 'bundlePriceCents'> & { name?: string } | null
  /** Thematic slug for /anillos/:slug; omit for umbrella /anillos. */
  collectionSlug?: string
  /** When false/undefined for a thematic collection, page is 404. */
  collectionPublished?: boolean
  collectionProducts?: SeoProduct[]
  otherCollections?: Array<Pick<CollectionDefinition, 'slug' | 'h1'>>
  deliveryPoints?: SeoDeliveryPoint[]
}

export type SeoMetaTag = { attr: 'name' | 'property'; key: string; content: string }

export type SeoPageMeta = {
  title: string
  description: string
  canonical: string
  robots?: string
  ogType: 'website' | 'product'
  ogImage: string
  twitterCard: 'summary_large_image'
  metaTags: SeoMetaTag[]
  jsonLd: unknown[]
  status: 200 | 404
  /** Early fetch for the first home-card image. Same srcset the grid will request. */
  imagePreload?: string
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function escapeHtmlAttr(value: string): string {
  return escapeHtml(value)
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** JSON.stringify then neutralize `</script>` breakouts inside inline script tags. */
export function stringifyJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  return `${SITE_ORIGIN}${path}`
}

export function truncateClean(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  const slice = normalized.slice(0, Math.max(0, max - 1))
  const boundary = slice.lastIndexOf(' ')
  const cut = boundary > max * 0.55 ? slice.slice(0, boundary) : slice
  return `${cut.trimEnd()}…`
}

/** First sentence of the product copy when it actually describes the piece. */
export function productImageAlt(name: string, material?: string, description?: string): string {
  const sentence = description?.trim().split(/(?<=[.!?…])\s/)[0]?.replace(/[.!?…]+$/, '').trim()
  if (sentence && sentence.length >= 24) return sentence.length > 160 ? truncateClean(sentence, 160).replace(/…$/, '').trim() : sentence
  const mat = material?.trim()
  return mat ? `${name}, ${mat.toLocaleLowerCase('es')}` : name
}

export function promoHomePhrase(promotion: SeoPageInput['promotion']): string | undefined {
  if (!promotion || promotion.kind !== 'BUNDLE') return undefined
  const qty = promotion.bundleQuantity
  const cents = promotion.bundlePriceCents
  if (!qty || cents === undefined || cents < 0) return undefined
  const dollars = (cents / 100).toFixed(2).replace(/\.00$/, '')
  return `Promo: ${qty} anillos por $${dollars}`
}

function productAvailability(product: SeoProduct): string {
  return (product.fulfillmentType ?? 'STOCK') === 'PREORDER' ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock'
}

function productAvailabilityLabel(product: SeoProduct): string {
  if ((product.fulfillmentType ?? 'STOCK') === 'PREORDER') return 'Bajo pedido'
  if ((product.stockQuantity ?? 1) <= 0) return 'Agotado'
  if ((product.stockQuantity ?? 1) <= 3) return 'Últimas piezas'
  return 'En stock'
}

const CARD_IMAGE_SIZES = '(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw'

/** Preload the first catalog card so the browser fetches it with the HTML, not after JS. */
function homeCardPreload(products: SeoProduct[] | undefined): string | undefined {
  const product = products?.find((entry) => entry.imageSources?.[0] || entry.imageUrl)
  const source = product?.imageSources?.[0]
  const href = source?.thumb640 ?? source?.thumb320 ?? source?.src ?? product?.imageUrl
  if (!href) return undefined
  const srcSet = [[source?.thumb320, '320w'], [source?.thumb640, '640w']].filter((entry): entry is [string, string] => Boolean(entry[0])).map(([url, width]) => `${escapeHtmlAttr(absoluteUrl(url))} ${width}`).join(', ')
  const srcAttr = srcSet ? ` imagesrcset="${srcSet}" imagesizes="${CARD_IMAGE_SIZES}"` : ''
  return `<link rel="preload" as="image" href="${escapeHtmlAttr(absoluteUrl(href))}"${srcAttr} fetchpriority="high" />`
}

function productImageUrls(product: SeoProduct): string[] {
  const sources = product.imageSources ?? []
  const fromSources = sources.map((image) => absoluteUrl(image.detail1200 ?? image.src)).filter(Boolean)
  if (fromSources.length) return fromSources
  if (product.imageUrls?.length) return product.imageUrls.map(absoluteUrl)
  if (product.imageUrl) return [absoluteUrl(product.imageUrl)]
  return [DEFAULT_OG_IMAGE]
}

function productOgImage(product: SeoProduct): string {
  const jpeg = product.imageSources?.[0]?.og1200
  if (jpeg) return absoluteUrl(jpeg)
  return productImageUrls(product)[0] ?? DEFAULT_OG_IMAGE
}

function asSentence(text: string | undefined): string | undefined {
  const trimmed = text?.trim()
  if (!trimmed) return undefined
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function productDescription(product: SeoProduct): string {
  const material = product.material?.trim()
  const parts = [asSentence(product.description), material ? `Material: ${material}.` : undefined, asSentence(formatProductSizeLabel(product, ''))].filter(Boolean) as string[]
  parts.push('Entrega en Maracaibo o envío nacional.')
  return truncateClean(parts.join(' '), DESCRIPTION_MAX)
}

function canonicalFor(path: string): string {
  const normalized = path.replace(/\/+$/, '') || '/'
  return absoluteUrl(normalized)
}

function onlineStoreJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: SITE_NAME,
    url: SITE_ORIGIN,
    logo: SITE_LOGO_URL,
    areaServed: [
      { '@type': 'City', name: 'Maracaibo' },
      { '@type': 'State', name: 'Zulia' },
      { '@type': 'Country', name: 'Venezuela' },
    ],
    sameAs: [BRAND_INSTAGRAM_URL, BRAND_FACEBOOK_URL],
  }
}

function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_ORIGIN,
  }
}

function productJsonLd(product: SeoProduct, path: string) {
  const images = productImageUrls(product)
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: images,
    sku: product.id,
    brand: { '@type': 'Brand', name: SITE_NAME },
    material: product.material,
    offers: {
      '@type': 'Offer',
      url: canonicalFor(path),
      priceCurrency: 'USD',
      price: (product.priceCents / 100).toFixed(2),
      availability: productAvailability(product),
      seller: { '@type': 'Organization', name: SITE_NAME },
    },
  }
}

function breadcrumbJsonLd(product: SeoProduct) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: 'Anillos', item: absoluteUrl('/anillos') },
      { '@type': 'ListItem', position: 3, name: product.name, item: absoluteUrl(`/producto/${encodeURIComponent(product.slug)}`) },
    ],
  }
}

function collectionBreadcrumbJsonLd(h1: string, path: string, thematic: boolean) {
  const items = [
    { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_ORIGIN },
    { '@type': 'ListItem', position: 2, name: 'Anillos', item: absoluteUrl('/anillos') },
  ]
  if (thematic) items.push({ '@type': 'ListItem', position: 3, name: h1, item: canonicalFor(path) })
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items }
}

function collectionPageJsonLd(h1: string, path: string, products: SeoProduct[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: h1,
    url: canonicalFor(path),
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: products.map((product, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: absoluteUrl(`/producto/${encodeURIComponent(product.slug)}`),
        name: product.name,
      })),
    },
  }
}

function deliveryBreadcrumbJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: 'Entregas en Maracaibo', item: absoluteUrl('/entregas-maracaibo') },
    ],
  }
}

export function deliveryDescriptionFromPoints(points: SeoDeliveryPoint[]): string {
  const names = points.map((point) => point.name.trim()).filter(Boolean)
  if (!names.length) return DELIVERY_DESCRIPTION_FALLBACK
  if (names.length === 1) return `Entrega personal en ${names[0]}, delivery en Maracaibo y envíos nacionales por MRW o ZOOM.`
  if (names.length === 2) return `Entrega personal en ${names[0]} y ${names[1]}, delivery en Maracaibo y envíos nacionales por MRW o ZOOM.`
  const head = names.slice(0, -1).join(', ')
  return `Entrega personal en ${head} y ${names[names.length - 1]}, delivery en Maracaibo y envíos nacionales por MRW o ZOOM.`
}

function notFoundMeta(canonical: string): SeoPageMeta {
  const title = truncateClean('Página no encontrada · CORU', TITLE_MAX)
  const description = truncateClean('La página que buscas no está disponible en CORU.', DESCRIPTION_MAX)
  return {
    title,
    description,
    canonical,
    robots: 'noindex, nofollow',
    ogType: 'website',
    ogImage: DEFAULT_OG_IMAGE,
    twitterCard: 'summary_large_image',
    metaTags: buildSocialTags({ title, description, canonical, ogType: 'website', ogImage: DEFAULT_OG_IMAGE }),
    jsonLd: [],
    status: 404,
  }
}

export function buildSeoMeta(input: SeoPageInput): SeoPageMeta {
  const path = input.path.replace(/\/+$/, '') || '/'
  const canonical = canonicalFor(path)

  if (input.kind === 'not-found' || (input.kind === 'product' && !input.product)) {
    return notFoundMeta(canonical)
  }

  if (input.kind === 'collection') {
    const thematic = Boolean(input.collectionSlug)
    if (thematic) {
      const definition = getCollectionDefinition(input.collectionSlug!)
      if (!definition || input.collectionPublished === false) return notFoundMeta(canonical)
      const products = input.collectionProducts ?? []
      const title = truncateClean(`${definition.h1} en Maracaibo · CORU`, TITLE_MAX)
      const description = truncateClean(`${definition.intro} Entrega en Maracaibo y envíos a toda Venezuela.`, DESCRIPTION_MAX)
      const ogImage = products[0] ? productOgImage(products[0]) : DEFAULT_OG_IMAGE
      return {
        title,
        description,
        canonical,
        ogType: 'website',
        ogImage,
        twitterCard: 'summary_large_image',
        metaTags: buildSocialTags({ title, description, canonical, ogType: 'website', ogImage }),
        jsonLd: [collectionPageJsonLd(definition.h1, path, products), collectionBreadcrumbJsonLd(definition.h1, path, true)],
        status: 200,
      }
    }
    const products = input.collectionProducts ?? input.products ?? []
    if (!isCollectionPublished(products.length, true)) return notFoundMeta(canonical)
    const title = truncateClean('Todos los anillos · CORU Maracaibo', TITLE_MAX)
    const description = truncateClean(`${ALL_RINGS_COLLECTION.intro} Entrega en Maracaibo y envíos a toda Venezuela.`, DESCRIPTION_MAX)
    const ogImage = products[0] ? productOgImage(products[0]) : DEFAULT_OG_IMAGE
    return {
      title,
      description,
      canonical,
      ogType: 'website',
      ogImage,
      twitterCard: 'summary_large_image',
      metaTags: buildSocialTags({ title, description, canonical, ogType: 'website', ogImage }),
      jsonLd: [collectionPageJsonLd(ALL_RINGS_COLLECTION.h1, path, products), collectionBreadcrumbJsonLd(ALL_RINGS_COLLECTION.h1, path, false)],
      status: 200,
    }
  }

  if (input.kind === 'delivery') {
    const title = truncateClean('Entregas en Maracaibo · CORU', TITLE_MAX)
    const description = truncateClean(deliveryDescriptionFromPoints(input.deliveryPoints ?? []), DESCRIPTION_MAX)
    return {
      title,
      description,
      canonical,
      ogType: 'website',
      ogImage: DEFAULT_OG_IMAGE,
      twitterCard: 'summary_large_image',
      metaTags: buildSocialTags({ title, description, canonical, ogType: 'website', ogImage: DEFAULT_OG_IMAGE }),
      jsonLd: [deliveryBreadcrumbJsonLd()],
      status: 200,
    }
  }

  if (input.kind === 'product' && input.product) {
    const product = input.product
    const title = truncateClean(`${product.name} · CORU Maracaibo`, TITLE_MAX)
    const description = productDescription(product)
    const ogImage = productOgImage(product)
    const priceAmount = (product.priceCents / 100).toFixed(2)
    return {
      title,
      description,
      canonical,
      ogType: 'product',
      ogImage,
      twitterCard: 'summary_large_image',
      metaTags: [
        ...buildSocialTags({ title, description, canonical, ogType: 'product', ogImage }),
        { attr: 'property', key: 'product:price:amount', content: priceAmount },
        { attr: 'property', key: 'product:price:currency', content: 'USD' },
      ],
      jsonLd: [productJsonLd(product, path), breadcrumbJsonLd(product)],
      status: 200,
    }
  }

  if (input.kind === 'size-guide') {
    const title = truncateClean('Cómo saber tu talla de anillo (tabla en cm) · CORU', TITLE_MAX)
    const description = truncateClean('Mide tu talla de anillo en casa con dos métodos y compárala con la tabla US en centímetros.', DESCRIPTION_MAX)
    return {
      title,
      description,
      canonical,
      ogType: 'website',
      ogImage: DEFAULT_OG_IMAGE,
      twitterCard: 'summary_large_image',
      metaTags: buildSocialTags({ title, description, canonical, ogType: 'website', ogImage: DEFAULT_OG_IMAGE }),
      jsonLd: [],
      status: 200,
    }
  }

  if (input.kind === 'privacy') {
    const title = truncateClean('Privacidad · CORU', TITLE_MAX)
    const description = truncateClean('Tu compra no necesita una cuenta. Guardamos poco, y siempre en tu control.', DESCRIPTION_MAX)
    return {
      title,
      description,
      canonical,
      ogType: 'website',
      ogImage: DEFAULT_OG_IMAGE,
      twitterCard: 'summary_large_image',
      metaTags: buildSocialTags({ title, description, canonical, ogType: 'website', ogImage: DEFAULT_OG_IMAGE }),
      jsonLd: [],
      status: 200,
    }
  }

  const promo = promoHomePhrase(input.promotion)
  const description = promo
    ? truncateClean(`${HOME_DESCRIPTION_BASE.replace(/\s*Pide por WhatsApp\.?\s*$/, '').trim()} ${promo}`, DESCRIPTION_MAX)
    : truncateClean(HOME_DESCRIPTION_BASE, DESCRIPTION_MAX)
  const title = truncateClean(HOME_TITLE, TITLE_MAX)
  return {
    title,
    description,
    canonical: canonicalFor('/'),
    ogType: 'website',
    ogImage: DEFAULT_OG_IMAGE,
    twitterCard: 'summary_large_image',
    metaTags: buildSocialTags({ title, description, canonical: canonicalFor('/'), ogType: 'website', ogImage: DEFAULT_OG_IMAGE }),
    jsonLd: [onlineStoreJsonLd(), websiteJsonLd()],
    imagePreload: homeCardPreload(input.products),
    status: 200,
  }
}

function buildSocialTags(input: { title: string; description: string; canonical: string; ogType: 'website' | 'product'; ogImage: string }): SeoMetaTag[] {
  return [
    { attr: 'property', key: 'og:site_name', content: SITE_NAME },
    { attr: 'property', key: 'og:locale', content: 'es_VE' },
    { attr: 'property', key: 'og:type', content: input.ogType },
    { attr: 'property', key: 'og:url', content: input.canonical },
    { attr: 'property', key: 'og:title', content: input.title },
    { attr: 'property', key: 'og:description', content: input.description },
    { attr: 'property', key: 'og:image', content: input.ogImage },
    { attr: 'name', key: 'twitter:card', content: 'summary_large_image' },
    { attr: 'name', key: 'twitter:title', content: input.title },
    { attr: 'name', key: 'twitter:description', content: input.description },
    { attr: 'name', key: 'twitter:image', content: input.ogImage },
  ]
}

function catalogListImage(product: SeoProduct, eager: boolean): string {
  const source = product.imageSources?.[0]
  const href = source?.thumb640 ?? source?.thumb320 ?? source?.detail1200 ?? source?.src ?? product.imageUrls?.[0] ?? product.imageUrl
  if (!href) return ''
  const alt = escapeHtmlAttr(productImageAlt(product.name, product.material, product.description))
  const loading = eager ? '' : ' loading="lazy"'
  return `<img src="${escapeHtmlAttr(absoluteUrl(href))}" alt="${alt}" width="320" height="320"${loading} />`
}

function productListFallback(products: SeoProduct[]): string {
  return products.map((product, index) => {
    const image = catalogListImage(product, index === 0)
    return `<li><a href="/producto/${escapeHtmlAttr(encodeURIComponent(product.slug))}">${image}${escapeHtml(product.name)} · ${escapeHtml(formatUsd(product.priceCents))}</a></li>`
  }).join('')
}

function otherCollectionsFallback(others: Array<Pick<CollectionDefinition, 'slug' | 'h1'>>, currentSlug?: string): string {
  const links = others
    .filter((entry) => entry.slug !== currentSlug)
    .map((entry) => `<a href="${escapeHtmlAttr(collectionPath(entry.slug))}">${escapeHtml(entry.h1)}</a>`)
  if (!links.length) return ''
  return `<p>Otras colecciones: ${links.join(' · ')}</p>`
}

export function buildFallbackHtml(input: SeoPageInput): string {
  if (input.kind === 'not-found' || (input.kind === 'product' && !input.product) || (input.kind === 'collection' && input.collectionSlug && input.collectionPublished === false)) {
    return `<div class="seo-fallback"><h1>Página no encontrada</h1><p>Vuelve al <a href="/">inicio</a> para seguir explorando.</p></div>`
  }

  if (input.kind === 'collection') {
    const thematic = Boolean(input.collectionSlug)
    const definition = thematic ? getCollectionDefinition(input.collectionSlug!) : undefined
    const h1 = thematic ? definition!.h1 : ALL_RINGS_COLLECTION.h1
    const intro = thematic ? definition!.intro : ALL_RINGS_COLLECTION.intro
    const products = input.collectionProducts ?? input.products ?? []
    const others = input.otherCollections ?? []
    const crumb = thematic
      ? `<nav aria-label="Migas de pan"><a href="/">Inicio</a> › <a href="/anillos">Anillos</a> › <span>${escapeHtml(h1)}</span></nav>`
      : `<nav aria-label="Migas de pan"><a href="/">Inicio</a> › <span>Anillos</span></nav>`
    return `<div class="seo-fallback">${crumb}<h1>${escapeHtml(h1)}</h1><p>${escapeHtml(intro)}</p><ul>${productListFallback(products)}</ul>${otherCollectionsFallback(others, input.collectionSlug)}<p><a href="/">Ver la tienda</a></p></div>`
  }

  if (input.kind === 'delivery') {
    const points = input.deliveryPoints ?? []
    const list = points.map((point) => `<li><strong>${escapeHtml(point.name)}</strong> — ${escapeHtml(point.address)}</li>`).join('')
    return `<div class="seo-fallback"><h1>Entregas en Maracaibo</h1><p>Elige cómo recibir tu pedido. Confirmamos todo por WhatsApp.</p><h2>Entrega personal</h2><ul>${list || '<li>Puntos a confirmar por WhatsApp.</li>'}</ul><h2>Delivery en Maracaibo</h2><p>${escapeHtml(YUMMY_DELIVERY_COPY)}</p><h2>Envío nacional</h2><p>${escapeHtml(NATIONAL_SHIPPING_COPY)}</p><h2>Cómo pedir</h2><ol><li>Agrega tus piezas al carrito.</li><li>Elige cómo recibirlas.</li><li>Envía tu pedido por WhatsApp y te confirmamos.</li></ol><p><a href="/">Ver la colección</a></p></div>`
  }

  if (input.kind === 'product' && input.product) {
    const product = input.product
    const price = escapeHtml(formatUsd(product.priceCents))
    const availability = escapeHtml(productAvailabilityLabel(product))
    const measurements = escapeHtml(product.measurementsText?.trim() || product.sizeLabel || '')
    const material = escapeHtml(product.material)
    const description = escapeHtml(product.description)
    const image = productImageUrls(product)[0]
    const alt = escapeHtmlAttr(productImageAlt(product.name, product.material, product.description))
    const related = relatedProductsFromCollection(product, input.products?.length ? input.products : [product], 4)
    const collectionHref = 'match' in related.collection ? collectionPath(related.collection.slug) : '/anillos'
    const crumbTail = collectionHref === '/anillos'
      ? ''
      : `<a href="${escapeHtmlAttr(collectionHref)}">${escapeHtml(related.collection.h1)}</a> › `
    const relatedList = related.products.length
      ? `<h2>Más ${escapeHtml(related.collection.h1.toLocaleLowerCase('es'))}</h2><ul>${productListFallback(related.products)}</ul>`
      : ''
    return `<div class="seo-fallback"><nav aria-label="Migas de pan"><a href="/">Inicio</a> › <a href="/anillos">Anillos</a> › ${crumbTail}<span>${escapeHtml(product.name)}</span></nav><h1>${escapeHtml(product.name)}</h1><p><strong>${price}</strong> · ${availability}</p><p>${description}</p><p>Material: ${material}</p>${measurements ? `<p>Medidas: ${measurements}</p>` : ''}${image ? `<p><img src="${escapeHtmlAttr(image)}" alt="${alt}" width="600" height="600" /></p>` : ''}${relatedList}<p><a href="/guia-de-tallas">Guía de tallas</a> · <a href="${escapeHtmlAttr(collectionHref)}">Ver ${escapeHtml(related.collection.h1.toLocaleLowerCase('es'))}</a></p></div>`
  }

  if (input.kind === 'size-guide') {
    const rows = SIZE_GUIDE_ROWS.map(([size, diameter, circumference]) => `<tr><th scope="row">${escapeHtml(size)}</th><td>${escapeHtml(diameter)}</td><td>${escapeHtml(circumference)}</td></tr>`).join('')
    const ringSteps = SIZE_GUIDE_RING_STEPS.map((step) => `<li>${escapeHtml(step)}</li>`).join('')
    const fingerSteps = SIZE_GUIDE_FINGER_STEPS.map((step) => `<li>${escapeHtml(step)}</li>`).join('')
    return `<div class="seo-fallback"><h1>¿Cómo saber tu talla de anillo?</h1><p>Mídela en casa fácilmente antes de comprar en CORU.</p><h2>Método 1: mide un anillo que ya uses</h2><ol>${ringSteps}</ol><h2>Método 2: mide tu dedo</h2><ol>${fingerSteps}</ol><h2>Tabla de tallas CORU</h2><table><thead><tr><th scope="col">Talla US</th><th scope="col">Diámetro interior (cm)</th><th scope="col">Circunferencia (cm)</th></tr></thead><tbody>${rows}</tbody></table><p><a href="/anillos">Ver anillos</a> · <a href="/entregas-maracaibo">Entregas en Maracaibo</a> · <a href="/">Volver a la tienda</a></p></div>`
  }

  if (input.kind === 'privacy') {
    return `<div class="seo-fallback"><h1>Privacidad sin letra pequeña.</h1><p>Tu compra no necesita una cuenta. Guardamos poco, y siempre en tu control.</p><p><a href="/">Volver a la tienda</a></p></div>`
  }

  const products = input.products ?? []
  const list = productListFallback(products)
  const styleLinks = (input.otherCollections ?? publishedCollections(products).map(({ slug, h1 }) => ({ slug, h1 })))
    .map((entry) => `<a href="${escapeHtmlAttr(collectionPath(entry.slug))}">${escapeHtml(entry.h1)}</a>`)
    .join(' · ')
  return `<div class="seo-fallback"><h1>Arma tu combo</h1><p>Anillos y accesorios en Maracaibo · Envíos a toda Venezuela</p>${styleLinks ? `<p>Explora por estilo: ${styleLinks}</p>` : ''}<ul>${list}</ul><p><a href="/guia-de-tallas">Guía de tallas</a> · <a href="/entregas-maracaibo">Entregas en Maracaibo</a> · <a href="/privacidad">Privacidad</a> · <a href="${escapeHtmlAttr(BRAND_INSTAGRAM_URL)}" rel="noopener" target="_blank">Instagram</a> · <a href="${escapeHtmlAttr(BRAND_FACEBOOK_URL)}" rel="noopener" target="_blank">Facebook</a></p></div>`
}

export type SitemapEntry = { loc: string; lastmod?: string }

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const lastmod = entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod.slice(0, 10))}</lastmod>` : ''
    return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmod}\n  </url>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

export function injectSeoIntoHtml(shellHtml: string, meta: SeoPageMeta, fallbackHtml: string): string {
  let html = shellHtml
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`)
  if (/<meta\s+name=["']description["'][^>]*>/i.test(html)) {
    html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${escapeHtmlAttr(meta.description)}" />`)
  } else {
    html = html.replace(/<\/head>/i, `  <meta name="description" content="${escapeHtmlAttr(meta.description)}" />\n</head>`)
  }

  const canonicalTag = `<link rel="canonical" href="${escapeHtmlAttr(meta.canonical)}" />`
  if (/<link\s+rel=["']canonical["'][^>]*>/i.test(html)) {
    html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/i, canonicalTag)
  }

  const headBits: string[] = []
  if (meta.imagePreload) headBits.push(meta.imagePreload)
  if (!html.includes(canonicalTag)) headBits.push(canonicalTag)
  if (meta.robots) headBits.push(`<meta name="robots" content="${escapeHtmlAttr(meta.robots)}" />`)
  for (const tag of meta.metaTags) {
    headBits.push(`<meta ${tag.attr}="${escapeHtmlAttr(tag.key)}" content="${escapeHtmlAttr(tag.content)}" />`)
  }
  for (const block of meta.jsonLd) {
    headBits.push(`<script type="application/ld+json">${stringifyJsonLd(block)}</script>`)
  }
  html = html.replace(/<\/head>/i, `  ${headBits.join('\n  ')}\n</head>`)

  if (/<div id=["']root["'][^>]*>\s*<\/div>/i.test(html)) {
    html = html.replace(/<div id=["']root["'][^>]*>\s*<\/div>/i, `<div id="root">${fallbackHtml}</div>`)
  } else {
    html = html.replace(/<div id=["']root["'][^>]*>/i, (match) => `${match}${fallbackHtml}`)
  }
  return html
}

/** Client-side document head sync for SPA navigations (mirrors server meta). */
export function applyDocumentSeo(meta: SeoPageMeta): void {
  if (typeof document === 'undefined') return
  document.title = meta.title
  let description = document.querySelector('meta[name="description"]')
  if (!description) {
    description = document.createElement('meta')
    description.setAttribute('name', 'description')
    document.head.appendChild(description)
  }
  description.setAttribute('content', meta.description)

  let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
  if (!canonical) {
    canonical = document.createElement('link')
    canonical.rel = 'canonical'
    document.head.appendChild(canonical)
  }
  canonical.href = meta.canonical

  let robots = document.querySelector('meta[name="robots"]')
  if (meta.robots) {
    if (!robots) {
      robots = document.createElement('meta')
      robots.setAttribute('name', 'robots')
      document.head.appendChild(robots)
    }
    robots.setAttribute('content', meta.robots)
  } else if (robots) {
    robots.remove()
  }
}

export { allRingProducts, productsForCollection, publishedCollections, collectionPath, getCollectionDefinition, isCollectionPublished }
