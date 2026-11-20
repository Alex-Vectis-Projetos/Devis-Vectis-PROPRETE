'use strict';
// Carrousel « domaines d'activité » : pagination par pages (Playwright, hors `npm test` : `node --test test/browser/carousel-pages.js`).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const INDEX = path.join(__dirname, '..', '..', '..', 'index.html');
const PH = 'e'.repeat(32);
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const NAMES = ['Cartório', 'Pharmacie', 'Airbnb', 'Immeubles commerciaux', 'Cabinet médical', 'Bureaux', 'Résidences', 'Agences immobilières', 'Hôtels', 'Écoles', 'Cliniques', 'Commerces', 'Restaurants'];
function content(n) {
  const cats = NAMES.slice(0, n).map((l, i) => ({ id: 'c' + i, label: l, subtitle: '', icon: 'i-pharmacie', active: true }));
  const items = cats.map((c, i) => ({ id: 'p' + i, category: c.id, title: 'Lieu ' + i, description: '', photos: [PH], mainPhoto: PH, active: true }));
  return { categories: { items: cats }, places: { hideBuiltin: true, items } };
}
let srv, base, browser, current;
test.before(async () => {
  srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/') { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return r.end(fs.readFileSync(INDEX)); }
    if (u.pathname === '/api/site/content') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ ok: true, content: current })); }
    if (u.pathname.startsWith('/api/site/assets/')) { r.writeHead(200, { 'Content-Type': 'image/gif' }); return r.end(GIF); }
    r.writeHead(404); r.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port + '/';
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); srv.close(); });

async function load(n, vp) {
  current = content(n);
  const c = await browser.newContext({ viewport: vp });
  const p = await c.newPage();
  await p.goto(base);
  await p.waitForSelector('#gal .card');
  await p.waitForTimeout(150);
  return { c, p };
}
// cartes réellement visibles (entièrement dans la fenêtre du carrousel)
const visible = () => {
  const g = document.getElementById('gal'), gr = g.getBoundingClientRect();
  return Array.from(g.querySelectorAll('.card')).map((c, i) => ({ c, i, r: c.getBoundingClientRect() }))
    .filter(x => x.r.left >= gr.left - 2 && x.r.right <= gr.right + 2).map(x => x.c.getAttribute('aria-label').replace('Voir les établissements : ', ''));
};
const state = () => ({
  dots: Array.from(document.querySelectorAll('#dots button')).length,
  active: Array.from(document.querySelectorAll('#dots button')).findIndex(b => b.getAttribute('aria-current') === 'true'),
  dotsHidden: document.getElementById('dots').offsetParent === null,
  prev: document.getElementById('galPrev').disabled, next: document.getElementById('galNext').disabled,
});
async function settle(p) { await p.waitForTimeout(900); }

const DESK = { width: 1440, height: 900 };
for (const [n, pages] of [[3, 1], [4, 1], [5, 2], [8, 2], [9, 3], [13, 4]]) {
  test(`bureau — ${n} catégories → ${pages} page(s), ${Math.ceil(n / 4)} = ceil(${n}/4)`, async () => {
    assert.equal(pages, Math.ceil(n / 4));
    const { c, p } = await load(n, DESK);
    try {
      let s = await p.evaluate(state);
      if (pages === 1) {
        assert.equal(s.dotsHidden, true, 'aucune pastille pour une seule page');
        assert.ok(s.prev && s.next, 'flèches inactives');
        assert.equal((await p.evaluate(visible)).length, n);
        return;
      }
      assert.equal(s.dots, pages); assert.equal(s.active, 0); assert.ok(s.prev); assert.ok(!s.next);
      // chaque pastille mène à la bonne page, dans l'ordre des catégories
      for (let i = 0; i < pages; i++) {
        await p.click(`#dots button[data-i="${i}"]`); await settle(p);
        s = await p.evaluate(state); const v = await p.evaluate(visible);
        assert.equal(s.active, i, `pastille ${i} active`);
        assert.equal(s.prev, i === 0); assert.equal(s.next, i === pages - 1);
        if (i < pages - 1) assert.deepEqual(v, NAMES.slice(i * 4, i * 4 + 4), `page ${i + 1} = cartes ${i * 4 + 1} à ${i * 4 + 4}`);
        else assert.ok(v.includes(NAMES[n - 1]) && v.length >= 1 && v.length <= 4, 'dernière page : dernière carte visible, pas de vide au-delà');
      }
      // flèches synchronisées : on repart à la page 1 puis suivant jusqu'au bout
      await p.click('#dots button[data-i="0"]'); await settle(p);
      for (let i = 1; i < pages; i++) { await p.click('#galNext'); await settle(p); assert.equal((await p.evaluate(state)).active, i); }
      assert.ok((await p.evaluate(state)).next, 'suivant désactivé à la dernière page');
      for (let i = pages - 2; i >= 0; i--) { await p.click('#galPrev'); await settle(p); assert.equal((await p.evaluate(state)).active, i); }
      assert.ok((await p.evaluate(state)).prev);
    } finally { await c.close(); }
  });
}

