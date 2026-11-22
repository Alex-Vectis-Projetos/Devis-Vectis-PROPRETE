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
let srv, base, browser, mode, hits, contentHits;

test.before(async () => {
  srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    const file = (f, t) => { r.writeHead(200, { 'Content-Type': t }); r.end(fs.readFileSync(path.join(ROOT, f))); };
    if (u.pathname === '/') return file('index.html', 'text/html; charset=utf-8');
    if (u.pathname === '/stats-collect.js' || u.pathname === '/stats-consent.js') return file(u.pathname.slice(1), 'text/javascript');
    if (u.pathname === '/legal/consent-panel.js') return file('legal/consent-panel.js', 'text/javascript');
    if (u.pathname === '/legal/legal.css') return file('legal/legal.css', 'text/css');
    if (u.pathname === '/gestion-des-cookies.html') return file('gestion-des-cookies.html', 'text/html; charset=utf-8');
    if (u.pathname === '/admin-stats.js' || u.pathname === '/admin-inline.js' || u.pathname === '/admin-panel.js') return file(u.pathname.slice(1), 'text/javascript');
    if (u.pathname === '/api/site/content') {
      contentHits++;
      if (mode.contentStatus) { r.writeHead(mode.contentStatus, { 'Content-Type': 'application/json' }); return r.end('{"ok":false}'); }
      const o = { ok: true, content: CONTENT };
      if (mode.stats !== undefined) o.stats = mode.stats; else if (!mode.legacy) o.stats = true;   // legacy = ancien serveur, sans le champ
      r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify(o));
    }
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
  mode = { status: 204, ...opts }; hits = []; contentHits = 0;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  // Par défaut le visiteur a déjà accepté (choix mémorisé) : les tests de collecte existants restent valables. consent: 'none' = pas encore de choix.
  const consent = opts.consent === undefined ? 'granted' : opts.consent;
  if (consent !== 'none') await p.addInitScript((c) => { try { if (!localStorage.getItem('vectis_stats_consent')) localStorage.setItem('vectis_stats_consent', JSON.stringify({ v: 1, c: c.c, t: Date.now() - (c.age || 0) })); } catch (e) {} }, typeof consent === 'string' ? { c: consent } : consent);
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

test('rien n’est lu ni écrit sur l’appareil, hors le choix du visiteur : aucun cookie, un seul élément de stockage local, rien en session', async () => {
  const { ctx, p } = await open();
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  const r = await p.evaluate(() => ({ c: document.cookie, keys: Object.keys(localStorage), ss: sessionStorage.length }));
  assert.deepEqual(r, { c: '', keys: ['vectis_stats_consent'], ss: 0 });
  const src = fs.readFileSync(path.join(ROOT, 'stats-collect.js'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /localStorage|sessionStorage|indexedDB|document\.cookie|\.value\b|api\/quotes|sendQuote|stopPropagation|preventDefault|innerHTML/);
  await ctx.close();
});

test('« Ne pas me suivre » : aucune requête de statistiques', async () => {
  const { ctx, p } = await open({}, () => Object.defineProperty(navigator, 'doNotTrack', { value: '1' }));   // même avec un « accepté » mémorisé
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  assert.equal(hits.length, 0);
  assert.equal(await p.$('#vcBar'), null, 'aucun bandeau');
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
    await ctx.addInitScript(() => { localStorage.setItem('vectis_stats_consent', JSON.stringify({ v: 1, c: 'granted', t: Date.now() })); });
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

test('stats=false : aucune requête vers /api/stats/e (ni POST ni 404), une seule requête de contenu, le site fonctionne', async () => {
  const { ctx, p, errors } = await open({ stats: false });
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  await p.evaluate(() => { location.hash = '#devis'; }); await settle(p);
  await p.fill('#quoteForm input[type="text"], #quoteForm textarea', 'x'); await settle(p);
  assert.equal(hits.length, 0, 'aucun POST de statistiques');
  assert.equal(await p.$('#vcBar'), null, 'collecte désactivée : aucun bandeau de consentement');
  assert.equal(contentHits, 1, 'aucune requête supplémentaire : la même réponse de contenu sert au site et au collecteur');
  assert.equal(await p.evaluate(() => document.getElementById('page-devis').classList.contains('active')), true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('serveur sans le champ « stats » (ancienne version) ou contenu en erreur : aucune mesure, aucune erreur, le site s’affiche', async () => {
  for (const o of [{ legacy: true }, { stats: 'true' }, { stats: 1 }]) {
    const { ctx, p, errors } = await open(o);
    await p.click('.dom[data-cat="bureaux"]'); await settle(p);
    assert.equal(hits.length, 0, JSON.stringify(o));
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  mode = { contentStatus: 500 }; hits = []; contentHits = 0;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base + '/'); await p.waitForTimeout(800);
  assert.equal(hits.length, 0);
  assert.deepEqual(errors, []);
  assert.equal(await p.evaluate(() => !!document.getElementById('quoteForm')), true);
  await ctx.close();
});


// ---------- Consentement (la collecte est active côté serveur, mais rien ne part sans l'accord du visiteur) ----------
const bar = (p) => p.$('#vcBar');

test('consentement : pas de choix = bandeau visible, AUCUN événement (clics, formulaire, #devis), aucun cookie, rien d’écrit', async () => {
  const { ctx, p, errors } = await open({ consent: 'none' });
  assert.ok(await bar(p), 'le bandeau est proposé');
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  await p.evaluate(() => { location.hash = '#devis'; }); await settle(p);
  await p.fill('#quoteForm input[type="text"], #quoteForm textarea', 'x'); await settle(p);
  assert.equal(hits.length, 0, 'aucun événement avant le consentement');
  const r = await p.evaluate(() => ({ c: document.cookie, ls: localStorage.length, ss: sessionStorage.length }));
  assert.deepEqual(r, { c: '', ls: 0, ss: 0 });
  assert.equal(await p.evaluate(() => document.getElementById('page-devis').classList.contains('active')), true, 'le site fonctionne avec le bandeau');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('consentement : Accepter = les événements partent (view puis clics), choix mémorisé, bandeau fermé, pas de redemande au rechargement', async () => {
  const { ctx, p } = await open({ consent: 'none' });
  await p.click('#vcYes'); await settle(p);
  assert.equal(await bar(p), null);
  assert.deepEqual(bodies(), [{ t: 'view' }]);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('vectis_stats_consent')));
  assert.equal(st.c, 'granted'); assert.equal(st.v, 1); assert.deepEqual(Object.keys(st).sort(), ['c', 't', 'v']);
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  assert.deepEqual(bodies(), [{ t: 'view' }, { t: 'category_view', g: 'bureaux' }]);
  hits.length = 0;
  await p.reload(); await p.waitForSelector('.dom[data-cat="bureaux"]', { state: 'attached' }); await settle(p);
  assert.equal(await bar(p), null, 'pas de redemande');
  assert.deepEqual(bodies(), [{ t: 'view' }]);
  assert.equal(await p.evaluate(() => document.cookie), '');
  await ctx.close();
});

test('consentement : Refuser = aucun événement, choix mémorisé, bandeau fermé, pas de redemande, le site reste utilisable', async () => {
  const { ctx, p, errors } = await open({ consent: 'none' });
  await p.click('#vcNo'); await settle(p);
  assert.equal(await bar(p), null);
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  await p.evaluate(() => { location.hash = '#devis'; }); await settle(p);
  assert.equal(hits.length, 0);
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('vectis_stats_consent')).c), 'denied');
  await p.reload(); await p.waitForSelector('.dom[data-cat="bureaux"]', { state: 'attached' }); await settle(p);
  assert.equal(await bar(p), null);
  assert.equal(hits.length, 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('consentement : Refuser est aussi simple et aussi visible qu’Accepter (même élément, même taille, même style, une seule action)', async () => {
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 800 }]) {
    mode = { status: 204 }; hits = []; contentHits = 0;
    const ctx = await browser.newContext({ viewport: vp });
    const p = await ctx.newPage();
    await p.goto(base + '/'); await p.waitForSelector('#vcBar');
    const r = await p.evaluate(() => {
      const f = (id) => { const b = document.getElementById(id), cs = getComputedStyle(b), rc = b.getBoundingClientRect(); return { tag: b.tagName, cls: b.className, w: Math.round(rc.width), h: Math.round(rc.height), bg: cs.backgroundColor, color: cs.color, border: cs.border, fs: cs.fontSize, fw: cs.fontWeight, top: Math.round(rc.top) }; };
      return { no: f('vcNo'), yes: f('vcYes'), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    assert.deepEqual({ ...r.no, w: 0, top: 0 }, { ...r.yes, w: 0, top: 0 }, 'même style');
    assert.ok(Math.abs(r.no.w - r.yes.w) <= 2 && r.no.h >= 44 && r.yes.h >= 44, 'même taille et cible tactile ≥ 44 px');
    assert.ok(Math.abs(r.no.top - r.yes.top) <= 1, 'sur la même ligne');
    assert.ok(r.sw <= r.cw, 'pas de débordement horizontal à ' + vp.width);
    assert.equal(hits.length, 0);
    await ctx.close();
  }
});

test('consentement : retirer son accord arrête immédiatement l’envoi ; ré-accepter le reprend', async () => {
  const { ctx, p } = await open();
  await p.click('.dom[data-cat="bureaux"]'); await settle(p);
  assert.equal(bodies().length, 2);
  await p.evaluate(() => window.VectisConsent.set('denied'));
  hits.length = 0;
  await p.click('.dom[data-cat="pharmacie"]'); await settle(p);
  await p.evaluate(() => { location.hash = '#devis'; }); await settle(p);
  assert.equal(hits.length, 0, 'plus rien après le retrait');
  await p.evaluate(() => { location.hash = '#accueil'; }); await settle(p);
  await p.evaluate(() => window.VectisConsent.set('granted'));
  await p.click('.dom[data-cat="pharmacie"]'); await settle(p);
  assert.ok(bodies().some((b) => b.t === 'category_view' && b.g === 'pharmacie'), 'reprise après un nouvel accord');
  await ctx.close();
});

test('consentement : « Ne pas me suivre » et GPC l’emportent (aucun bandeau, aucun événement), même avec un accord mémorisé ou sans choix', async () => {
  for (const [name, init] of [['DNT', () => Object.defineProperty(navigator, 'doNotTrack', { value: '1' })], ['GPC', () => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true })]]) {
    for (const consent of ['none', 'granted']) {
      const { ctx, p } = await open({ consent }, init);
      await p.click('.dom[data-cat="bureaux"]'); await settle(p);
      assert.equal(hits.length, 0, name + '/' + consent);
      assert.equal(await bar(p), null, name + '/' + consent + ' : pas de bandeau');
      await ctx.close();
    }
  }
});

test('consentement : un choix de plus de six mois est redemandé ; un choix récent ou invalide est traité correctement', async () => {
  const old = await open({ consent: { c: 'granted', age: 200 * 24 * 3600 * 1000 } });
  assert.ok(await bar(old.p), 'choix expiré : le bandeau revient');
  assert.equal(hits.length, 0, 'et rien n’est envoyé tant qu’il n’est pas ré-accepté');
  await old.ctx.close();
  const recent = await open({ consent: { c: 'granted', age: 100 * 24 * 3600 * 1000 } });
  assert.equal(await bar(recent.p), null);
  assert.deepEqual(bodies(), [{ t: 'view' }]);
  await recent.ctx.close();
  const bad = await open({ consent: 'none' }, () => localStorage.setItem('vectis_stats_consent', '{"v":1,"c":"granted","t":"x"}'));
  assert.ok(await bar(bad.p), 'valeur invalide = pas de choix');
  assert.equal(hits.length, 0);
  await bad.ctx.close();
});

test('page « Gestion des cookies » : état, boutons Refuser / Accepter, retrait possible, aucun événement envoyé par la page', async () => {
  for (const [stats, label] of [[true, 'en service'], [false, 'pas en service']]) {
    mode = { status: 204, stats }; hits = []; contentHits = 0;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base + '/gestion-des-cookies.html'); await p.waitForTimeout(500);
    if (!stats) {
      assert.equal(await p.evaluate(() => document.getElementById('cbtns').hidden), true, label);
      assert.match(await p.textContent('#cstate'), /n’est pas en service/);
    } else {
      assert.equal(await p.evaluate(() => document.getElementById('cbtns').hidden), false);
      assert.match(await p.textContent('#cstate'), /pas encore fait de choix/);
      await p.click('#cYes');
      assert.match(await p.textContent('#cstate'), /Vous avez accepté/);
      assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('vectis_stats_consent')).c), 'granted');
      await p.click('#cNo');
      assert.match(await p.textContent('#cstate'), /Vous avez refusé/);
      assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('vectis_stats_consent')).c), 'denied');
      const sz = await p.evaluate(() => ['cNo', 'cYes'].map((i) => { const r = document.getElementById(i).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      assert.deepEqual(sz[0], sz[1], 'boutons de même taille');
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    }
    assert.equal(hits.length, 0, 'la page de gestion n’envoie aucun événement');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});
