# Plan SEO · CORU (coru.systems)

> Estado: propuesta, sin implementar. Fecha del diagnóstico: 2026-09-24.
> Objetivo: que CORU aparezca en Google/Bing para búsquedas de anillos en Maracaibo
> y para búsquedas temáticas (anillos góticos, de calavera, de serpiente, abiertos…),
> y que los enlaces compartidos en WhatsApp, Instagram y Facebook muestren nombre,
> precio e imagen.

---

## 0. Datos confirmados y restricciones

Datos del propietario (2026-09-24):

| Dato | Valor |
|---|---|
| Instagram | `https://www.instagram.com/corucore.jpg/` (bio: "Maracaibo · small things, big mood ✦ accesorios · drops · bajo pedido · Envíos nacionales") |
| Facebook | `https://www.facebook.com/profile.php?id=61594548357564` |
| Facebook Marketplace | Publicación de anillos activa (requiere sesión; no indexable) |
| Perfil de Empresa en Google | No existe; se creará (guía en la sección 4, fase 4) |
| Zona | Maracaibo (entrega personal en C.C. El Gran Ruby, C.C. La Paragua, C.C. La Campana) + envío nacional MRW / ZOOM cobro a destino |

Restricciones del contexto maestro del proyecto que este plan respeta:

- La tienda es visual, "producto primero, poco texto". El texto SEO extra va en
  metadatos, HTML de respaldo, páginas de colección breves y `/entregas-maracaibo`,
  no en bloques largos dentro de la portada.
- Prohibido en la tienda: reseñas/ratings, login, favoritos. No se añade
  `aggregateRating` ni `review` en JSON-LD.
- No revelar proveedor, importación ni logística interna; no nombrar la fuente de
  la tasa Bs (Binance, BCV, "oficial").
- No inventar horarios, tarifas, tiempos de envío ni métodos de pago públicos.
- El material se toma literalmente de `product.material` (hoy "Aleación de zinc");
  nunca "plata".
- Sin dependencias nuevas. `HTMLRewriter` es nativo de Workers.
- No romper el aislamiento del bundle de Admin (SPEC C127 / V130).
- Las redes sociales para JSON-LD se toman de constantes de marca en
  `src/shared/seo.ts`; los ajustes guardados (`@coru`, `CORU`) no son URLs válidas.

---

## 1. Diagnóstico (evidencia en producción)

Pruebas hechas con peticiones HTTP sin JavaScript contra `https://coru.systems`:

| URL | Respuesta actual | Debería ser |
|---|---|---|
| `/` | 200, HTML de 1.133 bytes con `<div id="root"></div>` vacío | 200 con título, descripción y contenido propios |
| `/producto/<slug>` (42 productos) | El mismo HTML que `/` | 200 con nombre, precio, imagen y descripción del producto |
| `/guia-de-tallas`, `/privacidad` | El mismo HTML que `/` | 200 con metadatos propios |
| `/robots.txt` | 200 `text/html` (la SPA) | 200 `text/plain` |
| `/sitemap.xml` | 200 `text/html` (la SPA) | 200 `application/xml` con todas las URLs públicas |
| `/ruta-que-no-existe`, `/producto/slug-falso` | 200 (soft 404) | 404 |

Hallazgos en el código:

1. **Contenido solo con JavaScript.** `index.html` tiene un título y una descripción
   genéricos para todo el sitio. Los rastreadores que no ejecutan JS (Bing en parte,
   y siempre los de vistas previas de WhatsApp, Facebook e Instagram) no ven nada.
   Google lo ve tarde y con menos prioridad.
2. **Sin enlaces rastreables.** Tarjetas de producto (`ProductCard.tsx`), logo
   (`Brand.tsx`) y enlaces a guía y privacidad en `StorePage.tsx` son `<button>` con
   `navigate()`. Google no sigue botones, así que no descubre las 42 fichas.
   Los filtros de categoría son estado de React, sin URL.
