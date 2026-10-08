import { test, expect, type Page } from '@playwright/test';
import { watch, blockThirdParty } from './helpers';

const biz = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, name: `Negocio QA ${i}`, slug: `negocio-qa-${i}`,
  logo_url: null, cover_url: null, municipality_name: 'Cunduacán', address_text: 'Calle Falsa 123',
  lat: 18.0686 + i * 0.001, lng: -93.1689, verified: i === 1, hours: null, distance_km: 0.4 + i, published_count: i, ...extra,
});

/** Mock de nearby_businesses (RPC de lectura): registra los parametros enviados. */
async function mockNearby(page: Page, rows: unknown[] | ((p: any) => unknown[] | { status: number; body: unknown })) {
  const calls: any[] = [];
  await page.route('**/rest/v1/rpc/nearby_businesses*', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    const out = typeof rows === 'function' ? rows(body) : rows;
    if (out && !Array.isArray(out) && 'status' in (out as any)) {
      const o = out as { status: number; body: unknown };
      return route.fulfill({ status: o.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o.body) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  });
  return calls;
}

// Cada prueba usa su propio contexto con permisos/geolocalizacion propios
test.beforeEach(async ({ page }) => { await blockThirdParty(page); });

/** El island client:load se hidrata tras el render; reintenta hasta que el clic surte efecto. */
async function useMyLocation(page: Page) {
  await expect(async () => {
    await page.getByRole('button', { name: /Usar mi ubicación|Buscando tu ubicación/ }).click();
    await expect(page.getByLabel('Distancia')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });
}

test.describe('/cerca', () => {
  test('geolocalizacion simulada: lista resultados con distancia, radio y categoria cambian la consulta', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 18.0667, longitude: -93.1667 });
    const calls = await mockNearby(page, [biz(1), biz(2, { distance_km: 0.05 })]);
    const w = watch(page);
    await page.goto('/cerca');
    await expect(page.getByRole('heading', { level: 1, name: 'Negocios cerca de mí' })).toBeVisible();
    await expect(page.getByText('Elige cómo buscar')).toBeVisible();
    await useMyLocation(page);
    await expect(page.getByText('2 negocios cerca de tu ubicación')).toBeVisible();
    await expect(page.getByText('Negocio QA 1')).toBeVisible();
    await expect(page.getByText(/a 0\.\d km|a \d+ m/).first()).toBeVisible();
    expect(calls[0]).toMatchObject({ p_radius_km: 10, p_category: null, p_limit: 40 });
    expect(calls[0].p_lat).toBeCloseTo(18.0667, 3);
    expect(calls[0].p_lng).toBeCloseTo(-93.1667, 3);
    // Los enlaces de resultado
    await expect(page.getByRole('link', { name: 'Ver tienda' }).first()).toHaveAttribute('href', '/n/negocio-qa-1');
    await expect(page.getByRole('link', { name: 'Cómo llegar' }).first()).toHaveAttribute('href', /google\.com\/maps\/dir\/\?api=1&destination=18\./);

    await page.getByLabel('Distancia').selectOption('3');
    await expect.poll(() => calls.at(-1).p_radius_km).toBe(3);
    await page.getByLabel('Categoría').selectOption({ index: 1 });
    await expect.poll(() => calls.at(-1).p_category).not.toBeNull();
    expect(w.errors).toEqual([]);
  });

  test('vista mapa se dibuja (leaflet) y vuelve a lista', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 18.0667, longitude: -93.1667 });
    await mockNearby(page, [biz(1), biz(2)]);
    const w = watch(page);
    await page.goto('/cerca');
    await useMyLocation(page);
    await page.getByRole('button', { name: 'Mapa' }).click();
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.locator('.leaflet-interactive')).toHaveCount(3); // origen + 2 negocios
    await expect(page.getByRole('button', { name: 'Mapa' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Lista' }).click();
    await expect(page.locator('.leaflet-container')).toHaveCount(0);
    await expect(page.getByText('Negocio QA 2')).toBeVisible();
    expect(w.errors).toEqual([]);
  });

  test('permiso denegado: mensaje en espanol y municipio sigue disponible', async ({ page, context }) => {
    // Sin grantPermissions y con geolocalizacion bloqueada
    await context.clearPermissions();
    await page.addInitScript(() => {
      const deny = (_ok: unknown, err: (e: any) => void) => err({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3, message: 'denied' });
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: deny, watchPosition: deny, clearWatch() {} }, configurable: true });
    });
    await mockNearby(page, [biz(1)]);
    await page.goto('/cerca');
    await expect(async () => {
      await page.getByRole('button', { name: 'Usar mi ubicación' }).click();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('alert')).toContainText('No diste permiso para usar tu ubicación');
    // Alternativa: municipio
    const sel = page.locator('#nf-muni');
    test.skip((await sel.locator('option').count()) < 2, 'sin municipios con coordenadas');
    await sel.selectOption({ index: 1 });
    await expect(page.getByText(/1 negocio cerca de el centro de /)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('selector de municipio: usa las coordenadas del municipio', async ({ page }) => {
    const calls = await mockNearby(page, []);
    await page.goto('/cerca');
    const sel = page.locator('#nf-muni');
    test.skip((await sel.locator('option').count()) < 2, 'sin municipios con coordenadas');
    await expect(async () => {
      await sel.selectOption({ index: 1 });
      await expect(page.getByLabel('Distancia')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
    expect(Math.abs(calls[0].p_lat)).toBeGreaterThan(10);
    await expect(page.getByText('No encontramos negocios en este radio.')).toBeVisible();
    // Ampliar a 25 km
    await page.getByRole('button', { name: 'Ampliar a 25 km' }).click();
    await expect(page.getByLabel('Distancia')).toHaveValue('25');
    await expect.poll(() => calls.at(-1).p_radius_km).toBe(25);
    await expect(page.getByRole('button', { name: 'Ampliar a 25 km' })).toHaveCount(0);
  });

  test('error del servidor / funcion inexistente: mensaje amigable y reintentar', async ({ page }) => {
    let n = 0;
    await mockNearby(page, () => (++n === 1
      ? { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.nearby_businesses' } }
      : { status: 500, body: { code: 'XX000', message: 'boom' } }));
    await page.goto('/cerca');
    const sel = page.locator('#nf-muni');
    test.skip((await sel.locator('option').count()) < 2, 'sin municipios con coordenadas');
    await expect(async () => {
      await sel.selectOption({ index: 1 });
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('alert')).toContainText('aún no está disponible');
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByRole('alert')).toContainText('No pudimos cargar los negocios');
  });

  test('no se expone WhatsApp en la respuesta real de nearby_businesses (lectura real)', async ({ request }) => {
    const env = (await import('node:fs')).readFileSync('.env', 'utf8');
    const url = env.match(/PUBLIC_SUPABASE_URL=(.*)/)![1].trim().replace(/^["']|["']$/g, '');
    const key = env.match(/PUBLIC_SUPABASE_ANON_KEY=(.*)/)![1].trim().replace(/^["']|["']$/g, '');
    const r = await request.post(`${url}/rest/v1/rpc/nearby_businesses`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      data: { p_lat: 18.0667, p_lng: -93.1667, p_radius_km: 25, p_limit: 40 },
    });
    expect(r.status()).toBe(200);
    const rows = await r.json();
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('whatsapp');
      expect(JSON.stringify(row)).not.toMatch(/\b52\d{10}\b/);
    }
    // Parametros fuera de rango deben rechazarse o acotarse (solo lectura)
    const bad = await request.post(`${url}/rest/v1/rpc/nearby_businesses`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      data: { p_lat: 999, p_lng: 999, p_radius_km: 100000, p_limit: 100000 },
    });
    expect([200, 400, 422]).toContain(bad.status());
    if (bad.status() === 200) expect((await bad.json()).length).toBeLessThanOrEqual(100);
  });

  test('pagina /cerca sin JS rinde la estructura base (SSR)', async ({ page }) => {
    const res = await page.goto('/cerca');
    expect(res!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
