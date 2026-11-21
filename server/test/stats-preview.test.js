'use strict';

// STATISTIQUES preview: seed, report builder, simulator (real collector), isolation guards, admin-only routes (CI).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, testConfig, ADMIN } = require('./helpers');
const { loadConfig, assertRunnable } = require('../src/config');
const { dayOf } = require('../src/stats');
const { buildReport, resolveRange, BUILTIN_CATEGORIES, addDays, daysBetween } = require('../src/stats-report');
const { registerPreviewRoutes, PreviewMailer, ensureSeed, simulate, resetDemo, demoDay, HISTORY_DAYS, split } = require('../src/stats-preview');

const NOW = Date.UTC(2026, 10, 21, 10, 0, 0);   // 21 Nov 2026, 11:00 Paris
const TODAY = dayOf(NOW);
const labels = () => new Map(BUILTIN_CATEGORIES);

function seeded(extra = {}) {
  const s = setup({ config: testConfig({ previewMode: true, ...extra }) });
  ensureSeed(s.db, s.cfg, NOW);
  return s;
}
const report = (s, range, o = {}) => buildReport(s.db, resolveRange({ range, ...o }, TODAY), { today: TODAY, labels: labels() });
const count = (db, sql, ...a) => db.prepare(sql).get(...a).n;

test('split() distributes integers exactly', () => {
  for (const [t, w] of [[0, [1, 2]], [7, [1, 1, 1]], [100, [58, 35, 7]], [5, [0.1, 0.1, 0.8]], [13, [9, 5, 8, 11]]]) {
    const out = split(t, w);
    assert.equal(out.reduce((a, b) => a + b, 0), t);
    assert.ok(out.every((x) => Number.isInteger(x) && x >= 0));
  }
});

test('demo history is deterministic and respects the stats_daily invariants', () => {
  const a = demoDay('2026-10-01', TODAY); const b = demoDay('2026-10-01', TODAY);
  assert.deepEqual(a.rows, b.rows);
  assert.equal(a.quotes.created >= a.quotes.sent, true);
  for (const r of a.rows) {
    assert.ok(r.visitors <= r.sessions && r.sessions <= r.events, JSON.stringify(r));
    assert.ok(['view', 'category_view', 'gallery_open', 'form_open', 'form_start', 'phone_click', 'email_click', '*'].includes(r.type));
  }
  // totals row = sum of its type rows (events), views = sessions
  for (const dev of ['mobile', 'desktop', 'tablet']) {
    const rows = a.rows.filter((r) => r.device === dev);
    if (!rows.length) continue;
    const tot = rows.find((r) => r.type === '*');
    assert.equal(tot.events, rows.filter((r) => r.type !== '*').reduce((s, r) => s + r.events, 0));
    assert.equal(tot.sessions, rows.find((r) => r.type === 'view').events);
  }
});

test('seed: 90 closed days in stats_daily, demo quotes only, today through the real collector, idempotent', () => {
  const s = seeded();
  assert.equal(count(s.db, "SELECT COUNT(DISTINCT day) n FROM stats_daily"), HISTORY_DAYS);
  assert.equal(count(s.db, "SELECT COUNT(*) n FROM stats_daily WHERE day >= ?", TODAY), 0, 'today is never pre-aggregated');
  assert.ok(count(s.db, 'SELECT COUNT(*) n FROM stats_events WHERE day = ?', TODAY) > 20, 'today has live events');
  assert.ok(count(s.db, 'SELECT COUNT(*) n FROM quotes') > 100);
  assert.equal(count(s.db, "SELECT COUNT(*) n FROM quotes WHERE id NOT LIKE 'demo-%' OR payload NOT LIKE '%\"demo\":true%'"), 0, 'only labelled demo quotes');
  const before = [count(s.db, 'SELECT COUNT(*) n FROM stats_daily'), count(s.db, 'SELECT COUNT(*) n FROM stats_events'), count(s.db, 'SELECT COUNT(*) n FROM quotes')];
  assert.equal(ensureSeed(s.db, s.cfg, NOW), false);
  assert.deepEqual([count(s.db, 'SELECT COUNT(*) n FROM stats_daily'), count(s.db, 'SELECT COUNT(*) n FROM stats_events'), count(s.db, 'SELECT COUNT(*) n FROM quotes')], before);
  // next day: only the new day is added
  const tomorrow = NOW + 24 * 3600 * 1000;
  assert.equal(ensureSeed(s.db, s.cfg, tomorrow), true);
  assert.equal(count(s.db, 'SELECT COUNT(*) n FROM stats_daily WHERE day = ?', TODAY) > 0, true);
});

