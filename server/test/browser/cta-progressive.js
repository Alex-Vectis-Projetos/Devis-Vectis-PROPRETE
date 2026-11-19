'use strict';

// Bouton « Demander un devis » : intensité progressive de la moulure selon l'intérêt réel du visiteur (Playwright, hors `npm test` :
// `node --test test/browser/cta-progressive.js`). Contenu publié simulé : 4 catégories, 3 établissements, sans photos d'exemple.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* ignoré */ }
const ROOT = process.env.BANNER_TEST_ROOT || path.join(__dirname, '..', '..', '..');
const PH = 'e'.repeat(32);
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const cat = (id, label) => ({ id, label, subtitle: '', icon: 'i-pharmacie', active: true });
const place = (id, c) => ({ id, category: c, title: 'Lieu ' + id, description: '', photos: [PH], mainPhoto: PH, active: true });
const CONTENT = { categories: { items: [cat('pharmacie', 'Pharmacie'), cat('cartorio', 'Cartório'), cat('airbnb', 'Airbnb'), cat('bureaux', 'Bureaux')] },
  places: { hideBuiltin: true, items: [place('l1', 'pharmacie'), place('l2', 'pharmacie'), place('l3', 'cartorio'), place('l4', 'airbnb'), place('l5', 'bureaux')] } };

let srv, base, browser;
test.before(async () => {
  if (!chromium) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }
    if (u.pathname === '/api/site/content') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, content: CONTENT })); }
    if (u.pathname.startsWith('/api/site/assets/')) { res.writeHead(200, { 'Content-Type': 'image/gif' }); return res.end(GIF); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}/`;
  try { browser = await chromium.launch(); } catch { browser = null; }
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });
const skip = () => (!chromium ? 'playwright indisponible' : browser === null ? 'chromium indisponible' : false);

async function open(vp = { width: 1280, height: 800 }, reduced = false) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base); await page.waitForSelector('#domains .dom'); await page.waitForTimeout(300);
  return { ctx, page, errs };
}
const state = (page) => page.evaluate(() => {
  const b = document.querySelector('.header-cta'), r = b.getBoundingClientRect(), p = getComputedStyle(b, '::before'), cs = getComputedStyle(b);
  const inner = [...b.querySelectorAll('span, svg')].map((e) => getComputedStyle(e)).map((c) => ({ t: c.transform, a: c.animationName }));
  return { level: b.getAttribute('data-interest'), box: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10), ringOpacity: +p.opacity, ringAnim: p.animationName,
    ringEvents: p.pointerEvents, btnAnim: cs.animationName, btnTransform: cs.transform, inner, hash: location.hash };
});
const clickCat = (page, id) => page.click(`#domains .dom[data-cat="${id}"]`);
const clickCard = (page, i = 0) => page.click(`#gal .card >> nth=${i}`);

for (const [label, vp] of [['desktop', { width: 1280, height: 800 }], ['mobile 390', { width: 390, height: 844 }]]) {
  test(`[${label}] intensité progressive : initial → 1 catégorie → plusieurs → établissements, clics répétés non comptés`, { skip: skip() }, async () => {
    const { ctx, page, errs } = await open(vp);
    const s0 = await state(page);
    assert.equal(s0.level, null, 'état initial : niveau 0 (apparence d\'origine)'); assert.equal(s0.ringOpacity, 0); assert.equal(s0.btnAnim, 'glowpulse', 'l\'éclat discret d\'origine est conservé');
    await clickCat(page, 'pharmacie'); await page.waitForTimeout(150);
    let s = await state(page); assert.equal(s.level, '1', 'première catégorie'); assert.equal(s.ringAnim, 'none'); assert.equal(s.btnAnim, 'none');
    await page.waitForTimeout(800); assert.ok((await state(page)).ringOpacity > 0.5, 'moulure visible');
    await clickCat(page, 'pharmacie'); await clickCat(page, 'pharmacie'); await page.waitForTimeout(100);       // retire puis remet le filtre : même catégorie
    assert.equal((await state(page)).level, '1', 'cliquer plusieurs fois la même catégorie ne compte pas');
    await clickCat(page, 'cartorio'); s = await state(page); assert.equal(s.level, '2', 'deuxième intérêt'); assert.equal(s.ringAnim, 'ctaspin');
    await clickCard(page, 0); await page.waitForSelector('#lb:not([hidden])'); await page.keyboard.press('Escape');      // 1er établissement de Cartório (3e intérêt)
    assert.equal((await state(page)).level, '2');
    await clickCat(page, 'airbnb'); s = await state(page); assert.equal(s.level, '3', '4 intérêts distincts : niveau élevé'); assert.equal(s.ringAnim, 'ctaspin');
    // les établissements de la catégorie ouverte comptent, mais une fois chacun
    await clickCard(page, 0); await page.keyboard.press('Escape'); await clickCard(page, 0); await page.keyboard.press('Escape');
    assert.equal((await state(page)).level, '3'); assert.deepEqual(errs, []); await ctx.close();
  });
}

