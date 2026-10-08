# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

**Por la Esquina**: portal gratuito donde emprendedores de Tabasco (empezando por Cunduacán) publican productos y servicios; los clientes los contactan por WhatsApp. No hay ventas, pagos ni carrito. Ingresos futuros por publicidad. Todo el texto de la interfaz y la documentación está en **español (México)**. La persona dueña del proyecto delega las decisiones técnicas: propón y ejecuta, y confirma solo lo irreversible o lo que requiere sus cuentas.

## Comandos

```bash
npm run dev            # servidor local en :4321
npm run build          # build de producción (Astro SSR + adaptador Netlify)
npm run check          # astro check (tipos): debe dar 0 errores
npm test               # vitest: pruebas unitarias en src/**/*.test.ts (hours, favorites, format)
npm run test:e2e       # Playwright (e2e/); E2E_PORT=<puerto> para elegir puerto
npx vitest run src/lib/hours.test.ts            # un solo archivo de pruebas
npx playwright test e2e/functional/layout.spec.ts --project=mobile   # un solo spec
node scripts/make-icons.mjs && node scripts/make-og.mjs   # regenera iconos, manifiesto, offline.html e imagen OG desde src/lib/brand.ts
```

No hay linter. Verificación mínima antes de dar algo por terminado: `npm run check`, `npm run build` y `npm test`.

## Arquitectura (lo que cruza varios archivos)

- **Sin backend propio.** Astro (`output: 'server'`, adaptador Netlify) + islas React + Tailwind v4. El navegador habla **directo con Supabase** (Postgres + Auth + Storage) y **la seguridad vive en RLS y triggers** de `supabase/migrations/`. Cualquier regla de negocio o de seguridad nueva va a la base, no solo al cliente.
- **Páginas públicas = SSR** (`src/pages`): consultan Supabase desde el servidor con la clave anon (`src/lib/supabase.ts`). **Panel y admin = islas `client:only`** (`src/components/panel`, `src/components/admin`), con la sesión en `localStorage`; por eso el header decide qué mostrar con `html[data-auth]` (script inline en `Base.astro` + `src/lib/authUi.ts`) y no en el servidor.
- **`/ir/whatsapp/[id]` y `/ir/mapa/[id]`** (`src/pages/ir/`): rutas de servidor que cuentan el clic (con la `SUPABASE_SERVICE_ROLE_KEY`, declarada como secreto de servidor con `envField` en `astro.config.mjs`, nunca en el bundle) y responden 302. El número de WhatsApp no se imprime en el HTML. Aun así es legible por la API REST de `businesses` (decisión aceptada para el MVP; el aviso de privacidad lo declara público).
- **Marca y datos legales en un solo archivo:** `src/lib/brand.ts` (`BRAND`). Lo leen layout, logo, mensajes para compartir y los textos legales, que degradan con elegancia si un dato está vacío. `legalName` está vacío a propósito (la agencia "Moriah Studio" aún no existe como empresa).
- **Búsqueda y cercanía por RPC de Postgres:** `search_listings` (0005, español sin acentos, tolerante a errores), `search_listings_near` (0012, ordena por distancia), `nearby_businesses` (0008). `/explorar` ordena por cercanía por defecto usando la cookie `ubi` (ubicación aproximada, 24 h) o el municipio elegido en «Desde»; si la RPC no existe, cae a un respaldo simple.
- **Horarios:** `businesses.hours` (jsonb) hasta 2 turnos por día, zona `America/Mexico_City`; toda la lógica en `src/lib/hours.ts` (con 38 pruebas). Estado «abierto/cerrado» y aviso previo a WhatsApp fuera de horario (`ClosedDialog.astro`).
- **Fotos obligatorias para publicar:** trigger en BD + validación en cliente; mín. 1 y **máx. 4 por publicación**, **12 publicaciones por negocio** y 10 nuevas por día (migración `0016`; las constantes `MAX_IMAGES`/`MAX_LISTINGS` de `ListingsManager.tsx` deben coincidir con la base, que es la que impone el límite). Se comprimen a WebP en el navegador (`src/lib/upload.ts`: 1200 px / 0.5 MB) y se sube una **miniatura** `<uuid>.t.webp` (480 px) junto a cada foto; las tarjetas usan `thumbUrl()` y caen a la foto completa con `data-full` (listener global en `authUi.ts`). Es lo que cuida la transferencia del plan gratuito de Supabase. Cualquier código que borre fotos de Storage debe borrar también la miniatura (`removeImage` y `listingImagePaths` ya lo hacen).
- **Favoritos:** solo `localStorage` (`src/lib/favorites.ts`), sin cuenta. **Reseñas:** solo con cuenta, una por persona y negocio, con moderación; la tabla no es legible públicamente, se lee por RPC (`list_business_reviews`) sin exponer `user_id`.
- **PWA:** `public/sw.js` (se registra solo en producción desde `src/lib/pwa.ts`; nunca cachea panel, admin, ingreso ni `/ir/`), `public/site.webmanifest`, `public/offline.html` (los genera `scripts/make-icons.mjs`), `/instalar`.
- **SEO local:** `src/pages/[estado]/[municipio]/[categoria]` + `sitemap.xml.ts` + `robots.txt.ts`. Búsquedas y filtros de `/explorar` van `noindex`.

## Convenciones y trampas (aprendidas con errores reales)

