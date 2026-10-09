import { test, expect } from '@playwright/test';
import { watch, blockThirdParty, discover } from './helpers';

/** Los islands client:visible se hidratan tras el primer render: se reintenta el clic hasta que el modal abre. */
async function openReport(btn: import('@playwright/test').Locator, dlg: import('@playwright/test').Locator) {
  await expect(async () => { await btn.click(); await expect(dlg).toBeVisible({ timeout: 1000 }); }).toPass({ timeout: 15000 });
}

test.beforeEach(async ({ page }) => {
  await blockThirdParty(page);
});

test.describe('Home', () => {
  test('carga, muestra categorias, municipios y recientes sin errores de consola', async ({ page }) => {
    const w = watch(page);
    const res = await page.goto('/');
    expect(res!.status()).toBe(200);
    await expect(page).toHaveTitle(/.{3,}/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Explora por categoría' })).toBeVisible();
    expect(await page.locator('a[href^="/explorar?categoria="]').count()).toBeGreaterThan(3);
    await expect(page.getByRole('heading', { name: 'Publicado recientemente' })).toBeVisible();
    await expect(page.locator('a[href^="/tabasco/"]').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(w.errors).toEqual([]);
    expect(w.badResponses).toEqual([]);
  });

  test('el buscador de la home lleva a /explorar?q=', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Buscar').last().fill('tacos');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page).toHaveURL(/\/explorar\?q=tacos/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('tacos');
  });

  test('CTA "Empezar ahora" apunta a /registro sin sesion', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[data-cta]').first()).toHaveAttribute('href', '/registro');
  });
});

