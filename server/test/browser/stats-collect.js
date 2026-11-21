'use strict';
// Collecte STATISTIQUES côté navigateur (Playwright, hors `npm test` : `node --test test/browser/stats-collect.js`).
// Le vrai index.html et le vrai stats-collect.js tournent dans Chromium ; /api/stats/e est un serveur de test qui enregistre les
// requêtes. Les corps reçus sont ensuite rejoués dans le VRAI StatsCollector (même validation, sessions, dédoublonnage).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { setup, testConfig } = require('../helpers');
const { StatsCollector } = require('../../src/stats');

const ROOT = path.join(__dirname, '..', '..', '..');
const PID = 'b'.repeat(32);
const CONTENT = {
  categories: { items: [{ id: 'bureaux', label: 'Bureaux', subtitle: '', icon: 'i-building', active: true }, { id: 'pharmacie', label: 'Pharmacie', subtitle: '', icon: 'i-pharmacie', active: true }] },
  places: { items: [{ id: 'l1', category: 'bureaux', title: 'Tour Test', description: '', photos: [PID], mainPhoto: PID, active: true }, { id: 'l2', category: 'pharmacie', title: 'De la Place', description: '', photos: [PID], mainPhoto: PID, active: true }], hideBuiltin: true },
};
let srv, base, browser, mode, hits;

