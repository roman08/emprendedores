import type { Page, Request } from '@playwright/test';
import { AUTH_STORAGE_KEY, SUPABASE_URL, buildSession, fixtures } from '../helpers/mockSupabase';

export { AUTH_STORAGE_KEY, SUPABASE_URL, fixtures };

/** Hosts externos cuyas fallas de red no son culpa de la app (fuentes, tiles, imagenes de relleno). */
const EXTERNAL_NOISE = /fonts\.(googleapis|gstatic)\.com|tile\.openstreetmap\.org|picsum\.photos|challenges\.cloudflare\.com|plausible\.io|googlesyndication|nominatim/i;

export interface Watch {
  errors: string[];
  failed: string[];
  badResponses: string[];
}

/**
 * Registra console.error, pageerror, requests fallidas y respuestas >= 400 de recursos del mismo origen.
 * (Las respuestas 404 de la pagina principal se excluyen: se prueban aparte.)
 */
export function watch(page: Page, opts: { ignore?: RegExp[] } = {}): Watch {
  const w: Watch = { errors: [], failed: [], badResponses: [] };
  const ignore = opts.ignore ?? [];
  const skip = (s: string) => EXTERNAL_NOISE.test(s) || ignore.some((r) => r.test(s));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    const loc = m.location()?.url ?? '';
    // "Failed to load resource" de terceros es ruido de red del entorno
    if (skip(t) || skip(loc)) return;
    w.errors.push(`${t} @ ${loc}`);
  });
  page.on('pageerror', (e) => { if (!skip(e.message)) w.errors.push(`pageerror: ${e.message}`); });
  page.on('requestfailed', (r: Request) => {
    const u = r.url();
    if (skip(u) || r.failure()?.errorText === 'net::ERR_ABORTED') return;
    w.failed.push(`${r.method()} ${u} ${r.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    const u = res.url();
    if (res.status() < 400 || skip(u)) return;
    if (res.request().resourceType() === 'document') return;
    if (new URL(u).origin !== new URL(page.url() === 'about:blank' ? u : page.url()).origin && !u.includes('supabase.co')) return;
    w.badResponses.push(`${res.status()} ${u}`);
  });
  return w;
}

/** Sesion falsa con identities (para que AccountTab muestre "Cambiar contrasena"). */
export async function seedSession(page: Page, role: 'entrepreneur' | 'admin' = 'entrepreneur') {
  const s = buildSession(role) as any;
  s.user.identities = [{ provider: 'email', id: s.user.id, user_id: s.user.id }];
  // Se siembra solo una vez por pestana: despues de "Salir" la sesion no debe reaparecer al recargar.
  await page.addInitScript(([k, v]) => {
    try { if (!sessionStorage.getItem('qa-seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('qa-seeded', '1'); } } catch { /* */ }
  }, [AUTH_STORAGE_KEY, JSON.stringify(s)] as const);
  return s;
}

/** Evita llamadas a terceros (fuentes, tiles, imagenes) para que las pruebas sean deterministas y rapidas. */
export async function blockThirdParty(page: Page) {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.route(/fonts\.(googleapis|gstatic)\.com|tile\.openstreetmap\.org|picsum\.photos|plausible\.io/, (route) => {
    const u = route.request().url();
    if (/tile\.openstreetmap|picsum/.test(u)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  });
}

/** Lee del propio sitio (SSR, datos reales) el primer slug de ficha y de tienda publicados; null si no hay. */
export async function discover(page: Page): Promise<{ listing: string | null; business: string | null }> {
  await page.goto('/explorar');
  const href = await page.locator('a[href^="/p/"]').first().getAttribute('href').catch(() => null);
  const listing = href ? href.replace('/p/', '') : null;
  let business: string | null = null;
  if (listing) {
    await page.goto(`/p/${listing}`);
    const b = await page.locator('a[href^="/n/"]').first().getAttribute('href').catch(() => null);
    business = b ? b.replace('/n/', '') : null;
  }
  return { listing, business };
}

import { mockRest, type MockOptions } from '../helpers/mockSupabase';
/** mockRest con valores por defecto. Si se combina con un mock de auth propio, llamarlo ANTES (la ultima ruta registrada gana). */
export async function mockRestAll(page: Page, opts: MockOptions = {}) {
  return mockRest(page, opts);
}
export { mockRest };

/** Espera a que todos los islands de Astro se hayan hidratado (evita clics/checks perdidos antes de React). */
export async function hydrated(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll('astro-island[ssr]').length === 0, null, { timeout: 20000 });
}