test('seed: no real address anywhere (events carry no IP, user-agent or visitor identity beyond the pseudonymous key)', () => {
  const s = seeded();
  const cols = s.db.prepare("PRAGMA table_info('stats_events')").all().map((c) => c.name);
  assert.deepEqual(cols, ['id', 'at', 'day', 'sid', 'vkey', 'type', 'target', 'device']);
  const dump = JSON.stringify(s.db.prepare('SELECT * FROM stats_events').all()) + JSON.stringify(s.db.prepare("SELECT value FROM kv WHERE key NOT LIKE 'stats:salt:%'").all());
  assert.doesNotMatch(dump, /192\.0\.2\.|198\.51\.100\.|203\.0\.113\./);
});

test('report: totals are the sum of the days, shares add up, funnel and conversion are consistent', () => {
  const s = seeded();
  const r = report(s, '30d');
  assert.equal(r.range.days, 30);
  assert.equal(r.daily.length, 30);
  assert.equal(r.totals.visitors, r.daily.reduce((a, d) => a + d.visitors, 0));
  assert.equal(r.totals.sessions, r.daily.reduce((a, d) => a + d.sessions, 0));
  assert.equal(r.totals.views, r.totals.sessions, 'one view per session: page views are not collected');
  assert.ok(r.totals.visitors > 0 && r.totals.sessions >= r.totals.visitors);
  assert.ok(Math.abs(r.devices.reduce((a, d) => a + d.sharePct, 0) - 100) < 0.5);
  assert.deepEqual(r.devices.map((d) => d.device), ['mobile', 'desktop', 'tablet']);
  const f = Object.fromEntries(r.funnel.map((x) => [x.key, x.value]));
  assert.equal(f.visitors, r.totals.visitors);
  assert.equal(f.sessions, r.totals.sessions);
  assert.ok(f.sessions >= f.form_open && f.form_open >= f.form_start && f.form_start >= f.quote_created && f.quote_created >= f.quote_sent, JSON.stringify(f));
  assert.equal(r.conversion.numerator, f.quote_sent);
  assert.equal(r.conversion.denominator, f.sessions);
  assert.equal(r.conversion.rate, Math.round((f.quote_sent / f.sessions) * 1000) / 10);
  assert.equal(r.quotes.created, r.daily.reduce((a, d) => a + d.quotes, 0));
  assert.deepEqual(r.notMeasured.map((x) => x.key), ['new_vs_returning', 'origin', 'form_submit_click']);
  assert.equal(r.simulated, undefined, 'the flag is added by the route, not by the builder');
});

test('report: previous period has the same length and deltas compare the two', () => {
  const s = seeded();
  const r = report(s, '7d');
  assert.equal(r.previous.to, addDays(r.range.from, -1));
  assert.equal(daysBetween(r.previous.from, r.previous.to), 7);
  assert.equal(r.previousDaily.length, 7);
  const exp = Math.round(((r.totals.sessions - r.previousTotals.sessions) / r.previousTotals.sessions) * 1000) / 10;
  assert.equal(r.deltas.sessions, exp);
});

test('report: unknown targets never appear (counted in "autres"), categories are known ids only', () => {
  const s = seeded();
  const day = addDays(TODAY, -3);
  s.db.prepare("INSERT INTO stats_daily (day, type, target, device, events, sessions, visitors, updated_at) VALUES (?, 'category_view', 'zz-junk', 'mobile', 9, 9, 3, 1)").run(day);
  const r = report(s, '7d');
  assert.ok(r.categories.every((c) => labels().has(c.id)));
  assert.ok(!JSON.stringify(r.categories).includes('zz-junk'));
  assert.ok(r.categoriesOthersViews >= 9);
  assert.ok(r.categories.length > 0 && r.categories[0].views >= r.categories[r.categories.length - 1].views, 'sorted by views');
});

