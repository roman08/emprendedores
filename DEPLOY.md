# Guía de despliegue

Guía paso a paso para publicar el portal. No necesitas ser programador: copia y pega los comandos y sigue las pantallas.

Resumen: **código en GitHub -> sitio en Netlify -> base de datos en Supabase -> dominio propio**.

---

## A. Subir el proyecto a GitHub

1. Crea una cuenta en <https://github.com> y un repositorio nuevo **privado** (botón "New"), sin README ni .gitignore.
2. En una terminal, dentro de la carpeta del proyecto, **antes de subir nada** verifica que `.env` esté ignorado:

   ```bash
   git check-ignore -v .env
   ```

   Debe responder algo como `.gitignore:5:.env  .env`. Si no responde nada, **no continúes**: agrega la línea `.env` a `.gitignore`.
3. Revisa qué se va a subir y confirma que `.env` NO aparece en la lista:

   ```bash
   git add .
   git status
   ```

   Si `.env` aparece, ejecuta `git rm --cached .env` y repite.
4. Primer commit y subida (cambia la URL por la de tu repositorio):

   ```bash
   git commit -m "Primer commit"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
   git push -u origin main
   ```

5. Si alguna vez subes una clave por error, **cámbiala** en Supabase (Project Settings -> API); borrar el archivo del repositorio no basta.

## B. Crear el sitio en Netlify

1. Entra a <https://app.netlify.com>, "Add new site" -> "Import an existing project" -> GitHub -> elige el repositorio.
2. Configuración de build (ya viene en `netlify.toml`, solo confirma):
   - Build command: `npm run build`
   - Publish directory: `dist`
3. En "Site configuration" -> "Environment variables" agrega:

| Variable | Obligatoria | Secreta | Para qué sirve |
|---|---|---|---|
| `PUBLIC_SUPABASE_URL` | Si | No | URL del proyecto Supabase |
| `PUBLIC_SUPABASE_ANON_KEY` | Si | No (pública, la protege RLS) | Clave anon de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Recomendada | **SI, nunca con PUBLIC_** | Cuenta los clics de WhatsApp y mapa (`/ir/*`) |
| `VISITOR_SALT` | Recomendada | **SI** | Cadena aleatoria larga para el identificador anónimo de visitante |
| `SITE_URL` | Recomendada | No | Dominio final con `https://` (sitemap, canonicals, imagen al compartir) |
| `PUBLIC_TURNSTILE_SITE_KEY` | Opcional | No | Captcha Cloudflare Turnstile |
| `PUBLIC_ADS` | Opcional | No | `1` muestra espacios publicitarios |
| `PUBLIC_ADSENSE_CLIENT` | Opcional | No | `ca-pub-...` de AdSense |
| `PUBLIC_ADSENSE_SLOT` | Opcional | No | ID numérico del bloque de anuncios |
| `PUBLIC_PLAUSIBLE_DOMAIN` | Opcional | No | Tu dominio, sin `https://` |
| `PUBLIC_GEOCODER` | Opcional | No | `nominatim` (defecto), `maptiler` o `geoapify` |
| `PUBLIC_MAPTILER_KEY` / `PUBLIC_GEOAPIFY_KEY` | Si usas ese proveedor | No (pero **restríngela por dominio** en el panel del proveedor) | Clave del geocodificador |

   Todo lo que empieza con `PUBLIC_` termina visible en el navegador: nunca pongas ahí un secreto. Para generar `VISITOR_SALT` puedes usar `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Pulsa "Deploy site". Cada `git push` a `main` desplegará automáticamente.
5. Tras cambiar variables, haz "Trigger deploy" -> "Clear cache and deploy site" (las `PUBLIC_*` se incorporan al compilar).

## C. Supabase para producción

1. **URL de autenticación:** Authentication -> URL Configuration.
   - *Site URL:* `https://tudominio.com`
   - *Redirect URLs:* `https://tudominio.com/**`. Para pruebas agrega la URL **exacta** de tu sitio de Netlify (`https://TU-SITIO.netlify.app/panel` y `https://TU-SITIO.netlify.app/restablecer`), **nunca** un comodín como `https://*.netlify.app/**` (cualquiera podría desplegar un sitio en ese dominio y recibir los enlaces de recuperación de contraseña de tus usuarios). `http://localhost:4321/**` solo en el proyecto de desarrollo, no en producción.
2. **Correo propio (SMTP).** El correo de Supabase por defecto está muy limitado (pocos correos por hora) y no sirve para producción. Con Resend:
   1. Crea cuenta en <https://resend.com>, "Domains" -> "Add domain" y agrega tu dominio.
   2. Resend te dará registros DNS (SPF, DKIM). Créalos en el panel DNS de tu dominio y espera a que diga "Verified".
   3. "API Keys" -> crea una clave con permiso de envío.
   4. En Supabase: Authentication -> Emails -> SMTP Settings -> activa "Enable custom SMTP":
      host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = tu API key, remitente `no-reply@tudominio.com`, nombre "Por la Esquina".

   Con Brevo es igual: <https://www.brevo.com> -> SMTP & API -> host `smtp-relay.brevo.com`, puerto `587`, usuario y clave SMTP que te muestre Brevo, y verifica tu dominio/remitente.
