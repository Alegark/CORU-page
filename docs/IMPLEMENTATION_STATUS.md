# CORU implementation status

## Entregado en este corte

La aplicación ya ejecuta un vertical slice local de CORU:

- Store responsive con catálogo filtrable, detalle de producto y privacidad; el carrito ahora vive en una burbuja flotante circular accesible, como en el patrón de CatalogoPubliex.
- Carrito persistido en el navegador, promoción automática de 3 anillos por $10 y selector USD/Bs.
- Aviso de tasa protegida, creación idempotente de una intención `PENDING` y enlace de continuidad por WhatsApp.
- El CTA de WhatsApp intenta el endpoint Worker y solo vuelve al adaptador local cuando el preview Vite no tiene API; el feedback conserva la misma referencia y se guarda en `localStorage`.
- Al entrar a `/admin`, la SPA intenta hidratar productos y pedidos desde los endpoints administrativos; sin API o sin sesión conserva el adaptador local para el preview.
- Shell administrativo responsive con Resumen, Productos, Categorías, Promociones, Pedidos, Entregas, Analítica y Ajustes.
- El encabezado del panel muestra `Cerrar sesión`, enlazado al cierre oficial de Cloudflare Access; conserva una versión iconográfica compacta en teléfonos.
- Entregas de STOCK: selector inline PERSONAL/Yummy/Envío nacional; tres puntos personales activos de Maracaibo en una lista compacta accesible, además de administración CRUD/reordenamiento/archivado en `/admin/entregas`; Nacional nuevo usa solo MRW/ZOOM y coordina destinatario/oficina por WhatsApp, conservando snapshots históricos; WhatsApp mantiene `Cobro a destino`.
- Carrito STOCK con footer compacto y detalles inline: Personal expande solo su desplegable de puntos, Envío nacional expande solo MRW/ZOOM y Yummy se selecciona sin desplegar contenido; productos, totales y CTA permanecen visibles, Escape repliega los detalles y el bottom sheet móvil acepta arrastre hacia abajo.
- El menú público incluye enlaces directos a la guía de tallas y privacidad, además de las anclas de catálogo, con navegación móvil accesible.
- Yummy queda aislado detrás de un adaptador server-side verificable. Sin contrato oficial y credenciales, la cotización responde sin bloqueo con `Costo de delivery a confirmar por WhatsApp.`; una cotización referencial se invalida al cambiar la dirección.
- Confirmación y descarte local de pedidos; confirmar descuenta stock una sola vez en la sesión actual.
- Marca CORU y tokens visuales extraídos de los materiales aprobados en `design/`; las acciones seleccionadas usan `--color-brand-strong` para recuperar contraste sin romper el mint del logotipo.
- Favicon SVG oficial configurado en `index.html` con la mascota aprobada de `public/brand/coru-mascot.svg`; no se recreó ni se sustituyó el logo por un dibujo nuevo.
- Pase visual del storefront: hero sin espacio artificial, subrayado Mint separado de la descendente, wordmark ampliado, header alineado en retícula, menú responsive con entrada/salida suave, reveal escalonado del hero, microinteracciones de filtros/tarjetas y contador animado del carrito; todo conserva el fallback de movimiento reducido.
- Transición móvil del carrito con `panel reveal`: scrim con fade y panel bottom sheet con entrada/salida sincronizada; el panel permanece montado durante el cierre y respeta `prefers-reduced-motion`.
- Worker Hono con `GET /api/health` y configuración inicial de Wrangler.
- Worker `coru` publicado en producción con assets estáticos, cron cada 10
  minutos, binding R2 privado `coru-media-production`, la base Turso
  `coru-production` y dominio personalizado `coru.systems`.
- Cloudflare Access configurado para `CORU Admin`: `/admin*` y
  `/api/admin/*` exigen la sesión del operador autorizado; el catálogo público
  permanece fuera de Access. El proveedor **Cloudflare** quedó habilitado y el
  proveedor One-time PIN fue eliminado el 18-09-2026; el inicio probado abre
  el panel sin código por correo.