test('report: custom range, today and invalid ranges', () => {
  const s = seeded();
  const t = report(s, 'today');
  assert.equal(t.range.days, 1);
  assert.ok(t.totals.sessions > 0, 'today comes from live events');
  const c = report(s, 'custom', { from: addDays(TODAY, -10), to: addDays(TODAY, -4) });
  assert.equal(c.range.days, 7);
  for (const bad of [{ range: 'custom', from: '2026-13-01', to: '2026-13-02' }, { range: 'custom', from: TODAY, to: addDays(TODAY, -2) },
    { range: 'custom', from: '2020-01-01', to: TODAY }, { range: 'nope' }, { range: 'custom', from: addDays(TODAY, 2), to: addDays(TODAY, 5) }]) {
    assert.ok(resolveRange(bad, TODAY).error, JSON.stringify(bad));
  }
  assert.equal(resolveRange({ range: 'custom', from: addDays(TODAY, -2), to: addDays(TODAY, 9) }, TODAY).to, TODAY, 'future end is clamped');
});

test('report reads only: no write to quotes, stats_daily or stats_events', () => {
  const s = seeded();
  const snap = () => [count(s.db, 'SELECT COUNT(*) n FROM quotes'), count(s.db, 'SELECT COUNT(*) n FROM stats_daily'), count(s.db, 'SELECT COUNT(*) n FROM stats_events')];
  const before = snap();
  report(s, '90d'); report(s, 'today');
  assert.deepEqual(snap(), before);
});

test('simulator: goes through the real collector; device, journey and returning visitors are honoured', () => {
  const s = seeded();
  const base = report(s, 'today');
  const q0 = count(s.db, 'SELECT COUNT(*) n FROM quotes');
  const res = simulate(s.db, s.cfg, { journey: 'quote', device: 'tablet', visitorType: 'new', count: 5 }, NOW);
  assert.equal(res.journeys, 5);
  assert.equal(res.quotes, 5);
  assert.equal(count(s.db, 'SELECT COUNT(*) n FROM quotes'), q0 + 5);
  const after = report(s, 'today');
  const tab = (r) => r.devices.find((d) => d.device === 'tablet').sessions;
  assert.equal(tab(after) - tab(base), 5);
  assert.ok(after.interactions.formStarts - base.interactions.formStarts >= 5);
  // returning visitors: same pseudonymous key, a second session 35 minutes later
  const before = report(s, 'today');
  simulate(s.db, s.cfg, { journey: 'view', device: 'desktop', visitorType: 'returning', count: 6 }, NOW);
  const r = report(s, 'today');
  const dS = r.totals.sessions - before.totals.sessions; const dV = r.totals.visitors - before.totals.visitors;
  assert.ok(dS > dV, `sessions grow faster than visitors for returning visitors (${dS} > ${dV})`);
});

test('simulator: returning visitors keep both sessions on the same Paris day, even right after midnight', () => {
  for (const at of [Date.UTC(2026, 10, 21, 23, 10), Date.UTC(2026, 10, 21, 22, 59), Date.UTC(2026, 10, 21, 22, 40), Date.UTC(2026, 10, 21, 12, 0)]) {
    const s = setup({ config: testConfig({ previewMode: true }) });
    const today = dayOf(at);
    const rep = () => buildReport(s.db, resolveRange({ range: 'today' }, today), { today, labels: labels() }).totals;
    const b = rep();
    simulate(s.db, s.cfg, { journey: 'view', device: 'desktop', visitorType: 'returning', count: 4 }, at);
    const a = rep();
    assert.equal(a.sessions - b.sessions, 8, new Date(at).toISOString());
    assert.equal(a.visitors - b.visitors, 4, new Date(at).toISOString());
    assert.equal(count(s.db, 'SELECT COUNT(DISTINCT day) n FROM stats_events'), 1, 'one Paris day only');
  }
});

test('simulator: bounded and uses documentation addresses only (nothing is stored)', () => {
  const s = seeded();
  const res = simulate(s.db, s.cfg, { journey: 'view', count: 9999 }, NOW);
  assert.equal(res.journeys, 50);
  assert.equal(count(s.db, "SELECT COUNT(*) n FROM sqlite_master WHERE sql LIKE '%ip%' AND name = 'stats_events'"), 0);
});

