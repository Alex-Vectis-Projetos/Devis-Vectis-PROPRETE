'use strict';
// Tableau de bord STATISTIQUES (Playwright, hors `npm test` : `node --test test/browser/stats-dashboard.js`).
// Le serveur de test est minimal mais utilise le VRAI code de lecture/simulation (stats-report.js, stats-preview.js, StatsCollector)
// sur une base SQLite en mémoire ; seule la couche HTTP (Fastify) est remplacée. Captures : SHOTS_DIR si défini.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { setup, testConfig } = require('../helpers');
const { dayOf } = require('../../src/stats');
const { buildReport, resolveRange, BUILTIN_CATEGORIES } = require('../../src/stats-report');
const { ensureSeed, simulate, resetDemo } = require('../../src/stats-preview');

const ROOT = path.join(__dirname, '..', '..', '..');
const SHOTS = process.env.SHOTS_DIR || '';
let srv, base, browser, s, mode, requested;

test.before(async () => {
  s = setup({ config: testConfig({ previewMode: true }) });
  srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    requested.push(u.pathname);
    const json = (o, st = 200) => { r.writeHead(st, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
    const file = (f, t) => { r.writeHead(200, { 'Content-Type': t }); r.end(fs.readFileSync(path.join(ROOT, f))); };
    if (u.pathname === '/') return file('index.html', 'text/html; charset=utf-8');
    if (u.pathname === '/admin-stats.js') return file('admin-stats.js', 'text/javascript');
    if (u.pathname === '/admin-inline.js') return file('admin-inline.js', 'text/javascript');
    if (u.pathname === '/admin-panel.js') return file('admin-panel.js', 'text/javascript');
    if (u.pathname === '/api/site/content') return json({ ok: true, content: { categories: { items: [] }, places: { items: [], hideBuiltin: true } } });
    if (u.pathname === '/api/admin/auth/session') return json(mode.loggedIn ? { ok: true, authenticated: true, email: 'test@vectis.invalid', csrfToken: 'tok', expiresAt: Date.now() + 3600000 } : { ok: true, authenticated: false });
    if (u.pathname === '/api/mail/status') return json({ ok: true, connected: false });
    if (u.pathname.startsWith('/api/admin/stats/') && !mode.statsRoutes) return json({ ok: false, error: 'not_found' }, 404);
    if (u.pathname === '/api/admin/stats/status') return json({ ok: true, mode: 'preview', simulated: true, today: dayOf(Date.now()) });
    if (u.pathname === '/api/admin/stats/overview') {
      const today = dayOf(Date.now());
      const range = resolveRange({ range: u.searchParams.get('range'), from: u.searchParams.get('from'), to: u.searchParams.get('to') }, today);
      if (range.error) return json({ ok: false, message: range.error }, 400);
      ensureSeed(s.db, s.cfg, Date.now());
      const labels = new Map(BUILTIN_CATEGORIES);
      if (mode.evilLabel) labels.set('atelier', '<img src=x onerror="window.__xss=1">Atelier');
      return json({ ...buildReport(s.db, range, { today, labels }), mode: 'preview', simulated: true });
    }
    if (u.pathname === '/api/admin/stats/demo/simulate') {
      let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
        if (q.headers['x-csrf-token'] !== 'tok') return json({ ok: false }, 403);
        json({ ok: true, ...simulate(s.db, s.cfg, JSON.parse(b || '{}'), Date.now()) });
      }); return;
    }
    if (u.pathname === '/api/admin/stats/demo/reset') { resetDemo(s.db); ensureSeed(s.db, s.cfg, Date.now()); return json({ ok: true }); }
    r.writeHead(404); r.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); srv.close(); });

async function open(opts = {}, viewport = { width: 1280, height: 900 }) {
  mode = { loggedIn: true, statsRoutes: true, ...opts }; requested = [];
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base + '/');
  return { ctx, p, errors };
}
async function openDash(p) {
  await p.waitForSelector('#vStats', { state: 'visible' });
  await p.click('#vStats');
  await p.waitForSelector('.vst-kpi .v');
}
const num = (t) => Number(String(t).replace(/[^\d]/g, ''));
const kpiValue = (p, label) => p.evaluate((l) => {
  const b = Array.from(document.querySelectorAll('.vst-kpi')).find((k) => k.querySelector('.l').textContent.startsWith(l));
  return b ? b.querySelector('.v').textContent : null;
}, label);
async function shot(p, name) { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); }

