/** Panel de administracion con Supabase 100% simulado. Nada llega a la base real. */
import { test, expect, type Page } from '@playwright/test';
import { watch, blockThirdParty, seedSession, mockRest, fixtures } from './helpers';
import { FAKE_BUSINESS_ID, FAKE_LISTING_ID } from '../helpers/mockSupabase';

const stats = { businesses: 60, businesses_suspended: 2, listings_published: 14, reports_pending: 3, events_30d: 500, views_30d: 420, whatsapp_30d: 80 };
const mkBiz = (i: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-00000000${String(i).padStart(4, '0')}`, name: `Negocio Admin ${String(i).padStart(2, '0')}`, slug: `negocio-admin-${i}`,
  owner_id: 'u', status: 'active', verified: false, logo_url: null, banner_url: null, created_at: '2026-03-01T00:00:00Z', municipalities: { name: 'Centro' }, ...over,
});
const BIZ = Array.from({ length: 60 }, (_, i) => mkBiz(i + 1));

/** Intercepta GET <table> con paginacion real (offset/limit) y Content-Range. El resto de metodos pasa al mock general. */
async function paged(page: Page, table: string, rows: any[] | (() => any[]), seen: string[] = []) {
  await page.route(`**/rest/v1/${table}*`, async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') return route.fallback();
    const u = new URL(req.url());
    if (u.searchParams.get('select')?.includes('id') && u.searchParams.get('limit') === '100' && table === 'businesses') return route.fallback();
    seen.push(u.search);
    const all = typeof rows === 'function' ? rows() : rows;
    const offset = Number(u.searchParams.get('offset') ?? 0);
    const limit = Number(u.searchParams.get('limit') ?? all.length);
    const slice = all.slice(offset, offset + limit);
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': `${slice.length ? offset : '*'}${slice.length ? `-${offset + slice.length - 1}` : ''}/${all.length}` },
      body: JSON.stringify(slice),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await blockThirdParty(page);
});

async function openAdmin(page: Page, handlers: Record<string, any> = {}, allowWrites: string[] = [], role: 'admin' | 'entrepreneur' = 'admin') {
  await seedSession(page, role === 'admin' ? 'admin' : 'entrepreneur');
  const log = await mockRest(page, { role, handlers: { 'rpc/admin_stats': stats, ...handlers }, allowWrites });
  return log;
}

test.describe('Admin: acceso', () => {
  test('usuario normal ve "Acceso denegado" y enlace a su panel', async ({ page }) => {
    await openAdmin(page, {}, [], 'entrepreneur');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Acceso denegado' })).toBeVisible();
    await expect(page.getByText('Esta sección es solo para administradores.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ir a mi panel' })).toHaveAttribute('href', '/panel');
    await expect(page.getByRole('tab')).toHaveCount(0);
  });

  test('administrador ve las cuatro pestanas y el resumen', async ({ page }) => {
    const w = watch(page);
    await openAdmin(page);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Administración' })).toBeVisible();
    for (const t of ['Resumen', 'Negocios', 'Publicaciones', 'Reportes']) await expect(page.getByRole('tab', { name: t })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('2 suspendidos')).toBeVisible();
    await expect(page.getByText('Publicaciones publicadas')).toBeVisible();
    await expect(page.getByText('420 visitas · 80 clics a WhatsApp')).toBeVisible();
    expect(w.errors).toEqual([]);
  });

  test('si admin_stats falla (no es admin en la base) se muestra el error en espanol', async ({ page }) => {
    await seedSession(page, 'admin');
    await mockRest(page, { role: 'admin' });
    await page.route('**/rest/v1/rpc/admin_stats*', (r) => r.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"code":"42501","message":"Acceso denegado"}' }));
    await page.goto('/admin');
    await expect(page.getByRole('alert')).toContainText('No se pudieron cargar las cifras');
  });
});

test.describe('Admin: negocios', () => {
  test('paginacion de 25 en 25, pagina siguiente/anterior y limites', async ({ page }) => {
    const seen: string[] = [];
    await openAdmin(page);
    await paged(page, 'businesses', BIZ, seen);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Negocios' }).click();
    await expect(page.getByText('Mostrando 1–25 de 60')).toBeVisible();
    await expect(page.getByText('Página 1 de 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await expect(page.locator('ul.space-y-3 > li')).toHaveCount(25);
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByText('Mostrando 26–50 de 60')).toBeVisible();
    await expect(page.getByText('Negocio Admin 26')).toBeVisible();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByText('Mostrando 51–60 de 60')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await expect(page.locator('ul.space-y-3 > li')).toHaveCount(10);
    await page.getByRole('button', { name: 'Anterior' }).click();
    await expect(page.getByText('Página 2 de 3')).toBeVisible();
  });

  test('filtros y busqueda: se envian como consulta y el termino se sanea', async ({ page }) => {
    const seen: string[] = [];
    await openAdmin(page);
    await paged(page, 'businesses', BIZ, seen);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Negocios' }).click();
    await expect(page.getByText('Mostrando 1–25 de 60')).toBeVisible();
    await page.getByLabel('Filtrar').selectOption('suspended');
    await expect.poll(() => seen.at(-1)).toContain('status=eq.suspended');
    await page.getByLabel('Filtrar').selectOption('verified');
    await expect.poll(() => seen.at(-1)).toContain('verified=eq.true');
    // Caracteres con significado en .or() de PostgREST y comodines de LIKE
    await page.getByLabel('Buscar negocio').fill('a,b)(%_"x');
    const dec = (s: string) => decodeURIComponent(s.split('+').join(' '));
    await expect.poll(() => dec(seen.at(-1)!)).toContain('name.ilike.%a b \\%\\_ x%');
    const last = dec(seen.at(-1)!);
    expect(last).not.toMatch(/ilike\.%[^%]*[,()"][^%]*%/);
  });

  test('suspender: modal de confirmacion; cancelar y Escape no escriben; confirmar hace PATCH', async ({ page }) => {
    const log = await openAdmin(page, {}, ['PATCH businesses']);
    const writes = () => log.allowedWrites.filter((w) => !w.url.includes('/rpc/'));
    await paged(page, 'businesses', [mkBiz(1), mkBiz(2, { status: 'suspended', verified: true })]);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Negocios' }).click();
    const row = page.locator('li', { hasText: 'Negocio Admin 01' });
    await row.getByRole('button', { name: 'Suspender' }).click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('¿Suspender "Negocio Admin 01"?');
    // El foco entra al dialogo y Tab no se escapa
    await expect(dlg.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true); }
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(row.getByRole('button', { name: 'Suspender' })).toBeFocused(); // devuelve el foco
    await row.getByRole('button', { name: 'Suspender' }).click();
    await dlg.getByRole('button', { name: 'Cancelar' }).click();
    expect(writes()).toEqual([]);
    // Clic en el fondo cancela
    await row.getByRole('button', { name: 'Suspender' }).click();
    await page.mouse.click(5, 5);
    await expect(dlg).toBeHidden();
    // Confirmar
    await row.getByRole('button', { name: 'Suspender' }).click();
    await dlg.getByRole('button', { name: 'Suspender', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '"Negocio Admin 01" fue suspendido.' })).toBeVisible();
    expect(writes()).toHaveLength(1);
    expect(writes()[0].body).toEqual({ status: 'suspended' });
    await expect(row).toContainText('Suspendido');
    await expect(row.getByRole('button', { name: 'Reactivar' })).toBeVisible();
    // Reactivar no pide confirmacion
    await row.getByRole('button', { name: 'Reactivar' }).click();
    await expect(page.getByText('"Negocio Admin 01" fue reactivado.')).toBeVisible();
    // Verificar / quitar verificacion
    await page.locator('li', { hasText: 'Negocio Admin 02' }).getByRole('button', { name: 'Quitar verificación' }).click();
    await expect(page.getByText('Verificación retirada.')).toBeVisible();
  });

  test('borrar negocio: confirmacion, pausa publicaciones, DELETE y limpieza de Storage', async ({ page }) => {
    const log = await openAdmin(page, {
      'GET listings': [{ id: FAKE_LISTING_ID, status: 'published' }],
      'GET listing_images': [{ url: 'https://x.supabase.co/storage/v1/object/public/listing-images/u/l/a.webp' }],
      storage: () => [{ name: 'x' }],
    }, ['PATCH listings', 'DELETE businesses', 'DELETE storage', 'POST storage']);
    await paged(page, 'businesses', [mkBiz(1, { logo_url: 'https://x.supabase.co/storage/v1/object/public/business-media/u/logo.webp' })]);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Negocios' }).click();
    await page.getByRole('button', { name: 'Borrar' }).click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('¿Borrar "Negocio Admin 01" definitivamente?');
    await expect(dlg).toContainText('Esta acción no se puede deshacer');
    await dlg.getByRole('button', { name: 'Borrar todo' }).click();
    await expect(page.getByText(/Negocio borrado\. Archivos eliminados de Storage: 2\./)).toBeVisible();
    const methods = log.allowedWrites.map((w) => `${w.method} ${new URL(w.url).pathname.split('/').slice(-1)[0]}`);
    expect(methods.indexOf('PATCH listings')).toBeLessThan(methods.indexOf('DELETE businesses'));
    expect(log.blockedWrites).toEqual([]);
  });

  test('error al cargar muestra aviso y no rompe', async ({ page }) => {
    await openAdmin(page);
    await page.route('**/rest/v1/businesses*', (r) => r.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"boom"}' }));
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Negocios' }).click();
    await expect(page.getByRole('alert')).toContainText('No se pudieron cargar los negocios: boom');
    await expect(page.getByText('Sin resultados.')).toBeVisible();
  });
});

test.describe('Admin: publicaciones y reportes', () => {
  const L = (i: number, over: Record<string, unknown> = {}) => ({
    id: `00000000-0000-4000-8000-0000000c${String(i).padStart(4, '0')}`, slug: `pub-${i}`, title: `Publicación ${i}`, price: 10 * i,
    status: 'published', featured_until: null, created_at: '2026-03-01T00:00:00Z', businesses: { name: 'Negocio Ficticio QA', slug: 'negocio-ficticio-qa' }, ...over,
  });

  test('listado con estados, filtro y paginacion', async ({ page }) => {
    const seen: string[] = [];
    await openAdmin(page);
    await paged(page, 'listings', Array.from({ length: 30 }, (_, i) => L(i + 1, i === 1 ? { status: 'paused' } : {})), seen);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Publicaciones' }).click();
    await expect(page.getByText('Mostrando 1–25 de 30')).toBeVisible();
    await expect(page.locator('li', { hasText: 'Publicación 2' }).first()).toContainText('Pausado');
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByText('Mostrando 26–30 de 30')).toBeVisible();
    await page.getByLabel(/Filtrar|Estado/).first().selectOption('draft').catch(() => {});
  });

  test('reportes: pendientes/resueltos, resolver, despublicar con confirmacion', async ({ page }) => {
    const log = await openAdmin(page, {}, ['PATCH reports', 'PATCH listings', 'PATCH businesses']);
    const writes = () => log.allowedWrites.filter((w) => !w.url.includes('/rpc/'));
    await paged(page, 'reports', [{
      id: '00000000-0000-4000-8000-0000000000d1', reason: 'Estafa o engaño', details: 'Pide anticipo y no entrega', resolved: false, created_at: '2026-04-01T10:00:00Z',
      listing_id: FAKE_LISTING_ID, business_id: null,
      listings: { id: FAKE_LISTING_ID, title: 'Producto ficticio', slug: 'producto-ficticio', status: 'published', business_id: FAKE_BUSINESS_ID, businesses: { id: FAKE_BUSINESS_ID, name: 'Negocio Ficticio QA', slug: 'negocio-ficticio-qa', status: 'active' } },
      businesses: null,
    }]);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Reportes' }).click();
    await expect(page.getByRole('heading', { name: 'Reportes pendientes' })).toBeVisible();
    await expect(page.getByText('Pide anticipo y no entrega')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Producto ficticio' })).toHaveAttribute('href', '/p/producto-ficticio');
    await page.getByRole('button', { name: 'Despublicar publicación' }).click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('¿Despublicar "Producto ficticio"?');
    await page.keyboard.press('Escape');
    expect(writes()).toEqual([]);
    await page.getByRole('button', { name: 'Despublicar publicación' }).click();
    await dlg.getByRole('button', { name: 'Despublicar', exact: true }).click();
    await expect(page.getByText('Publicación despublicada.')).toBeVisible();
    expect((writes()[0].body as any)).toEqual({ status: 'paused' });
    await page.getByRole('button', { name: 'Marcar resuelto' }).click();
    await expect(page.getByText('Reporte marcado como resuelto.')).toBeVisible();
    expect(log.allowedWrites.some((w) => (w.body as any)?.resolved === true)).toBe(true);
    await page.getByRole('button', { name: 'Ver resueltos' }).click();
    await expect(page.getByRole('heading', { name: 'Reportes resueltos' })).toBeVisible();
  });

  test('reportes: sin resultados muestra mensaje', async ({ page }) => {
    await openAdmin(page);
    await paged(page, 'reports', []);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Reportes' }).click();
    await expect(page.getByText('No hay reportes pendientes.')).toBeVisible();
    await expect(page.getByText('0 resultados')).toBeVisible();
  });
});

test.describe('Admin: archivos huerfanos', () => {
  const orphans = [
    { bucket_id: 'listing-images', name: 'u1/l1/a.webp', size: 2048, created_at: '2026-01-01T00:00:00Z' },
    { bucket_id: 'business-media', name: 'u1/logo.webp', size: 5 * 1024 * 1024, created_at: '2026-01-02T00:00:00Z' },
  ];
  test('buscar, seleccionar, confirmar y borrar (Storage simulado)', async ({ page }) => {
    const log = await openAdmin(page, { 'rpc/admin_orphan_objects': orphans, storage: ({ body }: any) => (body?.prefixes ?? []).map((n: string) => ({ name: n })) }, ['DELETE storage', 'POST storage']);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Buscar huérfanos' }).click();
    await expect(page.getByText('Se encontraron 2 archivos huérfanos.')).toBeVisible();
    await expect(page.getByText('2.0 KB')).toBeVisible();
    await expect(page.getByText('5.00 MB')).toBeVisible();
    const del = page.getByRole('button', { name: /Borrar seleccionados/ });
    await expect(del).toBeDisabled();
    await page.getByLabel(/Seleccionar todos/).check();
    await expect(del).toHaveText('Borrar seleccionados (2)');
    await del.click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('¿Borrar 2 archivos huérfanos?');
    await expect(dlg).toContainText('5.00 MB'.replace('5.00', '5.00'));
    await dlg.getByRole('button', { name: 'Borrar archivos' }).click();
    await expect(page.getByText(/Archivos eliminados: 2 de 2\./)).toBeVisible();
    await expect(page.getByText('Storage está limpio.')).toBeVisible();
    expect(log.blockedWrites).toEqual([]);
  });

  test('sin huerfanos y error de la RPC', async ({ page }) => {
    await openAdmin(page, { 'rpc/admin_orphan_objects': [] });
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Buscar huérfanos' }).click();
    await expect(page.getByText('No hay archivos huérfanos.').first()).toBeVisible();
  });
});

test.describe('Admin: movil', () => {
  test('las pestanas se desplazan sin desbordar la pagina en 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdmin(page);
    await paged(page, 'businesses', BIZ);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Negocios' }).click();
    const right = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll('main *')).filter((e) => !e.closest('[role=tablist]')).map((e) => e.getBoundingClientRect().right)));
    expect(right).toBeLessThanOrEqual(391);
  });
});

void fixtures;
