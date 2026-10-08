/**
 * Utilidades para auditar la app SIN tocar la base real de Supabase.
 * - fakeSession(): siembra una sesion falsa en localStorage (clave sb-<ref>-auth-token).
 * - mockRest(): intercepta **\/rest/v1/**, **\/auth/v1/**, **\/storage/v1/** del NAVEGADOR
 *   y responde con fixtures ficticias. Toda escritura no esperada se rechaza (403) y se registra.
 *
 * LIMITE: las paginas SSR de Astro consultan Supabase desde el servidor Node; page.route()
 * no ve esas llamadas (solo las del navegador).
 */
import type { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------- .env / ref ----------
function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const txt = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* sin .env */ }
  return out;
}
const ENV = readEnv();
export const SUPABASE_URL = ENV.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || 'https://fakeref.supabase.co';
export const SUPABASE_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
export const AUTH_STORAGE_KEY = `sb-${SUPABASE_REF}-auth-token`;

// ---------- IDs / fixtures ficticias ----------
export const FAKE_USER_ID = '00000000-0000-4000-8000-000000000001';
export const FAKE_ADMIN_ID = '00000000-0000-4000-8000-0000000000aa';
export const FAKE_BUSINESS_ID = '00000000-0000-4000-8000-0000000000b1';
export const FAKE_LISTING_ID = '00000000-0000-4000-8000-0000000000c1';
const IMG = 'https://picsum.photos/seed/qa/600/400'; // ficticia; se puede bloquear/sustituir

export const fixtures = {
  states: [{ id: 1, name: 'Tabasco' }],
  municipalities: [
    { id: 1, state_id: 1, name: 'Centro' },
    { id: 2, state_id: 1, name: 'Cárdenas' },
    { id: 3, state_id: 1, name: 'Comalcalco' },
  ],
  categories: [
    { id: 1, name: 'Comida', slug: 'comida', icon: null },
    { id: 2, name: 'Servicios', slug: 'servicios', icon: null },
    { id: 3, name: 'Moda', slug: 'moda', icon: null },
  ],
  business: {
    id: FAKE_BUSINESS_ID, owner_id: FAKE_USER_ID, name: 'Negocio Ficticio QA', slug: 'negocio-ficticio-qa',
    description: 'Descripción de prueba.', whatsapp: '5219990000000', logo_url: null, cover_url: null,
    municipality_id: 1, category_id: 1, address: 'Calle Falsa 123', lat: 17.99, lng: -92.93,
    hours: null, status: 'active', created_at: '2026-01-01T00:00:00Z',
    municipalities: { name: 'Centro' }, categories: { name: 'Comida', slug: 'comida' },
  },
  listing: {
    id: FAKE_LISTING_ID, business_id: FAKE_BUSINESS_ID, slug: 'producto-ficticio', title: 'Producto ficticio',
    description: 'Publicación de prueba', price: 99.5, type: 'product', availability: 'available',
    status: 'active', created_at: '2026-01-02T00:00:00Z',
    listing_images: [
      { id: 'img-1', listing_id: FAKE_LISTING_ID, url: IMG, position: 0 },
      { id: 'img-2', listing_id: FAKE_LISTING_ID, url: IMG, position: 1 },
    ],
    businesses: { name: 'Negocio Ficticio QA', slug: 'negocio-ficticio-qa', whatsapp: '5219990000000', municipalities: { name: 'Centro' } },
  },
  profile: (role: 'entrepreneur' | 'admin' = 'entrepreneur') => ({
    id: role === 'admin' ? FAKE_ADMIN_ID : FAKE_USER_ID,
    role, full_name: role === 'admin' ? 'Admin Ficticio' : 'Emprendedor Ficticio',
    status: 'active', created_at: '2026-01-01T00:00:00Z',
  }),
  report: {
    id: '00000000-0000-4000-8000-0000000000d1', listing_id: FAKE_LISTING_ID, business_id: null,
    reason: 'spam', details: 'Reporte ficticio', status: 'open', created_at: '2026-02-01T00:00:00Z',
  },
  event: { id: 1, event_type: 'whatsapp_click', business_id: FAKE_BUSINESS_ID, listing_id: FAKE_LISTING_ID, created_at: '2026-02-02T00:00:00Z' },
};

