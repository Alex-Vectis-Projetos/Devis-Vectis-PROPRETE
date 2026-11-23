'use strict';

// Heures par jour (modalité « À l'heure ») et correctif « Effacer » (Playwright, hors `npm test` : `node --test test/browser/form-hours-by-day.js`).
// Vrais clics ; l'estimation vient du vrai moteur (POST /api/estimate) avec une date FIXE (23/11/2026 : novembre 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../src/pricing');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* ignoré */ }
const ROOT = process.env.BANNER_TEST_ROOT || path.join(__dirname, '..', '..', '..');

const NOW = Date.UTC(2026, 10, 23, 12);
let srv, base, browser;
test.before(async () => {
  if (!chromium) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }
    if (u.pathname === '/api/site/content') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, content: {} })); }
    if (u.pathname === '/api/estimate' && req.method === 'POST') {
      let b = ''; req.on('data', (c) => { b += c; });
      return req.on('end', () => {
        const n = P.normalizeInput(JSON.parse(b));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(P.estimate(P.DEFAULT_PRICING, n.value, NOW)));
      });
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}/`;
  try { browser = await chromium.launch(); } catch { browser = null; }
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });
const skip = () => (!chromium ? 'playwright indisponible' : browser === null ? 'chromium indisponible' : false);


async function open(freq = 'Plusieurs fois par semaine', visits = '4', vp = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp }); ctx.setDefaultTimeout(8000);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base + '#devis'); await page.waitForSelector('.prop');
  await page.fill('.prop [name=surface]', '350');
  await page.selectOption('.prop [name=freq]', freq);
  await page.selectOption('.prop [name=visits]', visits);
  await page.waitForFunction(() => /Forfait : ≈/.test(document.querySelector('.prop .est')?.textContent || ''), null, { timeout: 5000 });
  return { ctx, page, errs };
}
const day = (page, d) => page.click(`.prop .day:has(input[value=${d}])`);
const hrs = (page, d, v) => page.selectOption(`.prop select[name=hday][data-day=${d}]`, String(v));
const settle = (page) => page.waitForTimeout(900);
const res = (page) => page.evaluate(() => (document.querySelector('.prop .hrs-res') || {}).textContent || '');
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel);
const radio = (page, k) => page.click(`.prop .po:has(input[value=${k}]) label.r`);
const field = (page, k) => page.inputValue(`.prop [data-price=${k}]`);

test('le bloc d’heures n’apparaît qu’avec « À l’heure » et au moins un jour ; un champ par jour coché, par quarts d’heure', { skip: skip() }, async () => {
  const { ctx, page, errs } = await open();
  assert.equal(await visible(page, '.prop .hrs'), false, 'aucun jour : pas de bloc');
  await day(page, 'Lundi');
  assert.equal(await visible(page, '.prop .hrs'), true);
  assert.deepEqual(await page.$$eval('.prop select[name=hday]', (a) => a.map((x) => x.dataset.day)), ['Lundi']);
  const opts = await page.$$eval('.prop select[name=hday] option', (a) => a.map((o) => [o.value, o.textContent]));
  assert.deepEqual(opts[0], ['', 'Choisir…']);
  assert.deepEqual(opts.slice(1, 5), [['15', '00h15'], ['30', '00h30'], ['45', '00h45'], ['60', '01h00']]);
  assert.deepEqual(opts[opts.length - 1], ['720', '12h00']);
  assert.equal(opts.length, 1 + 48, 'de 00h15 à 12h00 par pas de 15 minutes');
  await day(page, 'Mercredi');
  assert.deepEqual(await page.$$eval('.prop select[name=hday]', (a) => a.map((x) => x.dataset.day)), ['Lundi', 'Mercredi'], 'ordre de la semaine');
  await day(page, 'Lundi');
  assert.deepEqual(await page.$$eval('.prop select[name=hday]', (a) => a.map((x) => x.dataset.day)), ['Mercredi'], 'jour décoché : son champ disparaît');
  await day(page, 'Mercredi');
  assert.equal(await visible(page, '.prop .hrs'), false, 'plus aucun jour : bloc caché');
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('2 h / 1 h 30 / 2 h / 1 h : 6 h 30 par semaine, 28 h en novembre 2026, 980,00 € HT — et le total suit les jours cochés', { skip: skip() }, async () => {
  const { ctx, page, errs } = await open();
  for (const d of ['Lundi', 'Mardi', 'Mercredi', 'Vendredi']) await day(page, d);
  await hrs(page, 'Lundi', 120); await hrs(page, 'Mardi', 90); await hrs(page, 'Mercredi', 120); await hrs(page, 'Vendredi', 60);
  await settle(page);
  let t = await res(page);
  assert.match(t, /Total par semaine\s*:\s*6 h 30/);
  assert.match(t, /Total du mois \(novembre 2026\)\s*:\s*28 h/);
  assert.match(t, /Tarif horaire\s*:\s*35,00 € HT \/ h/);
  assert.match(t, /Estimation mensuelle\s*:\s*980,00 € HT/);
  assert.match(t, /5 lundi, 4 mardi, 4 mercredi, 4 vendredi/);
  assert.ok(!/TVA|TTC/.test(t.replace('la TVA applicable s’ajoute', '')), 'aucune TVA ni TTC sans taux configuré');
  assert.deepEqual(await page.evaluate(() => collectQuote().body.properties[0].hoursByDay), { Lundi: 120, Mardi: 90, Mercredi: 120, Vendredi: 60 }, 'envoyé en minutes');
  await day(page, 'Mardi'); await settle(page);
  t = await res(page);
  assert.match(t, /Total par semaine\s*:\s*5 h/); assert.match(t, /Estimation mensuelle\s*:\s*770,00 € HT/);
  assert.deepEqual(await page.evaluate(() => collectQuote().body.properties[0].hoursByDay), { Lundi: 120, Mercredi: 120, Vendredi: 60 });
  assert.deepEqual(errs, []);
  await ctx.close();
});

test('autre modalité : bloc caché et rien envoyé ; retour à « À l’heure » : horaires retrouvés', { skip: skip() }, async () => {
  const { ctx, page } = await open();
  await day(page, 'Lundi'); await hrs(page, 'Lundi', 150); await settle(page);
  await radio(page, 'fixed');
  assert.equal(await visible(page, '.prop .hrs'), false);
  assert.equal(await page.evaluate(() => 'hoursByDay' in collectQuote().body.properties[0]), false);
  await radio(page, 'hour'); await settle(page);
  assert.equal(await page.inputValue('.prop select[name=hday][data-day=Lundi]'), '150');
  assert.match(await res(page), /Total du mois \(novembre 2026\)\s*:\s*12 h 30/);
  await ctx.close();
});

test('tous les 15 jours : estimation identifiée comme telle ; heures inférieures à la durée VECTIS : avertissement', { skip: skip() }, async () => {
  const { ctx, page } = await open('Tous les 15 jours', '1');
  await day(page, 'Lundi'); await hrs(page, 'Lundi', 120); await settle(page);
  const t = await res(page);
  assert.match(t, /\(estimation\)/); assert.match(t, /Estimation moyenne/);
  assert.match(t, /inférieures à la durée estimée par VECTIS \(4 h 30\)/);
  await ctx.close();
});

test('le prix saisi à la main n’est jamais écrasé par un changement d’horaires ni de jours', { skip: skip() }, async () => {
  const { ctx, page } = await open();
  await day(page, 'Lundi'); await hrs(page, 'Lundi', 120); await settle(page);
  await page.click('.prop [data-price=hour]'); await page.keyboard.press('Control+A'); await page.keyboard.type('41,00');
  await hrs(page, 'Lundi', 240); await day(page, 'Mardi'); await hrs(page, 'Mardi', 60); await settle(page);
  assert.equal(await field(page, 'hour'), '41,00');
  assert.deepEqual(await page.evaluate(() => collectQuote().body.properties[0].price), { kind: 'hour', value: '41,00' }, 'sans marqueur « auto »');
  await ctx.close();
});

test('correctif « Effacer » : valeur manuelle → Effacer → même modalité : l’estimation revient', { skip: skip() }, async () => {
  const { ctx, page } = await open('Une fois par semaine', '1');
  await radio(page, 'fixed'); await settle(page);
  await page.click('.prop [data-price=fixed]'); await page.keyboard.press('Control+A'); await page.keyboard.type('700,00');
  assert.equal(await field(page, 'fixed'), '700,00');
  await page.click('.prop .price-clr');
  assert.equal(await field(page, 'fixed'), '');
  await radio(page, 'fixed'); await settle(page);
  assert.equal(await field(page, 'fixed'), '681,98', 'plus de champ resté vide');
  assert.deepEqual(await page.evaluate(() => collectQuote().body.properties[0].price), { kind: 'fixed', value: '681,98', auto: true });
  await page.click('.prop [data-price=fixed]'); await page.keyboard.press('Control+A'); await page.keyboard.type('710,00'); await settle(page);
  assert.equal(await field(page, 'fixed'), '710,00', 'la saisie manuelle suivante reste respectée');
  await ctx.close();
});

test('par service : prix d’une intervention complète (5 h → 175,00 €), plus 16,25 €', { skip: skip() }, async () => {
  const { ctx, page } = await open('Une fois par semaine', '1');
  await page.click('.prop .svc-head >> nth=0');
  const ids = ['interne.vacuum', 'interne.sweep', 'interne.mop', 'interne.dust', 'interne.tables', 'interne.computers', 'interne.waste'];
  for (const id of ids) await page.check(`.prop [name=services][value="${id}"]`);
  await settle(page);
  await radio(page, 'service'); await settle(page);
  assert.equal(await field(page, 'service'), '175,00');
  assert.match(await page.textContent('.prop .est'), /Par service\s*:\s*175,00 € HT \/ intervention/);
  await ctx.close();
});

test('mobile 375 px : aucun défilement horizontal avec le bloc d’heures', { skip: skip() }, async () => {
  const { ctx, page } = await open('Plusieurs fois par semaine', '4', { width: 375, height: 800 });
  for (const d of ['Lundi', 'Mardi', 'Mercredi', 'Vendredi']) await day(page, d);
  for (const d of ['Lundi', 'Mardi', 'Mercredi', 'Vendredi']) await hrs(page, d, 120);
  await settle(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
  await ctx.close();
});
