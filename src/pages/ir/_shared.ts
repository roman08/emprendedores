// Utilidades de las rutas /ir/* (redirecciones con registro de clics). El prefijo "_" evita que Astro lo trate como ruta.
import { createClient } from '@supabase/supabase-js';
import type { APIContext } from 'astro';
import { getSecret } from 'astro:env/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOTS = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slurp|curl|wget|headless/i;

export const isUuid = (v: string | null | undefined): v is string => !!v && UUID.test(v);

/**
 * Variables privadas (declaradas como secretos de servidor en astro.config.mjs): astro:env las lee en tiempo de
 * ejecución (process.env en Netlify, .env en desarrollo) y no las incrusta en el bundle.
 */
function privateEnv(name: 'SUPABASE_SERVICE_ROLE_KEY' | 'VISITOR_SALT'): string | undefined {
  return getSecret(name) || undefined;
}

/** 404 amigable (HTML simple, sin indexar). */
export function notFound(message = 'Este enlace ya no está disponible.'): Response {
  const html = `<!doctype html><html lang="es-MX"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" />
<title>No encontrado</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f8faf9;color:#111827;text-align:center;padding:16px}
a{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:12px;background:#15803d;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>No encontrado</h1><p>${message}</p><a href="/explorar">Explorar emprendedores</a></main></body></html>`;
  return new Response(html, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

export function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

/** Identificador anónimo del visitante: hash de IP + user-agent + día (no se guarda la IP). */
async function visitorId(ctx: APIContext): Promise<string> {
  let ip = 'unknown';
  try { ip = ctx.clientAddress; } catch { /* sin IP disponible */ }
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const salt = privateEnv('VISITOR_SALT') ?? '';
  const data = new TextEncoder().encode(`${salt}|${ip}|${ctx.request.headers.get('user-agent') ?? ''}|${day}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return 's:' + hex.slice(0, 32);
}

/**
 * Registra un clic sin bloquear nunca la redirección. Requiere SUPABASE_SERVICE_ROLE_KEY
 * (track_event_server solo es ejecutable por service role); sin ella simplemente no se cuenta.
 */
export async function trackClick(
  ctx: APIContext,
  kind: 'whatsapp_click' | 'map_click',
  target: { listing?: string; business: string },
): Promise<void> {
  try {
    if (ctx.request.method !== 'GET') return;
    if (BOTS.test(ctx.request.headers.get('user-agent') ?? '')) return;
    const key = privateEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!key) return;
    const admin = createClient(import.meta.env.PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false } });
    const { error } = await admin.rpc('track_event_server', {
      p_listing: target.listing ?? null,
      p_business: target.business,
      p_kind: kind,
      p_visitor: await visitorId(ctx),
    });
    if (error) console.warn('track_event_server', error.message);
  } catch (e) {
    console.warn('trackClick', e);
  }
}
