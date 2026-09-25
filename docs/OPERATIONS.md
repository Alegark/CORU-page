# CORU · operación por entorno

Este archivo deja documentada la operación del Worker sin crear archivos de
secretos ni asumir nombres de cuentas. Cada entorno debe tener recursos
separados: base Turso, bucket R2 y variables/secretos de Wrangler.

## Última publicación — 24-09-2026 (banner 3 × $10, toques y carrito)

- Worker `coru` versión `08b6cba2-a52a-4c00-bd6f-89ecfb792e13` en `https://coru.systems/` (sustituye `4662de50-…` del mismo día).
- Incluye el banner de combo con ranuras de anillo, áreas de toque de 44 px en móvil y el desplazamiento del carrito en pantallas bajas. Sin migración ni secreto nuevo.
- Validación previa: typecheck limpio, 262/262 pruebas, build y smoke (`health` 200, `catalog` 200, guard 302).

## Publicación anterior — 24-09-2026 (auditoría + analítica de visitas)

- Worker `coru` versión `4662de50-98ef-4b0b-92f2-2f9cf867127f` en `https://coru.systems/` (precedida el mismo día por `f38e3e4c-…` y `1b9f32bd-…`).
- `CORU_ABUSE_SECRET` creado como secreto de Wrangler (48 caracteres, generado al azar y no registrado en ningún archivo).
- Copia completa previa en Turso: branch `coru-production-backup-20260924` (mismos conteos que producción al crearla).
- Analítica reiniciada por decisión del propietario: `analytics_events` se eliminó y se recreó vacía con el esquema de `0006` (acepta `privacy_view`/`not_found_view`) e índice `idx_analytics_occurred`. Pedidos, catálogo e imágenes intactos.
- Correcciones detectadas en la validación con navegador: `public/_headers` tenía una línea `*/` inválida que bloqueaba el deploy; la lista del carrito se colapsaba a 12 px en pantallas de poca altura; carrito, pedido y WhatsApp mostraban `Talla única` en vez de la talla US; abrir directamente `/privacidad` o `/guia-de-tallas` vaciaba el carrito.
- Validación: 232/232 pruebas, typecheck, build, smoke (`health` 200, `catalog` 200, guard 302), cabeceras de seguridad presentes, y recorrido en navegador de catálogo → combo 3 × $10 → Bs → carrito → entrega Personal → detalle → guía → privacidad → 404 sin errores de consola.
- Cloudflare inyecta `static.cloudflareinsights.com/beacon.min.js` (Web Analytics de la zona); está permitido en la CSP report-only. Si no se quiere, desactivarlo en el panel de Cloudflare.

## Checklist de publicación

Pasos para cada publicación (los de 24-09-2026 ya se ejecutaron):

1. Crear el secreto antiabuso: `npx wrangler secret put CORU_ABUSE_SECRET`
   (mínimo 32 caracteres). Sin él, producción cierra
   `POST /api/orders/whatsapp` con `503 ORDER_INTENT_GUARD_UNAVAILABLE`.
2. Tomar un dump/backup de Turso **antes** de aplicar la migración `0006`:
   `turso db shell coru-production .dump > backup.sql` (o equivalente).
3. Aplicar `drizzle/0006_coru_analytics_public_views.sql` con el runner atómico
   actual: `node scripts/apply-turso-migration.mjs drizzle/0006_coru_analytics_public_views.sql`
   (un batch condicional; aborta con exit 1 al primer error).
4. Publicar Worker + assets del entorno correspondiente.
5. Smoke: `pnpm smoke:production` (o `CORU_SMOKE_URL=…`) y comprobar
   `GET /api/health`, catálogo, pedido WhatsApp y `/admin/analitica`.

La CSP de assets está en modo **report-only**
(`Content-Security-Policy-Report-Only` en `public/_headers`, con
`frame-src` que incluye `https://www.openstreetmap.org` para el mapa de
entrega). Para forzarla más adelante, sustituir el nombre del header por
`Content-Security-Policy` tras validar reportes y ajustar la política.

