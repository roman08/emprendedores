// Convierte public/og-default.svg en public/og-default.png (1200x630) para WhatsApp/Facebook/X.
// Uso: node scripts/make-og.mjs   (sharp ya viene como dependencia de Astro)
import sharp from 'sharp';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../public/og-default.svg', import.meta.url));
const out = fileURLToPath(new URL('../public/og-default.png', import.meta.url));

const svg = await readFile(src);
await sharp(svg, { density: 144 }).resize(1200, 630, { fit: 'cover' }).png({ compressionLevel: 9 }).toFile(out);
const { size } = await stat(out);
console.log(`og-default.png generado (${Math.round(size / 1024)} KB)`);
