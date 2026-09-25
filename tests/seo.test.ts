import { describe, expect, it } from 'vitest'
import {
  buildFallbackHtml,
  buildSeoMeta,
  buildSitemapXml,
  escapeHtml,
  HOME_DESCRIPTION_BASE,
  HOME_TITLE,
  injectSeoIntoHtml,
  promoHomePhrase,
  stringifyJsonLd,
  truncateClean,
} from '../src/shared/seo'
import { demoProducts } from '../src/shared/catalog'

const shell = `<!doctype html><html lang="es-VE"><head><meta charset="UTF-8" /><meta name="description" content="old" /><title>Old</title></head><body><div id="root"></div></body></html>`

describe('seo metadata builders', () => {
  it('builds home title/description with optional promo phrase', () => {
    const base = buildSeoMeta({ kind: 'home', path: '/' })
    expect(base.title).toBe(HOME_TITLE)
    expect(base.description).toBe(HOME_DESCRIPTION_BASE)
    expect(base.canonical).toBe('https://coru.systems/')
    expect(base.jsonLd).toHaveLength(2)
    expect(base.jsonLd[0]).toMatchObject({ '@type': 'OnlineStore', name: 'CORU' })
    expect((base.jsonLd[0] as { sameAs: string[] }).sameAs).toEqual([
      'https://www.instagram.com/corucore.jpg/',
      'https://www.facebook.com/profile.php?id=61594548357564',
    ])
    expect(JSON.stringify(base.jsonLd)).not.toMatch(/aggregateRating|"telephone"/)

    const withPromo = buildSeoMeta({
      kind: 'home',
      path: '/',
      promotion: { kind: 'BUNDLE', bundleQuantity: 3, bundlePriceCents: 1000, name: '3x10' },
    })
    expect(withPromo.description).toContain('Promo: 3 anillos por $10')
    expect(withPromo.description).not.toMatch(/Pide por Promo/)
    expect(withPromo.description).toContain('envíos a toda Venezuela.')
    expect(withPromo.description.length).toBeLessThanOrEqual(160)
    expect(promoHomePhrase({ kind: 'BUNDLE', bundleQuantity: 3, bundlePriceCents: 1000 })).toBe('Promo: 3 anillos por $10')

    const withImage = buildSeoMeta({
      kind: 'home',
      path: '/',
      products: [{
        ...demoProducts[0],
        imageSources: [{ id: 'img-1', src: '/media/products/img-1/detail-1200.webp', thumb320: '/media/products/img-1/thumb-320.webp', thumb640: '/media/products/img-1/thumb-640.webp', detail1200: '/media/products/img-1/detail-1200.webp', og1200: '/media/products/img-1/og-1200.jpg' }],
      }],
    })
    expect(withImage.imagePreload).toContain('rel="preload"')
    expect(withImage.imagePreload).toContain('https://coru.systems/media/products/img-1/thumb-640.webp')
    expect(withImage.imagePreload).toContain('imagesrcset=')
    expect(withImage.imagePreload).toContain('(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw')
    const html = injectSeoIntoHtml(shell, withImage, '<div class="seo-fallback"></div>')
    expect(html.indexOf('rel="preload"')).toBeLessThan(html.indexOf('rel="canonical"'))
  })

  it('builds product meta without price in the title and with PreOrder availability', () => {
    const product = { ...demoProducts[5], imageSources: [{ id: 'img', src: '/media/products/img/detail-1200.webp', detail1200: '/media/products/img/detail-1200.webp' }] }
    const meta = buildSeoMeta({ kind: 'product', path: `/producto/${product.slug}`, product })
    expect(meta.title).toBe(`${product.name} · CORU Maracaibo`)
    expect(meta.title).not.toMatch(/\$/)
    expect(meta.ogType).toBe('product')
    expect(meta.metaTags.some((tag) => tag.key === 'product:price:amount')).toBe(true)
    const productLd = meta.jsonLd[0] as { offers: { availability: string; price: string }; material: string }
    expect(productLd.offers.availability).toBe('https://schema.org/PreOrder')
    expect(productLd.offers.price).toBe('4.50')
    expect(productLd.material).toBe(product.material)
    expect(JSON.stringify(meta.jsonLd)).not.toMatch(/aggregateRating|"telephone"/)
    expect(meta.jsonLd[1]).toMatchObject({ '@type': 'BreadcrumbList' })
  })

  it('writes product descriptions as separate sentences', () => {
    const meta = buildSeoMeta({ kind: 'product', path: '/producto/x', product: { ...demoProducts[0], description: 'Anillo plateado con calavera', material: 'Aleación de zinc', sizeLabel: 'US 7' } })
    expect(meta.description).toBe('Anillo plateado con calavera. Material: Aleación de zinc. Talla US 7. Entrega en Maracaibo o envío nacional.')
  })

  it('returns 404 meta for missing products and unknown routes', () => {
    expect(buildSeoMeta({ kind: 'product', path: '/producto/nope', product: null }).status).toBe(404)
    expect(buildSeoMeta({ kind: 'not-found', path: '/ruta-x' }).robots).toBe('noindex, nofollow')
  })

  it('escapes HTML and JSON-LD script breakouts', () => {
    const product = {
      ...demoProducts[0],
      name: `Anillo "especial" </script><img src=x onerror=alert(1)>`,
      description: 'Pieza con <b>énfasis</b>',
    }
    const meta = buildSeoMeta({ kind: 'product', path: `/producto/${product.slug}`, product })
    const html = injectSeoIntoHtml(shell, meta, buildFallbackHtml({ kind: 'product', path: `/producto/${product.slug}`, product }))
    expect(html).toContain(escapeHtml(product.name))
    expect(html).not.toContain('</script><img')
    expect(stringifyJsonLd({ name: product.name })).toContain('\\u003c')
    expect(stringifyJsonLd({ name: product.name })).not.toContain('</script>')
  })

  it('truncates descriptions on a word boundary', () => {
    const long = 'Palabra '.repeat(40).trim()
    const truncated = truncateClean(long, 40)
    expect(truncated.length).toBeLessThanOrEqual(40)
    expect(truncated.endsWith('…')).toBe(true)
    expect(truncated).not.toMatch(/\s…$/)
  })

  it('builds sitemap XML and home fallback product links', () => {
    const xml = buildSitemapXml([
      { loc: 'https://coru.systems/' },
      { loc: 'https://coru.systems/producto/orbita-oscura' },
    ])
    expect(xml).toContain('<loc>https://coru.systems/</loc>')
    expect(xml).toContain('/producto/orbita-oscura')

    const fallback = buildFallbackHtml({ kind: 'home', path: '/', products: demoProducts.slice(0, 2) })
    expect(fallback).toContain('<h1>Arma tu combo</h1>')
    expect(fallback).toContain('href="/producto/orbita-oscura"')
    expect(fallback).toContain('href="/guia-de-tallas"')
    expect(fallback).toContain('href="/privacidad"')
    expect(fallback).not.toContain('<img')

    const withPhoto = {
      ...demoProducts[0],
      description: 'Anillo plateado de aleación de zinc con calavera central.',
      imageSources: [{ id: 'img-1', src: '/media/products/img-1/detail-1200.webp', thumb320: '/media/products/img-1/thumb-320.webp', thumb640: '/media/products/img-1/thumb-640.webp' }],
    }
    const second = {
      ...demoProducts[1],
      imageSources: [{ id: 'img-2', src: '/media/products/img-2/detail-1200.webp', thumb640: '/media/products/img-2/thumb-640.webp' }],
    }
    const listed = buildFallbackHtml({
      kind: 'collection',
      path: '/anillos/calaveras',
      collectionSlug: 'calaveras',
      collectionPublished: true,
      collectionProducts: [withPhoto, second],
    })
    expect(listed).toContain('<img src="https://coru.systems/media/products/img-1/thumb-640.webp" alt="Anillo plateado de aleación de zinc con calavera central" width="320" height="320" />')
    expect(listed).toContain('<img src="https://coru.systems/media/products/img-2/thumb-640.webp" alt="')
    expect(listed).toContain('loading="lazy"')
    expect(listed.indexOf('thumb-640.webp')).toBeLessThan(listed.indexOf('loading="lazy"'))
  })

  it('keeps a single canonical and links a product to its collection', () => {
    const shellWithHomeCanonical = `<!doctype html><html><head><link rel="canonical" href="https://coru.systems/" /><title>Old</title><meta name="description" content="old" /></head><body><div id="root"></div></body></html>`
    const skulls = [0, 1, 2, 3].map((index) => ({
      ...demoProducts[1],
      id: `calavera-${index}`,
      slug: `calavera-${index}`,
      name: index === 0 ? 'Calavera orbital' : `Calavera ${index}`,
    }))
    const meta = buildSeoMeta({ kind: 'product', path: '/producto/calavera-0', product: skulls[0] })
    const html = injectSeoIntoHtml(shellWithHomeCanonical, meta, buildFallbackHtml({ kind: 'product', path: '/producto/calavera-0', product: skulls[0], products: skulls }))
    const canonicals = [...html.matchAll(/rel="canonical" href="([^"]+)"/g)].map((match) => match[1])
    expect(canonicals).toEqual(['https://coru.systems/producto/calavera-0'])
    expect(html).toContain('href="/anillos/calaveras"')
    expect(html).toContain('href="/producto/calavera-1"')
  })
})
