# Cambios

Historial corto de lo que entra a git o a producción. La entrada nueva va arriba.

## 2026-09-24 — el trabajo de la tienda y el SEO queda en git

- La tienda pública, el HTML para Google y los filtros de estilo en la misma página pasan de la carpeta local al repositorio.
- Commit: `pendiente`
- Producción: lo ya publicado sigue en `https://coru.systems/`. El filtro independiente de categoría y estilo todavía no está desplegado.

## 2026-09-24 — los estilos filtran la tienda en la misma página

- Elegir calaveras, góticos u otro estilo ya no abre otra página. La grilla de la portada se filtra ahí mismo.
- Commit: sin commit.
- Producción: Worker `a32345ff-ca30-45c4-a8ba-52750aa257b5` en `https://coru.systems/`.

## 2026-09-24 — cada página tiene su propia dirección para Google

- Las fichas y las colecciones ya no se anuncian también como la portada. La descripción de la promo no corta “Pide por WhatsApp”. El HTML de cada anillo enlaza su colección y anillos parecidos.
- Commit: sin commit.
- Producción: Worker `8574d073-af32-4579-8fef-ea334ed276ed` en `https://coru.systems/`.

## 2026-09-24 — fotos de anillos en el HTML que lee Google

- La portada y las colecciones incluyen la foto y el texto alternativo de cada anillo en el HTML, sin esperar a JavaScript.
- Commit: sin commit.
- Producción: Worker `677ceefb-2328-48e6-a704-3a42715a1972` en `https://coru.systems/`.

## 2026-09-24 — la primera foto de la portada empieza a bajar con el HTML

- La portada avisa al navegador la imagen de la primera pieza antes de que cargue el JavaScript.
- Commit: sin commit.
- Producción: Worker `2a412649-c000-4e3c-bf04-3bc79cc13e3b` en `https://coru.systems/`.

## 2026-09-24 — la portada deja de saltar al cargar, y el HTML y los assets se cachean

- La portada reserva el alto del banner, los estilos y la grilla mientras llega el catálogo.
- El HTML público se puede guardar 30 segundos en el borde. Los archivos con hash de `/assets/` quedan un año en el navegador.
- Commit: sin commit.
- Producción: Worker `471272c0-e00e-4c58-9979-a5f309a16a1c` en `https://coru.systems/`.

## 2026-09-24 — Bing y bio de Instagram

- Bing Webmaster: `coru.systems` importado desde Search Console. Panel: `https://www.bing.com/webmasters/home?siteUrl=https://coru.systems/`
- Instagram: el enlace del perfil ya está puesto por Diego. La bio también lleva `https://coru.systems/?src=instagram`.
- Facebook: el enlace del perfil CORU quedó en `https://coru.systems/?src=facebook`. Sin teléfono.
- Commit: sin commit.

## 2026-09-24 — SEO de la tienda publicado, sin commit

- HTML con título, descripción y datos para Google; sitemap, colecciones, página de entregas en Maracaibo, descripciones de anillos, textos de imagen y vistas previas JPEG.
- Search Console: dominio `coru.systems` verificado y sitemap enviado.
- Sin Perfil de Empresa: no hay local, no se usa una dirección cualquiera de Maracaibo y el teléfono no se publica en Google. El contacto es la página, que abre WhatsApp.
- Commit: sin commit.
- Producción: Worker `bb52b829-8c66-45af-9386-dd40d5d4029a` en `https://coru.systems/`.