3. **El servidor no puede personalizar el HTML.** `wrangler.jsonc` usa
   `not_found_handling: "single-page-application"`. Con la compatibilidad actual
   (`assets_navigation_prefers_asset_serving`, activa desde 2025-04-01) las
   navegaciones reciben `index.html` **sin invocar el Worker**. Hoy no hay punto
   donde inyectar metadatos ni devolver 404.
4. **Sin señales locales.** "Maracaibo" solo existe en
   `src/shared/delivery-points.ts`, que se carga por API dentro del carrito.
   Título, descripción y H1 ("Arma tu combo") no dicen qué se vende ni dónde.
5. **Sin metadatos sociales ni datos estructurados.** No hay `canonical`, Open Graph,
   Twitter Card, JSON-LD, imagen para compartir, `apple-touch-icon` ni manifest.
6. **Contenido de producto escaso.** Los slugs y nombres son buenos
   (`anillo-serpiente-enrollada`, `anillo-corazon-gotico`), pero cada descripción
   tiene una sola frase. Todo el material es aleación de zinc: el copy debe decir
   "plateado", nunca "plata".
7. **Tráfico orgánico invisible en la analítica.** `detectTrafficSource()` en
   `src/shared/analytics-source.ts` clasifica Google/Bing como `other`, así que no
   se podrá medir el efecto del SEO desde el panel.
8. **Redes sociales mal formadas para SEO.** `StoreSettings.instagramUrl` y
   `facebookUrl` aceptan texto libre (por defecto `@coru` y `CORU`). Para `sameAs`
   en JSON-LD hacen falta URLs absolutas `https://`.

Lo que ya está bien: HTTPS con HSTS, dominio propio, `lang="es"`, imágenes con
`srcset` y variantes WebP, guía de tallas con contenido útil y tabla semántica,
`/admin` detrás de Cloudflare Access.

---

## 2. Palabras clave objetivo

No hay datos de volumen todavía; esta lista es una hipótesis para validar en
Google Search Console tras 4–6 semanas (y con Google Trends o Keyword Planner).

| Intención | Términos | Página destino |
|---|---|---|
| Local / transaccional | anillos Maracaibo, tienda de anillos en Maracaibo, anillos Zulia, accesorios Maracaibo | `/` y `/entregas-maracaibo` |
| Temática | anillos góticos, anillos de calavera, anillos de serpiente, anillos de corazón, anillos de mariposa, anillos de flores, anillos sello, anillos con piedra negra | `/anillos/<coleccion>` |
| Atributo | anillos abiertos ajustables, anillos plateados, anillos para hombre, anillos para mujer | `/anillos/<coleccion>` y fichas |
| Producto | anillo serpiente enrollada, anillo calavera alada… | `/producto/<slug>` |
| Informativa | cómo saber mi talla de anillo, tabla de tallas de anillos en cm, medir anillo en casa | `/guia-de-tallas` |

Reglas de redacción: una intención principal por página, "Maracaibo" en título,
H1 o primer párrafo solo donde tenga sentido (portada, entregas, colecciones), sin
relleno de palabras clave, y sin prometer materiales que no son.

---

## 3. Decisión de arquitectura

Opciones evaluadas para que los rastreadores reciban HTML útil:

| Opción | Veredicto |
|---|---|
| **A. Worker + `HTMLRewriter` sobre `index.html`** | **Elegida.** El catálogo es dinámico (Turso, editable desde el admin) y ya vive hidratado en el Worker. Encaja con Hono y no toca el cliente React. |
| B. Prerender en build (SSG) | Descartada: el catálogo cambia sin rebuild y quedaría desactualizado. |
| C. SSR completo de React en el Worker + `hydrateRoot` | Descartada por ahora: mucho más código en el Worker y riesgo de desajustes de hidratación con estado de `localStorage` (moneda, carrito, avisos). |

Funcionamiento de la opción A:

1. `wrangler.jsonc` pasa a `run_worker_first` con lista de rutas. Al usar lista,
   Cloudflare deja de interpretar `Sec-Fetch-Mode`, así que **hay que incluir
   explícitamente `/api/*` y `/media/*`**, que hoy llegan al Worker por ser
   peticiones que no son navegación.
