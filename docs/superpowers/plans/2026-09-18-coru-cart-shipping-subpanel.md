# CORU — carrito y selector inline de envío

**Estado:** implementado y publicado en `coru.systems` (versión `f332298f-ae28-4b6f-8522-0ce5ebcb8daf`)
**Fecha:** 2026-09-19
**Tipo:** follow-up de UI/UX + contrato de envío STOCK

## Lectura obligatoria

Antes de modificar código, leer en este orden:

1. `doc/SPEC.md`
2. `design/DESIGN.md`
3. `doc/SPEC_PLAN.md`
4. este brief

Este brief concreta la presentación del carrito y **reemplaza cualquier requisito anterior que
obligue a pedir estado, ciudad u oficina para un nuevo envío `NATIONAL`**. Los campos antiguos
pueden conservarse para snapshots históricos, pero no deben volver a aparecer en la vista pública.

## Objetivo

El cliente debe poder revisar los productos, la promoción, el total y el CTA de WhatsApp sin que
el selector de envío o sus formularios oculten el carrito, especialmente en móvil (390–393 px).
El envío es una decisión breve e inline: se elige una modalidad y solo se despliega el conjunto de
opciones que necesita esa modalidad, sin abrir una ventana interna separada.

## Problemas observados

- `CartOverlay` renderizaba Personal, Yummy y Nacional inline dentro de `.cart-footer`, pero la
  versión anterior no distinguía la expansión ni la jerarquía visual.
- La solución mantiene el selector inline dentro del footer y deja las líneas del carrito visibles;
  las listas usan bloques compactos para no generar scroll innecesario.
- Nacional actualmente muestra y exige `Estado`, `Ciudad` y `Oficina o agencia`, aunque CORU
  coordinará esos datos por WhatsApp.
- El panel debe conservar la animación de entrada/salida y no crear un segundo scroll general.

## Diseño aprobado para implementar

### 1. Vista principal del carrito

Mantener un solo `role="dialog"` para el carrito, con esta jerarquía:

1. Encabezado: `Tu selección`, contador, vaciar y cerrar.
2. Lista de productos (`.cart-lines`), que es la única zona que puede desplazarse si hay muchas
   líneas.
3. Footer compacto y siempre alcanzable:
   - fila de envío para piezas disponibles;
   - tres opciones pequeñas: `Personal`, `Yummy`, `Envío nacional`;
   - modalidad seleccionada resumida, sin mapas, formularios ni textos largos;
   - nota `Bajo pedido` solo cuando existen líneas PREORDER;
   - promoción, subtotal, descuento, total y aviso de tasa cuando corresponda;
   - `Pedir por WhatsApp`.

No ocultar el CTA detrás de un bloque de envío ni convertir todo el drawer en una página con
scroll. Para carritos realmente largos se acepta scroll únicamente en la lista de productos.

### 2. Detalles inline de envío

Al pulsar una opción se selecciona la modalidad y, cuando hace falta, se despliega una región
inline dentro del selector. No hay encabezado ni botón `Volver al carrito` duplicados.

- **Personal:** desplegable compacto accesible de puntos activos, sin mapa dentro del carrito.
- **Yummy:** solo se selecciona la modalidad; la dirección y ubicación se coordinan por WhatsApp,
  sin desplegar un bloque adicional ni botón de cotización.
- **Envío nacional:** solo selector de `MRW` o `ZOOM`, más el texto:
  `Los datos del destinatario y la oficina se coordinan por WhatsApp.`
  Mostrar también `Cobro a destino`. No mostrar inputs de estado, ciudad u oficina.

Los detalles usan una transición breve de opacidad/posición dentro del footer y respetan
`prefers-reduced-motion`. El bottom sheet móvil incluye un asa táctil: un arrastre hacia abajo
mayor a 96 px lo cierra.

### 3. Contrato Nacional y compatibilidad

El payload canónico para nuevos pedidos es:

```ts
{ method: 'NATIONAL', carrier: 'MRW' | 'ZOOM' }
```

- `state`, `city` y `officeText` dejan de ser obligatorios.
- El validador puede aceptar esos campos como opcionales durante la compatibilidad con clientes
  antiguos, pero nunca debe exigirlos para un pedido nuevo.
