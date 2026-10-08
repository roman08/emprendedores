import { defineConfig, envField } from 'astro/config';
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
  // Secretos solo de servidor: astro:env los lee en tiempo de ejecución y nunca los incrusta en el bundle
  // (un acceso dinámico a import.meta.env metía TODAS las variables, incluida la service role, en la función).
  env: {
    schema: {
      SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      VISITOR_SALT: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // qrcode es CommonJS y se importa solo desde una isla: pre-optimizarlo evita recargas de dependencias en caliente
    optimizeDeps: { include: ['qrcode'] },
  },
});
