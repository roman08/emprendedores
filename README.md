# Por la Esquina

Portal gratuito donde emprendedores publican productos y servicios; los clientes los contactan por WhatsApp. Astro (SSR) + React islands + Supabase, desplegado en Netlify.

## Puesta en marcha

1. Crea un proyecto en [Supabase](https://supabase.com) y ejecuta las migraciones **en orden** (ver abajo) en el SQL Editor.
2. Copia `.env.example` a `.env` y completa `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`.
3. Configura Supabase Authentication (ver "Pasos manuales en Supabase").
4. `npm install` y `npm run dev`.
5. Vuelve admin a tu usuario (ver "Administrador").

## Migraciones (ejecutar en este orden)

Todas están en `supabase/migrations`. Son idempotentes salvo `0001`, que solo se ejecuta una vez en una base vacía. En una base nueva ejecuta todas, de la `0001` a la `0014`, una por una y en ese orden. En la base actual ya están `0001`-`0009` y `0012`; **`0010` no se pudo verificar con la clave pública: trátala como pendiente y ejecútala ya** (es idempotente). Faltan `0011` (correcciones de QA), `0013` y `0014`.

| # | Archivo | Qué hace |
|---|---------|----------|
| 1 | `0001_init.sql` | Esquema base: geografía, perfiles, negocios, publicaciones, imágenes, eventos, reportes, RLS, buckets de Storage y datos semilla (Tabasco, categorías). |
| 2 | `0002_business_hours.sql` | Columna `businesses.hours` (horarios de atención por día, opcional). |
| 3 | `0003_admin_reports.sql` | Panel admin y reportes: validaciones y límite anti-abuso de reportes (5 por hora por contenido), políticas para admin y función `admin_stats()`. |
| 4 | `0004_security_stats.sql` | Estadísticas confiables (dedupe por visitante y día, `track_event` solo para vistas, `track_event_server` para clics desde el servidor), triggers anti-spam en publicaciones y negocios, y RPC `my_stats`. |
| 5 | `0005_search.sql` | Búsqueda en español sin acentos y tolerante a errores (`search_listings`, `suggest_search`, índices). Hasta ejecutarla, `/explorar` usa un respaldo simple por título. |
| 6 | `0006_listing_extras.sql` | `listings.availability` (disponible / sobre pedido / agotado) y `orphan_storage_objects()` (solo admin, lista archivos sin referencia). |
| 7 | `0007_account.sql` | `delete_my_account()` para que cada usuario elimine su cuenta desde el panel. |
| 8 | `0008_nearby.sql` | "Negocios cerca de mí": índice `businesses_geo_idx` y RPC `nearby_businesses` (caja envolvente + haversine, sin PostGIS; valida rangos y nunca devuelve el WhatsApp). Hasta ejecutarla, `/cerca` muestra "aún no está disponible". |
| 9 | `0009_admin_storage.sql` | Políticas de Storage para que el admin liste y borre archivos (limpieza al borrar publicaciones o negocios) y RPC `admin_orphan_objects()` (huérfanos con tamaño, solo admin). Depende de `0006`. |
| 10 | `0010_profiles_role_guard.sql` | **URGENTE.** Seguridad: trigger que impide que un usuario se cambie a sí mismo el `role` de su perfil (evita volverse admin desde el navegador). Desde el SQL Editor sigue funcionando. |
| 11 | `0011_qa_fixes.sql` | Correcciones de seguridad de la revisión de QA: repite el guard de `role` y deja a los usuarios actualizar solo `profiles.full_name`; `featured_until`, `slug` y `created_at` los fija el servidor al crear publicaciones y negocios (nadie se auto-destaca); lista blanca de enlaces de mapa y tamaños máximos de campos; máximo de fotos y de publicaciones por negocio; `reports.created_at/resolved` fijados por el servidor (el límite de reportes ya no se evade) y tope diario de eventos por publicación; buckets con límite de 2 MB y solo WebP/JPEG/PNG, y listado de Storage solo para el dueño y el admin; `search_path` con `pg_temp` en las funciones `SECURITY DEFINER`. Ejecútala después de `0010`; si ya corriste `0014`, funciona igual. |
| 12 | `0012_search_near.sql` | `haversine_km` y la RPC `search_listings_near`: `/explorar` ordena del más cercano al más lejano (ubicación exacta si el negocio tiene pin; centro del municipio si no). Hasta ejecutarla, `/explorar` ordena por relevancia. |
| 13 | `0013_contact.sql` | Formulario `/contacto`: tabla `contact_messages` (anon y usuarios solo insertan los 4 campos del formulario; solo el admin lee, cambia el estado y borra), límite anti-spam (5 por hora por correo y 100 por hora en total) y fecha/estado/usuario fijados por el servidor. Alimenta la pestaña "Mensajes" de `/admin`. |
| 14 | `0014_reviews.sql` | Reseñas con moderación: tabla `reviews` (sin lectura pública, así no se expone `user_id`), triggers que limitan qué puede editar cada rol, RPC `business_rating_summary`, `list_business_reviews` y `reply_to_review` (respuesta única del dueño), y `reports.review_id` para reportar reseñas. Necesita `0003`. Alimenta la pestaña "Reseñas" de `/admin`. |
| 15 | `0015_municipios_tabasco.sql` | Completa los 17 municipios de Tabasco (0001 solo sembró 6) con coordenadas de su cabecera, y renombra "Villahermosa" a "Villahermosa (Centro)". Idempotente. |

Despliega el frontend junto con las migraciones: un frontend antiguo llamaría a `track_event` con 3 argumentos y los clics dejarían de contarse; el nuevo envía `p_visitor`.

## Variables de entorno

| Variable | Dónde | Descripción |
|----------|-------|-------------|
| `PUBLIC_SUPABASE_URL` | `.env` y Netlify | URL del proyecto Supabase. Obligatoria. |
| `PUBLIC_SUPABASE_ANON_KEY` | `.env` y Netlify | Clave anon. Obligatoria. |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo Netlify (scope Functions/Runtime; se declara como secreto de servidor en `astro.config.mjs` y no se incrusta en el build) | Secreto. Permite contar clics de WhatsApp y mapa en `/ir/*`. Sin ella la redirección funciona pero no se cuentan. Nunca con prefijo `PUBLIC_`. |
| `VISITOR_SALT` | Solo Netlify | Opcional. Cadena aleatoria larga para el hash anónimo de visitante en `/ir/*`. |
| `PUBLIC_TURNSTILE_SITE_KEY` | `.env` y Netlify | Opcional. Activa el captcha Cloudflare Turnstile en ingreso, registro, recuperación y `/contacto` (en `/contacto` solo se valida en el navegador; la defensa real es el honeypot y el límite por hora de `0013`). |
| `PUBLIC_ADS` | `.env` y Netlify | Opcional. `1` activa los espacios publicitarios. |
| `PUBLIC_ADSENSE_CLIENT` / `PUBLIC_ADSENSE_SLOT` | `.env` y Netlify | Opcional. Datos de Google AdSense; requieren `PUBLIC_ADS=1` y solo cargan tras el consentimiento de publicidad. |
| `PUBLIC_PLAUSIBLE_DOMAIN` | `.env` y Netlify | Opcional. Dominio (sin `https://`) para la analítica Plausible; solo carga tras el consentimiento de analítica. |
| `SITE_URL` | `.env` y Netlify | Opcional pero recomendada. Dominio público con `https://`: lo usan `astro.config.mjs`, `robots.txt`, `sitemap.xml`, canonicals, `og:image`, el QR de `/flyer` y los enlaces de invitación. `src/lib/brand.ts` también acepta `PUBLIC_SITE_URL` para `BRAND.domain` y `BRAND.site` (solo en el servidor). |
| `PUBLIC_GEOCODER` | `.env` y Netlify | Opcional. `nominatim` (defecto, gratuito), `maptiler` o `geoapify`. |
| `PUBLIC_MAPTILER_KEY` / `PUBLIC_GEOAPIFY_KEY` | `.env` y Netlify | Opcional. Clave del geocodificador elegido (visible en el navegador: restríngela por dominio). Sin clave se usa Nominatim. |

El banner de cookies solo aparece si hay Plausible o AdSense configurados. Al activarlos, amplía la CSP de `netlify.toml` con los dominios que indica la sección F de [DEPLOY.md](DEPLOY.md).

## Administrador

El panel `/admin` (resumen, negocios, publicaciones, reportes, reseñas y mensajes de contacto) solo abre para usuarios con rol `admin`. Para volver admin a un usuario, ejecuta en el SQL Editor:

```sql
update profiles set role = 'admin'
where id = (select id from auth.users where email = 'TU_CORREO');
```

Después vuelve a entrar al panel: aparece el enlace "Admin". Para revisar archivos huérfanos en Storage: `select * from orphan_storage_objects();` (solo borra desde el panel de Storage, la función no elimina nada).

## Pasos manuales en Supabase

1. **Authentication → Providers:** activa Email (y Google si lo deseas).
2. **Authentication → URL Configuration:** en Site URL pon el dominio del sitio y en Redirect URLs agrega `{SITE_URL}/panel` y `{SITE_URL}/restablecer` (este último es necesario para recuperar contraseña).
3. **Captcha (opcional):** crea un sitio en Cloudflare Turnstile, pon la site key en `PUBLIC_TURNSTILE_SITE_KEY` y activa **Authentication → Attack Protection → Enable CAPTCHA protection** con la secret key. Si lo activas en Supabase pero falta la variable en el sitio, ingreso y registro fallan.
4. **SMTP propio (recomendado antes de lanzar):** el correo integrado de Supabase tiene un límite muy bajo de envíos por hora. En **Authentication → SMTP Settings** configura un proveedor (Resend, Brevo, SES…) y revisa las plantillas de correo en español.
5. **Storage:** los buckets `listing-images` y `business-media` los crea `0001`. Verifica que sean públicos.
6. **Foreign keys:** confirma que las FKs hacia `auth.users` y entre tablas del negocio usan `on delete cascade` (así `delete_my_account()` limpia todo).

## Despliegue (Netlify)

Guía completa paso a paso (GitHub, Netlify, Supabase, dominio, correo, analítica y anuncios): [DEPLOY.md](DEPLOY.md). Resumen: conecta el repositorio; `netlify.toml` ya define el build y las cabeceras de seguridad. Agrega las variables de la tabla anterior en el panel de Netlify. La política CSP está en modo `Report-Only`: revisa la consola del navegador en producción y, cuando no haya avisos, cambia la cabecera a `Content-Security-Policy`.

## Estructura

- `supabase/migrations`: esquema, RLS, triggers y funciones.
- `src/pages`: páginas públicas SSR (`/`, `/explorar`, `/cerca`, `/favoritos`, `/guia`, `/flyer`, `/contacto`, `/p/[slug]`, `/n/[slug]`, `/como-funciona`, `/terminos` y `/privacidad`), páginas SEO por ubicación (`/[estado]`, `/[estado]/[municipio]` y `/[estado]/[municipio]/[categoria]`, con ayudas en `_lib.ts` y `_Location.astro`), auth (`/ingresar`, `/registro`, `/recuperar`, `/restablecer`), `/panel`, `/admin`, rutas `/ir/*` (redirección a WhatsApp y mapa con conteo en servidor), `robots.txt` y `sitemap.xml`. Las rutas estáticas tienen prioridad sobre las dinámicas, por eso `/p`, `/n`, `/ir`, `/panel`, etc. no las captura `[estado]`.
- `src/components/panel`: panel del emprendedor (islas React `client:only`), habla directo con Supabase bajo RLS.
- `src/components/admin`: panel de administración (listas paginadas en servidor, borrado con limpieza de Storage y herramienta de archivos huérfanos).
- `src/components/NearbyFinder.tsx`: isla de `/cerca` (GPS o municipio, radio, categoría, lista y mapa).
- `src/components/ReviewsSection.tsx`: reseñas de la tienda (`/n/[slug]`); `ContactForm.tsx`: formulario de `/contacto`.
- `src/components/FavoriteButton.tsx`, `FavoritesList.tsx` y `src/lib/favorites*.ts`: Guardados (favoritos en el navegador, sin cuenta, con lista compartible).
- `src/components/Logo.astro`, `GrowingBanner.astro` ("Estamos creciendo" cuando hay pocos resultados), `CookieConsent.astro` y `AdSlot.astro`.
- `src/lib`: `brand.ts` (nombre, eslogan y datos legales de la marca), `hours.ts` (horarios con hasta dos turnos por día), `favorites.ts`, `geocode.ts` (geocodificador intercambiable), `format.ts`, `upload.ts`, `supabase.ts`.
- `scripts/make-icons.mjs` y `scripts/make-og.mjs`: regeneran los iconos, el manifiesto y `public/og-default.png` desde `brand.ts`.
- `docs/PILOTO.md`: plan del piloto (a quién invitar, mensajes, seguimiento). La guía de despliegue es [DEPLOY.md](DEPLOY.md).
- `e2e`: pruebas de navegador con Playwright (`npm run test:e2e`); `qa-output` guarda capturas y resultados de QA (no se sube al repositorio).

## Pruebas

`npm test` ejecuta las pruebas unitarias (Vitest, solo `src/**/*.test.ts`: horarios, favoritos, JSON-LD y enlaces de mapa; `vitest.config.ts` excluye `e2e/`). `npm run test:e2e` corre las pruebas de navegador (Playwright; levanta `astro dev` en `E2E_PORT`, por defecto 4399; usa respuestas simuladas para todo lo autenticado y solo lecturas contra Supabase). `npx astro check` revisa tipos y `npm run build` compila el sitio.
