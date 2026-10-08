// Genera los iconos de marca: favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png y site.webmanifest.
// Lee nombre y color desde src/lib/brand.ts. Uso: node scripts/make-icons.mjs   (sharp ya viene con Astro)
import sharp from 'sharp';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const brandSrc = await readFile(root('src/lib/brand.ts'), 'utf8');
const pick = (key) => brandSrc.match(new RegExp(`^\\s*${key}:\\s*'([^']*)'`, 'm'))?.[1] ?? '';
const name = pick('name') || 'Por la Esquina';
const shortName = pick('shortName') || name;
const description = pick('description');
const themeColor = pick('themeColor') || '#0e8571';

// Pin blanco (misma geometría que el logo) sobre fondo de color a sangre; sirve para iconos "maskable".
const pinMark = `<path d="M16 5.5c-4.7 0-8 3.4-8 7.6 0 5.2 8 13.4 8 13.4s8-8.2 8-13.4c0-4.2-3.3-7.6-8-7.6z" fill="#fff"/><circle cx="16" cy="13" r="3.4" fill="${themeColor}"/>`;
const fullBleed = (rounded) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${rounded ? 7 : 0}" fill="${themeColor}"/><g transform="translate(16 16) scale(1.05) translate(-16 -16)">${pinMark}</g></svg>`,
);

const png = (svg, size) => sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

// favicon.ico: contenedor ICO con imágenes PNG de 16, 32 y 48 px (formato válido desde Windows Vista).
const favSvg = await readFile(root('public/favicon.svg'));
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => png(favSvg, s)));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((img, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 0);
  e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(img.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.length;
  return e;
});
await writeFile(root('public/favicon.ico'), Buffer.concat([header, ...entries, ...images]));

// Icono "maskable": Android lo recorta con círculo/squircle, así que el pin debe caber en la zona segura (centro ~60 %).
const maskable = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${themeColor}"/><g transform="translate(16 16) scale(0.78) translate(-16 -16)">${pinMark}</g></svg>`,
);

await writeFile(root('public/apple-touch-icon.png'), await png(fullBleed(false), 180));
await writeFile(root('public/icon-192.png'), await png(fullBleed(false), 192));
await writeFile(root('public/icon-512.png'), await png(fullBleed(false), 512));
await writeFile(root('public/icon-maskable-192.png'), await png(maskable, 192));
await writeFile(root('public/icon-maskable-512.png'), await png(maskable, 512));

// Manifiesto de la app instalable. Los accesos directos aparecen al mantener pulsado el ícono en Android.
const manifest = {
  id: '/',
  name,
  short_name: shortName,
  description,
  lang: 'es-MX',
  dir: 'ltr',
  start_url: '/?source=pwa',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait-primary',
  background_color: '#f6f8f9',
  theme_color: themeColor,
  categories: ['business', 'shopping', 'lifestyle'],
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
  shortcuts: [
    { name: 'Cerca de mí', short_name: 'Cerca', url: '/cerca?source=shortcut', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    { name: 'Explorar', url: '/explorar?source=shortcut', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    { name: 'Mis guardados', short_name: 'Guardados', url: '/favoritos?source=shortcut', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    { name: 'Mi panel', url: '/panel?source=shortcut', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
  ],
};
await writeFile(root('public/site.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');

// Página sin conexión (la guarda el service worker). HTML autónomo: sin CSS ni JS externos.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const tagline = pick('tagline');
await writeFile(root('public/offline.html'), `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${themeColor}">
<title>Sin conexión · ${esc(name)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f8f9;color:#14212b;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;text-align:center}
  main{max-width:26rem}
  .mark{width:72px;height:72px;margin:0 auto 20px}
  h1{font-size:1.5rem;margin:0 0 8px}
  p{color:#5d6b76;line-height:1.5;margin:0 0 20px}
  button{background:${themeColor};color:#fff;border:0;border-radius:12px;padding:12px 20px;font-size:1rem;font-weight:600;cursor:pointer}
  small{display:block;margin-top:28px;color:#5d6b76}
</style>
</head>
<body>
<main>
  <svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="${themeColor}"/><path d="M16 5.5c-4.7 0-8 3.4-8 7.6 0 5.2 8 13.4 8 13.4s8-8.2 8-13.4c0-4.2-3.3-7.6-8-7.6z" fill="#fff"/><circle cx="16" cy="13" r="3.4" fill="${themeColor}"/></svg>
  <h1>Sin conexión</h1>
  <p>No pudimos cargar esta página porque no hay internet. Revisa tu conexión e inténtalo de nuevo; las páginas que ya visitaste pueden abrirse sin conexión.</p>
  <button type="button" onclick="location.reload()">Reintentar</button>
  <small>${esc(name)}${tagline ? ' · ' + esc(tagline) : ''}</small>
</main>
</body>
</html>
`);

for (const f of ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'offline.html', 'site.webmanifest']) {
  const { size } = await stat(root(`public/${f}`));
  console.log(`${f} (${size} bytes)`);
}
