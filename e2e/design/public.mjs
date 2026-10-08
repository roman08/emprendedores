import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:4391';
const OUT = 'qa-output/design';
mkdirSync(OUT, { recursive: true });
const VPS = { m: [390, 844], t: [768, 1024], d: [1280, 800] };
const routes = [
  ['home', '/'], ['explorar', '/explorar'], ['explorar-sinres', '/explorar?q=zzzxqwv'],
  ['ficha', '/p/tacos-de-canasta-a7a1b'], ['tienda', '/n/prueba-936ae'], ['cerca', '/cerca'],
  ['cunduacan', '/tabasco/cunduacan'], ['comofunciona', '/como-funciona'], ['terminos', '/terminos'],
  ['privacidad', '/privacidad'], ['404', '/no-existe-xyz'], ['ingresar', '/ingresar'],
  ['registro', '/registro'], ['recuperar', '/recuperar'],
];
const report = [];
const browser = await chromium.launch();
for (const [vk, [w, h]] of Object.entries(VPS)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: vk === 'm', isMobile: vk === 'm' });
  for (const [name, path] of routes) {
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(500);
      // en la primera pasada deja el banner de cookies; es un estado a revisar
      await page.screenshot({ path: `${OUT}/${name}-${vk}.png`, fullPage: true });
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const over = [];
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > de.clientWidth + 1) && getComputedStyle(el).position !== 'fixed') over.push(el.tagName + '.' + String(el.className).slice(0, 50));
        });
        const small = [];
        document.querySelectorAll('a,button,input,select,textarea,[role=tab]').forEach((el) => {
          const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          if (r.width && r.height && cs.visibility !== 'hidden' && (r.height < 44 || r.width < 44) && el.type !== 'hidden')
            small.push(`${el.tagName}:${(el.textContent || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 25)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        });
        const imgs = [...document.images].map((i) => ({ src: i.src.slice(-40), lazy: i.loading, w: i.getAttribute('width'), h: i.getAttribute('height'), nw: i.naturalWidth, nh: i.naturalHeight, rw: Math.round(i.getBoundingClientRect().width), rh: Math.round(i.getBoundingClientRect().height), fit: getComputedStyle(i).objectFit }));
        return { scrollW: de.scrollWidth, clientW: de.clientWidth, over: over.slice(0, 6), small: small.slice(0, 40), nsmall: small.length, imgs, title: document.title, h1: document.querySelectorAll('h1').length };
      });
      report.push({ name, vk, status: resp?.status(), ...m });
    } catch (e) { report.push({ name, vk, error: String(e).slice(0, 200) }); }
    await page.close();
  }
  await ctx.close();
}
// axe + perf en desktop y movil para home/explorar/ficha/ingresar
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const axeRes = {};
for (const [name, path] of [['home', '/'], ['explorar', '/explorar'], ['ficha', '/p/tacos-de-canasta-a7a1b'], ['tienda', '/n/prueba-936ae'], ['ingresar', '/ingresar'], ['registro', '/registro'], ['cerca', '/cerca'], ['comofunciona', '/como-funciona']]) {
  const page = await ctx.newPage();
  let bytes = 0; const reqs = [];
  page.on('response', async (r) => { try { const b = (await r.body()).length; bytes += b; reqs.push([r.url().slice(0, 90), b]); } catch {} });
  await page.addInitScript(() => {
    window.__cls = 0; window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const perf = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: +window.__cls.toFixed(3) }));
  try {
    await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/axe-core/axe.min.js' });
    const r = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1]?.slice(0, 140)) })));
    axeRes[name] = { perf, kb: Math.round(bytes / 1024), top: reqs.sort((a, b) => b[1] - a[1]).slice(0, 4), v: r };
  } catch (e) { axeRes[name] = { perf, kb: Math.round(bytes / 1024), axeError: String(e).slice(0, 100) }; }
  await page.close();
}
writeFileSync(`${OUT}/public-report.json`, JSON.stringify({ report, axeRes }, null, 1));
await browser.close();
console.log('ok');