test.before(async () => {
  srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    const file = (f, t) => { r.writeHead(200, { 'Content-Type': t }); r.end(fs.readFileSync(path.join(ROOT, f))); };
    if (u.pathname === '/') return file('index.html', 'text/html; charset=utf-8');
    if (u.pathname === '/stats-collect.js') return file('stats-collect.js', 'text/javascript');
    if (u.pathname === '/admin-stats.js' || u.pathname === '/admin-inline.js' || u.pathname === '/admin-panel.js') return file(u.pathname.slice(1), 'text/javascript');
    if (u.pathname === '/api/site/content') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ ok: true, content: CONTENT })); }
    if (u.pathname === '/api/admin/auth/session') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ ok: true, authenticated: false })); }
    if (u.pathname === '/api/stats/e' && q.method === 'POST') {
      let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
        hits.push({ body: b, headers: q.headers });
        r.writeHead(mode.status || 204); r.end();
      }); return;
    }
    r.writeHead(404, { 'Content-Type': 'application/json' }); r.end('{"ok":false}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); srv.close(); });

async function open(opts = {}, init) {
  mode = { status: 204, ...opts }; hits = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  if (init) await p.addInitScript(init);
  await p.goto(base + (opts.hash || '/'));
  await p.waitForSelector('.dom[data-cat="bureaux"]', { state: 'attached', timeout: 8000 });
  await p.waitForTimeout(250);
  return { ctx, p, errors };
}
const bodies = () => hits.map((h) => JSON.parse(h.body));
const settle = (p) => p.waitForTimeout(300);

test('chargement : un seul événement « view », corps minimal, même origine, sans cookie ni référent', async () => {
  const { ctx, errors } = await open();
  assert.deepEqual(bodies(), [{ t: 'view' }]);
  const h = hits[0].headers;
  assert.equal(h['sec-fetch-site'], 'same-origin');
  assert.equal(h['content-type'], 'application/json');
  assert.equal(h.cookie, undefined);
  assert.equal(h.referer, undefined);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('catégories : clic sur un domaine = category_view (cible = identifiant), répété = une seule fois', async () => {
  const { ctx, p, errors } = await open();
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);      // désélection
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  await p.click('.dom[data-cat="pharmacie"]'); await settle(p);
  assert.deepEqual(bodies(), [{ t: 'view' }, { t: 'category_view', g: 'bureaux' }, { t: 'category_view', g: 'pharmacie' }]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('galerie : ouvrir un établissement = gallery_open avec la catégorie affichée ; la lightbox continue de s’ouvrir', async () => {
  const { ctx, p } = await open();
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  const card = await p.$('#gal .card[data-id]');
  if (!card) { await ctx.close(); return assert.fail('aucun établissement de test affiché'); }
  await card.click(); await settle(p);
  assert.deepEqual(bodies().filter((b) => b.t === 'gallery_open'), [{ t: 'gallery_open', g: 'bureaux' }]);
  assert.equal(await p.evaluate(() => document.getElementById('lb').hidden), false, 'la lightbox du site fonctionne');
  await ctx.close();
});

test('formulaire : #devis = form_open ; première saisie = form_start ; aucune valeur saisie n’est jamais envoyée', async () => {
  const { ctx, p } = await open();
  await p.evaluate(() => { location.hash = '#devis'; });
  await settle(p);
  assert.ok(bodies().some((b) => b.t === 'form_open'));
  assert.ok(!bodies().some((b) => b.t === 'form_start'), 'ouvrir ne suffit pas');
  const secret = 'Zorglub-Secret-77';
  await p.fill('#quoteForm input[type="text"], #quoteForm textarea', secret); await settle(p);
  await p.keyboard.type('abc'); await settle(p);
  const b = bodies();
  assert.equal(b.filter((x) => x.t === 'form_start').length, 1);
  assert.ok(!hits.some((h) => h.body.includes(secret) || h.body.includes('abc')));
  assert.ok(b.every((x) => Object.keys(x).every((k) => k === 't' || k === 'g')));
  assert.ok(!b.some((x) => /quote|sent|submit|envoy/i.test(JSON.stringify(x))), 'aucun événement « devis envoyé » côté navigateur');
  await ctx.close();
});

test('ouvrir directement /#devis compte form_open', async () => {
  const { ctx } = await open({ hash: '/#devis' });
  assert.ok(bodies().some((b) => b.t === 'form_open'));
  await ctx.close();
});

test('téléphone et e-mail : phone_click et email_click, sans adresse ni numéro dans la requête', async () => {
  const { ctx, p } = await open();
  await p.evaluate(() => {
    const mk = (href, id) => { const a = document.createElement('a'); a.href = href; a.id = id; a.textContent = 'x'; a.addEventListener('click', (e) => e.preventDefault()); document.body.appendChild(a); };
    mk('tel:+33612345678', 't1'); mk('mailto:contact@exemple.test', 'm1');
  });
  await p.click('#t1'); await p.click('#m1'); await settle(p);
  const b = bodies();
  assert.ok(b.some((x) => x.t === 'phone_click') && b.some((x) => x.t === 'email_click'));
  assert.ok(!hits.some((h) => /612345678|exemple/.test(h.body)));
  await ctx.close();
});

test('rien n’est lu ni écrit sur l’appareil : aucun cookie, localStorage, sessionStorage ni IndexedDB', async () => {
  const { ctx, p } = await open();
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  const r = await p.evaluate(() => ({ c: document.cookie, ls: localStorage.length, ss: sessionStorage.length }));
  assert.deepEqual(r, { c: '', ls: 0, ss: 0 });
  const src = fs.readFileSync(path.join(ROOT, 'stats-collect.js'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /localStorage|sessionStorage|indexedDB|document\.cookie|\.value\b|api\/quotes|sendQuote|stopPropagation|preventDefault|innerHTML/);
  await ctx.close();
});

test('« Ne pas me suivre » : aucune requête de statistiques', async () => {
  const { ctx, p } = await open({}, () => Object.defineProperty(navigator, 'doNotTrack', { value: '1' }));
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  assert.equal(hits.length, 0);
  await ctx.close();
});

test('collecte désactivée côté serveur (404) : une seule requête, puis plus aucune ; le site fonctionne normalement', async () => {
  const { ctx, p, errors } = await open({ status: 404 });
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  await p.click('.dom[data-cat="pharmacie"]'); await settle(p);
  await p.evaluate(() => { location.hash = '#devis'; }); await settle(p);
  assert.equal(hits.length, 1);
  assert.equal(await p.evaluate(() => document.getElementById('page-devis').classList.contains('active')), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('réseau coupé ou serveur en erreur : aucune erreur visible, la navigation et la galerie fonctionnent', async () => {
  const { ctx, p } = await (async () => {
    mode = { status: 204 }; hits = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
    await p.route('**/api/stats/e', (r) => r.abort());
    await p.goto(base + '/');
    await p.waitForSelector('.dom[data-cat="bureaux"]');
    return { ctx, p };
  })();
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  assert.equal(await p.evaluate(() => document.querySelector('.dom[data-cat="bureaux"]').getAttribute('aria-pressed')), 'true');
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

test('administrateur en édition : aucun événement envoyé', async () => {
  const { ctx, p } = await open();
  await p.evaluate(() => document.body.classList.add('v-editing'));
  hits.length = 0;
  await p.click('.dom[data-cat="pharmacie"]'); await settle(p);
  assert.equal(hits.length, 0);
  await ctx.close();
});

test('de bout en bout : les corps envoyés par le vrai navigateur sont acceptés par le vrai StatsCollector, un événement par session', async () => {
  const { ctx, p } = await open();
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  await p.evaluate(() => { location.hash = '#devis'; }); await settle(p);
  await p.keyboard.press('Tab'); await p.fill('#quoteForm input[type="text"], #quoteForm textarea', 'x'); await settle(p);
  const s = setup({ config: testConfig({ statsEnabled: true }) });
  const col = new StatsCollector({ db: s.db, config: s.cfg, now: () => Date.now() });
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  for (const h of hits) col.ingest({ body: JSON.parse(h.body), headers: { 'sec-fetch-site': h.headers['sec-fetch-site'], 'user-agent': UA }, ip: '192.0.2.10', cookies: {} });
  col.flush();
  for (const h of hits) col.ingest({ body: JSON.parse(h.body), headers: { 'sec-fetch-site': 'same-origin', 'user-agent': UA }, ip: '192.0.2.10', cookies: {} });
  col.flush();
  const rows = s.db.prepare('SELECT type, target FROM stats_events ORDER BY type, target').all();
  assert.deepEqual(rows.map((r) => r.type + ':' + r.target).sort(), ['category_view:bureaux', 'form_open:', 'form_start:', 'view:'].sort());
  assert.equal(col.counters.accepted, 4);
  col.close();
  await ctx.close();
});
