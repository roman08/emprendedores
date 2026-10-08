import { test } from '@playwright/test';
import { seedSession, mockRest, blockThirdParty } from './helpers';
test('dbg', async ({ page }) => {
  await blockThirdParty(page); await seedSession(page);
  await mockRest(page, { handlers: { 'GET listings': [], 'HEAD listings': [] } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/panel');
  await page.getByRole('tab', { name: 'Mi negocio' }).waitFor();
  for (const tab of ['Mi negocio', 'Publicaciones', 'Estadísticas', 'Cuenta']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => Array.from(document.querySelectorAll('main *')).filter((e) => e.getBoundingClientRect().right > 391).map((e) => e.tagName + '.' + String(e.className).slice(0, 50) + ' ' + Math.round(e.getBoundingClientRect().right) + ' ' + (e.textContent || '').trim().slice(0, 25)).slice(0, 6));
    console.log(tab, JSON.stringify(r));
  }
});
