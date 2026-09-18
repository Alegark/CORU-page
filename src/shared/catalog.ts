import type { Product } from './types'

export const demoProducts: Product[] = [
  {
    id: 'orbita-oscura', slug: 'orbita-oscura', name: 'Órbita oscura', category: 'Anillos', sizeLabel: 'Talla única', priceCents: 400, stockQuantity: 8, active: true, primaryImageApproved: true, promoEligible: true, artwork: 'orbita', description: 'Una órbita negra para darle peso a cualquier look.', material: 'Acero inoxidable',
  },
  {
    id: 'calavera-orbital', slug: 'calavera-orbital', name: 'Calavera orbital', category: 'Anillos', sizeLabel: 'Talla única', priceCents: 400, stockQuantity: 6, active: true, primaryImageApproved: true, promoEligible: true, artwork: 'skull', description: 'Metal y actitud en una silueta que no pasa desapercibida.', material: 'Acero inoxidable',
  },
  {
    id: 'estrella-rota', slug: 'estrella-rota', name: 'Estrella rota', category: 'Anillos', sizeLabel: 'Talla única', priceCents: 400, stockQuantity: 12, active: true, primaryImageApproved: true, promoEligible: true, artwork: 'star', description: 'Brilla distinto. Una estrella imperfecta, exactamente como debe ser.', material: 'Acero inoxidable',
  },
  {
    id: 'cruz-orbital', slug: 'cruz-orbital', name: 'Cruz orbital', category: 'Anillos', sizeLabel: 'Talla única', priceCents: 400, stockQuantity: 5, active: true, primaryImageApproved: true, promoEligible: true, artwork: 'cross', description: 'Un símbolo limpio con una curva inesperada.', material: 'Acero inoxidable',
  },
  {
    id: 'halo-pearl', slug: 'halo-pearl', name: 'Halo pearl', category: 'Anillos', sizeLabel: 'Talla única', priceCents: 500, stockQuantity: 3, active: true, primaryImageApproved: true, promoEligible: true, artwork: 'pearl', description: 'Una pieza suave para bajar el volumen sin perder carácter.', material: 'Acero inoxidable',
  },
  {
    id: 'signo-lunar', slug: 'signo-lunar', name: 'Signo lunar', category: 'Anillos', sizeLabel: 'Talla única', priceCents: 450, stockQuantity: 0, active: true, primaryImageApproved: true, promoEligible: false, fulfillmentType: 'PREORDER', leadTime: '3–4 semanas', measurementsText: 'Talla única · ajuste cómodo', artwork: 'orbita', description: 'Una pieza bajo pedido para cuando quieres algo distinto.', material: 'Acero inoxidable',
  },
  {
    id: 'cadena-mini', slug: 'cadena-mini', name: 'Cadena mini', category: 'Accesorios', sizeLabel: 'Largo 45 cm', priceCents: 700, stockQuantity: 4, active: true, primaryImageApproved: true, promoEligible: false, artwork: 'chain', description: 'Una cadena ligera para sumar textura todos los días.', material: 'Acero inoxidable',
  },
  {
    id: 'ear-cuff', slug: 'ear-cuff', name: 'Ear cuff humo', category: 'Accesorios', sizeLabel: 'Talla única', priceCents: 350, stockQuantity: 7, active: true, primaryImageApproved: true, promoEligible: false, artwork: 'orbita', description: 'Minimalista, cómoda y con la dosis justa de rebeldía.', material: 'Acero inoxidable',
  },
  {
    id: 'anillo-senal', slug: 'anillo-senal', name: 'Señal', category: 'Anillos', sizeLabel: 'Talla única', priceCents: 400, stockQuantity: 10, active: true, primaryImageApproved: true, promoEligible: true, artwork: 'cross', description: 'Geometría fuerte y líneas limpias.', material: 'Acero inoxidable',
  },
  {
    id: 'anillo-cometa', slug: 'anillo-cometa', name: 'Cometa', category: 'Anillos', sizeLabel: 'Talla única', priceCents: 400, stockQuantity: 9, active: true, primaryImageApproved: true, promoEligible: true, artwork: 'star', description: 'Una estela para tus días con prisa.', material: 'Acero inoxidable',
  },
  {
    id: 'pin-mint', slug: 'pin-mint', name: 'Pin mint', category: 'Accesorios', sizeLabel: '2 cm', priceCents: 250, stockQuantity: 16, active: true, primaryImageApproved: true, promoEligible: false, artwork: 'pearl', description: 'Pequeño, brillante y listo para tu tote favorita.', material: 'Metal esmaltado',
  },
  {
    id: 'llavero-coru', slug: 'llavero-coru', name: 'Llavero CORU', category: 'Accesorios', sizeLabel: '4 cm', priceCents: 600, stockQuantity: 2, active: true, primaryImageApproved: true, promoEligible: false, artwork: 'chain', description: 'Lleva la actitud contigo.', material: 'Metal',
  },
]

export function getPublicProducts(products: Product[]): Product[] {
  return products.filter((product) => product.active && product.primaryImageApproved && ((product.fulfillmentType ?? 'STOCK') === 'PREORDER' || product.stockQuantity > 0))
}

export function getProductBySlug(products: Product[], slug: string): Product | undefined {
  return products.find((product) => product.slug === slug)
}
