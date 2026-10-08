/* Service worker de la app instalable.
 *
 * Estrategia (pensada para un sitio con datos que cambian):
 *  - Navegaciones públicas: red primero; si no hay red, la última copia vista o /offline.html.
 *  - /_astro/* (archivos con hash): caché primero, nunca cambian.
 *  - Imágenes y tipografías: sirve la copia guardada y la actualiza en segundo plano.
 *  - NUNCA se guarda: panel, admin, ingreso/registro, rutas /ir/ ni llamadas a la API de Supabase.
 * Para forzar que todos los dispositivos renueven sus cachés, sube VERSION.
 */
const VERSION = 'v1';
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const IMAGES = `images-${VERSION}`;
const KEEP = [STATIC, PAGES, IMAGES];

const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/favicon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

// Rutas con datos de sesión o que no deben guardarse
const PRIVATE = [/^\/panel/, /^\/admin/, /^\/ingresar/, /^\/registro/, /^\/recuperar/, /^\/restablecer/, /^\/api\//];
const SKIP = [/^\/ir\//, /^\/sw\.js$/];

const MAX_PAGES = 40;
const MAX_IMAGES = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && SKIP.some((re) => re.test(url.pathname))) return;

  // Páginas
  if (req.mode === 'navigate') {
    if (!sameOrigin) return;
    if (PRIVATE.some((re) => re.test(url.pathname))) {
      event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    } else {
      event.respondWith(networkFirstPage(event));
    }
    return;
  }

  // Archivos con hash generados por el build
  if (sameOrigin && url.pathname.startsWith('/_astro/')) {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }

  // Íconos y archivos estáticos propios
  if (sameOrigin && /\.(?:png|svg|ico|webp|jpg|jpeg|woff2?)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, STATIC));
    return;
  }

  // Fotos de productos (Supabase Storage u otras) y tipografías
  if (req.destination === 'image') {
    event.respondWith(staleWhileRevalidate(req, IMAGES, MAX_IMAGES));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, STATIC));
  }
  // Todo lo demás (API de Supabase, etc.) pasa directo a la red
});

const cacheable = (res) =>
  res && (res.ok || res.type === 'opaque') && !/no-store/i.test(res.headers.get('Cache-Control') || '');

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function networkFirstPage(event) {
  const req = event.request;
  const cached = await caches.match(req, { cacheName: PAGES });
  try {
    // Con copia guardada, no esperamos más de 3 s a una red lenta
    const res = await withTimeout(fetch(req), cached ? 3000 : 20000);
    if (res.ok && res.type === 'basic' && cacheable(res)) {
      const copy = res.clone();
      event.waitUntil(caches.open(PAGES).then((c) => c.put(req, copy)).then(() => trim(PAGES, MAX_PAGES)));
    }
    return res;
  } catch {
    return cached || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req, { cacheName });
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req, copy));
  }
  return res;
}

async function staleWhileRevalidate(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (cacheable(res)) {
        cache.put(req, res.clone()).then(() => (max ? trim(cacheName, max) : undefined));
      }
      return res;
    })
    .catch(() => undefined);
  return hit || (await network) || Response.error();
}
