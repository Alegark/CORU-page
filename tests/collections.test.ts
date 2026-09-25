import { describe, expect, it } from 'vitest'
import {
  COLLECTION_DEFINITIONS,
  getCollectionDefinition,
  isCollectionPublished,
  normalizeCollectionText,
  productMatchesCollection,
  productsForCollection,
  publishedCollections,
} from '../src/shared/collections'

const productionCatalog = [
  ['Anillo sello con medallón grabado', 'Anillo plateado tipo sello con medallón central y grabados ornamentales.'],
  ['Anillo calavera alada', 'Anillo plateado con calavera central, alas y detalles oscuros.'],
  ['Anillo calavera bufón', 'Anillo plateado con calavera de bufón y diseño de puntas.'],
  ['Anillo geométrico Bagua', 'Anillo plateado abierto con diseño geométrico inspirado en Bagua.'],
  ['Anillo sello de calavera redonda', 'Anillo tipo sello con calavera redonda y borde texturizado.'],
  ['Anillo calavera lateral', 'Anillo plateado con calavera lateral y acabado de contraste oscuro.'],
  ['Anillo corazón gótico', 'Anillo plateado con corazón central y detalles ornamentales.'],
  ['Anillo as de picas', 'Anillo tipo sello plateado con símbolo negro de as de picas.'],
  ['Anillo rana pequeña', 'Anillo plateado con figura de rana sobre la banda.'],
  ['Anillo ojo negro', 'Anillo plateado con forma de ojo y centro circular negro.'],
  ['Anillo rana abierta', 'Anillo abierto plateado con figura de rana de mayor tamaño.'],
  ['Anillo palos de baraja', 'Anillo plateado con símbolos de baraja en rojo y negro.'],
  ['Anillo estrella geométrica', 'Anillo tipo sello con estrella negra y detalles geométricos.'],
  ['Anillo corazón alado', 'Anillo plateado con corazón central acompañado de alas laterales.'],
  ['Anillo soles calados', 'Anillo plateado calado con repetición de motivos tipo sol.'],
  ['Anillo serpiente enrollada', 'Anillo plateado abierto con serpiente enrollada alrededor del dedo.'],
  ['Anillo piedra negra cuadrada ornamental', 'Anillo ornamental con centro cuadrado negro y marco detallado.'],
  ['Anillo cadena corazones', 'Anillo plateado formado por una secuencia continua de corazones.'],
  ['Anillo sello ovalado negro con símbolo', 'Anillo tipo sello con centro ovalado negro y pequeño símbolo central.'],
  ['Anillo flor pequeña', 'Anillo fino plateado con una pequeña flor en el centro.'],
  ['Anillo dragón negro', 'Anillo negro con figura de dragón y acabado de alto contraste.'],
  ['Anillo piedra negra cuadrada', 'Anillo plateado con piedra cuadrada negra y banda geométrica.'],
  ['Anillo mariposa calavera', 'Anillo plateado con mariposa y calavera como motivo central.'],
  ['Anillo corazón voluminoso', 'Anillo plateado con corazón sólido y detalles laterales discretos.'],
  ['Anillo piedra negra ovalada', 'Anillo tipo sello plateado con centro ovalado negro y laterales grabados.'],
  ['Anillo loto geométrico', 'Anillo plateado con flor de loto geométrica como pieza central.'],
  ['Anillo hongos y estrellas', 'Anillo plateado con hongos, estrellas y detalles oscuros grabados.'],
  ['Anillo murciélago abierto', 'Anillo abierto plateado con figura de murciélago y alas extendidas.'],
  ['Anillo mariposa abierta', 'Anillo abierto plateado con silueta de mariposa en el frente.'],
  ['Anillo alas', 'Anillo abierto plateado con dos alas enfrentadas en el centro.'],
  ['Anillo piedra negra con alas', 'Anillo plateado con piedra negra central y alas laterales.'],
  ['Anillo hilo corazon', 'Anillo plateado abierto con dos hilos sosteniendo un corazón.'],
  ['Anillo llamas', 'Anillo plateado con motivo frontal de llamas y líneas oscuras.'],
  ['Anillo rombo ornamental', 'Anillo plateado con pieza central en rombo y grabado ornamental.'],
  ['Anillo flor ancho', 'Anillo ancho plateado abierto con una flor grabada de gran tamaño.'],
  ['Anillo Revenge', 'Anillo plateado con la palabra Revenge como elemento protagonista.'],
  ['Anillo flores pequeñas', 'Anillo plateado con una hilera de pequeñas flores detalladas.'],
  ['Anillo ondas', 'Anillo plateado de banda con líneas onduladas en relieve.'],
  ['Anillo banda floral con girasoles', 'Anillo plateado de banda ancha con motivo floral y girasoles.'],
  ['Anillo doble pétalo', 'Anillo plateado con dos motivos ornamentales enfrentados en el centro.'],
].map(([name, description]) => ({ name, description, category: 'Anillos' as const }))

describe('collection matcher', () => {
  it('strips accents and lowercases before matching', () => {
    expect(normalizeCollectionText('Anillo Corazón Gótico')).toBe('anillo corazon gotico')
    const definition = getCollectionDefinition('corazones')!
    expect(productMatchesCollection({ name: 'Anillo Corazón Gótico', description: 'Pieza', category: 'Anillos' }, definition)).toBe(true)
  })

  it('only matches products in the Anillos category', () => {
    const definition = getCollectionDefinition('calaveras')!
    expect(productMatchesCollection({ name: 'Anillo calavera', description: 'x', category: 'Accesorios' }, definition)).toBe(false)
    expect(productMatchesCollection({ name: 'Anillo calavera', description: 'x', category: 'Anillos' }, definition)).toBe(true)
  })

  it('publishes thematic collections only with 4+ matches', () => {
    expect(isCollectionPublished(3)).toBe(false)
    expect(isCollectionPublished(4)).toBe(true)
    expect(isCollectionPublished(1, true)).toBe(true)
    expect(isCollectionPublished(0, true)).toBe(false)
  })

  it('publishes the expected production collections (≥4)', () => {
    const published = publishedCollections(productionCatalog).map((entry) => entry.slug)
    expect(published).toEqual(expect.arrayContaining(['calaveras', 'corazones', 'flores', 'sello', 'piedra-negra', 'abiertos', 'animales', 'goticos']))
    for (const definition of COLLECTION_DEFINITIONS) {
      const count = productsForCollection(productionCatalog, definition).length
      expect(count).toBeGreaterThanOrEqual(4)
      expect(published).toContain(definition.slug)
    }
  })
})