test('reset removes only demo data and re-seeds', () => {
  const s = seeded();
  s.db.prepare("INSERT INTO quotes (id, submission_id, status, payload, created_at) VALUES ('real-1', 'real-1', 'sent', '{}', 1)").run();
  resetDemo(s.db);
  assert.equal(count(s.db, 'SELECT COUNT(*) n FROM stats_daily'), 0);
  assert.equal(count(s.db, "SELECT COUNT(*) n FROM quotes WHERE id LIKE 'demo-%'"), 0);
  assert.equal(count(s.db, "SELECT COUNT(*) n FROM quotes WHERE id = 'real-1'"), 1, 'non-demo rows are never touched');
  ensureSeed(s.db, s.cfg, NOW);
  assert.equal(count(s.db, 'SELECT COUNT(DISTINCT day) n FROM stats_daily'), HISTORY_DAYS);
});

test('production isolation: preview routes do not exist without PREVIEW_MODE', () => {
  const calls = [];
  const app = { get: (...a) => calls.push(a), post: (...a) => calls.push(a) };
  const s = setup({ config: testConfig() });
  assert.equal(s.cfg.previewMode, false);
  assert.equal(registerPreviewRoutes(app, { config: s.cfg, db: s.db, requireAdmin() {}, mailer: null }), null);
  assert.equal(calls.length, 0);
  assert.equal(loadConfig({}).previewMode, false);
  for (const v of ['', '0', 'false', 'no', 'off']) assert.equal(loadConfig({ PREVIEW_MODE: v }).previewMode, false, v);
  assert.equal(loadConfig({ PREVIEW_MODE: '1' }).previewMode, true);
});

test('production isolation: PREVIEW_MODE refuses the production origin, Google credentials, mail setup token and STATS_ENABLED', () => {
  const base = { SESSION_SECRET: 'x'.repeat(40), ADMIN_EMAILS: 'a@b.co', PUBLIC_ORIGIN: 'https://preview-stats.mrprop.fr', COOKIE_SECURE: 'true', PREVIEW_MODE: '1' };
  assert.doesNotThrow(() => assertRunnable(loadConfig(base)));
  for (const [k, v] of [['PUBLIC_ORIGIN', 'https://devis.mrprop.fr'], ['PUBLIC_ORIGIN', 'https://DEVIS.mrprop.fr'], ['GOOGLE_CLIENT_ID', 'id'], ['GOOGLE_CLIENT_SECRET', 'sec'], ['MAIL_SETUP_TOKEN', 'y'.repeat(30)], ['STATS_ENABLED', '1']]) {
    assert.throws(() => assertRunnable(loadConfig({ ...base, [k]: v })), /PREVIEW_MODE/, `${k}=${v}`);
  }
  // production config is unchanged: the default origin is still accepted when PREVIEW_MODE is off
  assert.doesNotThrow(() => assertRunnable(loadConfig({ ...base, PREVIEW_MODE: '', PUBLIC_ORIGIN: 'https://devis.mrprop.fr' })));
});

test('PreviewMailer never sends anything: it keeps the last login code in memory and refuses OAuth', async () => {
  const m = new PreviewMailer();
  assert.equal(m.ready(), true);
  await m.sendLoginCode({ to: ADMIN, code: '123456', ttlMinutes: 10 });
  assert.equal(m.last.code, '123456');
  const q = await m.sendQuote({ to: 'client@example.com' });
  assert.equal(q.id, 'preview');
  await assert.rejects(() => m.startOAuthFlow(), (e) => e.code === 'preview_mail_disabled');
  await assert.rejects(() => m.completeOAuthFlow(), (e) => e.code === 'preview_mail_disabled');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'stats-preview.js'), 'utf8');
  assert.doesNotMatch(src, /googleapis|nodemailer|require\('node:(https?|net|tls|dns)'\)|fetch\(/, 'no network code in the preview module');
});