3. **Plantillas de correo:** Authentication -> Emails -> Templates. Traduce a español "Confirm signup", "Reset password" y "Magic link" (conserva las variables `{{ .ConfirmationURL }}`).
4. **Reactivar la confirmación de correo (obligatorio antes de abrir al público):** Authentication -> Sign In / Providers -> Email -> activa "Confirm email". Si la desactivaste para pruebas, vuelve a activarla; con ella apagada cualquiera crea cuentas ilimitadas sin verificar su correo. En la misma pantalla sube la longitud mínima de contraseña a 8 o más y activa "Secure password change" (pide reautenticación reciente para cambiar la contraseña).
5. **Captcha (opcional):** si usas Turnstile, activa también "Enable CAPTCHA protection" en Authentication -> Attack Protection con la *secret key*.
6. **Plan y respaldos:** el plan gratuito pausa el proyecto tras una semana sin actividad y **no incluye respaldos descargables**. Para operar con negocios reales pasa a **Pro** (Organization -> Billing), que incluye respaldos diarios (Database -> Backups). Aun así, haz un respaldo propio periódico (ver sección G).
7. Confirma que las migraciones `supabase/migrations/*.sql` están ejecutadas en orden (`0001` a `0014`; la `0011` solo si existe) y que el bucket de Storage existe con sus políticas. Si ya tenías la base de pruebas, faltan por ejecutar `0013_contact.sql` (formulario de contacto) y `0014_reviews.sql` (reseñas), en ese orden. Mientras no estén, `/contacto` no puede enviar y las reseñas muestran un error.
8. **Administrador:** deja un solo admin (ver la sección "Administrador" del [README](README.md)) y vuelve a entrar con esa cuenta.

## D. Dominio propio y HTTPS

