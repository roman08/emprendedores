/**
 * Panel del emprendedor con Supabase 100% simulado (page.route). Nada llega a la base real:
 * el helper mockRest rechaza (403) y registra cualquier escritura no permitida explicitamente.
 */
import { test, expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { watch, blockThirdParty, seedSession, mockRest, hydrated, fixtures } from './helpers';
import { FAKE_BUSINESS_ID, FAKE_LISTING_ID, FAKE_USER_ID } from '../helpers/mockSupabase';

// ---------- PNG validos de colores distintos (para distinguir fotos al reordenar) ----------
function crc32(buf: Buffer) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(r: number, g: number, b: number) {
  const w = 16, h = 16;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const file = (n: number) => ({ name: `foto-${n}.png`, mimeType: 'image/png', buffer: png(40 * n, 255 - 40 * n, (90 * n) % 255) });

const STATS = { totals: { view: 12, whatsapp_click: 3, map_click: 1 }, listings: [{ id: FAKE_LISTING_ID, title: 'Producto ficticio', slug: 'producto-ficticio', view: 12, whatsapp_click: 3, map_click: 1 }] };
const storageHandler = ({ url, method }: { url: URL; method: string }) =>
  method === 'POST' && /\/object\/(listing-images|business-media)\//.test(url.pathname) && !/\/object\/list\//.test(url.pathname)
    ? { Key: 'fake/object', Id: 'fake-id' } : [];

test.beforeEach(async ({ page }) => { await blockThirdParty(page); await seedSession(page); });

async function openPanel(page: Page, handlers: Record<string, any> = {}, allowWrites: string[] = [], afterMock?: () => Promise<unknown>) {
  const h: Record<string, any> = { 'rpc/my_stats': STATS, storage: storageHandler, ...handlers };
  if (h['GET listings'] !== undefined && h['HEAD listings'] === undefined) h['HEAD listings'] = h['GET listings'];
  const log = await mockRest(page, { handlers: h, allowWrites });
  await afterMock?.();
  await page.goto('/panel');
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  await page.getByText('Cargando tu panel…').waitFor({ state: 'detached' }).catch(() => {});
  return log;
}

test.describe('Panel: crear negocio', () => {
  const noBusiness = { 'GET businesses': [] as unknown[] };

  test('a11y: los campos del formulario de negocio tienen etiqueta asociada', async ({ page }) => {
    await openPanel(page, noBusiness);
    await expect(page.getByLabel('Nombre del negocio *')).toBeVisible({ timeout: 3000 });
    await expect(page.getByLabel('Descripción')).toBeVisible({ timeout: 3000 });
  });

  test('sin negocio: muestra formulario de alta y la zona de cuenta', async ({ page }) => {
    const w = watch(page);
    await openPanel(page, noBusiness);
    await expect(page.getByRole('heading', { name: 'Configura tu negocio' })).toBeVisible();
    await expect(page.getByText('Primero cuéntanos sobre tu negocio')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear mi negocio' })).toBeVisible();
    await expect(page.getByText('qa@example.invalid').first()).toBeVisible();
    await page.getByText('Cuenta', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Zona de peligro' })).toBeVisible();
    expect(w.errors).toEqual([]);
  });

  test('validacion de WhatsApp: exige 10 digitos (sin enviar)', async ({ page }) => {
    const log = await openPanel(page, noBusiness);
    await page.locator('input.input[required]').first().fill('Mi Negocio QA');
    const wa = page.getByPlaceholder('9141234567');
    for (const bad of ['123', '12345678901234', 'abcdefghij', '914 123 45']) {
      await wa.fill(bad);
      await page.getByRole('button', { name: 'Crear mi negocio' }).click();
      await expect(page.getByRole('alert'), bad).toHaveText('Escribe tu WhatsApp a 10 dígitos (sin +52).');
    }
    expect(log.allowedWrites).toEqual([]);
    expect(log.blockedWrites).toEqual([]);
  });

  test('alta correcta: normaliza WhatsApp con 52, envia datos y pasa al panel', async ({ page }) => {
    const log = await openPanel(page, {
      ...noBusiness,
      'POST businesses': ({ body }: any) => ({ ...fixtures.business, ...body, id: FAKE_BUSINESS_ID, slug: 'mi-negocio-qa', status: 'active', hours: body.hours }),
    }, ['POST businesses']);
    await page.locator('input.input[required]').first().fill('  Mi Negocio QA  ');
    await page.getByPlaceholder('9141234567').fill('914 123 4567');
    await page.getByRole('button', { name: 'Crear mi negocio' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mi Negocio QA' })).toBeVisible();
    const post = log.allowedWrites.find((x) => x.method === 'POST' && x.url.includes('/businesses'))!;
    expect(post.body).toMatchObject({ name: 'Mi Negocio QA', whatsapp: '529141234567', owner_id: FAKE_USER_ID, has_physical_store: false, lat: null, lng: null, hours: null });
    await expect(page.getByRole('tab', { name: 'Publicaciones' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Ver mi tienda/ })).toHaveAttribute('href', '/n/mi-negocio-qa');
  });

  test('local fisico: "Ubicar" usa el geocodificador (mock de nominatim) y envia lat/lng', async ({ page }) => {
    let geoQuery = '';
    await page.route('https://nominatim.openstreetmap.org/**', (route) => {
      geoQuery = new URL(route.request().url()).searchParams.get('q') ?? '';
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ lat: '18.0712', lon: '-93.1701', display_name: 'Falsa 1' }]) });
    });
    const log = await openPanel(page, {
      ...noBusiness, 'POST businesses': ({ body }: any) => ({ ...fixtures.business, ...body, id: FAKE_BUSINESS_ID, slug: 'mi-negocio-qa' }),
    }, ['POST businesses']);
    await hydrated(page).catch(() => {});
    await page.locator('input.input[required]').first().fill('Con Local');
    await page.getByPlaceholder('9141234567').fill('9141234567');
    await expect(page.getByText('Dirección del local')).toHaveCount(0);
    await page.getByLabel('Tengo un local físico donde atiendo clientes').check();
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await page.getByPlaceholder(/Calle, número, colonia/).fill('Calle Falsa 123, Cunduacán');
    await page.getByRole('button', { name: 'Ubicar' }).click();
    await expect(page.getByText('Ubicación encontrada. Arrastra el pin')).toBeVisible();
    await expect(page.getByText('Pin colocado ✔')).toBeVisible();
    expect(geoQuery).toBe('Calle Falsa 123, Cunduacán');
    await page.getByRole('button', { name: 'Crear mi negocio' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Con Local' })).toBeVisible();
    const post = log.allowedWrites.find((x) => x.url.includes('/businesses'))!.body as any;
    expect(post).toMatchObject({ has_physical_store: true, address_text: 'Calle Falsa 123, Cunduacán', lat: 18.0712, lng: -93.1701 });
  });

  test('"Ubicar": sin resultados y error de red muestran mensajes de ayuda; Enter no envia el formulario', async ({ page }) => {
    let mode: 'empty' | 'fail' = 'empty';
    await page.route('https://nominatim.openstreetmap.org/**', (route) =>
      mode === 'empty' ? route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }) : route.abort('failed'));
    const log = await openPanel(page, noBusiness);
    await page.getByLabel('Tengo un local físico donde atiendo clientes').check();
    const addr = page.getByPlaceholder(/Calle, número, colonia/);
    await addr.fill('zzzz inexistente');
    await addr.press('Enter');
    await expect(page.getByText('No encontramos esa dirección')).toBeVisible();
    mode = 'fail';
    await page.getByRole('button', { name: 'Ubicar' }).click();
    await expect(page.getByText('No pudimos buscar la dirección')).toBeVisible();
    expect(log.allowedWrites).toEqual([]);
    expect(log.blockedWrites).toEqual([]);
    // Clic en el mapa coloca el pin manualmente
    await page.locator('.leaflet-container').click({ position: { x: 100, y: 100 } });
    await expect(page.getByText('Pin colocado ✔')).toBeVisible();
  });

  test('horarios: dos turnos, copiar a la semana y validaciones', async ({ page }) => {
    const log = await openPanel(page, {
      ...noBusiness, 'POST businesses': ({ body }: any) => ({ ...fixtures.business, ...body, id: FAKE_BUSINESS_ID, slug: 'x' }),
    }, ['POST businesses']);
    await page.locator('input.input[required]').first().fill('Con Horario');
    await page.getByPlaceholder('9141234567').fill('9141234567');
    await page.getByLabel('Mostrar mis horarios de atención').check();
    await expect(page.getByLabel('Lunes: abre')).toBeVisible();
    // segundo turno
    await page.getByRole('button', { name: 'Lunes: agregar segundo turno' }).click();
    await expect(page.getByLabel('Lunes: segundo turno abre')).toBeVisible();
    // invalido: apertura == cierre
    await page.getByLabel('Lunes: abre').fill('10:00');
    await page.getByLabel('Lunes: cierra').fill('10:00');
    await expect(page.getByRole('alert').filter({ hasText: 'no pueden ser la misma hora' })).toBeVisible();
    await page.getByRole('button', { name: 'Crear mi negocio' }).click();
    await expect(page.getByRole('alert').last()).toContainText('Revisa el horario del lunes');
    expect(log.allowedWrites).toEqual([]);
    // invalido: segundo turno empieza antes de que termine el primero
    await page.getByLabel('Lunes: abre').fill('09:00');
    await page.getByLabel('Lunes: cierra').fill('14:00');
    await page.getByLabel('Lunes: segundo turno abre').fill('13:00');
    await page.getByLabel('Lunes: segundo turno cierra').fill('18:00');
    await expect(page.getByText('El segundo turno debe empezar después de que termine el primero.')).toBeVisible();
    // valido: 09-14 y 16-20
    await page.getByLabel('Lunes: segundo turno abre').fill('16:00');
    await page.getByLabel('Lunes: segundo turno cierra').fill('20:00');
    await expect(page.getByText('El segundo turno debe empezar')).toHaveCount(0);
    // copiar a toda la semana
    await page.getByRole('button', { name: /Copiar el primer día abierto/ }).click();
    await expect(page.getByLabel('Sábado: segundo turno abre')).toHaveValue('16:00');
    // cerrar el domingo
    await page.getByLabel('Domingo: abre').fill('09:00'); // existe => aun abierto
    await page.getByRole('button', { name: 'Crear mi negocio' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Con Horario' })).toBeVisible();
    const body = log.allowedWrites.find((x) => x.url.includes('/businesses'))!.body as any;
    expect(body.hours.mon).toMatchObject({ open: '09:00', close: '14:00', open2: '16:00', close2: '20:00' });
    expect(body.hours.sat).toMatchObject({ open2: '16:00', close2: '20:00' });
  });

  test('cierre despues de medianoche: solo se permite en el ultimo turno', async ({ page }) => {
    await openPanel(page, noBusiness);
    await page.getByLabel('Mostrar mis horarios de atención').check();
    await page.getByLabel('Martes: abre').fill('20:00');
    await page.getByLabel('Martes: cierra').fill('02:00');
    await expect(page.getByLabel('Martes: cierra')).toHaveAttribute('aria-invalid', 'false'); // sin segundo turno es valido (cierra pasada la medianoche)
    await page.getByRole('button', { name: 'Martes: agregar segundo turno' }).click();
    await expect(page.getByText('Solo el segundo turno puede terminar después de medianoche.')).toBeVisible();
  });

  test('error de la base al guardar se muestra al usuario (no se rompe la pantalla)', async ({ page }) => {
    await openPanel(page, noBusiness, []); // POST businesses bloqueado => 403 del mock
    await page.locator('input.input[required]').first().fill('Mi Negocio QA');
    await page.getByPlaceholder('9141234567').fill('9141234567');
    await page.getByRole('button', { name: 'Crear mi negocio' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear mi negocio' })).toBeEnabled();
  });
});

test.describe('Panel: publicaciones', () => {
  test('checklist, tabs y estadisticas', async ({ page }) => {
    const w = watch(page);
    await openPanel(page, { 'GET listings': [] });
    await expect(page.getByRole('heading', { level: 1, name: 'Negocio Ficticio QA' })).toBeVisible();
    // Sin horario, sin publicaciones, sin compartir => 1 de 4 (perfil completo)
    await expect(page.getByRole('heading', { name: 'Activa tu tienda' })).toBeVisible();
    await expect(page.getByText('1 de 4')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    await page.getByRole('button', { name: 'Agregar horario' }).click();
    await expect(page.getByRole('tab', { name: 'Mi negocio', selected: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Estadísticas' }).click();
    await expect(page.getByText('Visitas a tus publicaciones')).toBeVisible();
    await expect(page.getByText('12', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('table')).toContainText('Producto ficticio');
    expect(w.errors).toEqual([]);
  });

  test('estadisticas: si falla la RPC muestra mensaje', async ({ page }) => {
    await openPanel(page, { 'GET listings': [] }, [], () => page.route('**/rest/v1/rpc/my_stats*', (r) => r.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"boom"}' })));
    await page.getByRole('tab', { name: 'Estadísticas' }).click();
    await expect(page.getByText('No pudimos cargar tus estadísticas')).toBeVisible();
  });

  test('menu compartir de la tienda: copiar enlace y redes apuntan a la URL de la tienda', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openPanel(page, { 'GET listings': [] });
    const share = page.getByRole('region', { name: 'Comparte tu tienda' });
    await expect(share.getByLabel('Enlace de tu tienda')).toHaveValue(/\/n\/negocio-ficticio-qa$/);
    await expect(share.getByRole('img', { name: /Código QR/ })).toBeVisible();
    await share.getByRole('button', { name: 'Copiar enlace' }).first().click();
    await expect(share.getByRole('status').first()).toHaveText('¡Enlace copiado!');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/n\/negocio-ficticio-qa$/);
    await expect(share.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.*n%2Fnegocio-ficticio-qa/);
    await expect(share.getByRole('link', { name: 'Facebook' })).toHaveAttribute('href', /facebook\.com\/sharer/);
    // Compartir marca el paso del checklist como hecho (localStorage)
    expect(await page.evaluate((id) => localStorage.getItem(`emprendedores:shared:${id}`), FAKE_BUSINESS_ID)).toBe('1');
  });

  test('menu compartir de una publicacion publicada', async ({ page }) => {
    await openPanel(page, { 'GET listings': [{ ...fixtures.listing, status: 'published', business_id: FAKE_BUSINESS_ID }] });
    await expect(page.getByText('Producto ficticio').first()).toBeVisible();
    await page.locator('li.card').getByRole('button', { name: 'Compartir' }).click();
    const menu = page.locator('div.absolute').filter({ hasText: 'Copiar texto' });
    await expect(menu.getByRole('link', { name: 'Telegram' })).toHaveAttribute('href', /t\.me\/share\/url\?url=.*p%2Fproducto-ficticio/);
    await expect(menu.getByRole('link', { name: 'Correo' })).toHaveAttribute('href', /^mailto:/);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('nueva publicacion: publicar sin fotos -> error; maximo 4 fotos; reordenar y portada', async ({ page }) => {
    const log = await openPanel(page, { 'GET listings': [] });
    await page.getByRole('button', { name: '+ Nueva publicación' }).click();
    await page.getByLabel('Título *').fill('Pastel de prueba');
    await page.locator('form').getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Agrega al menos una foto para publicar.');
    expect(log.allowedWrites).toEqual([]);

    // 5 fotos de golpe -> solo entran 4 (MAX_IMAGES, migración 0016)
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles([1, 2, 3, 4, 5].map(file));
    await expect(page.getByText('Solo se aceptan imágenes y hasta 4 fotos por publicación.')).toBeVisible();
    await expect(page.getByText('(4/4)')).toBeVisible();
    await expect(page.locator('input[type=file]')).toHaveCount(0); // ya no se puede agregar
    await expect(page.getByAltText('Foto 1 (portada)')).toBeVisible();

    const srcs = async () => page.locator('img[alt^="Foto "]').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
    const before = await srcs();
    expect(new Set(before).size).toBe(4);
    // mover foto 2 a la izquierda -> pasa a ser portada
    await page.getByRole('button', { name: 'Mover foto 2 a la izquierda' }).click();
    let after = await srcs();
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    // hacer portada la foto 4
    await page.getByRole('button', { name: /Hacer portada/ }).nth(2).click(); // idx 3 (la 1ra de la lista es idx1)
    after = await srcs();
    expect(after[0]).toBe(before[3]);
    // los botones de mover estan deshabilitados en los extremos
    await expect(page.getByRole('button', { name: 'Mover foto 1 a la izquierda' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Mover foto 4 a la derecha' })).toBeDisabled();
    // quitar una foto libera el cupo
    await page.getByRole('button', { name: 'Quitar foto 4' }).click();
    await expect(page.getByText('(3/4)')).toBeVisible();
    await expect(page.locator('input[type=file]').first()).toBeAttached();
  });

  test('un archivo que no es imagen se rechaza', async ({ page }) => {
    await openPanel(page, { 'GET listings': [] });
    await page.getByRole('button', { name: '+ Nueva publicación' }).click();
    await page.locator('input[type=file]').first().setInputFiles({ name: 'virus.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(page.getByRole('alert')).toContainText('Solo se aceptan imágenes');
    await expect(page.getByText('(0/4)')).toBeVisible();
  });

  test('publicar: sube fotos en orden, guarda posiciones y publica (todo simulado)', async ({ page }) => {
    const imgBodies: any[] = [];
    let n = 0;
    const log = await openPanel(page, {
      'GET listings': [],
      'POST listings': () => ({ id: FAKE_LISTING_ID, slug: 'pastel-de-prueba-x1' }),
      'POST listing_images': ({ body }: any) => { imgBodies.push(body); return { id: `img-${++n}` }; },
      'PATCH listings': [],
    }, ['POST listings', 'POST listing_images', 'PATCH listings', 'POST storage']);
    await page.getByRole('button', { name: '+ Nueva publicación' }).click();
    await page.getByLabel('Tipo').selectOption('service');
    await page.getByLabel('Categoría').selectOption({ index: 1 });
    await page.getByLabel('Título *').fill('Pastel de prueba');
    await page.getByLabel('Precio (MXN)').fill('250.5');
    await page.getByLabel('Disponibilidad').selectOption('on_demand');
    await page.locator('input[type=file]').first().setInputFiles([file(1), file(2)]);
    await page.getByRole('button', { name: 'Hacer portada' }).click(); // la 2da pasa a portada
    await page.locator('form').getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(page.getByText('"Pastel de prueba" está publicada.')).toBeVisible({ timeout: 30000 });
    const post = log.allowedWrites.find((x) => x.method === 'POST' && /\/listings(\?|$)/.test(x.url))!.body as any;
    expect(post).toMatchObject({ title: 'Pastel de prueba', type: 'service', price: 250.5, availability: 'on_demand', status: 'draft', business_id: FAKE_BUSINESS_ID });
    expect(imgBodies.map((b) => b.position)).toEqual([0, 1]);
    const patches = log.allowedWrites.filter((x) => x.method === 'PATCH' && x.url.includes('/listings'));
    expect(patches.some((p) => (p.body as any).status === 'published')).toBe(true);
    expect(log.blockedWrites).toEqual([]);
    await expect(page.getByRole('link', { name: 'Ver publicación' })).toHaveAttribute('href', '/p/pastel-de-prueba-x1');
  });

  test('"Publicar" valida titulo/precio (type=button se salta la validacion HTML)', async ({ page }) => {
    const log = await openPanel(page, {
      'GET listings': [], 'POST listings': () => ({ id: FAKE_LISTING_ID, slug: 'x' }), 'POST listing_images': () => ({ id: 'i1' }), 'PATCH listings': [],
    }, ['POST listings', 'POST listing_images', 'PATCH listings', 'POST storage']);
    await page.getByRole('button', { name: '+ Nueva publicación' }).click();
    await page.getByLabel('Precio (MXN)').fill('-5');
    await page.locator('input[type=file]').first().setInputFiles([file(1)]);
    await page.locator('form').getByRole('button', { name: 'Publicar', exact: true }).click();
    await page.waitForTimeout(2500);
    const post = log.allowedWrites.find((x) => x.method === 'POST' && /\/listings(\?|$)/.test(x.url));
    // Lo correcto: no se envia nada con titulo vacio / precio negativo
    expect(post).toBeUndefined();
  });

  test('"Guardar borrador" con titulo vacio es bloqueado por el navegador (validacion nativa)', async ({ page }) => {
    const log = await openPanel(page, { 'GET listings': [] });
    await page.getByRole('button', { name: '+ Nueva publicación' }).click();
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await expect(page.getByLabel('Título *')).toBeFocused();
    expect(log.allowedWrites).toEqual([]);
  });

  test('editar publicacion activa: no permite quitar la ultima foto', async ({ page }) => {
    await openPanel(page, { 'GET listings': [{ ...fixtures.listing, status: 'published', business_id: FAKE_BUSINESS_ID, listing_images: [fixtures.listing.listing_images[0]] }] });
    await page.getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar publicación' })).toBeVisible();
    await expect(page.getByLabel('Disponibilidad')).toHaveValue('available');
    await page.getByRole('button', { name: 'Quitar foto 1' }).click();
    await expect(page.getByRole('alert')).toHaveText('Una publicación activa necesita al menos una foto. Agrega otra antes de borrar esta.');
    // Sigue habiendo 1 foto
    await expect(page.getByText('(1/4)')).toBeVisible();
    // Vista previa abre y cierra con Escape
    await page.getByRole('button', { name: 'Vista previa' }).click();
    const dlg = page.getByRole('dialog', { name: 'Vista previa de la publicación' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText('Contactar por WhatsApp').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('disponibilidad visible en la lista (Agotado / Sobre pedido)', async ({ page }) => {
    await openPanel(page, {
      'GET listings': [
        { ...fixtures.listing, status: 'published', id: 'l1', title: 'Uno', availability: 'sold_out', business_id: FAKE_BUSINESS_ID },
        { ...fixtures.listing, id: 'l2', title: 'Dos', availability: 'on_demand', status: 'paused', business_id: FAKE_BUSINESS_ID },
        { ...fixtures.listing, id: 'l3', title: 'Tres', availability: 'available', status: 'draft', business_id: FAKE_BUSINESS_ID },
      ],
    });
    const rows = page.locator('ul > li.card');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Agotado');
    await expect(rows.nth(0)).toContainText('Publicado');
    await expect(rows.nth(1)).toContainText('Sobre pedido');
    await expect(rows.nth(1)).toContainText('Pausado');
    await expect(rows.nth(2)).toContainText('Borrador');
    await expect(rows.nth(2)).not.toContainText('Disponible');
  });

  test('pausar y borrar publicacion (confirm nativo) llaman a las escrituras esperadas', async ({ page }) => {
    const log = await openPanel(page, {
      'GET listings': [{ ...fixtures.listing, status: 'published', business_id: FAKE_BUSINESS_ID }], 'PATCH listings': [], 'DELETE listings': [],
    }, ['PATCH listings', 'DELETE listings', 'POST storage', 'DELETE storage']);
    await page.getByRole('button', { name: 'Pausar' }).click();
    await expect.poll(() => log.allowedWrites.filter((x) => x.method === 'PATCH').length).toBe(1);
    expect((log.allowedWrites.find((x) => x.method === 'PATCH')!.body as any).status).toBe('paused');
    page.once('dialog', (d) => { expect(d.message()).toContain('¿Eliminar "Producto ficticio"?'); d.dismiss(); });
    await page.getByRole('button', { name: 'Borrar' }).click();
    await page.waitForTimeout(300);
    expect(log.allowedWrites.some((x) => x.method === 'DELETE')).toBe(false);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Borrar' }).click();
    await expect.poll(() => log.allowedWrites.some((x) => x.method === 'DELETE' && x.url.includes('/listings'))).toBe(true);
    await expect(page.getByText('"Producto ficticio" se eliminó.')).toBeVisible();
  });
});

test.describe('Panel: cuenta', () => {
  test('cambiar contrasena: no coinciden / exito (auth simulado)', async ({ page }) => {
    const log = await openPanel(page, { 'GET listings': [] });
    await page.getByRole('tab', { name: 'Cuenta' }).click();
    await page.getByLabel('Nueva contraseña').fill('clave-nueva-1');
    await page.getByLabel('Confirma la contraseña').fill('distinta-123');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByRole('alert')).toHaveText('Las contraseñas no coinciden.');
    await page.getByLabel('Confirma la contraseña').fill('clave-nueva-1');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Contraseña actualizada.' })).toBeVisible();
    expect(log.blockedWrites).toEqual([]);
  });

  test('eliminar cuenta: requiere escribir ELIMINAR exactamente; RPC simulada y redirige a /', async ({ page }) => {
    const log = await openPanel(page, { 'GET listings': [], 'rpc/delete_my_account': null });
    await page.getByRole('tab', { name: 'Cuenta' }).click();
    const btn = page.getByRole('button', { name: 'Eliminar mi cuenta' });
    await expect(btn).toBeDisabled();
    for (const w of ['eliminar', 'ELIMINA', ' ELIMINAR', 'ELIMINAR ']) {
      await page.getByLabel(/Escribe ELIMINAR/).fill(w);
      await expect(btn, w).toBeDisabled();
    }
    await page.getByLabel(/Escribe ELIMINAR/).fill('ELIMINAR');
    await expect(btn).toBeEnabled();
    const rpc = page.waitForRequest((r) => r.url().includes('/rpc/delete_my_account'));
    await btn.click();
    await rpc;
    await page.waitForURL((u) => u.pathname === '/');
    expect(log.blockedWrites.filter((b) => !/auth\/v1\/logout/.test(b.url))).toEqual([]);
  });

  test('eliminar cuenta: si la RPC falla se avisa y el boton se reactiva', async ({ page }) => {
    await openPanel(page, { 'GET listings': [] }, [], () => page.route('**/rest/v1/rpc/delete_my_account', (r) => r.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"boom"}' })));
    await page.getByRole('tab', { name: 'Cuenta' }).click();
    await page.getByLabel(/Escribe ELIMINAR/).fill('ELIMINAR');
    await page.getByRole('button', { name: 'Eliminar mi cuenta' }).click();
    await expect(page.getByRole('alert')).toContainText('No pudimos eliminar tu cuenta');
    await expect(page.getByRole('button', { name: 'Eliminar mi cuenta' })).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe('/panel');
  });

  test('cerrar sesion en todos los dispositivos -> /ingresar', async ({ page }) => {
    await openPanel(page, { 'GET listings': [] });
    await page.getByRole('tab', { name: 'Cuenta' }).click();
    await page.getByRole('button', { name: 'Cerrar sesión en todos los dispositivos' }).click();
    await page.waitForURL('**/ingresar');
  });

  test('"Salir" del panel limpia la sesion', async ({ page }) => {
    await openPanel(page, { 'GET listings': [] });
    await page.locator('main').getByRole('button', { name: 'Salir' }).click();
    await page.waitForURL((u) => u.pathname === '/');
    await page.waitForLoadState('load');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /auth-token/.test(k)))).toEqual([]);
  });

  test('enlace Admin solo aparece para administradores', async ({ page }) => {
    await openPanel(page, { 'GET listings': [] });
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  });
});

test.describe('Panel: movil', () => {
  test('la barra de pestanas del panel no desborda en 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPanel(page, { 'GET listings': [] });
    await page.getByRole('tab', { name: 'Mi negocio' }).click();
    // La barra de pestanas hace scroll interno (overflow-x-auto): ni ella ni la pagina deben desbordar la pantalla
    const m = await page.evaluate(() => ({ tabs: document.querySelector('[role=tablist]')!.getBoundingClientRect().right, page: document.documentElement.scrollWidth }));
    expect(m.tabs).toBeLessThanOrEqual(391);
    expect(m.page).toBeLessThanOrEqual(390);
  });
});