2. Para rutas públicas, el Worker pide `index.html` a `env.ASSETS`, resuelve la
   ruta con el mismo `resolveRoute()` del cliente y aplica `HTMLRewriter`:
   - reemplaza `<title>` y `<meta name="description">`;
   - añade `canonical`, Open Graph, Twitter Card y JSON-LD en `<head>`;
   - inserta dentro de `<div id="root">` un HTML semántico básico (H1, texto,
     enlaces, precio). `main.tsx` usa `createRoot().render()`, que **reemplaza**
     ese contenido al montar; no hay hidratación ni desajustes.
3. Si la ruta o el slug no existen, responde 404 con el mismo HTML (la SPA sigue
   mostrando su página 404).
4. `/admin*` recibe `X-Robots-Tag: noindex, nofollow`.

Configuración prevista (a verificar en local con `wrangler dev`):

```jsonc
"assets": {
  "directory": "./dist",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/*", "!/assets/*", "!/brand/*"]
}
```

`"/*"` con exclusiones permite devolver 404 real en cualquier ruta inventada. Los
PNG/SVG sueltos de `public/` (`coru-ring-hero.png`, etc.) pasarían por el Worker;
se pueden mover a `public/img/` y excluir `!/img/*` para evitar invocaciones.

Coste: cada carga de página HTML invoca el Worker (hoy no lo hace). Con el volumen
actual está muy por debajo del plan; el estado ya está hidratado en memoria del
isolate y se puede añadir `Cache-Control: public, max-age=0, s-maxage=300` más la
Cache API si hiciera falta.

---

## 4. Fases y tareas

### Fase 1 · Base técnica

| # | Tarea | Archivos |
|---|---|---|
| 1.1 | `robots.txt` estático: `Allow: /`, `Disallow: /admin`, `Disallow: /api/admin/`, línea `Sitemap: https://coru.systems/sitemap.xml`. **No** bloquear `/api/` ni `/media/`: Google los necesita para renderizar catálogo e imágenes | `public/robots.txt` |
| 1.2 | `GET /sitemap.xml` desde el Worker: portada, guía, privacidad, colecciones (fase 3) y productos públicos, con `<lastmod>` desde `updatedAt` del producto | `src/worker/routes/seo.ts` (nuevo), `src/worker/app.ts` |
| 1.3 | `run_worker_first` con lista de rutas (sección 3) | `wrangler.jsonc` |
| 1.4 | Módulo compartido de metadatos por ruta: título, descripción, canonical, `og:*`. Tomado de `resolveRoute()` + estado del catálogo | `src/shared/seo.ts` (nuevo, puro y testeable) |
| 1.5 | Middleware HTML con `HTMLRewriter` que aplica 1.4 y responde 404 si la ruta o el slug no existen | `src/worker/routes/seo.ts` |
| 1.6 | Actualizar `document.title` y la descripción al navegar en la SPA (mismo módulo de 1.4) para que coincida lo que ve el usuario con lo que vio el rastreador | `src/client/app/App.tsx` |
| 1.7 | Convertir en `<a href>` las tarjetas de producto, el logo y los accesos a guía/privacidad, interceptando el clic para mantener la navegación sin recarga (respetando Ctrl/Cmd+clic y botón central) | `ProductCard.tsx`, `Brand.tsx`, `StorePage.tsx`, `ProductPage.tsx`, `SizeGuidePage.tsx`, `router.ts` |
| 1.8 | `X-Robots-Tag: noindex` en `/admin*` | `src/worker/app.ts` |
| 1.9 | Imagen social por defecto 1200×630 PNG, `apple-touch-icon` 180 px, favicon PNG 48 px y `site.webmanifest` | `public/`, `index.html` |
| 1.10 | `lang="es-VE"` en `index.html` | `index.html` |

Plantillas de títulos (máx. ~60 caracteres) y descripciones (~150):