- **Migraciones ya ejecutadas no se editan.** Cambios de base = nueva migración con el siguiente número (`0016`...), idempotente (`create or replace`, `if not exists`, `drop policy/trigger if exists`), `SECURITY DEFINER` con `search_path` fijo y grants explícitos. Cuida los delimitadores `$$` (un `$` suelto ya rompió la 0014).
- **`profiles.role` es un blanco clásico de escalada de privilegios:** lo protegen 0010/0011. Un admin se asigna solo desde el SQL Editor (`update profiles set role='admin' ...`).
- **Los `rpc()` de supabase-js son perezosos:** solo envían la petición si se consumen (`await` o `.then`). Olvidarlo hizo que las estadísticas no se registraran.
- **Tailwind v4:** los componentes de `global.css` (`.btn`, `.card`, `.input`…) deben estar en `@layer components`; fuera de la capa pisan a `hidden`, `bg-*`, etc.
- **Leaflet:** llamar `setView` antes de agregar capas; los popups se arman con nodos DOM (`textContent`), nunca con strings (XSS por nombre de negocio).
- **Texto de usuario → HTML:** JSON-LD con `ldJson()`, URLs con `safeHttpUrl()`/`safeMapsUrl()`/`cssUrl()` (`src/lib/format.ts`). Nunca `set:html` con datos de usuarios sin escapar.
- **`SITE_URL`** se normaliza en `astro.config.mjs` y `brand.ts` (acepta sin `https://`); un valor inválido ya tumbó un build de Netlify con «Invalid URL».
- **Renombrar el sitio en Netlify libera el subdominio anterior** y rompe las URLs de retorno de Supabase/Google: ante un cambio de URL actualiza Site URL y Redirect URLs (exactas, sin comodines) en Supabase y los orígenes autorizados en Google Cloud.
- **Entorno de esta máquina (Windows):** el shell Bash falla con acentos dentro de heredocs y no tiene `python`: crea y edita archivos con las herramientas Write/Edit. Astro 7 exige `--ignore-lock` para un segundo `astro dev` (no uses `--force`: mataría el servidor del usuario en :4321). Los avisos «LF will be replaced by CRLF» de git son inofensivos.
- **Pruebas e2e:** parte de las páginas públicas leen datos reales de Supabase; con la base vacía algunas se saltarán o fallarán. Las pantallas autenticadas se prueban con mocks (`e2e/helpers/mockSupabase.ts`), nunca contra la base real: no crees cuentas ni escribas datos reales en pruebas.

## Estado actual (octubre 2026)

- **En producción:** https://porlaesquina.netlify.app (Netlify desde `main` del repo `roman08/emprendedores`), Supabase gratuito, ingreso con Google funcionando, app instalable verificada en un celular. **Migraciones `0001`–`0015` ejecutadas** (según el usuario); base limpia: solo el usuario admin `rmcentinela@gmail.com`.
- **Sin dominio propio** (sin presupuesto): al comprarlo, seguir la sección D de `DEPLOY.md` y actualizar además: Netlify (`SITE_URL`, dominio principal; la dirección `netlify.app` redirige sola), Supabase (Site URL y Redirect URLs), Google Cloud (orígenes autorizados), Turnstile, claves del geocodificador, Search Console y Plausible. Las sesiones, favoritos y la app instalada se reinician por cambio de origen.
- **Sin SMTP propio** (requiere dominio): «Confirm email» está **desactivado**; mitigación del piloto = Turnstile + ingreso con Google + enlace solo a invitados. Antes de abrir al público: dominio, Resend, activar Confirm email.
- **Pendiente (lo hace la persona, requiere sus cuentas):** crear el widget de Turnstile y poner `PUBLIC_TURNSTILE_SITE_KEY` en Netlify **antes** de activarlo en Supabase; subir el negocio de demostración «Moriah Studio» (`docs/moriah-demo/textos.md` + imágenes); `git push` de los últimos commits; revisión de un abogado de Términos y Aviso de privacidad.
- **Publicidad:** hay espacios (`AdSlot.astro`) y carga de AdSense solo con consentimiento, pero faltan `public/ads.txt`, ampliar la CSP (hoy `Report-Only` en `netlify.toml`) y un dominio propio (AdSense no aprueba `netlify.app`). Sin sistema de venta de banners directos.
- **Promoción:** post para grupos de Facebook y plan de piloto de 30–50 negocios de Cunduacán en `docs/PILOTO.md`; guía pública en `/guia`, cartel imprimible en `/flyer`.
- **Ideas no hechas:** módulo de campañas/banners, notificaciones por correo, importar productos por CSV, reordenar fotos arrastrando, múltiples negocios por usuario.
- **Anti-pausa de Supabase gratuito:** la plantilla `docs/keepalive-workflow.yml` (visita el sitio cada 3 días) **no está activa**: el token de Git de esta máquina no tiene el permiso `workflow` y GitHub rechaza el push de `.github/workflows/`. Para activarla, crear `.github/workflows/keepalive.yml` desde la web de GitHub con ese contenido, o dar el permiso `workflow` al token.

## Documentación

`README.md` (migraciones, variables de entorno, administrador), `DEPLOY.md` (GitHub → Netlify → Supabase → dominio → SMTP → AdSense → rollback), `docs/PILOTO.md` (plan y mensajes de invitación), `docs/moriah-demo/` (negocio de demostración).