test('dock : icône de statistiques sans texte, entre les réglages et « — », infobulle « Statistiques »', async () => {
  const { ctx, p, errors } = await open();
  await p.waitForSelector('#vStats', { state: 'visible' });
  const r = await p.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('#vdock > button')).map((b) => b.id);
    const b = document.getElementById('vStats');
    return { ids, text: b.textContent.trim(), title: b.title, aria: b.getAttribute('aria-label'), hasSvg: !!b.querySelector('svg path'), color: getComputedStyle(b.querySelector('svg')).color };
  });
  assert.deepEqual(r.ids, ['vGear', 'vStats', 'vMin', 'vEnd']);
  assert.equal(r.text, '');
  assert.equal(r.title, 'Statistiques');
  assert.equal(r.aria, 'Statistiques');
  assert.ok(r.hasSvg);
  assert.match(r.color, /rgb\(2(1\d|0\d), 1(6\d|5\d), (3\d|2\d)\)/, 'gold icon');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('production : sans route de statistiques ou sans session, aucune icône et le script du tableau de bord n’est jamais demandé', async () => {
  for (const o of [{ statsRoutes: false }, { loggedIn: false }]) {
    const { ctx, p } = await open(o);
    await p.waitForTimeout(600);
    assert.equal(await p.evaluate(() => document.getElementById('vStats').hidden), true, JSON.stringify(o));
    assert.equal(await p.isVisible('#vStats'), false);
    assert.ok(!requested.includes('/admin-stats.js'));
    await ctx.close();
  }
});