test('bureau — 8 catégories : page 1 et page 2 exactes', async () => {
  const { c, p } = await load(8, DESK);
  try {
    assert.deepEqual(await p.evaluate(visible), ['Cartório', 'Pharmacie', 'Airbnb', 'Immeubles commerciaux']);
    await p.click('#galNext'); await settle(p);
    assert.deepEqual(await p.evaluate(visible), ['Cabinet médical', 'Bureaux', 'Résidences', 'Agences immobilières']);
    assert.equal((await p.evaluate(state)).dots, 2);
  } finally { await c.close(); }
});

test('mobile (2 cartes visibles) — pages = ceil(cartes / visibles), pastilles et flèches cohérentes', async () => {
  const { c, p } = await load(8, { width: 390, height: 844 });
  try {
    const per = (await p.evaluate(visible)).length;
    assert.equal(per, 2);
    const pages = Math.ceil(8 / per);
    let s = await p.evaluate(state); assert.equal(s.dots, pages);
    for (let i = 0; i < pages; i++) {
      await p.click(`#dots button[data-i="${i}"]`); await settle(p);
      s = await p.evaluate(state); assert.equal(s.active, i);
      assert.deepEqual(await p.evaluate(visible), NAMES.slice(i * per, i * per + per));
    }
  } finally { await c.close(); }
});

test('redimensionnement : pagination recalculée (bureau → mobile → bureau)', async () => {
  const { c, p } = await load(8, DESK);
  try {
    assert.equal((await p.evaluate(state)).dots, 2);
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
    assert.equal((await p.evaluate(state)).dots, 4);
    await p.setViewportSize(DESK); await p.waitForTimeout(400);
    const s = await p.evaluate(state); assert.equal(s.dots, 2); assert.equal(s.active, 0);
  } finally { await c.close(); }
});

test('ajout / suppression de catégories : pagination recalculée à partir du contenu publié (ordre conservé)', async () => {
  const { c, p } = await load(8, DESK);
  try {
    assert.equal((await p.evaluate(state)).dots, 2);
    for (const [n, dots] of [[9, 3], [4, 0], [5, 2], [3, 0], [8, 2]]) {
      current = content(n);
      await p.reload(); await p.waitForSelector('#gal .card'); await p.waitForTimeout(200);
      const s = await p.evaluate(state);
      assert.equal(s.dots, dots, `${n} catégories → ${dots} pastille(s)`);
      assert.deepEqual((await p.evaluate(() => Array.from(document.querySelectorAll('#gal .card')).map(x => x.querySelector('.cap').textContent))), NAMES.slice(0, n), 'ordre conservé');
    }
  } finally { await c.close(); }
});

test('catégorie ouverte : les photos/établissements gardent leur propre rangée, sans hériter de l’ancienne pagination', async () => {
  const { c, p } = await load(8, DESK);
  try {
    await p.click('#gal .card[data-cat="c1"]');
    await p.waitForSelector('#gal .card[data-id]');
    await p.waitForTimeout(300);
    const s = await p.evaluate(state);
    assert.equal(s.dotsHidden, true, 'un seul établissement : pas de pagination');
    assert.equal(s.active, -1);
  } finally { await c.close(); }
});
