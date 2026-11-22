'use strict';

// STATISTIQUES admin read API (production): admin-only, read-only, honest when the collection is off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, testConfig, ADMIN } = require('./helpers');
const { dayOf } = require('../src/stats');
const { registerStatsAdminRoutes, categoryLabels, RAW_RETENTION_DAYS, DAILY_RETENTION_MONTHS } = require('../src/stats-admin');

const NOW = Date.UTC(2026, 10, 21, 10, 0, 0);
const TODAY = dayOf(NOW);

function fakeApp() {
  const routes = {};
  return { routes, get: (url, opt, fn) => { routes['GET ' + url] = { opt, fn }; }, post: (url, opt, fn) => { routes['POST ' + url] = { opt, fn }; } };
}
function reply() {
  const r = { headers: {}, code: 200, header(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return b; } };
  r.code = function (c) { r.statusCode = c; return r; };
  return r;
}
const requireAdmin = () => {};

test('routes: exactly two GET routes, both behind requireAdmin, nothing else registered', () => {
  const s = setup({ config: testConfig() });
  const app = fakeApp();
  assert.ok(registerStatsAdminRoutes(app, { config: s.cfg, db: s.db, requireAdmin, now: () => NOW }));
  assert.deepEqual(Object.keys(app.routes).sort(), ['GET /api/admin/stats/overview', 'GET /api/admin/stats/status']);
  for (const r of Object.values(app.routes)) assert.equal(r.opt.preHandler, requireAdmin);
});

test('status: collection flag, today, first day, retention; no-store', async () => {
  const s = setup({ config: testConfig({ statsEnabled: false }) });
  const app = fakeApp();
  registerStatsAdminRoutes(app, { config: s.cfg, db: s.db, requireAdmin, now: () => NOW });
  const r = reply();
  const j = await app.routes['GET /api/admin/stats/status'].fn({}, r);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.deepEqual({ ...j, retention: undefined }, { ok: true, mode: 'live', collectionEnabled: false, today: TODAY, firstDay: null, retention: undefined });
  assert.deepEqual(j.retention, { rawDays: RAW_RETENTION_DAYS, dailyMonths: DAILY_RETENTION_MONTHS });
  assert.equal(RAW_RETENTION_DAYS, 90);
  assert.equal(DAILY_RETENTION_MONTHS, 25);
});

test('overview with the collection off: zeros, collectionEnabled=false, quotes still counted from the quotes table, nothing written', async () => {
  const s = setup({ config: testConfig({ statsEnabled: false }) });
  const ins = s.db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get('quotes');
  assert.ok(ins, 'quotes table exists');
  const cols = s.db.prepare("PRAGMA table_info('quotes')").all();
  const names = cols.map((c) => c.name);
  assert.ok(names.includes('created_at') && names.includes('status'));
  const snap = () => ['quotes', 'stats_daily', 'stats_events', 'kv'].map((t) => s.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
  const before = snap();
  const app = fakeApp();
  registerStatsAdminRoutes(app, { config: s.cfg, db: s.db, requireAdmin, now: () => NOW });
  const get = (q) => app.routes['GET /api/admin/stats/overview'].fn({ query: q }, reply());
  const j = await get({ range: '30d' });
  assert.equal(j.ok, true);
  assert.equal(j.mode, 'live');
  assert.equal(j.simulated, undefined, 'no simulated flag in production');
  assert.equal(j.collectionEnabled, false);
  assert.equal(j.totals.sessions, 0);
  assert.equal(j.range.days, 30);
  assert.equal(j.conversion.rate, null);
  assert.deepEqual(snap(), before, 'read only');
  const r = reply();
  const bad = await app.routes['GET /api/admin/stats/overview'].fn({ query: { range: 'custom', from: '2026-02-30', to: '2026-03-01' } }, r);
  assert.equal(r.statusCode, 400);
  assert.equal(bad.error, 'bad_range');
  const r2 = reply();
  await app.routes['GET /api/admin/stats/overview'].fn({ query: { range: 'forever' } }, r2);
  assert.equal(r2.statusCode, 400);
});

test('overview reads real events (stats_events today) and sent quotes from the quotes table', async () => {
  const s = setup({ config: testConfig({ statsEnabled: true }) });
  const at = NOW - 60 * 1000;
  const ev = s.db.prepare('INSERT INTO stats_events (at, day, sid, vkey, type, target, device) VALUES (?, ?, ?, ?, ?, ?, ?)');
  ev.run(at, TODAY, 'sid-0001', 'vkey-0001', 'view', '', 'mobile');
  ev.run(at, TODAY, 'sid-0001', 'vkey-0001', 'form_open', '', 'mobile');
  ev.run(at, TODAY, 'sid-0001', 'vkey-0001', 'category_view', 'bureaux', 'mobile');
  ev.run(at, TODAY, 'sid-0002', 'vkey-0002', 'view', '', 'desktop');
  ev.run(at, TODAY, 'sid-0002', 'vkey-0002', 'phone_click', '', 'desktop');
  ev.run(at, TODAY, 'sid-0002', 'vkey-0002', 'category_view', 'zz-junk', 'desktop');
  const q = s.db.prepare("INSERT INTO quotes (id, submission_id, status, payload, photo_count, attempts, mails_sent, last_error, created_at, sent_at) VALUES (?, ?, ?, '{}', 0, 1, ?, NULL, ?, ?)");
  q.run('q-sent-1', 'q-sent-1', 'sent', 1, at, at);
  q.run('q-pending', 'q-pending', 'pending', 0, at, null);
  q.run('q-failed', 'q-failed', 'mail_failed', 0, at, null);
  const app = fakeApp();
  registerStatsAdminRoutes(app, { config: s.cfg, db: s.db, requireAdmin, now: () => NOW });
  const j = await app.routes['GET /api/admin/stats/overview'].fn({ query: { range: 'today' } }, reply());
  assert.equal(j.collectionEnabled, true);
  assert.equal(j.totals.sessions, 2);
  assert.equal(j.totals.visitors, 2);
  assert.deepEqual({ created: j.quotes.created, sent: j.quotes.sent, failed: j.quotes.failed }, { created: 3, sent: 1, failed: 1 }, 'only status=sent counts as a sent quote');
  assert.equal(j.conversion.numerator, 1);
  assert.equal(j.interactions.formOpens, 1);
  assert.equal(j.interactions.phoneClicks, 1);
  assert.deepEqual(j.categories.map((c) => c.id), ['bureaux']);
  assert.equal(j.categoriesOthersViews, 1, 'unknown targets are folded into "Autres"');
  const st = await app.routes['GET /api/admin/stats/status'].fn({}, reply());
  assert.equal(st.firstDay, TODAY);
});

test('categoryLabels: shipped categories, overridden by the published ones, tolerant of junk', () => {
  const s = setup({ config: testConfig() });
  const m = categoryLabels(s.db, () => NOW);
  assert.equal(m.get('bureaux'), 'Bureaux');
  s.db.prepare("INSERT INTO site_content (section, value, version, updated_at) VALUES ('categories', ?, 1, ?)")
    .run(JSON.stringify({ items: [{ id: 'bureaux', label: 'Bureaux & co' }, { id: 7, label: 'x' }, null, { id: 'regies', label: 'Régies' }] }), NOW);
  const m2 = categoryLabels(s.db, () => NOW);
  assert.equal(m2.get('bureaux'), 'Bureaux & co');
  assert.equal(m2.get('regies'), 'Régies');
  assert.equal(m2.size, m.size + 1);
});

test('the module only reads: no INSERT/UPDATE/DELETE and no network code', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'stats-admin.js'), 'utf8');
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|REPLACE)\b\s/i);
  assert.doesNotMatch(src, /fetch\(|require\('node:(https?|net|tls|dns)'\)|googleapis|nodemailer/);
  assert.doesNotMatch(src, /\bapp\.(post|put|patch|delete)\(/);
});

