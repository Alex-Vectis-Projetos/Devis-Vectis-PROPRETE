'use strict';

// Rendu réel des domaines (#domains) et de la galerie (#gal) pendant le chargement : les catégories et photos d'exemple intégrées
// ne doivent jamais apparaître quand un contenu est publié. Voir banner-render.js (mêmes conventions, hors `npm test`).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* ignoré */ }
const ROOT = process.env.BANNER_TEST_ROOT || path.join(__dirname, '..', '..', '..');
const PID = 'b'.repeat(32);
let srv, base, browser, mode = 'ok', delay = 0, hits = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const content = () => ({ ok: true, content: {
  categories: { items: [{ id: 'pharmacie', label: 'Pharmacie', subtitle: '', icon: 'i-pharmacie', active: true }, { id: 'agences', label: 'Agences immobilières', subtitle: '', icon: 'i-building', active: true }] },
  places: { items: [{ id: 'l1', category: 'pharmacie', title: 'De la Place', description: '', photos: [PID], mainPhoto: PID, active: true }], hideBuiltin: true } } });
test.before(async () => {
  if (!chromium) return;
  srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }
    if (u.pathname === '/api/site/content') { hits++; await sleep(delay);
      if (mode === 'down') { res.writeHead(503); return res.end(); }
      if (mode === 'nocontent') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true,"content":{}}'); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(JSON.stringify(content())); }
    if (u.pathname.startsWith('/api/site/assets/')) { res.writeHead(200, { 'Content-Type': 'image/gif' }); return res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}/`;
  try { browser = await chromium.launch(); } catch { browser = null; }
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });
const skip = () => (!chromium ? 'playwright indisponible' : browser === null ? 'chromium indisponible' : false);

const SAMPLER = `(() => { const tl = window.__tl = []; const t0 = performance.now(); let last = '';
  (function t() {
    const d = [...document.querySelectorAll('#domains .dom')].map((x) => x.dataset.cat);
    const g = [...document.querySelectorAll('#gal .card')].map((c) => (c.querySelector('img') || {}).src || '').map((s) => (s.startsWith('data:image/webp') ? 'BUILTIN' : 'API'));
    const n = document.querySelector('.gal-note'); const note = !!n && !n.hidden;
    const k = JSON.stringify({ d, g, note });
    if (k !== last) { tl.push([Math.round(performance.now() - t0), d, g, note]); last = k; }
    if (performance.now() - t0 < 16000) requestAnimationFrame(t);
  })(); })();`;
const BUILTIN_CATS = ['atelier', 'cartorio', 'airbnb', 'immeubles', 'cabinet', 'public', 'bureaux'];
const sawBuiltin = (tl) => tl.some(([, d, g, note]) => d.some((x) => BUILTIN_CATS.includes(x)) || g.includes('BUILTIN') || note);
async function run(vp, wait) {
  const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); hits = 0;
  await page.addInitScript(SAMPLER); await page.goto(base); await sleep(wait);
  const tl = await page.evaluate(() => window.__tl); await ctx.close(); return tl;
}
const last = (tl) => tl[tl.length - 1];

for (const [name, vp] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
  for (const ms of [0, 300, 1500]) {
    test(`[${name}] API ${ms} ms : domaines et galerie publiés directement, jamais les valeurs intégrées`, { skip: skip() }, async () => {
      mode = 'ok'; delay = ms; const tl = await run(vp, ms + 1500);
      assert.ok(!sawBuiltin(tl), JSON.stringify(tl)); assert.deepEqual(last(tl).slice(1, 3), [['pharmacie', 'agences'], ['API']]); assert.equal(last(tl)[3], false);
    });
  }
}
test('API en échec : rien pendant les tentatives, puis mode dégradé explicite (valeurs intégrées + note d\'exemple) après la dernière', { skip: skip() }, async () => {
  mode = 'down'; delay = 0; const ctx = await browser.newContext(); const page = await ctx.newPage(); hits = 0;
  await page.addInitScript(SAMPLER); await page.goto(base); await sleep(11000);
  assert.ok(!sawBuiltin(await page.evaluate(() => window.__tl)), 'rien avant la dernière tentative'); await sleep(2500);
  const tl = await page.evaluate(() => window.__tl); await ctx.close();
  assert.equal(hits, 3); assert.ok(last(tl)[1].length === 13 && last(tl)[3] === true, JSON.stringify(last(tl)));
});
test('API sans contenu publié : valeurs intégrées + note, sans nouvelle tentative', { skip: skip() }, async () => {
  mode = 'nocontent'; delay = 0; const tl = await run({ width: 1280, height: 800 }, 5000);
  assert.equal(hits, 1); assert.ok(last(tl)[1].length === 13 && last(tl)[3] === true);
});