test('category list in stats-report.js matches the builtin categories of index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const block = html.slice(html.indexOf('var CATEGORIES=['), html.indexOf('];', html.indexOf('var CATEGORIES=[')));
  const ids = [...block.matchAll(/\{id:'([a-z0-9-]+)',label:'([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(BUILTIN_CATEGORIES, ids);
});

// ---------------------------------------------------------------- real Fastify stack (CI)

let fastifyAvailable = true;
try { require.resolve('fastify'); require.resolve('@fastify/cookie'); } catch (_) { fastifyAvailable = false; }
const opts = { skip: fastifyAvailable ? false : 'fastify not installed in this environment' };
const ORIGIN = 'https://devis.test';

async function boot(cfg) {
  const { buildApp } = require('../src/app');
  const s = setup({ config: testConfig(cfg), mailer: cfg && cfg.previewMode ? new PreviewMailer() : undefined });
  const { app, auth } = await buildApp({ config: s.cfg, db: s.db, mailer: s.mailer, keys: s.keys, logger: false });
  await app.ready();
  const call = (method, url, payload, headers = {}) => app.inject({
    method, url, payload, headers: { origin: ORIGIN, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
  });
  const login = async () => {
    await call('POST', '/api/admin/auth/request', { email: ADMIN });
    await auth.idle();
    const code = (await call('GET', '/api/preview/login-code')).json().code;
    const res = await call('POST', '/api/admin/auth/verify', { email: ADMIN, code });
    const ck = res.cookies.find((x) => /vectis_admin/.test(x.name));
    return { cookie: `${ck.name}=${ck.value}`, csrf: res.json().csrfToken };
  };
  return { app, call, login, ...s };
}

test('Fastify: without PREVIEW_MODE (production) none of the preview/demo routes exist', opts, async () => {
  const { app, call } = await boot({});
  for (const [m, u] of [['GET', '/api/preview/info'], ['GET', '/api/preview/login-code'], ['POST', '/api/admin/stats/demo/simulate'], ['POST', '/api/admin/stats/demo/reset']]) {
    const r = await call(m, u, m === 'POST' ? {} : undefined);
    assert.equal(r.statusCode, 404, `${m} ${u}`);
  }
  await app.close();
});

test('Fastify preview: statistics are admin-only; the demo works end to end; no e-mail is sent', opts, async () => {
  const { app, call, login, db, mailer } = await boot({ previewMode: true });
  for (const [m, u] of [['GET', '/api/admin/stats/status'], ['GET', '/api/admin/stats/overview'], ['POST', '/api/admin/stats/demo/simulate'], ['POST', '/api/admin/stats/demo/reset']]) {
    const r = await call(m, u, m === 'POST' ? {} : undefined);
    assert.equal(r.statusCode, 401, `${m} ${u} must require a session`);
  }
  const { cookie, csrf } = await login();
  const auth = { cookie, 'x-csrf-token': csrf };
  const st = (await call('GET', '/api/admin/stats/status', undefined, { cookie })).json();
  assert.equal(st.simulated, true);
  const ov = await call('GET', '/api/admin/stats/overview?range=30d', undefined, { cookie });
  assert.equal(ov.statusCode, 200);
  const j = ov.json();
  assert.equal(j.simulated, true);
  assert.equal(j.range.days, 30);
  assert.ok(j.totals.sessions > 0);
  assert.equal((await call('GET', '/api/admin/stats/overview?range=custom&from=2026-02-30&to=2026-03-01', undefined, { cookie })).statusCode, 400);
  const before = j.totals.sessions;
  assert.equal((await call('POST', '/api/admin/stats/demo/simulate', { journey: 'quote', device: 'mobile', count: 3 }, { cookie })).statusCode, 403, 'CSRF required');
  const sim = await call('POST', '/api/admin/stats/demo/simulate', { journey: 'quote', device: 'mobile', count: 3 }, auth);
  assert.equal(sim.statusCode, 200);
  assert.equal((await call('POST', '/api/admin/stats/demo/simulate', { journey: 'quote', count: 3, extra: 1 }, auth)).statusCode, 400);
  const after = (await call('GET', '/api/admin/stats/overview?range=30d', undefined, { cookie })).json();
  // 30 % of the mixed visitors are « returning » and open two sessions: compare with what the simulator reports, not with a fixed 3.
  assert.ok(sim.json().sessions >= 3);
  assert.equal(after.totals.sessions, before + sim.json().sessions);
  assert.equal(mailer.quotes, 0, 'no quote e-mail');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM quotes WHERE id NOT LIKE 'demo-%'").get().n, 0);
  await app.close();
});
