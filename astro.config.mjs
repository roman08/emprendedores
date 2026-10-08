import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import netlify from '@astrojs/netlify';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';

// SITE_URL (p. ej. https://tudominio.com) fija el dominio real para sitemap, canonicals y og:image; sin ella no se define
const env = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const site = (process.env.SITE_URL || env.SITE_URL || '').trim().replace(/\/$/, '') || undefined;

export default defineConfig({
  site,
  output: 'server',
  adapter: netlify(),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // qrcode es CommonJS y se importa solo desde una isla: pre-optimizarlo evita recargas de dependencias en caliente
    optimizeDeps: { include: ['qrcode'] },
  },
});