| Página | Título | Descripción |
|---|---|---|
| Portada | Anillos en Maracaibo · CORU | Anillos plateados con actitud: calaveras, serpientes, corazones y más. Entrega en Maracaibo y envíos a toda Venezuela. Pide por WhatsApp. (+ "Promo: 3 anillos por $10" solo si esa promoción está activa en el servidor) |
| Producto | {Nombre} · CORU Maracaibo | {Descripción} {Material}. {Talla si existe}. Entrega en Maracaibo o envío nacional. (El precio va en JSON-LD y `og`, no en el título, para no dejar precios viejos en Google.) |
| Guía de tallas | Cómo saber tu talla de anillo (tabla en cm) · CORU | Mide tu talla de anillo en casa con dos métodos y compárala con la tabla US en centímetros. |
| Privacidad | Privacidad · CORU | (actual, con `noindex` opcional) |

### Fase 2 · Contenido legible sin JavaScript y datos estructurados

| # | Tarea | Detalle |
|---|---|---|
| 2.1 | HTML de respaldo dentro de `#root` | Portada: H1, párrafo con propuesta local y lista de productos como `<a href="/producto/…">` con nombre y precio en USD. Ficha: H1, precio, disponibilidad, descripción, material, talla, imagen con `alt` y enlace a la guía. Mismo texto que renderiza React, para no incurrir en cloaking. |
| 2.2 | JSON-LD en portada | `OnlineStore` (nombre, logo, URL, `areaServed` Maracaibo/Zulia/Venezuela, `sameAs` Instagram y Facebook) + `WebSite`. |
| 2.3 | JSON-LD en fichas | `Product` con `name`, `image` (variante `detail1200`), `description`, `sku`, `brand`, `material`, `offers` (`price`, `priceCurrency: USD`, `availability` InStock / PreOrder / OutOfStock, `url`, `seller`). Opcional: `shippingDetails` con destino VE. |
| 2.4 | JSON-LD de migas de pan | Inicio › Anillos › {Producto}; visible también como texto en la ficha. |
| 2.5 | Open Graph de producto | `og:type=product`, `og:image` de la foto, `product:price:amount`, `product:price:currency`. Verificar en el depurador de Facebook que las vistas previas aceptan WebP; si no, generar una variante JPEG `og1200` en el pipeline de imágenes (`image.service.ts`, `scripts/backfill-image-derivatives.py`). |
| 2.6 | Redes sociales | Constantes de marca `https://www.instagram.com/corucore.jpg/` y `https://www.facebook.com/profile.php?id=61594548357564` en `src/shared/seo.ts` para `sameAs`. No convertir `@coru` de los ajustes (apuntaría a otra cuenta). Enlaces visibles a las redes en la franja "Información útil" de la portada. |
| 2.7 | Fuente "buscador" en analítica | Añadir `search` a `AnalyticsTrafficSource` para referrers de Google, Bing, DuckDuckGo y Yahoo, y para `utm_source=google_business`; mostrarlo en el panel. No hay restricción en la base de datos para `source`. |

Nota: Google limitó en 2023 los resultados enriquecidos de FAQ y HowTo; no
se añadirán esos esquemas esperando resultados enriquecidos.

### Fase 3 · Contenido local y por temática

