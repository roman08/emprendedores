import { chromium } from '@playwright/test';
import { mockRest, fakeSession, fixtures, FAKE_BUSINESS_ID } from '../helpers/mockSupabase.ts';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:4391';
const OUT = 'qa-output/design';
const VPS = { m: [390, 844], d: [1280, 800] };
const notes = [];
const browser = await chromium.launch();

async function overflow(page) {
  return page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
}
for (const [vk, [w, h]] of Object.entries(VPS)) {
  // ---------- PANEL ----------
  {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: vk === 'm' });
    const page = await ctx.newPage();
    const biz = { ...fixtures.business, hours: { mon: { open: '09:00', close: '18:00', closed: false } } };
    const log = await mockRest(page, { handlers: { 'GET businesses': [biz] }, allowWrites: [] });
    await fakeSession(page);
    page.on('pageerror', (e) => notes.push(`${vk} panel pageerror ${String(e).slice(0, 120)}`));
    await page.goto(BASE + '/panel', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/panel-publicaciones-${vk}.png`, fullPage: true });
    notes.push(`${vk} panel overflow ${await overflow(page)}`);
    // menu compartir de producto
    const sh = page.getByRole('button', { name: /^Compartir/ }).last();
    if (await sh.count()) { await sh.click().catch(() => {}); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/panel-menu-compartir-${vk}.png`, fullPage: true }); await page.keyboard.press('Escape'); }
    // formulario nueva publicacion
    const nuevo = page.getByRole('button', { name: /Nueva|Publicar|Agregar/i }).first();
    if (await nuevo.count()) { await nuevo.click().catch(() => {}); await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/panel-form-publicacion-${vk}.png`, fullPage: true });
      // enviar vacio para ver errores
      const sub = page.getByRole('button', { name: /Guardar|Publicar/i }).last(); if (await sub.count()) { await sub.click().catch(() => {}); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/panel-form-error-${vk}.png`, fullPage: true }); } }
    for (const [tab, file] of [['Mi negocio', 'negocio'], ['Estadísticas', 'stats'], ['Cuenta', 'cuenta']]) {
      await page.goto(BASE + '/panel', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
      await page.getByRole('tab', { name: tab }).click(); await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/panel-${file}-${vk}.png`, fullPage: true });
      notes.push(`${vk} panel-${file} overflow ${await overflow(page)}`);
    }
    notes.push(`${vk} panel blocked writes: ${log.blockedWrites.length}`);
    await ctx.close();
  }
  // ---------- ADMIN ----------
  {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: vk === 'm' });
    const page = await ctx.newPage();
    const log = await mockRest(page, { role: 'admin' });
    await fakeSession(page, { role: 'admin' });
    page.on('pageerror', (e) => notes.push(`${vk} admin pageerror ${String(e).slice(0, 120)}`));
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/admin-resumen-${vk}.png`, fullPage: true });
    notes.push(`${vk} admin overflow ${await overflow(page)}`);
    for (const [tab, file] of [['Negocios', 'negocios'], ['Publicaciones', 'publicaciones'], ['Reportes', 'reportes']]) {
      await page.getByRole('tab', { name: tab }).click(); await page.waitForTimeout(1000);
      await page.screenshot({ path: `${OUT}/admin-${file}-${vk}.png`, fullPage: true });
      notes.push(`${vk} admin-${file} overflow ${await overflow(page)}`);
    }
    // modal de confirmacion (en Publicaciones: Borrar)
    await page.getByRole('tab', { name: 'Publicaciones' }).click(); await page.waitForTimeout(500);
    const del = page.getByRole('button', { name: 'Borrar' }).first();
    if (await del.count()) { await del.click(); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/admin-modal-${vk}.png` }); }
    notes.push(`${vk} admin blocked writes: ${log.blockedWrites.length}`);
    await ctx.close();
  }
}
// ---------- Estados publicos: dialogo fuera de horario, menu compartir, foco teclado, formulario con error ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.route('**/ir/**', (r) => r.abort());
  await page.goto(BASE + '/p/tacos-de-canasta-a7a1b', { waitUntil: 'networkidle' });
  await page.locator('#wa').click({ noWaitAfter: true }).catch((e) => notes.push('wa click ' + String(e).slice(0, 80)));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/estado-fuera-horario-m.png` });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await mockRest(page);
  await page.goto(BASE + '/ingresar', { waitUntil: 'networkidle' });
  // foco por teclado
  const seq = [];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Tab');
    seq.push(await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return `${e.tagName}:${(e.textContent || e.name || '').trim().slice(0, 18)} outline=${cs.outlineStyle}/${cs.outlineWidth} shadow=${cs.boxShadow !== 'none'}`; }));
    if (i === 3) await page.screenshot({ path: `${OUT}/foco-ingresar-d.png` });
  }
  notes.push('FOCO: ' + seq.join(' | '));
  await page.getByRole('button', { name: /^Ingresar$/ }).last().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/ingresar-error-vacio-d.png` });
  await page.fill('input[type=email]', 'noesemail');
  await page.fill('input[type=password]', 'x');
  await page.getByRole('button', { name: /^Ingresar$/ }).last().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/ingresar-error-d.png` });
  // registro con error (mock bloquea auth)
  await page.goto(BASE + '/registro', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/registro-form-d.png`, fullPage: true });
  await ctx.close();
}
writeFileSync(`${OUT}/auth-notes.txt`, notes.join('\n'));
console.log(notes.join('\n'));
await browser.close();