// ---------------------------------------------------------------- real Fastify stack (CI)
let fastifyAvailable = true;
try { require.resolve('fastify'); require.resolve('@fastify/cookie'); } catch (_) { fastifyAvailable = false; }
const opts = { skip: fastifyAvailable ? false : 'fastify not installed in this environment' };
const ORIGIN = 'https://devis.test';

test('Fastify (production mode): stats read routes answer 401 without a session, 200 with one, and nothing is public', opts, async () => {
  const { buildApp } = require('../src/app');
  const s = setup({ config: testConfig() });
  const { app, auth } = await buildApp({ config: s.cfg, db: s.db, mailer: s.mailer, keys: s.keys, logger: false });
  await app.ready();
  const call = (method, url, payload, headers = {}) => app.inject({ method, url, payload, headers: { origin: ORIGIN, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } });
  for (const u of ['/api/admin/stats/status', '/api/admin/stats/overview', '/api/admin/stats/overview?range=7d']) {
    assert.equal((await call('GET', u)).statusCode, 401, u);
  }
  assert.equal((await call('GET', '/api/admin/stats/overview', undefined, { cookie: 'vectis_admin=forged' })).statusCode, 401);
  for (const u of ['/api/preview/info', '/api/preview/login-code']) assert.equal((await call('GET', u)).statusCode, 404, u);
  for (const u of ['/api/admin/stats/demo/simulate', '/api/admin/stats/demo/reset']) assert.equal((await call('POST', u, {})).statusCode, 404, u + ' does not exist');
  await call('POST', '/api/admin/auth/request', { email: ADMIN });
  await auth.idle();
  const code = s.mailer.sent && s.mailer.sent.length ? s.mailer.sent[s.mailer.sent.length - 1].code : null;
  assert.ok(code, 'FakeMailer received the login code');
  const res = await call('POST', '/api/admin/auth/verify', { email: ADMIN, code });
  const ck = res.cookies.find((x) => /vectis_admin/.test(x.name));
  const cookie = `${ck.name}=${ck.value}`;
  const st = await call('GET', '/api/admin/stats/status', undefined, { cookie });
  assert.equal(st.statusCode, 200);
  assert.equal(st.headers['cache-control'], 'no-store');
  assert.equal(st.json().collectionEnabled, false);
  const ov = await call('GET', '/api/admin/stats/overview?range=30d', undefined, { cookie });
  assert.equal(ov.statusCode, 200);
  assert.equal(ov.json().mode, 'live');
  assert.equal((await call('GET', '/api/admin/stats/overview?range=custom&from=bad&to=bad', undefined, { cookie })).statusCode, 400);
  await app.close();
});