- La persistencia puede conservar las columnas nullable existentes para no romper históricos.
- La hidratación de pedidos debe aceptar un Nacional que solo tenga carrier.
- Admin debe mostrar `Envío nacional · MRW/ZOOM` y, cuando no haya ubicación histórica,
  `Datos por coordinar por WhatsApp`.
- El mensaje de WhatsApp para nuevos pedidos debe incluir carrier, `Cobro a destino` y que los
  datos se coordinan por WhatsApp. Si un pedido histórico trae estado/ciudad/oficina, se pueden
  mostrar esos snapshots sin reescribirlos.
- La tarifa nacional no se calcula en la web y no se suma al total de mercancía.

## Accesibilidad e interacción

- Personal y Envío nacional exponen `aria-expanded`/`aria-controls`; Yummy es una selección directa
  con su campo inline.
- `Escape` repliega primero los detalles expandidos y luego cierra el carrito.
- Conservar targets táctiles de al menos 44 px y estados de foco visibles.
- No usar bordes negros gruesos para indicar selección; usar el lenguaje visual Mint existente y
  una transición breve de posición/opacidad.

## Cambios esperados

- `src/client/components/store/CartOverlay.tsx`: separar resumen y subpanel; eliminar el formulario
  Nacional antiguo; manejar apertura/cierre, foco y estado de modalidad.
- Preferible extraer el detalle a
  `src/client/components/store/ShippingPanel.tsx` si reduce la complejidad de `CartOverlay`.
- `src/client/design/app.css`: layout footer/lista, capa responsive, transición y reduced motion.
- `src/shared/types.ts`: permitir Nacional carrier-only y conservar opcionales históricos.
- `src/shared/validation.ts`: validar carrier y tratar ubicación como opcional compatible.
- `src/worker/services/order.service.ts`: copy de WhatsApp Nacional carrier-only con fallback de
  snapshots históricos.
- `src/worker/persistence.ts` y `src/db/repositories/orders.repository.ts`: hidratar/guardar
  Nacional sin exigir ubicación.
- `src/client/features/admin/AdminPages.tsx`: destino legible cuando los datos aún están por
  coordinar.

## Pruebas mínimas

Agregar o actualizar pruebas para demostrar:

1. En 390–393 px, con uno o varios productos, las líneas y el total siguen accesibles sin que el
   bloque de envío inline los tape.
2. Personal y Envío nacional despliegan solo sus opciones compactas; Yummy se selecciona sin
   desplegar contenido.
3. Nacional se puede enviar con `carrier` solamente.
4. Payloads Nacional antiguos con estado/ciudad/oficina siguen hidratándose y mostrándose.
5. WhatsApp nuevo incluye carrier, coordinación por WhatsApp y cobro a destino.
6. Yummy se envía a coordinación por WhatsApp y no añade ningún estimado al total de mercancía.
7. Personal conserva un desplegable accesible con nombres y direcciones compactas.
8. Teclado, foco, Escape y `prefers-reduced-motion` funcionan en móvil y escritorio.

Ejecutar como mínimo:

```text
pnpm typecheck
pnpm test
pnpm build
pnpm worker:dry-run
```

Después verificar manualmente el preview local en móvil y escritorio antes de publicar.

## Despliegue y rollback

No requiere migración de base de datos si las columnas Nacional existentes permanecen nullable.
Después de pasar las pruebas:

1. desplegar Worker + Static Assets con Wrangler;
2. ejecutar `pnpm smoke:production`;
3. verificar catálogo público, carrito, tres modalidades, WhatsApp y detalle Admin;
4. conservar el id de la versión anterior para rollback inmediato si el panel rompe el flujo.

La publicación en producción requiere autorización de release separada; implementar y verificar
este brief no constituye por sí solo autorización de despliegue.

## Criterios de aceptación

- El cliente ve primero productos y total.
- El selector de envío ocupa una fila compacta en el resumen.
- Los detalles aparecen inline con animación breve, sin ventana interna adicional.
- Envío nacional solo pide MRW/ZOOM y coordina el resto por WhatsApp.
- No se pierde la información de pedidos históricos.
- El flujo mantiene el lenguaje visual CORU, targets táctiles, foco accesible y movimiento reducido.
