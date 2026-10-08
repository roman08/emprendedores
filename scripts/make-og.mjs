// Convierte public/og-default.svg en public/og-default.png (1200x630) para WhatsApp/Facebook/X.
// Nombre y eslogan se toman de src/lib/brand.ts. Uso: node scripts/make-og.mjs   (sharp ya viene como dependencia de Astro)
import sharp from 'sharp';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../public/og-default.svg', import.meta.url));
const out = fileURLToPath(new URL('../public/og-default.png', import.meta.url));
const brandSrc = await readFile(fileURLToPath(new URL('../src/lib/brand.ts', import.meta.url)), 'utf8');
const pick = (key) => brandSrc.match(new RegExp(`^\\s*${key}:\\s*'([^']*)'`, 'm'))?.[1];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

let svg = await readFile(src, 'utf8');
const name = pick('name');
const tagline = pick('tagline');
if (name) svg = svg.replace(/(<text id="brand-name"[^>]*>)[^<]*/, `$1${esc(name)}`);
if (tagline) svg = svg.replace(/(<text id="brand-tagline"[^>]*>)[^<]*/, `$1${esc(tagline)}`);

await sharp(Buffer.from(svg), { density: 144 }).resize(1200, 630, { fit: 'cover' }).png({ compressionLevel: 9 }).toFile(out);
const { size } = await stat(out);
console.log(`og-default.png generado (${Math.round(size / 1024)} KB)`);
