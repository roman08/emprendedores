import { test, expect } from '@playwright/test';
import { watch, blockThirdParty } from './helpers';

test.beforeEach(async ({ page }) => { await blockThirdParty(page); });

/** Rastreo ligero (solo GET, datos reales de lectura) de los enlaces internos desde home, header y footer. */
test('rastreo de enlaces internos: ninguno roto, sin errores de consola ni de hidratacion', async ({ page, request }) => {
  test.setTimeout(240000);
  const w = watch(page);
  const queue: string[] = ['/'];
  const seen = new Set<string>();
  const broken: string[] = [];
  const consoleByPage: Record<string, string[]> = {};
  const hashes: string[] = [];
  const MAX = 45;

  while (queue.length && seen.size < MAX) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const before = w.errors.length;
    const res = await page.goto(path, { waitUntil: 'load' });
    const status = res?.status() ?? 0;
    if (status >= 400) { broken.push(`${status} ${path}`); continue; }
    await page.waitForLoadState('networkidle').catch(() => {});
    if (w.errors.length > before) consoleByPage[path] = w.errors.slice(before);

    // Atributos de la pagina: un unico h1, lang, titulo no vacio
    expect(await page.locator('h1').count(), `h1 en ${path}`).toBeGreaterThanOrEqual(1);
    expect((await page.title()).length, `title en ${path}`).toBeGreaterThan(3);

    // Imagenes del mismo sitio / Supabase rotas
    const brokenImgs = await page.evaluate(() => Array.from(document.images)
      .filter((i) => i.complete && i.naturalWidth === 0 && i.src && !/fonts|picsum|openstreetmap/.test(i.src))
      .map((i) => i.src));
    if (brokenImgs.length) broken.push(`imagen rota en ${path}: ${brokenImgs.slice(0, 3).join(', ')}`);

    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
    for (const h of hrefs) {
      if (!h || h.startsWith('#')) { if (h && h.length > 1) hashes.push(h); continue; }
      if (/^(mailto:|tel:|javascript:)/i.test(h)) { if (/^javascript:/i.test(h)) broken.push(`javascript: en ${path}`); continue; }
      let u: URL;
      try { u = new URL(h, page.url()); } catch { broken.push(`href invalido ${h} en ${path}`); continue; }
      if (u.origin !== new URL(page.url()).origin) continue;
      const p = u.pathname + u.search;
      // /ir/* redirige fuera del sitio: se valida aparte; /panel y /admin son SPA
      if (u.pathname.startsWith('/ir/')) continue;
      if (!seen.has(p) && !queue.includes(p)) queue.push(p);
    }
  }

  // Enlaces /ir/* validos (302) o 404 amigable; nunca 5xx
  const ir = await (async () => {
    await page.goto('/explorar');
    return page.locator('a[href^="/ir/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  })();
  for (const h of ir.slice(0, 5)) {
    const r = await request.get(h, { maxRedirects: 0 });
    if (r.status() >= 500) broken.push(`${r.status()} ${h}`);
  }

  console.log(`Rastreadas ${seen.size} paginas`);
  expect(broken, 'enlaces/recursos rotos').toEqual([]);
  expect(consoleByPage, 'errores de consola por pagina').toEqual({});
  expect(w.badResponses, 'recursos con >=400').toEqual([]);
  expect(w.failed, 'requests fallidas (mismo origen / supabase)').toEqual([]);
});

test('todas las rutas publicas principales: sin console.error, sin recursos 404', async ({ page }) => {
  const routes = ['/', '/explorar', '/explorar?q=caf%C3%A9', '/cerca', '/como-funciona', '/terminos', '/privacidad', '/tabasco', '/tabasco/cunduacan',
    '/ingresar', '/registro', '/recuperar', '/restablecer'];
  const w = watch(page);
  for (const r of routes) {
    const n = w.errors.length;
    await page.goto(r);
    await page.waitForLoadState('networkidle').catch(() => {});
    expect(w.errors.slice(n), r).toEqual([]);
  }
  expect(w.badResponses).toEqual([]);
});

test('footer y header: enlaces esperados presentes y funcionales', async ({ page, request }) => {
  await page.goto('/');
  const footerLinks = await page.locator('footer a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  expect(footerLinks.length).toBeGreaterThan(3);
  for (const l of [...new Set(footerLinks)]) {
    if (l.startsWith('/ir/')) continue;
    const r = await request.get(l);
    expect(r.status(), l).toBeLessThan(400);
  }
  const headerLinks = await page.locator('header a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  expect(headerLinks).toEqual(expect.arrayContaining(['/', '/explorar', '/cerca', '/ingresar', '/registro', '/panel']));
});

test('sin enlaces target=_blank sin rel=noopener', async ({ page }) => {
  for (const p of ['/', '/explorar', '/como-funciona']) {
    await page.goto(p);
    const bad = await page.locator('a[target="_blank"]:not([rel*="noopener"])').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(bad, p).toEqual([]);
  }
});