test('tableau de bord : indicateurs, graphiques, appareils, catégories, entonnoir, badge « données simulées »', async () => {
  const { ctx, p, errors } = await open();
  await openDash(p);
  assert.equal(await p.isVisible('#vstBadge'), true);
  assert.match(await p.textContent('#vstBadge'), /simulées/i);
  const labels = await p.$$eval('.vst-kpi .l', (n) => n.map((x) => x.textContent));
  assert.deepEqual(labels.map((x) => x.split(' (')[0]), ['Visiteurs', 'Sessions', 'Événements mesurés', 'Sessions par visiteur', 'Demandes de devis reçues', 'Taux de conversion']);
  const d = await p.evaluate(() => ({
    svgs: document.querySelectorAll('.vst svg[role="img"]').length,
    funnel: document.querySelectorAll('.vst-fun .r').length,
    cats: document.querySelectorAll('.vst-row').length,
    dev: Array.from(document.querySelectorAll('.vst-dl > div:not([style])')).map((x) => x.textContent),
    nm: document.querySelectorAll('.vst-nm li').length,
    tiles: document.querySelectorAll('.vst-tile').length,
  }));
  assert.ok(d.svgs >= 3, 'line chart, quotes chart, donut');
  assert.equal(d.funnel, 6);
  assert.ok(d.cats >= 6);
  assert.equal(d.tiles, 5);
  assert.equal(d.nm, 3);
  assert.ok(d.dev.some((t) => /Mobile/.test(t)) && d.dev.some((t) => /Ordinateur/.test(t)) && d.dev.some((t) => /Tablette/.test(t)));
  const funnelTxt = await p.$$eval('.vst-fun .t span:first-child', (n) => n.map((x) => x.textContent));
  assert.deepEqual(funnelTxt, ['Visiteurs', 'Sessions', 'Formulaire ouvert', 'Remplissage commencé', 'Demandes reçues par l’API', 'Devis envoyés par e-mail']);
  assert.match(await p.textContent('.vst-foot'), /simulées/);
  await shot(p, 'dashboard-desktop-30j');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('périodes : aujourd’hui, 7, 30, 90 jours et intervalle personnalisé mettent à jour les indicateurs', async () => {
  const { ctx, p } = await open();
  await openDash(p);
  const seen = {};
  for (const [label, days] of [['Aujourd’hui', 1], ['7 jours', 7], ['30 jours', 30], ['90 jours', 90]]) {
    await p.click(`.vst-chip:text-is("${label}")`);
    await p.waitForFunction((n) => new RegExp('\\(' + n + ' jours?\\)').test(document.querySelector('.vst-sub') && document.querySelector('.vst-sub').textContent), days);
    seen[days] = num(await kpiValue(p, 'Sessions'));
  }
  assert.ok(seen[1] > 0 && seen[1] < seen[7] && seen[7] < seen[30] && seen[30] < seen[90], JSON.stringify(seen));
  await p.click('.vst-chip:text-is("Personnalisé")');
  const today = await p.evaluate(() => document.querySelector('.vst-custom input').max);
  const from = new Date(today + 'T00:00:00Z'); from.setUTCDate(from.getUTCDate() - 12);
  const to = new Date(today + 'T00:00:00Z'); to.setUTCDate(to.getUTCDate() - 5);
  const inputs = await p.$$('.vst-custom input');
  await inputs[0].fill(from.toISOString().slice(0, 10));
  await inputs[1].fill(to.toISOString().slice(0, 10));
  await p.click('.vst-chip:text-is("Appliquer")');
  await p.waitForFunction(() => /\(8 jours\)/.test(document.querySelector('.vst-sub').textContent));
  assert.ok(num(await kpiValue(p, 'Sessions')) > 0);
  await ctx.close();
});

test('comparaison et séries : la légende « Période précédente » suit la case, les séries se masquent', async () => {
  const { ctx, p } = await open();
  await openDash(p);
  assert.equal(await p.locator('.vst-leg', { hasText: 'Période précédente' }).count(), 1);
  assert.ok(await p.locator('.vst-box path[stroke-dasharray]').count() >= 2);
  await p.uncheck('.vst-cmp input');
  assert.equal(await p.locator('.vst-leg', { hasText: 'Période précédente' }).count(), 0);
  assert.equal(await p.locator('.vst-box path[stroke-dasharray]').count(), 0);
  await p.click('.vst-leg button:has-text("Sessions")');
  assert.equal(await p.getAttribute('.vst-leg button:has-text("Sessions")', 'aria-pressed'), 'false');
  await p.click('.vst-leg button:has-text("Visiteurs")');   // the last visible series cannot be hidden
  assert.equal(await p.getAttribute('.vst-leg button:has-text("Visiteurs")', 'aria-pressed'), 'true');
  await ctx.close();
});

test('infobulle : survol du graphique affiche le jour et les valeurs', async () => {
  const { ctx, p } = await open();
  await openDash(p);
  const box = await p.locator('.vst-box svg[role="img"]').first().boundingBox();
  await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await p.waitForSelector('.vst-tip');
  const t = await p.textContent('.vst-tip');
  assert.match(t, /Visiteurs : \d/);
  assert.match(t, /Sessions : \d/);
  await ctx.close();
});

test('simulation : un parcours complet de devis augmente sessions, formulaires et demandes ; réinitialisation', async () => {
  const { ctx, p } = await open();
  await openDash(p);
  await p.click('.vst-chip:text-is("Aujourd’hui")');
  await p.waitForFunction(() => /\(1 jour\)/.test(document.querySelector('.vst-sub').textContent));
  const s0 = num(await kpiValue(p, 'Sessions')); const q0 = num(await kpiValue(p, 'Demandes de devis'));
  await p.selectOption('#vstDev', 'mobile'); await p.selectOption('#vstVis', 'new'); await p.selectOption('#vstJny', 'quote'); await p.fill('#vstCnt', '6');
  await p.click('.vst-btn:text-is("Simuler")');
  await p.waitForFunction((v) => { const b = Array.from(document.querySelectorAll('.vst-kpi')).find((k) => k.querySelector('.l').textContent.startsWith('Sessions')); return b && Number(b.querySelector('.v').textContent.replace(/\D/g, '')) >= v; }, s0 + 6);
  assert.equal(num(await kpiValue(p, 'Sessions')), s0 + 6);
  assert.equal(num(await kpiValue(p, 'Demandes de devis')), q0 + 6);
  // visiteur récurrent : plus de sessions que de visiteurs
  const v1 = num(await kpiValue(p, 'Visiteurs')); const s1 = num(await kpiValue(p, 'Sessions'));
  await p.selectOption('#vstVis', 'returning'); await p.selectOption('#vstJny', 'view'); await p.fill('#vstCnt', '8');
  await p.click('.vst-btn:text-is("Simuler")');
  await p.waitForFunction((v) => { const b = Array.from(document.querySelectorAll('.vst-kpi')).find((k) => k.querySelector('.l').textContent.startsWith('Sessions')); return b && Number(b.querySelector('.v').textContent.replace(/\D/g, '')) >= v; }, s1 + 16);
  const dV = num(await kpiValue(p, 'Visiteurs')) - v1; const dS = num(await kpiValue(p, 'Sessions')) - s1;
  assert.equal(dS, 16); assert.equal(dV, 8);
  await p.click('.vst-btn:text-is("Réinitialiser la démo")');
  await p.waitForFunction(() => /réinitialisées/.test(document.getElementById('toast').textContent));
  await p.waitForFunction(() => document.querySelector('.vst-kpi .v'));
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM quotes WHERE id NOT LIKE 'demo-%'").get().n, 0, 'only demo rows exist');
  assert.ok(num(await kpiValue(p, 'Sessions')) > 0, 'the demo is re-seeded');
  await ctx.close();
});

test('sécurité : une étiquette de catégorie hostile est affichée comme texte, jamais exécutée', async () => {
  const { ctx, p } = await open({ evilLabel: true });
  await openDash(p);
  await p.waitForSelector('.vst-row');
  assert.equal(await p.evaluate(() => window.__xss), undefined);
  assert.equal(await p.locator('.vst img').count(), 0);
  assert.match(await p.textContent('.vst-rows'), /<img src=x/);
  await ctx.close();
});

test('mobile 390 px : pas de défilement horizontal, éléments lisibles, fermeture au clavier', async () => {
  const { ctx, p, errors } = await open({}, { width: 390, height: 844 });
  await openDash(p);
  const m = await p.evaluate(() => {
    const o = document.getElementById('vst');
    const over = Array.from(o.querySelectorAll('*')).filter((e) => e.getBoundingClientRect().right > o.clientWidth + 1 && !e.closest('svg') && getComputedStyle(e).position !== 'fixed').map((e) => e.className || e.tagName).slice(0, 5);
    return { sw: o.scrollWidth, cw: o.clientWidth, docSw: document.documentElement.scrollWidth, innerW: innerWidth, over };
  });
  assert.ok(m.sw <= m.cw + 1, JSON.stringify(m));
  assert.ok(m.docSw <= m.innerW + 1, JSON.stringify(m));
  assert.deepEqual(m.over, []);
  await shot(p, 'dashboard-mobile-top');
  await p.evaluate(() => document.getElementById('vst').scrollTo(0, 900));
  await shot(p, 'dashboard-mobile-middle');
  await p.keyboard.press('Escape');
  assert.equal(await p.isVisible('#vst'), false);
  assert.equal(await p.evaluate(() => document.body.style.overflow), '');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('tablette 820 px et bureau large : mise en page sans débordement', async () => {
  for (const vp of [{ width: 820, height: 1000 }, { width: 1600, height: 1000 }, { width: 1280, height: 2300 }]) {
    const { ctx, p } = await open({}, vp);
    await openDash(p);
    const m = await p.evaluate(() => { const o = document.getElementById('vst'); return { sw: o.scrollWidth, cw: o.clientWidth }; });
    assert.ok(m.sw <= m.cw + 1, JSON.stringify([vp, m]));
    if (vp.width === 820) await shot(p, 'dashboard-tablet');
    if (vp.height === 2300) await shot(p, 'dashboard-desktop-full');
    await ctx.close();
  }
});

test('le tableau de bord n’envoie aucune écriture sur le site (lecture seule hors simulation) et n’appelle que /api/admin/stats/*', async () => {
  const { ctx, p } = await open();
  await openDash(p);
  await p.click('.vst-chip:text-is("7 jours")');
  await p.waitForTimeout(300);
  const api = requested.filter((x) => x.startsWith('/api/')).filter((x) => !/^\/api\/(site\/content|admin\/auth\/session|mail\/status|admin\/site\/content)$/.test(x));
  assert.ok(api.every((x) => x.startsWith('/api/admin/stats/') || x === '/api/preview/login-code'), JSON.stringify([...new Set(api)]));
  await ctx.close();
});
