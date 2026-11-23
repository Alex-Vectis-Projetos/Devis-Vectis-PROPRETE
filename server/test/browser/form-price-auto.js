'use strict';

// Montant proposé : remplissage automatique de la modalité choisie (Playwright, hors `npm test` :
// `node --test test/browser/form-price-auto.js`). Vrais clics et vraie frappe ; l'estimation vient du vrai barème (POST /api/estimate).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../src/pricing');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* ignoré */ }
const ROOT = process.env.BANNER_TEST_ROOT || path.join(__dirname, '..', '..', '..');

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
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(P.estimate(P.DEFAULT_PRICING, n.value)));
      });
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}/`;
  try { browser = await chromium.launch(); } catch { browser = null; }
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });
const skip = () => (!chromium ? 'playwright indisponible' : browser === null ? 'chromium indisponible' : false);

const P1 = '.prop >> nth=0';
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); ctx.setDefaultTimeout(8000);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base + '#devis'); await page.waitForSelector('.prop');
  await page.fill('.prop [name=surface]', '350');
  await page.selectOption('.prop [name=freq]', 'Une fois par semaine');
  await page.selectOption('.prop [name=visits]', '1');
  await page.waitForFunction(() => /Forfait : ≈/.test(document.querySelector('.prop .est')?.textContent || ''), null, { timeout: 5000 });
  return { ctx, page, errs };
}
const radio = (page, k) => page.click(`.prop .po:has(input[value=${k}]) label.r`);
const field = (page, k) => page.inputValue(`.prop [data-price=${k}]`);
const settle = (page) => page.waitForTimeout(900);   // anti-rebond de l'estimation : 450 ms + aller-retour
const priceBody = (page) => page.evaluate(() => collectQuote().body.properties[0].price);

test('Forfait fixe choisi directement : le forfait estimé est prérempli (633,26 € HT pour 350 m² chaque semaine)', { skip: skip() }, async () => {
  const { ctx, page, errs } = await open();
  await radio(page, 'fixed'); await settle(page);
  assert.equal(await field(page, 'fixed'), '633,26');
  assert.deepEqual(await priceBody(page), { kind: 'fixed', value: '633,26', auto: true });
  assert.deepEqual(errs, []); await ctx.close();
});

test('Effacer → choisir Forfait fixe : l’estimation revient dans le champ (corrige le champ resté vide)', { skip: skip() }, async () => {
  const { ctx, page, errs } = await open();
  await radio(page, 'hour'); await settle(page);
  assert.equal(await field(page, 'hour'), '32,50');
  await page.click('.prop .price-clr'); await settle(page);
  assert.equal(await page.isChecked('.prop input[value=hour]'), false, 'Effacer décoche la modalité');
  assert.equal(await field(page, 'hour'), '');
  await radio(page, 'fixed'); await settle(page);
  assert.equal(await field(page, 'fixed'), '633,26', 'le forfait estimé est prérempli après Effacer');
  assert.equal(await page.isVisible('.prop .po:has(input[value=fixed]) .auto-tag'), true, 'étiquette « suggestion automatique »');
  assert.deepEqual(await priceBody(page), { kind: 'fixed', value: '633,26', auto: true });
  // même chose pour les deux autres modalités
  await page.click('.prop .price-clr'); await radio(page, 'hour'); await settle(page);
  assert.equal(await field(page, 'hour'), '32,50');
  assert.deepEqual(errs, []); await ctx.close();
});

test('Effacer → Forfait fixe suit ensuite les changements de fréquence (y compris « Autre fréquence »)', { skip: skip() }, async () => {
  const { ctx, page } = await open();
  await page.click('.prop .price-clr'); await radio(page, 'fixed'); await settle(page);
  assert.equal(await field(page, 'fixed'), '633,26');
  await page.selectOption('.prop [name=freq]', 'Autre fréquence'); await settle(page);
  assert.equal(await field(page, 'fixed'), '146,25');
  await page.selectOption('.prop [name=freq]', 'Tous les 15 jours'); await page.selectOption('.prop [name=visits]', '1'); await settle(page);
  assert.equal(await field(page, 'fixed'), '317,36');
  await ctx.close();
});

test('la saisie manuelle reste respectée : jamais écrasée par un changement de fréquence ou de surface', { skip: skip() }, async () => {
  const { ctx, page } = await open();
  await radio(page, 'fixed'); await settle(page);
  await page.click('.prop [data-price=fixed]');
  await page.keyboard.press('Control+A'); await page.keyboard.type('700,00');
  assert.equal(await field(page, 'fixed'), '700,00');
  assert.equal(await page.isVisible('.prop .po:has(input[value=fixed]) .auto-tag'), false, 'plus de « suggestion automatique »');
  await page.selectOption('.prop [name=freq]', 'Tous les 15 jours'); await settle(page);
  assert.equal(await field(page, 'fixed'), '700,00', 'fréquence modifiée : montant saisi conservé');
  await page.fill('.prop [name=surface]', '500'); await settle(page);
  assert.equal(await field(page, 'fixed'), '700,00', 'surface modifiée : montant saisi conservé');
  assert.deepEqual(await priceBody(page), { kind: 'fixed', value: '700,00' }, 'envoyé sans le marqueur « auto »');
  // « Utiliser cette estimation » reste le seul moyen de reprendre la suggestion
  await page.click('.prop .est-use'); await settle(page);
  assert.notEqual(await field(page, 'fixed'), '700,00');
  assert.equal((await priceBody(page)).auto, true);
  await ctx.close();
});

test('saisie manuelle après Effacer : respectée aussi (le correctif ne force pas la suggestion)', { skip: skip() }, async () => {
  const { ctx, page } = await open();
  await page.click('.prop .price-clr'); await radio(page, 'fixed'); await settle(page);
  await page.click('.prop [data-price=fixed]'); await page.keyboard.press('Control+A'); await page.keyboard.type('820,00');
  await page.selectOption('.prop [name=freq]', 'Une fois par mois'); await settle(page);
  assert.equal(await field(page, 'fixed'), '820,00');
  assert.deepEqual(await priceBody(page), { kind: 'fixed', value: '820,00' });
  await ctx.close();
});

test('changer de modalité vide l’ancien champ et préremplit le nouveau, sans toucher à l’autre saisie', { skip: skip() }, async () => {
  const { ctx, page } = await open();
  await radio(page, 'fixed'); await settle(page);
  await radio(page, 'service'); await settle(page);
  assert.equal(await field(page, 'fixed'), '');
  assert.equal(await page.isDisabled('.prop [data-price=fixed]'), true);
  await ctx.close();
});