test('structure : seule la moulure s\'anime ; texte, icône, taille et position du bouton restent identiques à tous les niveaux', { skip: skip() }, async () => {
  const { ctx, page } = await open(); const s0 = await state(page);
  for (const id of ['pharmacie', 'cartorio', 'airbnb', 'bureaux']) { await clickCat(page, id); await page.waitForTimeout(100); }
  const s3 = await state(page); assert.equal(s3.level, '3');
  assert.deepEqual(s3.box, s0.box, 'taille et position du bouton inchangées');
  assert.equal(s3.btnTransform, 'none', 'le bouton ne tourne pas'); assert.equal(s3.btnAnim, 'none');
  for (const e of s3.inner) { assert.equal(e.t, 'none', 'contenu intérieur sans transformation'); assert.equal(e.a, 'none', 'contenu intérieur sans animation'); }
  assert.equal(s3.ringEvents, 'none', 'la moulure ne capte pas les clics');
  assert.ok(!/red|green/i.test(await page.evaluate(() => getComputedStyle(document.querySelector('.header-cta'), '::before').backgroundImage)), 'pas de rouge/vert nommés');
  await ctx.close();
});

test('mouvement réduit : moulure statique équivalente (visible, sans animation)', { skip: skip() }, async () => {
  const { ctx, page } = await open({ width: 1280, height: 800 }, true);
  for (const id of ['pharmacie', 'cartorio', 'airbnb', 'bureaux']) { await clickCat(page, id); await page.waitForTimeout(100); }
  const s = await state(page); assert.equal(s.level, '3'); assert.equal(s.ringAnim, 'none'); assert.equal(s.btnAnim, 'none'); assert.ok(s.ringOpacity >= 0.99, `moulure visible : ${s.ringOpacity}`);
  await ctx.close();
});

test('animation finie : la rotation s\'arrête (pas de boucle infinie)', { skip: skip() }, async () => {
  const { ctx, page } = await open();
  for (const id of ['pharmacie', 'cartorio']) { await clickCat(page, id); await page.waitForTimeout(80); }
  const it = await page.evaluate(() => getComputedStyle(document.querySelector('.header-cta'), '::before').animationIterationCount);
  assert.equal(it, '3'); await ctx.close();
});

test('rien n\'est stocké (localStorage, sessionStorage, cookies) ; le défilement ne compte pas', { skip: skip() }, async () => {
  const { ctx, page } = await open();
  await page.mouse.wheel(0, 1500); await page.waitForTimeout(300); await page.mouse.wheel(0, -1500);
  assert.equal((await state(page)).level, null, 'défiler n\'augmente pas l\'intensité');
  await clickCat(page, 'pharmacie'); await clickCat(page, 'cartorio');
  const st = await page.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length, ck: document.cookie }));
  assert.deepEqual(st, { ls: 0, ss: 0, ck: '' }); await ctx.close();
});

test('clic sur le bouton : navigation vers le formulaire inchangée (#devis), à chaque niveau', { skip: skip() }, async () => {
  for (const clicks of [[], ['pharmacie', 'cartorio', 'airbnb', 'bureaux']]) {
    const { ctx, page } = await open();
    for (const id of clicks) { await clickCat(page, id); await page.waitForTimeout(80); }
    await page.click('.header-cta'); await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ hash: location.hash, devis: document.querySelector('#page-devis').classList.contains('active'), home: document.querySelector('#page-home').classList.contains('active') }));
    assert.deepEqual(r, { hash: '#devis', devis: true, home: false }); await ctx.close();
  }
});