1. Compra el dominio (Namecheap, GoDaddy, Cloudflare, NIC.mx para `.mx`).
2. Netlify -> "Domain management" -> "Add a domain" y sigue las instrucciones: o bien usas los nameservers de Netlify, o bien creas en tu DNS un registro `CNAME` de `www` hacia `TU-SITIO.netlify.app` (y `A`/ALIAS para el dominio raíz según indique Netlify).
3. Cuando el DNS propague (minutos a horas), en "HTTPS" pulsa "Verify DNS configuration" y luego "Provision certificate" (Let's Encrypt, gratuito y automático).
4. Activa "Force HTTPS" y elige si el dominio principal es con o sin `www`; el otro redirige.
5. Actualiza `SITE_URL`, el *Site URL* de Supabase y las *Redirect URLs* con el dominio final, y vuelve a desplegar.

## E. Buscadores, analítica y publicidad

### Google Search Console
1. <https://search.google.com/search-console> -> agrega tu dominio y verifícalo con un registro DNS TXT.
2. "Sitemaps" -> envía `https://tudominio.com/sitemap.xml`.
3. Revisa en "Páginas" qué se indexa; `/panel`, `/admin`, `/favoritos`, `/flyer`, `/ir/` y `/api/` están bloqueados en `robots.txt`.

### Plausible (analítica)
1. Crea cuenta en <https://plausible.io> y agrega tu dominio como sitio.
2. Define `PUBLIC_PLAUSIBLE_DOMAIN=tudominio.com` en Netlify y redespliega. El script **solo se carga si el visitante acepta la analítica** en el banner de cookies.

### Google AdSense (requisitos realistas)
- Necesitas dominio propio, contenido original y útil (decenas de negocios con fichas completas, no páginas vacías), páginas de privacidad, términos y contacto **definitivas** (ya están redactadas, pero completa tus datos en `src/lib/brand.ts` y pide que las revise un abogado antes de solicitar), y navegación clara.
- Google revisa el sitio manualmente; suele tardar de días a semanas y puede rechazar por "contenido insuficiente". No hay un mínimo oficial de visitas, pero sin tráfico real los ingresos serán casi nulos y la aprobación, más difícil. Conviene tener el piloto andando y algo de tráfico orgánico.
- Pasos: solicita la cuenta en <https://adsense.google.com>, agrega el sitio, y cuando lo aprueben crea un bloque de anuncios. Define `PUBLIC_ADS=1`, `PUBLIC_ADSENSE_CLIENT=ca-pub-...` y `PUBLIC_ADSENSE_SLOT=<id del bloque>`.
- Los anuncios solo se cargan si el visitante acepta la categoría "Publicidad". Publica un archivo `ads.txt` en `public/` cuando AdSense te lo indique.
- Mientras no estén esas variables, `PUBLIC_ADS=1` solo muestra un marcador "Publicidad" (útil para ver el diseño, no lo dejes así en producción).

## F. CSP: de Report-Only a enforcing

La política actual en `netlify.toml` es `Content-Security-Policy-Report-Only`: solo reporta en la consola, no bloquea.

1. Con el sitio ya en el dominio final, navega por todas las páginas con la consola del navegador abierta (F12) y anota los avisos "Content Security Policy".
2. Amplía las fuentes legítimas. Con los servicios opcionales activos necesitarás, como mínimo:
   - Plausible: `script-src https://plausible.io` y `connect-src https://plausible.io`
   - AdSense: `script-src https://pagead2.googlesyndication.com https://*.googlesyndication.com`, `frame-src https://googleads.g.doubleclick.net https://*.googlesyndication.com`, `connect-src https://*.google.com https://*.doubleclick.net`, `img-src` ya admite `https:`
   - Geocodificador: `connect-src https://nominatim.openstreetmap.org https://api.maptiler.com https://api.geoapify.com` (solo el que uses)
   - Mapas (Leaflet): los mosaicos de `tile.openstreetmap.org` entran por `img-src https:`
3. Cuando la consola esté limpia, en `netlify.toml` cambia `Content-Security-Policy-Report-Only` por `Content-Security-Policy`, despliega y vuelve a recorrer el sitio. Si algo se rompe, revierte el cambio (es una sola línea).

## G. Lista de verificación y rollback

### Después de desplegar
- [ ] La portada carga con HTTPS y sin avisos de contenido mixto.
- [ ] Registro de usuario: llega el correo de confirmación (revisa también spam) y el enlace abre el sitio, no localhost.
- [ ] Recuperar contraseña funciona de punta a punta.
- [ ] Crear un negocio con producto, fotos y ubicación (el "Ubicar" encuentra una dirección).
- [ ] Un negocio de prueba aparece en `/explorar` y en su página pública; el botón de WhatsApp abre el chat y suma un clic (tabla de métricas en Supabase).
- [ ] `/panel` y `/admin` redirigen a quien no tiene sesión/rol; un usuario normal no entra a `/admin`.
- [ ] `https://tudominio.com/robots.txt` y `/sitemap.xml` usan el dominio real.
- [ ] Al compartir un enlace en WhatsApp/Facebook aparece la imagen de vista previa (si no, prueba en el depurador de Facebook para limpiar la caché).
- [ ] El banner de cookies aparece (si hay Plausible/AdSense), "Solo necesarias" no carga terceros (pestaña Network) y "Preferencias de cookies" en el pie lo reabre.
- [ ] La clave `SUPABASE_SERVICE_ROLE_KEY` no aparece en el código fuente del navegador (Ver código fuente -> buscar "service_role").
- [ ] Lighthouse (F12 -> Lighthouse) en móvil: revisa accesibilidad y rendimiento.
- [ ] `/contacto`: envía un mensaje y aparece en Admin -> Mensajes. `/favoritos`, `/guia` y `/flyer` abren (el volante muestra el QR con tu dominio).
- [ ] Reseñas: con una cuenta de cliente (con más de 10 minutos de antigüedad) deja una reseña en la tienda de otro negocio; el dueño la responde y el admin puede ocultarla.
- [ ] En un celular angosto (360 px) el encabezado no se desborda.
- [ ] Plan del piloto: [docs/PILOTO.md](docs/PILOTO.md).

### Respaldos
- Plan Pro de Supabase: respaldos diarios automáticos (Database -> Backups).
- Respaldo propio mensual: Supabase CLI `supabase db dump -f respaldo.sql` (necesita la cadena de conexión de Project Settings -> Database) y copia de las fotos del bucket de Storage a un disco o nube tuya.
- Activa alertas por correo de Supabase y Netlify (Project/Site settings -> Notifications).

### Rollback
- **Código:** en Netlify -> "Deploys", abre un despliegue anterior que funcionara y pulsa "Publish deploy". Es inmediato. Luego corrige en Git con `git revert <commit>` y `git push`.
- **Variables:** si un cambio de variable rompe el sitio, vuelve al valor anterior y redespliega.
- **Base de datos:** las migraciones no se deshacen solas. Antes de ejecutar una nueva en producción haz un respaldo; si falla, restaura desde Backups (Pro) o desde tu `respaldo.sql`.
- **Emergencia:** para sacar el sitio del aire, en Netlify -> "Site configuration" -> "Danger zone" -> "Stop auto publishing" y/o publica una página de mantenimiento.

## H. Identidad de marca
- **Nombre, eslogan y datos legales:** edita solo `src/lib/brand.ts` (`BRAND`). Ahí también van `legalName`, `contactEmail`, `address` y `updatedAt`, que usan términos y privacidad. El dominio sale de `PUBLIC_SITE_URL` o `SITE_URL`.
- **Colores:** tokens `--color-brand-*` en `src/styles/global.css` (con las razones de contraste documentadas). Si cambias `brand-600`, actualiza también `themeColor` en `brand.ts`.
- **Iconos e imagen para compartir:** tras cambiar nombre o colores ejecuta `node scripts/make-icons.mjs` (favicon.ico, apple-touch-icon, icon-192/512 y site.webmanifest) y `node scripts/make-og.mjs` (og-default.png). El dibujo del logo está en `src/components/Logo.astro`, `public/favicon.svg` y `public/og-default.svg`; si lo rediseñas, cámbialo en los tres y en `make-icons.mjs`.
- Después de desplegar, Facebook y WhatsApp guardan en caché la imagen anterior: límpiala con el depurador de Facebook.