// ---------- sesion falsa ----------
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function fakeJwt(userId: string, expSec: number): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    iss: `${SUPABASE_URL}/auth/v1`, sub: userId, aud: 'authenticated', role: 'authenticated',
    exp: expSec, iat: expSec - 3600, email: 'qa@example.invalid',
  })}.${Buffer.from('firma-falsa').toString('base64url')}`;
}

export function buildSession(role: 'entrepreneur' | 'admin' = 'entrepreneur') {
  const uid = role === 'admin' ? FAKE_ADMIN_ID : FAKE_USER_ID;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  return {
    access_token: fakeJwt(uid, exp), token_type: 'bearer', expires_in: 31536000, expires_at: exp,
    refresh_token: 'fake-refresh-token',
    user: {
      id: uid, aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid',
      email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}

/** Siembra la sesion falsa antes de que cargue cualquier script de la pagina. */
export async function fakeSession(page: Page, opts: { role?: 'entrepreneur' | 'admin' } = {}) {
  const session = buildSession(opts.role ?? 'entrepreneur');
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* */ } },
    [AUTH_STORAGE_KEY, JSON.stringify(session)] as const);
  return session;
}

// ---------- mock REST ----------
export type Handler = unknown | ((ctx: { url: URL; method: string; body: any; route: Route }) => unknown);
export interface MockOptions {
  role?: 'entrepreneur' | 'admin';
  /** Claves: "GET listings", "rpc/search_listings", "POST listings", "storage". Valor: fixture o funcion. */
  handlers?: Record<string, Handler>;
  /** Escrituras que SI se permiten (devuelven 201/204 sin tocar nada). Ej: ['POST listings']. */
  allowWrites?: string[];
}
export interface MockLog {
  requests: string[];
  /** Escrituras no esperadas (rechazadas con 403). */
  blockedWrites: { method: string; url: string; body: unknown }[];
  /** Escrituras permitidas explicitamente (simuladas). */
  allowedWrites: { method: string; url: string; body: unknown }[];
}

const WRITE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// RPC que solo registran telemetria: se aceptan como no-op y no cuentan como bloqueadas.
const BENIGN_RPC = new Set(['track_event', 'track_event_server']);

function defaultTable(table: string, role: 'entrepreneur' | 'admin'): unknown {
  switch (table) {
    case 'states': return fixtures.states;
    case 'municipalities': return fixtures.municipalities;
    case 'categories': return fixtures.categories;
    case 'businesses': return [fixtures.business];
    case 'listings': return [fixtures.listing];
    case 'listing_images': return fixtures.listing.listing_images;
    case 'profiles': return [fixtures.profile(role)];
    case 'reports': return [fixtures.report];
    case 'events': return [fixtures.event];
    default: return [];
  }
}
function defaultRpc(name: string): unknown {
  switch (name) {
    case 'search_listings': return [fixtures.listing];
    case 'nearby_businesses': return [{ ...fixtures.business, distance_km: 1.2 }];
    case 'suggest_search': return [];
    case 'my_stats': return { views: 10, whatsapp_clicks: 3, listings: 1 };
    case 'admin_stats': return { businesses: 1, listings: 1, reports_open: 1, users: 2 };
    case 'admin_orphan_objects': return [];
    default: return null;
  }
}

export async function mockRest(page: Page, opts: MockOptions = {}): Promise<MockLog> {
  const role = opts.role ?? 'entrepreneur';
  const handlers = opts.handlers ?? {};
  const allow = new Set(opts.allowWrites ?? []);
  const log: MockLog = { requests: [], blockedWrites: [], allowedWrites: [] };

  const json = (route: Route, status: number, data: unknown, headers: Record<string, string> = {}) =>
    route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', ...headers },
      body: data === undefined ? '' : JSON.stringify(data),
    });
  const run = async (h: Handler, ctx: any) => (typeof h === 'function' ? (h as any)(ctx) : h);

  const handle = async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const p = url.pathname;
    log.requests.push(`${method} ${p}${url.search}`);

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    }
    let body: any = null;
    try { body = req.postData() ? JSON.parse(req.postData()!) : null; } catch { body = req.postData(); }
    const ctx = { url, method, body, route };

    // ----- AUTH -----
    if (p.startsWith('/auth/v1/')) {
      const sub = p.replace('/auth/v1/', '');
      if (handlers[`auth/${sub}`] !== undefined) return json(route, 200, await run(handlers[`auth/${sub}`], ctx));
      const s = buildSession(role);
      if (sub === 'user') return json(route, 200, s.user);
      if (sub === 'token') return json(route, 200, s); // refresh falso
      if (sub === 'logout') return json(route, 204, undefined);
      if (sub === 'settings') return json(route, 200, { external: {}, disable_signup: false, mailer_autoconfirm: false });
      // signup / otp / recover / verify / admin: registro de usuarios => bloquear
      log.blockedWrites.push({ method, url: req.url(), body });
      return json(route, 403, { error: 'blocked_by_qa_mock', message: 'Auth write blocked by QA mock' });
    }

    // ----- STORAGE -----
    if (p.startsWith('/storage/v1/')) {
      if (handlers.storage !== undefined) return json(route, 200, await run(handlers.storage, ctx));
      if (WRITE.has(method)) {
        const key = `${method} storage`;
        if (allow.has(key)) {
          log.allowedWrites.push({ method, url: req.url(), body: '[binario omitido]' });
          return json(route, 200, { Key: 'fake/object', Id: 'fake-id', path: 'fake/object' });
        }
        log.blockedWrites.push({ method, url: req.url(), body: '[binario omitido]' });
        return json(route, 403, { error: 'blocked_by_qa_mock', message: 'Storage write blocked by QA mock' });
      }
      // lecturas de objetos publicos: pixel 1x1
      if (p.includes('/object/')) {
        return route.fulfill({
          status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' },
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
        });
      }
      return json(route, 200, []);
    }

    // ----- REST -----
    if (p.startsWith('/rest/v1/')) {
      const target = p.replace('/rest/v1/', '');
      const isRpc = target.startsWith('rpc/');
      const key = isRpc ? target : `${method} ${target}`;
      const writeKey = isRpc ? `POST ${target}` : key;

      if (WRITE.has(method)) {
        if (isRpc && BENIGN_RPC.has(target.slice(4)) && handlers[key] === undefined) return json(route, 204, undefined);
        if (handlers[key] !== undefined) {
          log.allowedWrites.push({ method, url: req.url(), body });
          return json(route, 200, await run(handlers[key], ctx));
        }
        if (isRpc && handlers[target] !== undefined) {
          // RPC de lectura (POST /rpc/x): se permite si hay handler explicito
          return json(route, 200, await run(handlers[target], ctx));
        }
        if (isRpc && !allow.has(writeKey) && defaultRpc(target.slice(4)) !== null) {
          return json(route, 200, defaultRpc(target.slice(4)));
        }
        if (allow.has(writeKey)) {
          log.allowedWrites.push({ method, url: req.url(), body });
          return json(route, method === 'POST' ? 201 : 204, method === 'POST' ? [] : undefined);
        }
        log.blockedWrites.push({ method, url: req.url(), body });
        return json(route, 403, { code: '42501', message: 'blocked_by_qa_mock', details: null, hint: null });
      }

      // GET / HEAD
      let data: unknown;
      if (handlers[key] !== undefined) data = await run(handlers[key], ctx);
      else if (isRpc && handlers[target] !== undefined) data = await run(handlers[target], ctx);
      else data = isRpc ? defaultRpc(target.slice(4)) : defaultTable(target, role);

      const headers: Record<string, string> = {};
      if (Array.isArray(data)) headers['content-range'] = data.length ? `0-${data.length - 1}/${data.length}` : '*/0';
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers } });
      headers['access-control-expose-headers'] = 'content-range';
      // .single() / .maybeSingle()
      const accept = req.headers()['accept'] ?? '';
      if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) {
        if (data.length === 0) {
          return json(route, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows', hint: null });
        }
        return json(route, 200, data[0], headers);
      }
      return json(route, 200, data ?? [], headers);
    }

    return route.continue();
  };

  await page.route('**/rest/v1/**', handle);
  await page.route('**/auth/v1/**', handle);
  await page.route('**/storage/v1/**', handle);
  return log;
}