test.describe('Busqueda y /explorar', () => {
  const queries: [string, string][] = [
    ['acentos', 'café'],
    ['mayusculas+acentos', 'TÁCOS'],
    ['error de escritura', 'tacoz de canasta'],
    ['vacio', ''],
    ['solo espacios', '    '],
    ['caracteres raros', `%_\\'"<>;--&|{}[]()*`],
    ['sql-injection-like', `' OR 1=1; DROP TABLE listings;--`],
    ['html', '<script>window.__xss=1</script>'],
    ['emoji', '🌮🌮'],
    ['200 caracteres', 'a'.repeat(200)],
    ['control chars', 'ta\u0000co\u0007s'],
  ];
  for (const [name, q] of queries) {
    test(`q=${name} no genera 500 ni errores de consola`, async ({ page }) => {
      const w = watch(page);
      const res = await page.goto('/explorar?q=' + encodeURIComponent(q));
      expect(res!.status(), `status para q=${name}`).toBeLessThan(400);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
      expect(await page.locator('script', { hasText: '__xss' }).count()).toBe(0);
      expect(w.errors).toEqual([]);
    });
  }

  test('q de 200 caracteres se recorta a 80 en el campo', async ({ page }) => {
    await page.goto('/explorar?q=' + 'a'.repeat(200));
    const v = await page.locator('main input[name="q"]').inputValue();
    expect(v.length).toBeLessThanOrEqual(80);
  });

  test('busqueda tolerante a errores de escritura devuelve resultados (0005 aplicada)', async ({ page }) => {
    await page.goto('/explorar?q=' + encodeURIComponent('tacoz'));
    const hasCards = await page.locator('a[href^="/p/"]').count();
    const msg = await page.getByText('No encontramos resultados.').count();
    // Con 0005 aplicada: o hay resultados, o hay sugerencia "¿Quisiste decir…?"
    if (!hasCards) {
      expect(msg).toBe(1);
      await expect(page.getByText('¿Quisiste decir')).toBeVisible();
    }
  });

  test('sin resultados: mensaje amigable y categorias sugeridas', async ({ page }) => {
    await page.goto('/explorar?q=zzzqxjkw');
    await expect(page.getByText('No encontramos resultados.')).toBeVisible();
    await expect(page.getByText('Revisa la ortografía')).toBeVisible();
  });

  for (const p of ['-1', 'abc', '9999', '0', '1.5', '1e9', '', 'NaN', '  2 ']) {
    test(`pagina=${JSON.stringify(p)} no rompe`, async ({ page }) => {
      const res = await page.goto('/explorar?pagina=' + encodeURIComponent(p));
      expect(res!.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }

  test('categoria/municipio/tipo invalidos se ignoran sin error', async ({ page }) => {
    for (const qs of ['categoria=inexistente', 'municipio=nope', 'tipo=otro', 'categoria[]=x&tipo[]=y', 'categoria=%00']) {
      const res = await page.goto('/explorar?' + qs);
      expect(res!.status(), qs).toBe(200);
      await expect(page.getByRole('heading', { level: 1 }), qs).toBeVisible();
    }
  });

  test('filtros: elegir categoria y municipio reflejado en URL y en el h1', async ({ page }) => {
    await page.goto('/explorar');
    // En móvil y tableta los filtros están en una hoja inferior que se abre con «Filtros»
    // La barra de herramientas de `astro dev` flota abajo y tapa el botón de la hoja (no existe en producción)
    await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
    const toggle = page.locator('[data-filters-open]');
    if (await toggle.isVisible()) await toggle.click();
    await page.getByLabel('Categoría', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Municipio', { exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: /^(Filtrar|Ver resultados)$/ }).click();
    await expect(page).toHaveURL(/categoria=.+&municipio=.+/);
    await expect(page.getByLabel('Categoría', { exact: true })).not.toHaveValue('');
    await expect(page.getByLabel('Municipio', { exact: true })).not.toHaveValue('');
    await expect(page.getByRole('link', { name: /^Ver .* en .* →$/ })).toBeVisible();
  });

  test('filtro con categoria sin resultados ofrece "Quitar filtros"', async ({ page }) => {
    await page.goto('/explorar?categoria=mascotas&q=zzzqxjkw');
    await expect(page.getByRole('link', { name: 'Quitar filtros' })).toBeVisible();
  });

  test('paginacion: con pocos datos reales no hay nav; con mock del navegador no aplica (SSR)', async ({ page }) => {
    await page.goto('/explorar');
    const nav = page.getByRole('navigation', { name: 'Paginación' });
    const n = await page.locator('a[href^="/p/"]').count();
    if (n < 24) await expect(nav).toHaveCount(0);
  });
});

test.describe('Ficha /p/<slug>', () => {
  test('galeria, WhatsApp via /ir/whatsapp (sin numero en HTML), compartir, reportar', async ({ page, request }) => {
    const { listing } = await discover(page);
    test.skip(!listing, 'No hay publicaciones reales para probar la ficha');
    const w = watch(page);
    const res = await page.goto(`/p/${listing}`);
    expect(res!.status()).toBe(200);

    const html = await (await request.get(`/p/${listing}`)).text();
    const wa = page.locator('#wa');
    await expect(wa).toBeVisible();
    await expect(wa).toHaveAttribute('href', /^\/ir\/whatsapp\/[0-9a-f-]{36}$/);
    expect(html).not.toMatch(/wa\.me\/\d{8,}/);
    expect(html).not.toMatch(/api\.whatsapp\.com\/send\?phone/);
    expect(html).not.toMatch(/"telephone"/);
    expect(html).not.toMatch(/\b52\d{10}\b/);

    // Metadatos y JSON-LD
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/p/${listing}$`));
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /.{3,}/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
    const lds = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(lds.length).toBeGreaterThan(0);
    for (const t of lds) { const j = JSON.parse(t); expect(j['@context']).toBe('https://schema.org'); }

    // Galeria: si hay miniaturas, el clic cambia la imagen principal
    const thumbs = page.locator('[data-thumb]');
    if (await thumbs.count() > 1) {
      const target = await thumbs.nth(1).getAttribute('data-thumb');
      await thumbs.nth(1).click();
      await expect(page.locator('#main-img')).toHaveAttribute('src', target!);
    }

    // Compartir
    await expect(page.getByRole('button', { name: 'Copiar enlace' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Compartir por WhatsApp' })).toBeVisible();

    // Badge de disponibilidad: debe haber tipo (Producto/Servicio); badges especiales segun estado
    await expect(page.getByText(/^(Producto|Servicio)$/).first()).toBeVisible();

    // Cerrado: el dialogo de cerrado puede interceptar; solo comprobamos que la pagina no genero errores
    await page.waitForLoadState('networkidle');
    expect(w.errors).toEqual([]);
  });

  test('horario visible en ficha ("Ver horario") cuando el negocio lo configuro', async ({ page }) => {
    const { listing } = await discover(page);
    test.skip(!listing, 'sin datos');
    await page.goto(`/p/${listing}`);
    const details = page.locator('details', { hasText: 'Ver horario' });
    if (await details.count()) {
      await details.locator('summary').click();
      await expect(details.getByText(/Lunes|Lun/i).first()).toBeVisible();
    }
  });

  test('reportar con mock: abre modal, envia y muestra gracias; Esc cierra', async ({ page }) => {
    const { listing } = await discover(page);
    test.skip(!listing, 'sin datos');
    const posts: string[] = [];
    // Se intercepta el POST de reportes (NUNCA llega a la base real)
    await page.route('**/rest/v1/reports*', async (route) => {
      posts.push(route.request().method());
      await route.fulfill({ status: 201, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '' });
    });
    await page.route('**/rest/v1/rpc/track_event*', (r) => r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }));
    await page.goto(`/p/${listing}`);
    const btn = page.getByRole('button', { name: /Reportar esta publicación/ });
    await btn.scrollIntoViewIfNeeded();
    const dlg = page.getByRole('dialog', { name: /Reportar/ });
    await openReport(btn, dlg);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await openReport(btn, dlg);
    await page.getByLabel('Motivo').selectOption('Estafa o engaño');
    await page.getByLabel(/Detalles/).fill('Reporte de prueba automatizada');
    await page.getByRole('button', { name: 'Enviar reporte' }).click();
    await expect(page.getByText('Gracias por avisarnos')).toBeVisible();
    expect(posts).toEqual(['POST']);
  });

  test('reportar: error del servidor muestra mensaje en espanol', async ({ page }) => {
    const { listing } = await discover(page);
    test.skip(!listing, 'sin datos');
    await page.route('**/rest/v1/reports*', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'rate' }) }));
    await page.goto(`/p/${listing}`);
    const b2 = page.getByRole('button', { name: /Reportar esta publicación/ });
    await openReport(b2, page.getByRole('dialog', { name: /Reportar/ }));
    await page.getByRole('button', { name: 'Enviar reporte' }).click();
    await expect(page.getByRole('alert')).toContainText('No pudimos enviar tu reporte');
  });

  test('slug inexistente -> 404 amigable con status 404', async ({ page }) => {
    const res = await page.goto('/p/esta-publicacion-no-existe-xyz');
    expect(res!.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.getByRole('link', { name: 'Ir al inicio' })).toBeVisible();
  });

  test('slugs raros no provocan 500', async ({ page }) => {
    for (const s of ['%00', '%27%20OR%201=1--', 'a'.repeat(300), '%E2%9C%93', '..%2f..%2fetc%2fpasswd']) {
      const res = await page.goto('/p/' + s);
      expect(res!.status(), s).toBe(404);
    }
  });
});

test.describe('Tienda /n/<slug>', () => {
  test('muestra el negocio, WhatsApp oculto, JSON-LD valido', async ({ page, request }) => {
    const { business } = await discover(page);
    test.skip(!business, 'sin datos');
    const w = watch(page);
    const res = await page.goto(`/n/${business}`);
    expect(res!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const html = await (await request.get(`/n/${business}`)).text();
    expect(html).toMatch(/\/ir\/whatsapp\/tienda\?negocio=/);
    expect(html).not.toMatch(/wa\.me\/\d{8,}/);
    expect(html).not.toMatch(/\b52\d{10}\b/);
    for (const t of await page.locator('script[type="application/ld+json"]').allTextContents()) JSON.parse(t);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/n/${business}$`));
    await page.waitForLoadState('networkidle');
    expect(w.errors).toEqual([]);
  });

  test('slug inexistente -> 404 amigable', async ({ page }) => {
    const res = await page.goto('/n/negocio-que-no-existe');
    expect(res!.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
  });
});

test.describe('Paginas de ubicacion', () => {
  test('/tabasco', async ({ page }) => {
    const res = await page.goto('/tabasco');
    expect(res!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tabasco');
    await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();
  });
  test('/tabasco/cunduacan', async ({ page }) => {
    const w = watch(page);
    const res = await page.goto('/tabasco/cunduacan');
    expect(res!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cunduacán');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/tabasco\/cunduacan$/);
    for (const t of await page.locator('script[type="application/ld+json"]').allTextContents()) {
      const j = JSON.parse(t);
      expect(j['@type']).toBe('BreadcrumbList');
      for (const it of j.itemListElement) expect(it.item).toMatch(/^https?:\/\//);
    }
    await page.waitForLoadState('networkidle');
    expect(w.errors).toEqual([]);
  });
  test('/tabasco/cunduacan/<categoria valida>', async ({ page }) => {
    await page.goto('/tabasco/cunduacan');
    const link = page.locator('a[href^="/tabasco/cunduacan/"]').first();
    test.skip(!(await link.count()), 'sin categorias con publicaciones');
    const href = (await link.getAttribute('href'))!;
    const res = await page.goto(href);
    expect(res!.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cunduacán');
  });
  test('combinaciones invalidas -> 404', async ({ page }) => {
    for (const u of ['/tabasco/cunduacan/categoria-inexistente', '/tabasco/municipio-inexistente', '/estado-falso', '/tabasco/cunduacan/%00', '/tabasco/Cunduac%C3%A1n']) {
      const res = await page.goto(u);
      expect(res!.status(), u).toBe(404);
      await expect(page.getByRole('heading', { name: 'No encontramos esta página' }), u).toBeVisible();
    }
  });
  test('?pagina invalida en municipio no rompe', async ({ page }) => {
    for (const p of ['-5', 'abc', '99999']) {
      const res = await page.goto('/tabasco/cunduacan?pagina=' + p);
      expect(res!.status(), p).toBe(200);
    }
  });
});

test.describe('SEO: sitemap, robots, metadatos', () => {
  test('sitemap.xml bien formado, URLs absolutas, sin /panel ni /admin', async ({ request, baseURL }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('xml');
    const xml = await res.text();
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trim().endsWith('</urlset>')).toBe(true);
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(3);
    expect(xml.match(/<url>/g)!.length).toBe(locs.length);
    expect(xml.match(/<\/url>/g)!.length).toBe(locs.length);
    for (const l of locs) {
      expect(l, l).toMatch(/^https?:\/\//);
      expect(() => new URL(l)).not.toThrow();
      const p = new URL(l).pathname;
      expect(p, l).not.toMatch(/^\/(panel|admin|ir|ingresar|registro|restablecer|recuperar)/);
    }
    // sin & sin escapar
    expect(xml.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toContain('&');
    for (const m of xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) expect(Number.isNaN(Date.parse(m[1]))).toBe(false);
    // Las rutas del sitemap existen (200)
    for (const l of locs.filter((x) => !x.includes('?')).slice(0, 12)) {
      const r = await request.get(l.replace(new URL(l).origin, baseURL!));
      expect(r.status(), l).toBe(200);
    }
  });

  test('robots.txt valido: bloquea /panel y /admin, apunta al sitemap absoluto', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    const t = await res.text();
    expect(t).toMatch(/^User-agent: \*/m);
    expect(t).toMatch(/^Disallow: \/panel/m);
    expect(t).toMatch(/^Disallow: \/admin/m);
    expect(t).toMatch(/^Sitemap: https?:\/\/[^\s]+\/sitemap\.xml$/m);
  });

  const pages: [string, RegExp][] = [
    ['/', /.{3,}/], ['/explorar', /Explorar/], ['/cerca', /cerca de mí/], ['/como-funciona', /.+/],
    ['/terminos', /.+/], ['/privacidad', /.+/], ['/tabasco', /Tabasco/],
  ];
  for (const [path, title] of pages) {
    test(`metadatos de ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.{20,}/);
      const canon = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canon).toMatch(/^https?:\/\//);
      expect(new URL(canon!).pathname).toBe(path);
      await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https?:\/\//);
      await expect(page.locator('h1')).toHaveCount(1);
    });
  }

  test('paginas privadas llevan noindex', async ({ page }) => {
    for (const p of ['/panel', '/admin', '/ingresar', '/registro', '/recuperar', '/restablecer']) {
      await page.goto(p);
      await expect(page.locator('meta[name="robots"]'), p).toHaveAttribute('content', 'noindex');
    }
  });

  test('canonical de /explorar con filtros no incluye query (todas las variantes consolidan)', async ({ page }) => {
    await page.goto('/explorar?categoria=comida-y-bebidas');
    const canon = await page.locator('link[rel="canonical"]').getAttribute('href');
    // El sitemap ya no lista /explorar?categoria=... (su canonical es /explorar).
    const xml = await (await page.request.get('/sitemap.xml')).text();
    expect(xml).not.toContain('/explorar?categoria=');
    expect(new URL(canon!).search).toBe('');
  });
});

test.describe('Redireccion /ir/whatsapp/<id>', () => {
  test('id valido -> 302 a wa.me; id inexistente o mal formado -> 404 amigable', async ({ page, request }) => {
    const { listing } = await discover(page);
    test.skip(!listing, 'sin datos');
    await page.goto(`/p/${listing}`);
    const href = (await page.locator('#wa').getAttribute('href'))!;
    const r = await request.get(href, { maxRedirects: 0 });
    expect(r.status()).toBe(302);
    expect(r.headers()['location']).toMatch(/^https:\/\/wa\.me\/\d{10,15}\?text=/);
    expect(r.headers()['cache-control']).toContain('no-store');

    for (const bad of ['xyz', '00000000-0000-4000-8000-000000000999', '1', 'DROP%20TABLE', '%00']) {
      const nf = await request.get('/ir/whatsapp/' + bad, { maxRedirects: 0 });
      expect(nf.status(), bad).toBe(404);
      expect(await nf.text(), bad).toContain('No encontrado');
      expect(nf.headers()['content-type']).toContain('text/html');
    }
    const t = await request.get('/ir/whatsapp/tienda?negocio=no-es-uuid', { maxRedirects: 0 });
    expect(t.status()).toBe(404);
    const t2 = await request.get('/ir/whatsapp/tienda', { maxRedirects: 0 });
    expect(t2.status()).toBe(404);
  });

  test('sin service role no rompe la redireccion (no se cuenta el clic)', async ({ page, request }) => {
    const { listing } = await discover(page);
    test.skip(!listing, 'sin datos');
    await page.goto(`/p/${listing}`);
    const href = (await page.locator('#wa').getAttribute('href'))!;
    // UA de navegador: trackClick intenta contar, pero sin SUPABASE_SERVICE_ROLE_KEY retorna sin error
    const r = await request.get(href, { maxRedirects: 0, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36' } });
    expect(r.status()).toBe(302);
  });

  test('/ir/mapa/<id> redirige o responde 404 amigable', async ({ page, request }) => {
    const { listing } = await discover(page);
    test.skip(!listing, 'sin datos');
    const bad = await request.get('/ir/mapa/no-existe', { maxRedirects: 0 });
    expect(bad.status()).toBe(404);
    await page.goto(`/p/${listing}`);
    const map = page.locator('#map');
    if (await map.count()) {
      const r = await request.get((await map.getAttribute('href'))!, { maxRedirects: 0 });
      expect(r.status()).toBe(302);
      expect(r.headers()['location']).toMatch(/^https?:\/\//);
    }
  });
});

test.describe('Paginas estaticas', () => {
  for (const p of ['/como-funciona', '/terminos', '/privacidad']) {
    test(`${p} responde y no tiene errores de consola`, async ({ page }) => {
      const w = watch(page);
      const res = await page.goto(p);
      expect(res!.status()).toBeLessThan(500);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(w.errors).toEqual([]);
    });
  }
  test('ruta desconocida -> 404 amigable con buscador', async ({ page }) => {
    const res = await page.goto('/ruta/que/no/existe');
    expect(res!.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
    await page.getByPlaceholder('Busca productos o servicios…').fill('pastel');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page).toHaveURL(/\/explorar\?q=pastel/);
  });
});
