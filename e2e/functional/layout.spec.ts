// Regresiones de maquetación (QA D-01, D-02, D-04): los componentes de global.css van en @layer components,
// así que las utilidades de Tailwind (hidden, bg-brand-900...) les ganan.
import { test, expect } from '@playwright/test';
import { blockThirdParty } from './helpers';

test.beforeEach(async ({ page }) => { await blockThirdParty(page); });

for (const width of [360, 390]) {
  test(`sin scroll horizontal a ${width}px en las páginas públicas`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/', '/explorar', '/como-funciona', '/cerca', '/ingresar', '/registro', '/guia']) {
      await page.goto(path);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw, path).toBeLessThanOrEqual(width);
    }
  });
}

test('en móvil Explorar y Cerca de mí del header están ocultos; desde sm se muestran', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await expect(page.locator('header nav').getByRole('link', { name: 'Explorar' })).toBeHidden();
  await expect(page.locator('header nav').getByRole('link', { name: 'Cerca de mí' })).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.locator('header nav').getByRole('link', { name: 'Explorar' })).toBeVisible();
  await expect(page.locator('header nav').getByRole('link', { name: 'Cerca de mí' })).toBeVisible();
});

test('el banner CTA de inicio y de Cómo funciona tiene fondo oscuro (texto blanco legible)', async ({ page }) => {
  for (const path of ['/', '/como-funciona']) {
    await page.goto(path);
    const cta = page.locator('section.card').filter({ has: page.locator('a[data-cta], a[href="/registro"]') }).last();
    const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+(\.\d+)?/g)!.map(Number);
    // Luminancia baja = fondo oscuro (brand-900 #0b3b34)
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b, `${path} fondo ${bg}`).toBeLessThan(100);
  }
});

test('en móvil los botones y chips tienen al menos 44px de alto', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('header a.btn:not([hidden]), main a.btn, main a.rounded-full'))
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ t: (e.textContent ?? '').trim().slice(0, 20), h: e.getBoundingClientRect().height }))
      .filter((x) => x.h < 43.5));
  expect(small).toEqual([]);
});