- API Worker local con catálogo público, intención WhatsApp, validación, analítica y transiciones de inventario en memoria.
- Servicios de dominio para inventario atómico, tasa Bs (modo manual/automático y expiración Caracas), ajustes, categorías/productos e imágenes originales ordenables en R2.
- Tasa automática basada en la cotización oficial Binance C2C VES/USDT: producción usa el relay server-side de solo lectura configurado en `EXCHANGE_RATE_URL`, con el adaptador Binance P2P directo como fallback. La URL y el proveedor nunca se exponen al público.
- Motor de promociones configurable (bundle/fixed discount), detección de solapamientos y CRUD administrativo conectado al Worker.
- El storefront hidrata categorías y la promoción activa desde el Worker; el panel de Ajustes persiste WhatsApp, datos públicos, estado de tienda y modo/tasa. Analítica y Resumen muestran señales/ventas reales, sin métricas ficticias.
- El editor de productos conserva el historial de stock mediante movimientos `MANUAL_SET`; las imágenes nuevas se guardan sin alterar, con recomendación de 1200 × 1200 px y reordenamiento persistente de la galería.
- Los estados operativos tienen carga/error/vacío explícitos, confirmación para acciones destructivas, fecha administrativa en Caracas, UX para carreras de stock, carga diferida del panel admin y navegación accesible por teclado con restauración de foco en el drawer.
- En un origen real, cualquier fallo HTTP de la tasa desactiva Bs de forma segura; el preview Vite conserva su tasa demostrativa.
- La hidratación de Turso descarta metadatos de tasa con timestamp epoch (1970), evitando que un registro placeholder desactive Bs cuando la tasa inicial vigente sigue disponible.
- Cliente HTTP libSQL/Turso y repositorios conectados mediante hidratación por entorno; los cambios de pedidos, inventario, ajustes, tasas, imágenes y analítica se programan en el adaptador durable cuando existen bindings. La migración v1 y la expansión `0001_coru_fulfillment.sql` quedaron aplicadas en `coru-production` el 18-09-2026; `TURSO_AUTH_TOKEN` está guardado como secreto de Wrangler.
- Analítica anónima en lotes de hasta 20 eventos, retención de 180 días y estados de catálogo/pedido/tasa en la interfaz.
- Estadísticas de visitas conectadas a eventos `catalog_view`: el cliente hace flush automático al segundo de actividad o al salir, y el admin expone visitas, sesiones y páginas por sesión mediante `/api/admin/analytics/traffic` sin IP ni datos de contacto.
- El panel de analítica distingue `Visitantes únicos` (un identificador persistente una vez por período) de `Visitas totales` (cada entrada al catálogo); las vistas de producto no inflan la visita general, y los eventos sin identificador no se cuentan como visitantes únicos.

## Verificación local

```text
pnpm typecheck  PASS
pnpm test       PASS (80 tests)
pnpm build      PASS
pnpm test:e2e   PASS (3 tests: mobile + desktop + STOCK delivery)
pnpm worker:types    PASS
pnpm worker:dry-run  PASS
```

En Windows, Vitest/Vite necesitan autorización elevada cuando el proceso auxiliar de esbuild devuelve `spawn EPERM` dentro del sandbox.

El Worker local también se comprobó con `wrangler dev --local`: health 200,
catálogo público de 11 productos, intención `CORU-000001` por $10 y segundo
POST con la misma clave reutilizando la referencia.

## Alcance pendiente

La publicación ya tiene el binding de persistencia durable: las migraciones v1
y `0001_coru_fulfillment.sql` se aplicaron en `coru-production`,
`TURSO_DATABASE_URL` está configurado y
`TURSO_AUTH_TOKEN` vive como secreto de Wrangler. El bucket R2 privado
`coru-media-production` y el adaptador Binance P2P también están activos.
La base comienza sin datos de catálogo reales; por eso `/api/catalog` responde
200 con una lista vacía hasta que se carguen categorías, productos e imágenes
aprobadas desde el flujo administrativo. No se copió el catálogo demo a
producción para evitar datos ficticios.

