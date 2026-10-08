// Cabeceras de seguridad en TODA respuesta del servidor (SSR y rutas /ir/*).
// Las [[headers]] de netlify.toml solo se aplican con certeza a los archivos estáticos; con esto las páginas dinámicas
// (/n/*, /p/*, /explorar...) también las llevan. Si una respuesta ya trae la cabecera, no se pisa.
import { defineMiddleware } from 'astro:middleware';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000',
};

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
  } catch {
    // Respuestas con cabeceras inmutables (p. ej. Response.redirect): se dejan como están
  }
  return response;
});