| # | Tarea | Detalle |
|---|---|---|
| 3.1 | Portada con propuesta local | Mantener "Arma tu combo" como H1 visual. Cambiar solo el subtítulo a una línea corta tipo "Anillos y accesorios en Maracaibo · Envíos a toda Venezuela" y añadir en "Información útil" un acceso a `/entregas-maracaibo`. Nada de bloques largos (la tienda es "poco texto"). |
| 3.2 | Página `/entregas-maracaibo` | Puntos de entrega activos desde `/api/personal-delivery-points` (nombre y dirección; sin mapa nuevo), delivery en Maracaibo "costo a confirmar por WhatsApp", envío nacional "MRW o ZOOM · Cobro a destino", y cómo pedir (carrito → WhatsApp). Sin horarios, tarifas ni métodos de pago inventados. |
| 3.3 | Colecciones con URL propia | `/anillos`, `/anillos/calaveras`, `/anillos/corazones`, `/anillos/flores`, `/anillos/sello`, `/anillos/piedra-negra`, `/anillos/abiertos-ajustables`, `/anillos/animales`. Cada una con H1, 2–3 frases propias y la cuadrícula filtrada. Solo publicar colecciones con 4+ productos para evitar páginas pobres. Conteo actual aproximado: abiertos 8, animales 7, sello 6, calaveras 5, corazones 5, flores 5, piedra negra 5. |
| 3.4 | Modelo de datos de colecciones | Primera versión: reglas por palabra clave (nombre + descripción, sin tildes) en `src/shared/collections.ts`. Más adelante, y fuera de esta implementación: campo `collections` editable en el admin (migración `0007`). |
| 3.5 | Filtros enlazables | Los chips de categoría y colección navegan a su URL en lugar de solo cambiar estado. |
| 3.6 | Mejores descripciones | Plantilla de 2–3 frases: estilo y motivo, material y acabado, ajuste o talla. Se editan desde el admin (datos de producción; no los cambia un agente). |
| 3.7 | `alt` descriptivo | Cambiar "Imagen de {nombre}" por "{nombre}, anillo plateado de aleación de zinc" en la imagen principal. Miniaturas decorativas siguen con `alt=""`. |
| 3.8 | Enlazado interno | Ficha → su colección y 4 productos relacionados; guía de tallas → colecciones; pie de página con colecciones, entregas y redes. |

### Fase 4 · Fuera del código (dueño del negocio)

1. **Google Search Console**: verificar el dominio `coru.systems` (registro DNS en
   Cloudflare), enviar `sitemap.xml`, pedir indexación de portada y guía.
2. **Bing Webmaster Tools**: importar desde Search Console.
3. **Perfil de Empresa en Google** (palanca principal para Maps y "cerca de mí").
   Hacerlo después de que la fase 1 esté publicada:
   1. Entrar en <https://business.google.com/create> con la cuenta Google del negocio.
   2. Nombre: `CORU` (exactamente igual que en Instagram y Facebook; sin añadir
      palabras clave al nombre, Google lo penaliza).
   3. Categoría principal: "Tienda de bisutería". Secundaria: "Tienda de accesorios
      de moda" (o la más parecida que ofrezca el buscador de categorías).
   4. "¿Quieres añadir una ubicación que los clientes puedan visitar?": **No**
      (no hay tienda física). Marcar que entregas productos a clientes.
   5. Zona de servicio: Maracaibo y San Francisco (Zulia). Opcional: Zulia.
   6. Teléfono: el mismo número de WhatsApp del sitio. Web:
      `https://coru.systems/?utm_source=google_business`.
   7. Verificar (Google elige el método: llamada, SMS, correo o vídeo corto
      mostrando los productos y el material de marca).
   8. Completar: descripción (texto sugerido abajo), logo cuadrado
      (`public/brand/coru-mascot.svg` exportado a PNG 720×720), portada y 10+
      fotos reales de anillos, horario "con cita" o el que aplique, enlaces a
      Instagram y Facebook, y productos en la pestaña "Productos" con enlace a su
      ficha en `coru.systems`.

   Descripción sugerida (≤ 750 caracteres):

   > CORU es una marca de anillos y accesorios con actitud en Maracaibo. Piezas
   > plateadas con calaveras, serpientes, corazones, flores y diseños góticos para
   > combinar a tu estilo. Mira el catálogo en coru.systems, arma tu combo y pide por
   > WhatsApp. Entrega personal en C.C. El Gran Ruby, C.C. La Paragua y C.C. La
   > Campana, delivery en Maracaibo y envíos nacionales por MRW o ZOOM con cobro a
   > destino. También trabajamos piezas bajo pedido.
4. **Instagram y Facebook**: poner `https://coru.systems/?src=instagram` en la bio
   de Instagram (hoy dice "↓ catálogo") y `https://coru.systems/?src=facebook` en
   el perfil de Facebook. En cada publicación o anuncio de Marketplace, enlazar la
   ficha exacta (`/producto/<slug>?src=facebook`). En el admin, Ajustes, guardar las
   URLs completas de ambas redes.
