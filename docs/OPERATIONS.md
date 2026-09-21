# CORU · operación por entorno

Este archivo deja documentada la operación del Worker sin crear archivos de
secretos ni asumir nombres de cuentas. Cada entorno debe tener recursos
separados: base Turso, bucket R2 y variables/secretos de Wrangler.

## Variables del Worker

Configuración del servidor (nunca se incluye en el bundle del navegador):

```text
TURSO_DATABASE_URL (`libsql://coru-production-alegark.aws-us-east-1.turso.io` en producción)
TURSO_AUTH_TOKEN (secret de Wrangler)
TEAM_DOMAIN (`https://publiex.cloudflareaccess.com` en producción)
POLICY_AUD (audience tag de la aplicación `CORU Admin`)
YUMMY_ADAPTER_ENABLED (`false` hasta validar el contrato oficial)
YUMMY_API_URL (configuración server-side entregada por Yummy)
YUMMY_API_TOKEN (secret de Wrangler entregado por Yummy)
EXCHANGE_RATE_URL (endpoint JSON server-side de solo lectura para la cotización oficial de Binance)
```

En la publicación actual están configurados `TURSO_AUTH_TOKEN` y
`EXCHANGE_RATE_URL`. Las imágenes se almacenan como originales, sin quitar
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
las sentencias al endpoint HTTP de Turso, no guarda credenciales y falla si una
sentencia devuelve error. La migración v1 de producción quedó aplicada (20
sentencias) y la expansión `drizzle/0001_coru_fulfillment.sql` se aplicó en
`coru-production` el 18-09-2026. La comprobación posterior confirmó 40
columnas en `orders`, ausencia de tablas temporales `_v1`, y las cuatro tablas
y seis índices nuevos de la expansión.

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

La versión actual (`f332298f-ae28-4b6f-8522-0ce5ebcb8daf`, 19-09-2026) está publicada en producción como `coru` con el dominio personalizado `https://coru.systems/` (el enlace provisional `workers.dev` está desactivado). Incluye el `panel reveal` del carrito para entrada/salida del bottom sheet móvil y drawer de escritorio, miniaturas del carrito ampliadas para escritorio y móvil, el selector inline de entrega sin modalidad preseleccionada, Personal con un desplegable compacto tematizado para los tres puntos sin controles nativos del navegador que se superpone al resumen sin aumentar la hoja, `Envío nacional` con dos botones pequeños MRW/ZOOM, Yummy como selección directa sin desplegar contenido y el gesto táctil de arrastre hacia abajo para cerrar el carrito en móvil. Cada línea del carrito usa ahora una papelera compacta con estado hover/foco para quitarla sin texto suelto. El encabezado muestra únicamente `Carrito`, sin contador ni el texto `Tu selección`. El CTA de WhatsApp queda bloqueado hasta escoger una modalidad y muestra un aviso breve si se pulsa antes. La portada usa el encabezado compacto `Arma tu combo` en una sola línea móvil con `Anillos y accesorios para combinar`, un banner negro rectangular y compacto de 176 px en móvil con mensaje, progreso y CTA en columnas, y chips derivados únicamente de las categorías activas del catálogo que tienen productos públicos; las cards mantienen imagen protagonista, precios Bs sin salto y botón `+` negro con cruz verde. En `/admin/categorias`, las categorías vacías muestran una papelera de eliminación junto al editor sin desplazar la fila y el endpoint las elimina de forma permanente cuando no tienen referencias. También conserva el detalle de producto alineado arriba en escritorio, los enlaces públicos de guía de tallas y privacidad, el middleware administrativo limitado a `/api/admin/*`, el botón visible `Cerrar sesión` del panel administrativo enlazado a Cloudflare Access, el favicon SVG de la mascota CORU, las estadísticas de tráfico anónimo y la aclaración visible de que la tarifa Yummy depende de la tarifa vigente y puede variar por hora/disponibilidad. La API pública de tasa ya obtiene la observación C2C de Binance mediante el relay configurado; el valor cambia con el mercado. Name.com guarda únicamente `jacqueline.ns.cloudflare.com` y `troy.ns.cloudflare.com`; los resolvers públicos delegan en Cloudflare.
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

La analítica pública es anónima y se conserva durante 180 días. Cada carga del
catálogo envía `catalog_view` de forma no bloqueante; el panel Analítica separa
`Visitantes únicos` (un identificador persistente una vez por período) de
`Visitas totales` (cada entrada al catálogo). Las vistas de producto se usan
solo para interés por producto, no para inflar la visita general. Los registros
sin identificador no cuentan como visitantes únicos. No se persisten IP, correo,
teléfono ni contenido de mensajes.

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