Las imágenes nuevas ya no dependen de Photoroom ni de una clave de procesamiento:
se conserva el archivo original y el primer elemento de la galería se usa como
imagen principal. Los registros históricos procesados se mantienen compatibles.

La integración Yummy tiene el límite seguro implementado: adaptador server-side,
snapshot referencial y fallback que no bloquea WhatsApp. La cotización real aún
no puede activarse en producción porque falta el contrato oficial vigente y sus
credenciales (endpoint, esquema, moneda, validez y límites); no se inventó una
URL ni se creó un token ficticio.

La publicación actual `3e2a134c-9727-4eb3-9902-3e82c96f5f81` confirmó
el build del favicon, del panel de tráfico, del aviso de tarifa variable de
Yummy en el checkout y WhatsApp y la reorganización visible de los accesos de
guía de tallas y privacidad. El smoke de producción posterior
confirmó `health: 200`, `catalog: 200` y `admin guard: 302`. El smoke de la
publicación anterior `b74c1cfc-7b2f-4961-aaf8-2c5024267110` confirmó
`/api/health` 200, `/api/catalog` 200 y la redirección de
`/admin/pedidos` al login de Cloudflare Access. Name.com guarda
únicamente `jacqueline.ns.cloudflare.com` y `troy.ns.cloudflare.com`; los
resolvers públicos delegan en Cloudflare y `https://coru.systems/` ya sirve el
storefront. La tasa pública obtiene una observación actual de Binance mediante
el relay configurado y se marca como no disponible si no hay una observación
válida, en lugar de presentar el fallback inicial. No se creó ningún pedido de
prueba remoto.

La guía de variables, migración y orden de publicación está en `docs/OPERATIONS.md`. `pnpm db:migrate` aplica `drizzle/0000_coru_v1.sql` sin crear archivos de secretos.

La última publicación de producción es `3aa7aa27-93c0-4533-afb4-15b36a43f817` (19-09-2026). Incluye la guía de tallas rediseñada, el hero de anillo CORU, la ilustración del método de medición del dedo y la nueva ilustración del método 1; el smoke posterior confirmó health 200, catálogo 200 y guard administrativo 302.

La cobertura E2E de Store/Admin se ejecuta localmente contra Vite cuando está
instalado Chromium. La suite todavía debe repetirse contra un Worker publicado
con bindings reales para cubrir la persistencia Turso/R2 y los límites del
entorno de integración.

Cloudflare Access ya está configurado y el middleware existente protege el
panel. Se verificó una sesión autenticada con el proveedor Cloudflare y la
carga del panel; falta repetir el smoke de mutaciones administrativas contra
producción. La API pública y la persistencia ya están sanas.

`doc/SPEC.md` se conserva sin modificar porque el archivo recibido contiene un registro `R9|Design source|...` repetido y no ofrece un contrato de negocio legible. No se inventaron reglas a partir de ese contenido.

## Última publicación — 21-09-2026

- Worker `coru` versión `51cb5ec7-7df9-4e41-a2f0-46fd6ea50f77` publicada en `https://coru.systems/`.
- El panel responsive de analítica muestra visitantes únicos, visitas totales, agregados e intentos por WhatsApp; el detalle inferior conserva la distribución por tipo de dispositivo.
- El identificador anónimo usa almacenamiento persistente del navegador y fallback de cookie; no se almacenan IP, correo, teléfono ni contenido de mensajes.
- Se ejecutó una limpieza única en Turso de eventos `analytics_events` anteriores a `2026-09-20T04:00:00.000Z` (medianoche del 20-09-2026 en Caracas). El interruptor temporal de limpieza fue retirado después del health check.
- Validación: `pnpm test` (116/116), `pnpm typecheck`, `pnpm build`, `pnpm worker:dry-run`, `/api/health` 200, `/api/catalog` 200 y guard administrativo 302.