5. **Facebook como página**: el perfil actual es `profile.php?id=…`. Asignarle un
   nombre de usuario (por ejemplo `facebook.com/coru.mcbo`) hace el enlace más
   reconocible y fácil de mantener igual en todas partes.
6. **Coherencia de datos (NAP)**: mismo nombre, WhatsApp, ciudad y URL en Google,
   Instagram, Facebook y el sitio.
7. **Reseñas**: pedirlas en el Perfil de Empresa tras cada entrega (solo en Google;
   la tienda web no muestra reseñas).
8. **Menciones locales**: directorios y cuentas de Maracaibo (moda, regalos,
   centros comerciales de los puntos de entrega).

---

## 5. Pruebas y criterios de aceptación

Tests automáticos (Vitest):
- `src/shared/seo.ts`: título, descripción, canonical y JSON-LD por cada tipo de
  ruta; escapado de texto en JSON-LD y atributos (nombres con comillas o `</script>`).
- Worker: `/sitemap.xml` lista solo productos públicos; `/producto/slug-falso` y
  rutas inventadas devuelven 404; `/admin` lleva `X-Robots-Tag`; `/api/*` y
  `/media/*` siguen funcionando con `run_worker_first`.
- Cliente: las tarjetas son `<a href>` y el clic normal no recarga la página;
  Ctrl+clic abre pestaña nueva.
- `detectTrafficSource()` devuelve `search` para referrers de Google/Bing.

Verificación manual antes de publicar:
- `curl` (sin JS) a portada, una ficha y la guía: título, descripción, H1 y
  enlaces presentes en el HTML.
- [Rich Results Test](https://search.google.com/test/rich-results) sin errores
  en `Product` y `BreadcrumbList`.
- [Depurador de Facebook](https://developers.facebook.com/tools/debug/) y un envío
  real por WhatsApp muestran imagen, nombre y precio.
- PageSpeed Insights móvil: sin regresión de LCP ni CLS por el HTML de respaldo.

Métricas de seguimiento (Search Console + panel de analítica):
- Páginas indexadas: objetivo 100 % de las URLs del sitemap.
- Impresiones y clics para consultas con "maracaibo" y términos temáticos.
- Sesiones con fuente `search` y pedidos por WhatsApp desde esas sesiones.

---

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| `run_worker_first` en forma de lista deja fuera `/api/*` o `/media/*` y rompe la tienda | Tests de rutas + `wrangler dev` + smoke en producción justo después del deploy |
| El HTML de respaldo produce un salto visual antes de que monte React | Usar las mismas clases base; medir CLS; si molesta, reducirlo al mínimo semántico |
| Contenido del respaldo distinto del renderizado (cloaking) | Generar ambos desde los mismos datos y textos compartidos |
| Vistas previas sin imagen por formato WebP | Probar en el depurador; variante JPEG si hace falta |
| Colecciones con pocos productos (páginas pobres) | Umbral de 4 productos; `noindex` por debajo |
| El árbol de trabajo tiene muchos cambios sin commit que ya están en producción | Implementar sobre el árbol actual (una rama desde `HEAD` perdería esos cambios), tocar solo archivos del plan, sin commits ni deploy sin aprobación |

---

## 7. Orden sugerido y esfuerzo estimado

1. Fase 1 completa: 1–2 días.
2. Fase 2: 1–2 días.
3. Alta en Search Console y Perfil de Empresa en Google (fase 4, pasos 1–3): en
   cuanto se despliegue la fase 1.
4. Fase 3: 2–4 días, más el tiempo de redactar descripciones.
5. Revisión en Search Console a las 4–6 semanas para ajustar palabras clave.

## 8. Datos pendientes del negocio

- ¿Se puede mostrar el número de WhatsApp en los datos estructurados? (hasta
  confirmarlo, no se incluye `telephone`).
- Horarios de entrega en los puntos y zonas de delivery cubiertas.
- Nombre de usuario para el perfil de Facebook (opcional).