## Variables del Worker

Configuración del servidor (nunca se incluye en el bundle del navegador):

```text
TURSO_DATABASE_URL (`libsql://coru-production-alegark.aws-us-east-1.turso.io` en producción)
TURSO_AUTH_TOKEN (secret de Wrangler)
TEAM_DOMAIN (`https://publiex.cloudflareaccess.com` en producción)
POLICY_AUD (audience tag de la aplicación `CORU Admin`)
CORU_ABUSE_SECRET (secret de Wrangler; mínimo 32 caracteres; HMAC del cookie de dispositivo y digests antiabuso)
YUMMY_ADAPTER_ENABLED (`false` hasta validar el contrato oficial)
YUMMY_API_URL (configuración server-side entregada por Yummy)
YUMMY_API_TOKEN (secret de Wrangler entregado por Yummy)
EXCHANGE_RATE_URL (endpoint JSON server-side de solo lectura para la cotización oficial de Binance)
```

En la publicación actual están configurados `TURSO_AUTH_TOKEN` y
`EXCHANGE_RATE_URL`. `CORU_ABUSE_SECRET` es requisito **antes** del próximo
deploy (véase checklist arriba). Las imágenes se almacenan como originales, sin quitar
fondos ni aplicar un procesamiento automático. El panel recomienda 1200 × 1200
px y permite reordenar la galería; el primer elemento es la imagen principal.

`EXCHANGE_RATE_URL` puede apuntar a un endpoint JSON server-side controlado por
el operador. En producción apunta al relay de solo lectura que devuelve la
cotización oficial C2C VES/USDT de Binance; no recibe credenciales, datos de
clientes ni tokens. Si no se define, el Worker intenta el adaptador directo de
Binance P2P. Una respuesta inválida o un fallo de red no sustituye la última
observación válida; si no existe una observación válida disponible, la API
marca Bs como no disponible en vez de mostrar la tasa bootstrap.

Yummy permanece en modo no bloqueante mientras no exista un contrato oficial
vigente: el panel solo solicita la dirección y recuerda enviar la ubicación por
WhatsApp para cotizar manualmente; el carrito permite continuar por WhatsApp.
Para activar una cotización real, Yummy debe entregar por escrito el endpoint,
autenticación, payload de origen/destino, moneda, identificador de cotización,
validez, errores y límites. Después de validarlo, se cargan `YUMMY_API_URL` y
`YUMMY_API_TOKEN` como configuración del Worker, se prueba primero en un
entorno separado y solo entonces se cambia `YUMMY_ADAPTER_ENABLED=true`. No se
debe adivinar una URL, raspar la aplicación ni guardar el token en el
navegador.

Bindings y contexto:

```text
CORU_MEDIA (R2 bucket `coru-media-production` en producción)
ENVIRONMENT=local|preview|production
```

`DEV_ADMIN_BYPASS=true` solo sirve para una sesión local explícita. No debe
definirse en preview ni producción. La aplicación self-hosted `CORU Admin` de
Cloudflare Access protege `/admin*` y `/api/admin/*` y permite únicamente la
identidad del operador configurada en la política `CORU Owner`. El proveedor
Cloudflare está habilitado como único método de inicio; One-time PIN fue
eliminado el 18-09-2026 después de verificar el acceso al panel.

## Migración Turso

Con las variables del entorno seleccionadas en la sesión de terminal:

```bash
node scripts/apply-turso-migration.mjs
```

También se puede indicar otra migración como primer argumento. El script envía
cada migración como un **batch Hrana condicional atómico** (strip de
`BEGIN`/`COMMIT` explícitos; omite `ALTER TABLE … ADD COLUMN` si la columna ya
existe vía `PRAGMA table_info`; aborta con exit 1 al primer error e imprime
recordatorio de backup). No guarda credenciales. La migración v1 de producción quedó aplicada (20
sentencias) y la expansión `drizzle/0001_coru_fulfillment.sql` se aplicó en
`coru-production` el 18-09-2026. La comprobación posterior confirmó 40
columnas en `orders`, ausencia de tablas temporales `_v1`, y las cuatro tablas
y seis índices nuevos de la expansión.

El editor de productos incorpora las medidas de anillos en
`drizzle/0004_coru_product_us_size.sql`. Esta migración es aditiva y todavía
debe aplicarse en cada entorno antes de publicar una versión que lea o escriba
`products.us_size`:

```bash
node scripts/apply-turso-migration.mjs drizzle/0004_coru_product_us_size.sql
```

La optimización de imágenes añade las columnas opcionales de variantes en
`drizzle/0005_coru_product_image_variants.sql`. La API crea también estas
columnas de forma idempotente durante la hidratación para evitar que una
publicación quede bloqueada si el token de Turso solo existe como secreto de
Wrangler. Tras publicar el Worker, el backfill conserva los originales y crea
únicamente WebP adicionales (`thumb-320`, `thumb-640`, `detail-1200`) en R2:

```bash
node scripts/apply-turso-migration.mjs drizzle/0005_coru_product_image_variants.sql
<python-empaquetado> scripts/backfill-image-derivatives.py --base-url https://coru.systems
```

El backfill es idempotente: comprueba la variante pública antes de subirla,
omite objetos ya presentes y nunca borra un objeto original. `--dry-run`
genera las variantes sin escribir en R2 y `--force` permite regenerar una
variante concreta si se cambia la calidad. Las rutas versionadas sirven los
WebP con caché inmutable; mientras una variante no exista, la API devuelve el
original con una caché corta para que el siguiente backfill sea visible.

## Orden de una publicación

1. Verificar que la base, el bucket y `ENVIRONMENT` pertenecen al mismo entorno.
2. Aplicar la migración y comprobar que termina sin errores.
3. Ejecutar `pnpm typecheck`, `pnpm test` y `pnpm build`.
4. Publicar Worker y assets con el perfil de Wrangler del entorno.
5. Comprobar `GET /api/health` y `GET /api/catalog`.
6. En automático, comprobar la siguiente ejecución Cron y que una respuesta
   inválida de Binance (o del override configurado) conserve la última tasa
   válida; si no existe una observación válida, confirmar que Bs queda
   desactivado de forma segura.
7. En preview, crear y descartar una intención de WhatsApp; confirmar que no
   descuenta stock hasta la venta concretada.

Después de propagar el dominio, la comprobación repetible es:

```bash
pnpm smoke:production
```

Puede recibir otro origen con `CORU_SMOKE_URL`; no envía pedidos ni datos de
catálogo y solo comprueba health, catálogo y el guard administrativo.

La versión actual (`e8a96e23-139d-4931-9749-ea630bc0ac6d`, 22-09-2026) está publicada en producción como `coru` con el dominio personalizado `https://coru.systems/` (el enlace provisional `workers.dev` está desactivado). Incluye el `panel reveal` del carrito para entrada/salida del bottom sheet móvil y drawer de escritorio, miniaturas del carrito ampliadas para escritorio y móvil, el selector inline de entrega sin modalidad preseleccionada, Personal con un desplegable compacto tematizado para los tres puntos sin controles nativos del navegador que se superpone al resumen sin aumentar la hoja, `Envío nacional` con dos botones pequeños MRW/ZOOM, Yummy como selección directa sin desplegar contenido y el gesto táctil de arrastre hacia abajo para cerrar el carrito en móvil. Cada línea del carrito usa ahora una papelera compacta con estado hover/foco para quitarla sin texto suelto. El encabezado muestra únicamente `Carrito`, sin contador ni el texto `Tu selección`. El CTA de WhatsApp queda bloqueado hasta escoger una modalidad y muestra un aviso breve si se pulsa antes. La portada usa el encabezado compacto `Arma tu combo` en una sola línea móvil con `Anillos y accesorios para combinar`, un banner negro de altura ajustada al contenido con tres pasos de progreso conectados; el CTA lleva a Anillos antes de completar el combo y abre el carrito desde tres piezas, y chips derivados únicamente de las categorías activas del catálogo que tienen productos públicos; las cards mantienen imagen protagonista, precios Bs sin salto y botón `+` negro con cruz verde. En `/admin/categorias`, las categorías vacías muestran una papelera de eliminación junto al editor sin desplazar la fila y el endpoint las elimina de forma permanente cuando no tienen referencias. También conserva el detalle de producto alineado arriba en escritorio, los enlaces públicos de guía de tallas y privacidad, el middleware administrativo limitado a `/api/admin/*`, el botón visible `Cerrar sesión` del panel administrativo enlazado a Cloudflare Access, el favicon SVG de la mascota CORU, las estadísticas de tráfico anónimo y la aclaración visible de que la tarifa Yummy depende de la tarifa vigente y puede variar por hora/disponibilidad. La API pública de tasa ya obtiene la observación C2C de Binance mediante el relay configurado; el valor cambia con el mercado. Name.com guarda únicamente `jacqueline.ns.cloudflare.com` y `troy.ns.cloudflare.com`; los resolvers públicos delegan en Cloudflare.

La misma publicación expone `imageSources` responsive y las rutas versionadas de media. Las 79 imágenes del catálogo tienen ahora `thumb-320`, `thumb-640` y `detail-1200` en WebP dentro de R2 (237 variantes), con fallback temporal al original y caché inmutable cuando la variante existe. El primer request también garantiza de forma idempotente las columnas de medidas y variantes si una migración aditiva todavía no se ejecutó en Turso.
El smoke posterior a la migración confirma `/api/health` 200, `/api/catalog`
200 y `/api/admin/products` 302 hacia el login de Cloudflare Access. El
storefront vuelve a mostrar su estado vacío normal (sin error de persistencia).
La validación equivalente sin publicación sigue siendo `pnpm worker:dry-run`.
El bucket R2 privado `coru-media-production` y la base Turso
`coru-production` ya están creados y enlazados; `TURSO_AUTH_TOKEN` está
guardado como secreto de Wrangler. El relay de tasa de solo lectura y el
adaptador Binance P2P quedan integrados, y el Cron se ejecuta cada 10 minutos.
El inicio autenticado con
Cloudflare ya fue verificado; antes de aceptar tráfico comercial hay que cargar
el catálogo real y completar el smoke de mutaciones administrativas.

> Nota: el registro de publicaciones abajo es **histórico**. El orden
> newest-first no está garantizado entre entradas; usar las fechas y los
> IDs de versión del Worker como referencia.

## Última publicación — 22-09-2026 (tooltip de moneda y feedback del carrito)

- Worker `coru` versión `3f8f8f1a-fe2f-4720-8990-876b14b7e39b` publicada en `https://coru.systems/`.
- El selector USD/Bs muestra una sola vez el tooltip `Elige tu moneda`, lo persiste en `localStorage` y lo cierra al usar el selector o al agregar un producto.
- El agregado exitoso muestra un único toast temporal con `Agregado al carrito` y el nombre de la pieza; las adiciones rápidas reemplazan el nombre y reinician el temporizador.
- El badge del carrito conserva el contador con una microanimación de 180 ms y respeta `prefers-reduced-motion`.
- Validación previa: 167/167 pruebas, `npm run typecheck` y `npm run build`; smoke posterior `health: 200`, `catalog: 200`, guard administrativo `302`.

## Última publicación — 22-09-2026 (burbuja del carrito)

- Worker `coru` versión `68232143-9418-4ba5-abce-c4cb566fb36b` publicada en `https://coru.systems/`.
- El feedback de agregado dejó de ser un toast separado: ahora es una burbuja blanca compacta, con check mint, nombre de producto hasta dos líneas y punta visual anclada aproximadamente 12 px sobre el carrito flotante.
- La burbuja reemplaza el contenido y reinicia el temporizador en adiciones rápidas, queda debajo del drawer del carrito y se cierra inmediatamente al abrirlo.
- Validación previa: 168/168 pruebas, `npm run typecheck` y `npm run build`; smoke posterior `health: 200`, `catalog: 200`, guard administrativo `302`.
- Verificación visual de producción: la burbuja aparece junto al carrito y desaparece antes de abrir el drawer.

La analítica pública es anónima y se conserva durante 180 días. Registra cada
carga o navegación pública como vista de página (catálogo, producto, guía,
privacidad y página no encontrada); administración y API quedan excluidas.
El panel separa vistas de página, sesiones e identificadores de visitante
únicos en todo el período. Una sesión nueva empieza tras 30 minutos sin eventos
y se comparte entre pestañas del mismo perfil. La gráfica y el desglose de
dispositivos cuentan cada perfil una vez por día de Caracas. Las sesiones con
esta definición están disponibles desde la fecha mostrada por el panel; las
visitas históricas se conservan, pero no se reconstruyen sesiones antiguas.
Antes de publicar la captura de privacidad y página no encontrada, aplicar la
migración que amplía el `CHECK` de `analytics_events` conservando sus filas:

```bash
node scripts/apply-turso-migration.mjs drizzle/0006_coru_analytics_public_views.sql
```

Estado al 24-09-2026: la implementación y la migración están en el árbol local;
la migración remota y la publicación del Worker siguen pendientes.

Los registros sin identificador no cuentan como visitantes únicos. No se
persisten IP, correo, teléfono ni contenido de mensajes.

## Última publicación — 19-09-2026

- Worker `coru` versión `3aa7aa27-93c0-4533-afb4-15b36a43f817` publicada en `https://coru.systems/`, sustituyendo la versión anterior.
- Incluye la guía de tallas actualizada en `/guia-de-tallas`, el hero `coru-ring-hero.png`, la ilustración del método 2 `coru-medir-dedo.svg` y la nueva ilustración del método 1 `coru-medir-anillo.png`.
- Prepublicación: `tests/size-guide.test.tsx` (3/3), `pnpm typecheck`, `pnpm build` y `pnpm exec wrangler deploy --dry-run` PASS.
- Smoke posterior: `/api/health` 200, `/api/catalog` 200, guard administrativo 302; la ruta pública y `coru-medir-anillo.png` respondieron 200.

## Última publicación — 21-09-2026

- Worker `coru` versión `51cb5ec7-7df9-4e41-a2f0-46fd6ea50f77` publicada en `https://coru.systems/`.
- La tarjeta duplicada de dispositivos fue reemplazada por `Visitas totales`, calculada únicamente con eventos `catalog_view`.
- Se ejecutó la limpieza única de `analytics_events` anterior a `2026-09-20T04:00:00.000Z` (Caracas); el binding temporal `ANALYTICS_PURGE_BEFORE` ya no está configurado.
- Verificación posterior: `pnpm test` (116/116), `pnpm typecheck`, `pnpm build`, `pnpm worker:dry-run`, health 200, catálogo 200 y guard administrativo 302.

## Última publicación — 22-09-2026 (banner 3 × $10)

- Worker `coru` versión `e8a96e23-139d-4931-9749-ea630bc0ac6d` publicada en `https://coru.systems/` a las 12:09 (America/Caracas).
- El banner muestra tres pasos conectados, progreso repetible y `Ver carrito` desde tres piezas; la elegibilidad coincide con el cálculo del carrito. No se ejecutaron migraciones ni se generaron pedidos en la verificación.
- Antes de publicar: 164/164 pruebas, `pnpm typecheck`, `pnpm build`, `wrangler types --check`, `wrangler deploy --dry-run` y comparación de assets con producción para descartar cambios administrativos adicionales.
- Después: `/api/health` 200, `/api/catalog` 200, guard administrativo 302; el HTML sirvió `index-DrgY8GYP.js` e `index-BfzRQ-6l.css`; el navegador móvil confirmó el recorrido de 0 a 3 piezas, `1 combo aplicado` y apertura del carrito sin crear pedido.
- El despliegue salió del árbol de trabajo local; los cambios siguen sin commit.
