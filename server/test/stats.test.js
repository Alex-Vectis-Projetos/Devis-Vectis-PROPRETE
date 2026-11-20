'use strict';

// STATISTIQUES, step 1 (collection only). Core logic is tested with the same minimal Fastify stand-in as quotes.test.js;
// the real Fastify stack is exercised at the end (CI).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup, testConfig } = require('./helpers');
const { loadConfig } = require('../src/config');
const { StatsCollector, registerStatsRoutes, deviceOf, dayOf, SESSION_GAP_MS, QUEUE_MAX } = require('../src/stats');
const { registerQuoteRoutes } = require('../src/quotes');
const { AuthService } = require('../src/auth');

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MS = 60 * 1000;
const T0 = Date.UTC(2026, 10, 20, 10, 0, 0);   // 20 Nov 2026 11:00 in Paris

function mk({ cfg = {}, auth = null, start = T0 } = {}) {
  const s = setup({ config: testConfig({ statsEnabled: true, statsFlushMs: 0, ...cfg }) });
  const clock = { t: start };
  const logs = [];
  const c = new StatsCollector({ db: s.db, config: s.cfg, auth, now: () => clock.t, log: (o) => logs.push(o) });
  return { ...s, c, clock, logs };
}
const req = (body, { ip = '203.0.113.7', ua = DESKTOP_UA, headers = {}, cookies } = {}) => ({
  body, ip, cookies, headers: { 'sec-fetch-site': 'same-origin', 'user-agent': ua, ...headers },
});
const view = (o) => req({ t: 'view' }, o);
const rows = (db) => db.prepare('SELECT * FROM stats_events ORDER BY id').all();
const tick = () => new Promise((r) => setImmediate(r));

// ---------------------------------------------------------------- schema

test('migration 5: schema version, tables, indexes, primary keys, NOT NULL', () => {
  const { db } = setup();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  const info = (t) => Object.fromEntries(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => [c.name, c]));
  const ev = info('stats_events');
  assert.deepEqual(Object.keys(ev), ['id', 'at', 'day', 'sid', 'vkey', 'type', 'target', 'device']);
  for (const k of ['at', 'day', 'sid', 'vkey', 'type', 'target', 'device']) assert.equal(ev[k].notnull, 1, k + ' NOT NULL');
  assert.equal(ev.id.pk, 1);
  assert.equal(ev.target.dflt_value, "''");
  const daily = info('stats_daily');
  assert.deepEqual(Object.keys(daily), ['day', 'type', 'target', 'device', 'events', 'sessions', 'visitors', 'updated_at']);
  for (const k of Object.keys(daily)) assert.equal(daily[k].notnull, 1, k + ' NOT NULL');
  assert.deepEqual(Object.values(daily).filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name), ['day', 'type', 'target', 'device']);
  const idx = db.prepare("PRAGMA index_list('stats_events')").all();
  const uq = idx.find((i) => i.name === 'uq_stats_events_session');
  assert.equal(uq.unique, 1);
  assert.deepEqual(db.prepare("PRAGMA index_info('uq_stats_events_session')").all().map((c) => c.name), ['sid', 'type', 'target']);
  assert.ok(idx.some((i) => i.name === 'idx_stats_events_day') && idx.some((i) => i.name === 'idx_stats_events_at'));
});

test('migration 5: constraints reject NULL targets, wrong types/devices, inconsistent targets and duplicates', () => {
  const { db } = setup();
  const ins = (o = {}) => {
    const r = { at: T0, day: '2026-11-20', sid: 'sid-12345678', vkey: 'vkey-1234567', type: 'view', target: '', device: 'desktop', ...o };
    return db.prepare('INSERT INTO stats_events (at, day, sid, vkey, type, target, device) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.at, r.day, r.sid, r.vkey, r.type, r.target, r.device);
  };
  ins();
  assert.throws(() => ins({ target: null }), /NOT NULL/);                       // NULL can never reach the unique index
  assert.throws(() => ins(), /UNIQUE/);                                          // same (sid, type, '') twice
  assert.throws(() => ins({ type: 'hack' }), /CHECK/);
  assert.throws(() => ins({ device: 'tv', sid: 'sid-other-1' }), /CHECK/);
  assert.throws(() => ins({ type: 'category_view', target: '', sid: 'sid-other-2' }), /CHECK/);   // targeted type needs a target
  assert.throws(() => ins({ type: 'form_open', target: 'x', sid: 'sid-other-3' }), /CHECK/);      // other types must have none
  assert.throws(() => ins({ day: '20-11-2026', sid: 'sid-other-4' }), /CHECK/);
  ins({ type: 'category_view', target: 'pharmacie', sid: 'sid-other-5' });
  ins({ type: 'category_view', target: 'airbnb', sid: 'sid-other-5' });          // same session, other target: allowed
  assert.throws(() => ins({ type: 'category_view', target: 'airbnb', sid: 'sid-other-5' }), /UNIQUE/);
});

test('migration 5: stats_daily keeps integrity (PK, totals, invariants) and supports the planned roll-up', () => {
  const s = mk();
  // realistic traffic through the collector: 40 visitors over two devices, several event types
  for (let i = 0; i < 40; i++) {
    const o = { ip: '198.51.100.' + i, ua: i % 3 === 0 ? IPHONE_UA : DESKTOP_UA };
    s.c.ingest(view(o));
    if (i % 2 === 0) s.c.ingest(req({ t: 'category_view', g: i % 4 === 0 ? 'pharmacie' : 'airbnb' }, o));
    if (i % 5 === 0) s.c.ingest(req({ t: 'form_open' }, o));
    s.clock.t += 1000;
  }
  s.c.flush();
  while (s.c.queue.length) s.c.flush();
  // the roll-up planned for step 7 (documented here to prove the schema is final)
  const day = '2026-11-20';
  s.db.prepare(`INSERT OR REPLACE INTO stats_daily (day, type, target, device, events, sessions, visitors, updated_at)
    SELECT day, type, target, device, COUNT(*), COUNT(DISTINCT sid), COUNT(DISTINCT vkey), ? FROM stats_events WHERE day = ? GROUP BY day, type, target, device`).run(T0, day);
  s.db.prepare(`INSERT OR REPLACE INTO stats_daily (day, type, target, device, events, sessions, visitors, updated_at)
    SELECT day, '*', '', device, COUNT(*), COUNT(DISTINCT sid), COUNT(DISTINCT vkey), ? FROM stats_events WHERE day = ? GROUP BY day, device`).run(T0, day);
  const total = s.db.prepare("SELECT SUM(events) e, SUM(sessions) s, SUM(visitors) v FROM stats_daily WHERE type = '*'").get();
  const raw = s.db.prepare('SELECT COUNT(*) e, COUNT(DISTINCT sid) s, COUNT(DISTINCT vkey) v FROM stats_events').get();
  assert.deepEqual({ e: total.e, s: total.s, v: total.v }, { e: raw.e, s: raw.s, v: raw.v });   // additive across devices
  assert.equal(raw.v, 40);
  // re-running the roll-up is idempotent (primary key), and the CHECKs refuse nonsense
  s.db.prepare(`INSERT OR REPLACE INTO stats_daily (day, type, target, device, events, sessions, visitors, updated_at)
    SELECT day, '*', '', device, COUNT(*), COUNT(DISTINCT sid), COUNT(DISTINCT vkey), ? FROM stats_events WHERE day = ? GROUP BY day, device`).run(T0, day);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM stats_daily WHERE type = '*'").get().n, 2);
  const bad = (o) => s.db.prepare('INSERT INTO stats_daily (day, type, target, device, events, sessions, visitors, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(...Object.values({ day: '2026-11-21', type: 'view', target: '', device: 'mobile', events: 3, sessions: 2, visitors: 1, updated_at: 1, ...o }));
  bad({});
  assert.throws(() => bad({}), /UNIQUE|PRIMARY/);
  assert.throws(() => bad({ target: null, device: 'tablet' }), /NOT NULL/);
  assert.throws(() => bad({ visitors: 5, device: 'tablet' }), /CHECK/);
  assert.throws(() => bad({ sessions: 9, device: 'tablet' }), /CHECK/);
});

test('migration 5 on an existing version-4 database keeps every row (quotes, content, kv) untouched', () => {
  const { memoryDb } = require('./helpers');
  const { MIGRATIONS, migrate } = require('../src/db');
  const db = memoryDb();
  for (let v = 0; v < 4; v++) { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); }
  db.prepare("INSERT INTO quotes (id, submission_id, status, payload, created_at) VALUES ('q1', 's1', 'sent', '{\"x\":1}', 5)").run();
  db.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('k', 'v', 1)").run();
  db.prepare("INSERT INTO site_content (section, value, updated_at) VALUES ('palette', '{}', 2)").run();
  assert.equal(migrate(db), 5);
  assert.deepEqual(db.prepare('SELECT id, status, payload, created_at FROM quotes').all().map((r) => ({ ...r })), [{ id: 'q1', status: 'sent', payload: '{"x":1}', created_at: 5 }]);
  assert.equal(db.prepare("SELECT value FROM kv WHERE key = 'k'").get().value, 'v');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM site_content').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stats_events').get().n, 0);
  assert.equal(migrate(db), 5);   // idempotent
});

// ---------------------------------------------------------------- off by default

test('statistics are OFF by default and the route is not even registered', () => {
  assert.equal(loadConfig({}).statsEnabled, false);
  for (const v of ['', '0', 'false', 'no', 'off', 'maybe']) assert.equal(loadConfig({ STATS_ENABLED: v }).statsEnabled, false, v);
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) assert.equal(loadConfig({ STATS_ENABLED: v }).statsEnabled, true, v);
  const routes = [];
  const app = { post: (u) => routes.push(u), addHook: () => routes.push('hook') };
  const s = setup();   // default test config: disabled
  assert.equal(registerStatsRoutes(app, { config: s.cfg, db: s.db }), null);
  assert.deepEqual(routes, []);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM stats_events').get().n, 0);
});

// ---------------------------------------------------------------- ingestion

test('a valid event is queued then stored; nothing personal is stored or logged', async () => {
  const s = mk({ cfg: { statsFlushMs: 0 } });
  const ip = '203.0.113.77', ua = DESKTOP_UA;
  assert.equal(s.c.ingest(req({ t: 'view' }, { ip, ua })), 'queued');
  assert.equal(s.c.ingest(req({ t: 'category_view', g: 'pharmacie' }, { ip, ua })), 'queued');
  assert.equal(s.c.ingest(req({ t: 'form_open', g: null }, { ip, ua })), 'queued');   // null target is normalised to ''
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM stats_events').get().n, 0, 'nothing is written on the request path');
  assert.equal(s.c.flush(), 3);
  const r = rows(s.db);
  assert.deepEqual(r.map((x) => [x.type, x.target, x.device, x.day]), [
    ['view', '', 'desktop', '2026-11-20'], ['category_view', 'pharmacie', 'desktop', '2026-11-20'], ['form_open', '', 'desktop', '2026-11-20'],
  ]);
  assert.equal(new Set(r.map((x) => x.sid)).size, 1);
  assert.equal(new Set(r.map((x) => x.vkey)).size, 1);
  // no IP, user-agent or anything else identifying anywhere: rows, kv, logs
  const dump = JSON.stringify([r, s.db.prepare('SELECT * FROM kv').all(), s.logs]);
  assert.ok(!dump.includes(ip), 'IP persisted or logged');
  assert.ok(!dump.includes('Mozilla') && !dump.includes('Windows'), 'user-agent persisted or logged');
  assert.ok(!dump.includes(s.cfg.sessionSecret));
});

test('payload validation: unknown fields, types, targets and shapes are refused', () => {
  const s = mk();
  const bad = (b) => s.c.ingest(req(b));
  assert.equal(bad(null), 'invalid');
  assert.equal(bad([]), 'invalid');
  assert.equal(bad('view'), 'invalid');
  assert.equal(bad({}), 'invalid');
  assert.equal(bad({ t: 'hack' }), 'invalid');
  assert.equal(bad({ t: 'view', x: 1 }), 'invalid');                       // unknown field
  assert.equal(bad({ t: 'view', g: 'x' }), 'invalid');                     // target on a type without target
  assert.equal(bad({ t: 'category_view' }), 'invalid');                    // missing target
  assert.equal(bad({ t: 'category_view', g: '' }), 'invalid');
  assert.equal(bad({ t: 'category_view', g: 'Pharmacie' }), 'invalid');    // upper case
  assert.equal(bad({ t: 'category_view', g: 'a b' }), 'invalid');
  assert.equal(bad({ t: 'category_view', g: "x';--" }), 'invalid');
  assert.equal(bad({ t: 'category_view', g: 'x'.repeat(41) }), 'invalid');
  assert.equal(bad({ t: 'category_view', g: 12 }), 'invalid');
  assert.equal(bad({ t: 'gallery_open', g: ['a'] }), 'invalid');
  assert.equal(bad({ t: ['view'] }), 'invalid');
  assert.equal(s.c.queue.length, 0);
  assert.equal(s.c.ingest(req({ t: 'gallery_open', g: 'l-12_ab' })), 'queued');
});

test('duplicates: one event per (session, type, target), in memory and again by the UNIQUE index', () => {
  const s = mk();
  assert.equal(s.c.ingest(view()), 'queued');
  assert.equal(s.c.ingest(view()), 'duplicate');
  assert.equal(s.c.ingest(req({ t: 'category_view', g: 'a' })), 'queued');
  assert.equal(s.c.ingest(req({ t: 'category_view', g: 'a' })), 'duplicate');
  assert.equal(s.c.ingest(req({ t: 'category_view', g: 'b' })), 'queued');   // other target: counted
  s.c.flush();
  assert.equal(rows(s.db).length, 3);
  // safety net: even if the memory check were bypassed, the database refuses a second identical row
  const e = { ...s.c.queue[0], at: T0 };
  s.c.queue.push({ at: T0, day: '2026-11-20', sid: rows(s.db)[0].sid, vkey: rows(s.db)[0].vkey, type: 'view', target: '', device: 'desktop' });
  s.c.flush();
  assert.equal(rows(s.db).length, 3);
  assert.equal(s.c.counters.duplicate >= 3, true);
  assert.ok(e);
});

test('sessions: 30 minutes of inactivity ends a session; another visitor is another session; devices are classified', () => {
  const s = mk();
  s.c.ingest(view());
  s.clock.t += 29 * MS;
  assert.equal(s.c.ingest(req({ t: 'form_open' })), 'queued');
  s.clock.t += 29 * MS;                                    // activity keeps the session alive (sliding window)
  assert.equal(s.c.ingest(view()), 'duplicate');
  s.clock.t += SESSION_GAP_MS + MS;                        // > 30 min of silence
  assert.equal(s.c.ingest(view()), 'queued');              // new session: the same event counts again
  s.c.ingest(view({ ip: '203.0.113.99' }));
  s.c.ingest(view({ ip: '203.0.113.100', ua: IPHONE_UA }));
  s.c.ingest(view({ ip: '203.0.113.101', ua: IPAD_UA }));
  s.c.flush();
  const r = rows(s.db);
  assert.equal(new Set(r.map((x) => x.sid)).size, 5);   // 2 sessions for the first visitor + 3 other visitors
  const first = r.filter((x) => x.vkey === r[0].vkey);
  assert.equal(new Set(first.map((x) => x.sid)).size, 2);
  assert.deepEqual(r.filter((x) => x.vkey !== r[0].vkey).map((x) => x.device), ['desktop', 'mobile', 'tablet']);
  assert.equal(deviceOf(DESKTOP_UA), 'desktop');
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile Safari/537.36'), 'mobile');
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14; SM-X900) Chrome/130 Safari/537.36'), 'tablet');
});

test('daily salt: random, kept in kv for today only, stable across a restart, never reusable across days', () => {
  const s = mk();
  s.c.ingest(view());
  s.c.flush();
  const saltRows = () => s.db.prepare("SELECT key, value FROM kv WHERE key LIKE 'stats:salt:%'").all();
  assert.deepEqual(saltRows().map((x) => x.key), ['stats:salt:2026-11-20']);
  assert.match(saltRows()[0].value, /^[0-9a-f]{64}$/);
  const v1 = rows(s.db)[0].vkey;
  // restart on the same day: same salt, same visitor key, so a visitor is not split in two
  const c2 = new StatsCollector({ db: s.db, config: s.cfg, now: () => s.clock.t, log: () => {} });
  c2.ingest(view({ ip: '203.0.113.7' }));
  assert.equal(c2.queue[0].vkey, v1);
  // next Paris day: new salt, the old one is deleted, the same visitor gets another key, and a new session
  s.clock.t = Date.UTC(2026, 10, 21, 9, 0, 0);
  assert.equal(s.c.ingest(view()), 'queued');
  s.c.flush();
  assert.deepEqual(saltRows().map((x) => x.key), ['stats:salt:2026-11-21']);
  const r = rows(s.db);
  assert.notEqual(r[1].vkey, r[0].vkey);
  assert.notEqual(r[1].sid, r[0].sid);
  assert.equal(r[1].day, '2026-11-21');
});

test('Paris day boundary: a session never spans two days (events either side of midnight)', () => {
  const s = mk({ start: Date.UTC(2026, 10, 20, 22, 58, 0) });   // 23:58 Paris
  assert.equal(dayOf(s.clock.t), '2026-11-20');
  s.c.ingest(view());
  s.clock.t += 3 * MS;                                          // 00:01 Paris, 3 minutes later
  assert.equal(dayOf(s.clock.t), '2026-11-21');
  assert.equal(s.c.ingest(view()), 'queued');                   // not a duplicate: new key, new session
  s.c.flush();
  const r = rows(s.db);
  assert.deepEqual(r.map((x) => x.day), ['2026-11-20', '2026-11-21']);
  assert.notEqual(r[0].sid, r[1].sid);
  const perSession = s.db.prepare('SELECT sid, COUNT(DISTINCT day) d FROM stats_events GROUP BY sid').all();
  assert.ok(perSession.every((x) => x.d === 1));
});

test('salt survives a database failure (memory only) without breaking ingestion', () => {
  const s = mk();
  const broken = { prepare() { throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' }); } };
  const c = new StatsCollector({ db: broken, config: s.cfg, now: () => T0, log: (o) => s.logs.push(o) });
  assert.equal(c.ingest(view()), 'queued');
  assert.equal(c.ingest(view({ ip: '203.0.113.50' })), 'queued');
  assert.ok(s.logs.some((l) => l.event === 'stats_salt_db_failed'));
});

// ---------------------------------------------------------------- bots, administrators, privacy signals

test('bots, scripts, cross-site calls and privacy signals are discarded', () => {
  const s = mk();
  for (const ua of ['', 'x', 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'curl/8.4.0 (x86_64-pc-linux-gnu) libcurl',
    'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130.0 Safari/537.36', 'python-requests/2.31.0 something', 'Lighthouse Chrome-Lighthouse 12.0 more',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'Go-http-client/2.0 padding-padding']) {
    assert.equal(s.c.ingest(view({ ua })), 'bot', ua);
  }
  assert.equal(s.c.ingest(req({ t: 'view' }, { headers: { 'sec-fetch-site': 'cross-site' } })), 'fetch_site');
  assert.equal(s.c.ingest({ body: { t: 'view' }, ip: '203.0.113.7', headers: { 'user-agent': DESKTOP_UA } }), 'fetch_site');   // not a browser fetch
  assert.equal(s.c.ingest(req({ t: 'view' }, { headers: { 'sec-gpc': '1' } })), 'privacy_signal');
  assert.equal(s.c.ingest(req({ t: 'view' }, { headers: { dnt: '1' } })), 'privacy_signal');
  assert.equal(s.c.ingest({ body: { t: 'view' }, headers: { 'sec-fetch-site': 'same-origin', 'user-agent': DESKTOP_UA } }), 'no_ip');
  assert.equal(s.c.queue.length, 0);
  assert.equal(s.c.ingest(view()), 'queued');
});

test('administrator traffic is never counted; visitors without the cookie cost no session lookup', () => {
  const lookups = [];
  const auth = { getSession: (sid) => { lookups.push(sid); return sid === 'good-session' ? { email: 'a@b.c' } : null; } };
  const s = mk({ auth });
  const name = s.cfg.cookieName;
  assert.equal(s.c.ingest(view({ cookies: { [name]: 'good-session' } })), 'admin');
  assert.equal(s.c.ingest(view({ cookies: { [name]: 'expired-session' } })), 'queued');   // stale cookie = an ordinary visitor
  assert.equal(s.c.ingest(view({ ip: '203.0.113.9' })), 'queued');
  assert.deepEqual(lookups, ['good-session', 'expired-session']);
  const throwing = mk({ auth: { getSession() { throw new Error('db down'); } } });
  assert.equal(throwing.c.ingest(view({ cookies: { [throwing.cfg.cookieName]: 'x' } })), 'queued');   // a failing lookup never blocks
});

test('rate limits per visitor and globally (in memory, no SQLite write per event)', () => {
  const s = mk({ cfg: { limits: { ...testConfig().limits, statsPerVisitor: { limit: 3, windowMs: 3600e3 }, statsGlobal: { limit: 8, windowMs: 3600e3 } } } });
  const o = { ip: '203.0.113.7' };
  assert.equal(s.c.ingest(req({ t: 'view' }, o)), 'queued');
  assert.equal(s.c.ingest(req({ t: 'category_view', g: 'a' }, o)), 'queued');
  assert.equal(s.c.ingest(req({ t: 'category_view', g: 'b' }, o)), 'queued');
  assert.equal(s.c.ingest(req({ t: 'category_view', g: 'c' }, o)), 'rate_visitor');
  s.clock.t += 3601e3;                                                        // next window
  assert.equal(s.c.ingest(req({ t: 'category_view', g: 'c' }, o)), 'queued');
  for (let i = 0; i < 7; i++) s.c.ingest(view({ ip: '198.51.100.' + i }));    // 1 + 7 = 8 in this window: the global limit
  assert.equal(s.c.ingest(view({ ip: '198.51.100.200' })), 'rate_global');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM rate_limits').get().n, 0, 'the rate_limits table is not used');
});

test('junk targets are capped per day', () => {
  const s = mk({ cfg: { limits: { ...testConfig().limits, statsPerVisitor: { limit: 1e6, windowMs: 3600e3 }, statsGlobal: { limit: 1e6, windowMs: 3600e3 } } } });
  let capped = 0;
  for (let i = 0; i < 520; i++) if (s.c.ingest(req({ t: 'category_view', g: 'junk' + i }, { ip: '10.0.' + Math.floor(i / 250) + '.' + (i % 250) })) === 'target_cap') capped++;
  assert.equal(capped, 20);
});

// ---------------------------------------------------------------- queue, failures, shutdown

test('queue is bounded: the oldest events are dropped and logged, the rest is written in small batches', async () => {
  const s = mk({ cfg: { limits: { ...testConfig().limits, statsGlobal: { limit: 1e6, windowMs: 3600e3 } } } });
  for (let i = 0; i < 1500; i++) s.c.ingest(view({ ip: '10.1.' + Math.floor(i / 250) + '.' + (i % 250) }));
  assert.equal(s.c.queue.length, QUEUE_MAX);
  assert.equal(s.c.counters.overflow, 500);
  for (let i = 0; i < 20 && s.c.queue.length; i++) await tick();
  assert.equal(s.c.queue.length, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM stats_events').get().n, 1000);
  assert.ok(s.logs.some((l) => l.event === 'stats_flush' && l.overflow === 500), 'drops are reported');
  assert.ok(!JSON.stringify(s.logs).includes('10.1.'), 'no IP in logs');
});

test('write failures are counted, logged without personal data and swallowed; the next flush recovers', () => {
  const s = mk();
  const real = s.db;
  let fail = true;
  const db = new Proxy(real, { get: (t, k) => (k === 'prepare' ? (sql) => { if (fail && /stats_events/.test(sql)) throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }); return t.prepare(sql); } : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
  const c = new StatsCollector({ db, config: s.cfg, now: () => T0, log: (o) => s.logs.push(o) });
  c.ingest(view()); c.ingest(view({ ip: '203.0.113.8' }));
  assert.doesNotThrow(() => c.flush());
  assert.equal(c.counters.flush_failed, 2);
  const l = s.logs.find((x) => x.event === 'stats_flush_failed');
  assert.deepEqual([l.events, l.code], [2, 'SQLITE_BUSY']);
  assert.ok(!JSON.stringify(s.logs).includes('203.0.113'));
  fail = false;
  c.ingest(view({ ip: '203.0.113.9' }));
  assert.equal(c.flush(), 1);
  assert.equal(c.counters.written, 1);
});

test('a flush never touches (nor rolls back) a transaction that someone else has open', () => {
  const s = mk();
  s.c.ingest(view());
  s.db.exec('BEGIN IMMEDIATE');
  s.db.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('t:probe', '1', 1)").run();
  assert.doesNotThrow(() => s.c.flush());                    // BEGIN fails inside the flush: events lost, nothing else harmed
  assert.equal(s.c.counters.flush_failed, 1);
  s.db.exec('COMMIT');                                       // the foreign transaction is intact
  assert.equal(s.db.prepare("SELECT value FROM kv WHERE key = 't:probe'").get().value, '1');
});

test('normal shutdown flushes what is queued; afterwards nothing is accepted', () => {
  const s = mk();
  for (let i = 0; i < 30; i++) s.c.ingest(view({ ip: '10.2.0.' + i }));
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM stats_events').get().n, 0);
  s.c.close();
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM stats_events').get().n, 30);
  assert.equal(s.c.ingest(view({ ip: '10.2.9.9' })), 'closed');
  assert.ok(s.logs.some((l) => l.event === 'stats_flush' && l.written === 30));
});

test('route: always 204 and empty body (valid, invalid, bot, closed); onClose flushes', async () => {
  const s = setup({ config: testConfig({ statsEnabled: true, statsFlushMs: 0 }) });
  const routes = {}, hooks = {};
  const app = { post: (u, o, h) => { routes[u] = { o, h }; }, addHook: (n, f) => { hooks[n] = f; }, log: { info() {} } };
  const c = registerStatsRoutes(app, { config: s.cfg, db: s.db });
  assert.ok(c instanceof StatsCollector);
  assert.equal(routes['/api/stats/e'].o.bodyLimit, 512);
  const call = async (r) => { let code, out = 'unset'; const reply = { code(x) { code = x; return reply; }, send(x) { out = x; return reply; } }; await routes['/api/stats/e'].h(r, reply); return [code, out]; };
  assert.deepEqual(await call(view()), [204, undefined]);
  assert.deepEqual(await call(req({ t: 'nope' })), [204, undefined]);
  assert.deepEqual(await call(view({ ua: 'bot' })), [204, undefined]);
  assert.deepEqual(await call({ body: undefined, headers: {}, ip: '1.1.1.1' }), [204, undefined]);
  assert.equal(c.queue.length, 1);
  await hooks.onClose();
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM stats_events').get().n, 1);
  assert.deepEqual(await call(view({ ip: '203.0.113.60' })), [204, undefined]);   // still 204 after close
});

// ---------------------------------------------------------------- quotes are never affected

const prop = () => ({ site: 'Atelier Lyon', num: '8', street: 'Rue Pasteur', zip: '69200', city: 'Vénissieux', type: 'Atelier', typeother: '', surface: '350 m²', desc: 'Entretien hebdomadaire', freq: 'Une fois par semaine', freqother: '', visits: '1', days: ['Lundi'], price: { kind: 'hour', value: '45,00' } });
const quote = () => ({ submissionId: 'sub-' + crypto.randomBytes(8).toString('hex'), contact: { name: 'Société Test', phone: '06 12 34 56 78', email: 'client@example.fr' }, properties: [prop()], photos: [0] });

function quoteHarness(extraCfg = {}) {
  const s = setup({ config: testConfig({ statsEnabled: true, statsFlushMs: 0, ...extraCfg }) });
  const routes = {};
  const app = { post: (url, o, h) => { routes[url] = h; } };
  const auth = new AuthService({ db: s.db, config: s.cfg, keys: s.keys, mailer: s.mailer, now: Date.now, log: () => {} });
  registerQuoteRoutes(app, { config: s.cfg, db: s.db, auth, mailer: s.mailer });
  const call = async (url, { body, params = {} } = {}) => {
    let code = 200, out;
    const reply = { code(c) { code = c; return reply; }, header() { return reply; }, send(x) { out = x; return reply; } };
    const r = await routes[url]({ body, headers: {}, params, ip: '203.0.113.9', log: { info() {}, error() {}, warn() {} } }, reply);
    return { code, body: out !== undefined ? out : r };
  };
  return { ...s, call };
}
async function sendQuote(h) {
  const c = await h.call('/api/quotes', { body: quote() });
  assert.equal(c.code, 200, JSON.stringify(c.body));
  const f = await h.call('/api/quotes/:id/finalize', { params: { id: c.body.id }, body: { token: c.body.token } });
  return { create: c, finalize: f, id: c.body.id };
}

test('LOAD: 1000 events in a burst, quotes created and sent meanwhile: all succeed, events written in short batches', async () => {
  const h = quoteHarness();
  const c = new StatsCollector({ db: h.db, config: h.cfg, now: Date.now, log: () => {} });
  const t0 = process.hrtime.bigint();
  let slowest = 0;
  const realFlush = c.flush.bind(c);
  c.flush = () => { const a = process.hrtime.bigint(); const n = realFlush(); slowest = Math.max(slowest, Number(process.hrtime.bigint() - a) / 1e6); return n; };
  for (let i = 0; i < 1000; i++) c.ingest(view({ ip: '10.3.' + Math.floor(i / 250) + '.' + (i % 250) }));
  const results = [];
  for (let i = 0; i < 5; i++) { results.push(await sendQuote(h)); await tick(); }   // the quote flow interleaves with the flushes
  for (let i = 0; i < 20 && c.queue.length; i++) await tick();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(c.snapshot().written, 1000);
  assert.equal(c.snapshot().queued, 0);
  for (const r of results) {
    assert.deepEqual([r.create.code, r.finalize.code, r.finalize.body.status], [200, 200, 'sent']);
    assert.equal(h.db.prepare('SELECT status FROM quotes WHERE id = ?').get(r.id).status, 'sent');
  }
  assert.equal(h.mailer.quotes.length, 5);
  console.log(`# LOAD 1000 events: written=${c.snapshot().written}, total=${ms.toFixed(0)} ms (incl. 5 quotes), slowest batch=${slowest.toFixed(1)} ms`);
  assert.ok(slowest < 250, 'one batch must stay short: ' + slowest);
});

test('A FAILING COLLECTION never prevents creating or sending a quote', async () => {
  const h = quoteHarness();
  const broken = new Proxy(h.db, { get: (t, k) => (k === 'prepare' ? (sql) => { if (/stats_events|kv/.test(sql) && /stats/.test(sql)) throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' }); return t.prepare(sql); } : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
  const logs = [];
  const c = new StatsCollector({ db: broken, config: h.cfg, now: Date.now, log: (o) => logs.push(o) });
  for (let i = 0; i < 300; i++) c.ingest(view({ ip: '10.4.0.' + (i % 250) + (i > 249 ? '' : '') }));
  const r1 = await sendQuote(h);
  c.flush();                                              // fails: counted and swallowed
  const r2 = await sendQuote(h);
  for (const r of [r1, r2]) assert.deepEqual([r.create.code, r.finalize.code, r.finalize.body.status], [200, 200, 'sent']);
  assert.equal(h.mailer.quotes.length, 2);
  assert.ok(c.snapshot().flush_failed > 0, 'the failure is recorded');
  assert.ok(logs.some((l) => l.event === 'stats_flush_failed'));
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM quotes').get().n, 2);
});

test('statistics code never reads quote content (no payload, no photos, no contact)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/stats.js'), 'utf8');
  assert.ok(!/\bquotes\b|payload|quote_photos/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
});

// ---------------------------------------------------------------- real Fastify stack (CI)

let fastifyAvailable = true;
try { require.resolve('fastify'); require.resolve('@fastify/cookie'); } catch (_) { fastifyAvailable = false; }
const opts = { skip: fastifyAvailable ? false : 'fastify not installed in this environment' };
const ORIGIN = 'https://devis.test';

async function boot(cfg) {
  const { buildApp } = require('../src/app');
  const s = setup({ config: testConfig(cfg) });
  const { app } = await buildApp({ config: s.cfg, db: s.db, mailer: s.mailer, keys: s.keys, logger: false });
  await app.ready();
  const post = (payload, headers = {}) => app.inject({
    method: 'POST', url: '/api/stats/e', payload,
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'user-agent': DESKTOP_UA, ...headers },
  });
  return { app, post, ...s };
}

test('Fastify: disabled by default, /api/stats/e does not exist and nothing is written', opts, async () => {
  const { app, post, db } = await boot();
  const res = await post({ t: 'view' });
  assert.equal(res.statusCode, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stats_events').get().n, 0);
  await app.close();
});

test('Fastify: enabled, the route answers 204, applies the global guards and flushes on close', opts, async () => {
  const { app, post, db } = await boot({ statsEnabled: true, statsFlushMs: 0 });
  const ok = await post({ t: 'view' });
  assert.equal(ok.statusCode, 204);
  assert.equal(ok.body, '');
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.equal((await post({ t: 'view' }, { origin: 'https://evil.example' })).statusCode, 403);   // existing Origin guard
  assert.equal((await post({ t: 'view' }, { 'content-type': 'text/plain' })).statusCode, 415);     // existing content-type guard
  assert.equal((await post({ t: 'nope' })).statusCode, 204);                                        // invalid: swallowed
  assert.equal((await app.inject({ method: 'GET', url: '/api/stats/e' })).statusCode, 404);         // nothing readable
  assert.equal((await app.inject({ method: 'POST', url: '/api/stats/e', payload: 'x'.repeat(2000), headers: { origin: ORIGIN, 'content-type': 'application/json' } })).statusCode >= 400, true);   // body limit
  await app.close();                                                                                // onClose → flush
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stats_events').get().n, 1);
});

// ---------------------------------------------------------------- log policy for /api/stats/e

test('log policy: the stats route registers its own request serializer (method and constant path only)', () => {
  const calls = [];
  const app = { post: (...a) => calls.push(a), addHook() {}, log: { info() {} } };
  const s = setup({ config: testConfig({ statsEnabled: true, statsFlushMs: 0 }) });
  registerStatsRoutes(app, { config: s.cfg, db: s.db });
  assert.equal(calls.length, 1);
  const [path, routeOpts] = calls[0];
  assert.equal(path, '/api/stats/e');
  assert.equal(routeOpts.bodyLimit, 512, 'the body limit is unchanged');
  const out = routeOpts.logSerializers.req({
    method: 'POST', url: '/api/stats/e?utm=secret', ip: '198.51.100.77', host: 'devis.example', headers: { cookie: 'x=1', 'user-agent': 'UA' },
    socket: { remoteAddress: '172.16.11.1', remotePort: 51234 }, body: { t: 'view', g: 'abc' },
  });
  assert.deepEqual(out, { method: 'POST', url: '/api/stats/e' });
  assert.deepEqual(Object.keys(routeOpts.logSerializers), ['req'], 'no other serializer is overridden');
});

test('log policy: with collection off (default) nothing is registered, so no serializer exists either', () => {
  const calls = [];
  const app = { post: (...a) => calls.push(a), addHook() {}, log: { info() {} } };
  const s = setup({ config: testConfig() });
  assert.equal(s.cfg.statsEnabled, false);
  assert.equal(registerStatsRoutes(app, { config: s.cfg, db: s.db }), null);
  assert.equal(calls.length, 0);
});

function logCapture() {
  const lines = [];
  return { stream: { write: (l) => lines.push(l) }, lines, text: () => lines.join(''), json: () => lines.map((l) => JSON.parse(l)) };
}

// Same logger options as production (app.js: level + redaction) plus a capturing stream; trustProxy as in production
// (the Docker gateway), so req.ip is the visitor address taken from X-Forwarded-For.
async function bootLogged(cfg = {}) {
  const { buildApp } = require('../src/app');
  const cap = logCapture();
  const s = setup({ config: testConfig({ trustProxy: '172.16.11.1', ...cfg }) });
  const { app } = await buildApp({
    config: s.cfg, db: s.db, mailer: s.mailer, keys: s.keys,
    logger: { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'], stream: cap.stream },
  });
  await app.ready();
  return { app, cap, ...s };
}
const GATEWAY = '172.16.11.1';
const VISITOR = '198.51.100.77';

test('Fastify log policy: /api/stats/e lines carry no IP, sid, vkey, salt, user-agent, query, cookie or body', opts, async () => {
  const { app, cap, db } = await bootLogged({ statsEnabled: true, statsFlushMs: 0 });
  const base = { origin: ORIGIN, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-forwarded-for': VISITOR };
  const ua = DESKTOP_UA + ' UAMARK93f1';
  const go = (over = {}) => app.inject({
    method: 'POST', url: over.url || '/api/stats/e?q=QUERYMARK77', remoteAddress: GATEWAY, payload: over.payload === undefined ? { t: 'gallery_open', g: 'cat-zzmark' } : over.payload,
    headers: { ...base, 'user-agent': ua, cookie: 'vectis_sid=COOKIEMARK', ...(over.headers || {}) },
  });
  assert.equal((await go()).statusCode, 204);
  assert.equal((await go({ payload: { t: 'view' } })).statusCode, 204);
  assert.equal((await go({ payload: { t: 'nope', g: 'BODYMARK55' } })).statusCode, 204);
  assert.equal((await go({ headers: { origin: 'https://evil.example' } })).statusCode, 403);   // global Origin guard, same route
  assert.equal((await go({ headers: { 'content-type': 'text/plain' } })).statusCode, 415);      // global content-type guard
  assert.ok((await go({ payload: 'x'.repeat(2000) })).statusCode >= 400);                       // body limit
  assert.equal((await go({ payload: '{"t":"view"' })).statusCode, 400);                          // malformed JSON
  await app.close();                                                                            // flush → rows exist

  const ev = db.prepare('SELECT sid, vkey FROM stats_events').all();
  assert.ok(ev.length >= 1, 'events were really stored, so the secrets below exist');
  const salts = db.prepare("SELECT value FROM kv WHERE key LIKE 'stats:salt:%'").all().map((r) => String(r.value));
  assert.ok(salts.length >= 1 && salts.every((x) => x.length >= 16));

  const text = cap.text();
  const forbidden = [VISITOR, GATEWAY, 'UAMARK93f1', 'QUERYMARK77', 'COOKIEMARK', 'cat-zzmark', 'BODYMARK55', 'evil.example',
    ...ev.flatMap((e) => [e.sid, e.vkey]), ...salts];
  for (const f of forbidden) assert.ok(!text.includes(f), `log must not contain ${f.slice(0, 8)}…`);

  const lines = cap.json();
  const statsReqs = lines.filter((l) => l.req && l.req.url === '/api/stats/e');
  assert.ok(statsReqs.length >= 7, 'the route is still logged (incoming request lines)');
  for (const l of statsReqs) assert.deepEqual(Object.keys(l.req).sort(), ['method', 'url'], 'req serializer = method + constant path only');
  assert.ok(lines.some((l) => l.res && l.res.statusCode === 204), 'completion lines are kept');
});

test('Fastify log policy: other routes keep the default request logging (client address included)', opts, async () => {
  const { app, cap } = await bootLogged({ statsEnabled: true, statsFlushMs: 0 });
  const h = (over = {}) => ({ origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.88', ...over });
  assert.equal((await app.inject({ method: 'GET', url: '/api/health', remoteAddress: GATEWAY, headers: h() })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/inconnu', remoteAddress: GATEWAY, headers: h() })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/estimate', remoteAddress: GATEWAY, payload: {}, headers: h() })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/estimate', remoteAddress: GATEWAY, payload: {}, headers: h({ origin: 'https://evil.example' }) })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/stats/e', remoteAddress: GATEWAY, payload: { t: 'view' }, headers: h({ 'user-agent': DESKTOP_UA, 'sec-fetch-site': 'same-origin' }) })).statusCode, 204);
  await app.close();
  const incoming = cap.json().filter((l) => l.req && l.req.url !== '/api/stats/e');
  for (const url of ['/api/health', '/api/inconnu', '/api/estimate']) {
    const l = incoming.find((x) => x.req.url === url);
    assert.ok(l, `incoming request logged for ${url}`);
    assert.equal(l.req.remoteAddress, '198.51.100.88', `default serializer unchanged for ${url} (req.ip resolved from X-Forwarded-For)`);
    assert.ok('host' in l.req && 'remotePort' in l.req && l.req.method, `default fields kept for ${url}`);
  }
  assert.ok(cap.json().some((l) => l.event === 'origin_rejected'), 'warnings of the global guard are still logged');
  assert.ok(cap.json().some((l) => l.res && l.res.statusCode === 404), 'completion lines of other routes are kept');
});

test('Fastify log policy: collection off by default, route absent, and the log setup does not depend on it', opts, async () => {
  const { app, cap, db } = await bootLogged();
  assert.equal(app.hasRoute({ method: 'POST', url: '/api/stats/e' }), false);
  const r = await app.inject({ method: 'POST', url: '/api/stats/e', remoteAddress: GATEWAY, payload: { t: 'view' }, headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': VISITOR, 'sec-fetch-site': 'same-origin', 'user-agent': DESKTOP_UA } });
  assert.equal(r.statusCode, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stats_events').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM kv WHERE key LIKE 'stats:%'").get().n, 0);
  await app.close();
  void cap;
});

test('Fastify log policy: enabling the route does not change quotes, authentication or shared counters', opts, async () => {
  const run = async (statsEnabled) => {
    const { app, db, mailer } = await bootLogged({ statsEnabled, statsFlushMs: 0 });
    const h = { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': VISITOR };
    const calls = [
      ['GET', '/api/health'],
      ['POST', '/api/estimate', {}],
      ['POST', '/api/quotes', {}],
      ['POST', '/api/admin/auth/request', { email: 'inconnu@example.com' }],
      ['POST', '/api/admin/auth/verify', { email: 'inconnu@example.com', code: '123456' }],
    ];
    const out = [];
    for (const [method, url, payload] of calls) {
      const r = await app.inject({ method, url, remoteAddress: GATEWAY, payload, headers: h });
      out.push([r.statusCode, r.body]);
    }
    const before = db.prepare('SELECT key, count FROM rate_limits ORDER BY key').all();
    if (statsEnabled) {
      for (let i = 0; i < 30; i++) {
        await app.inject({ method: 'POST', url: '/api/stats/e', remoteAddress: GATEWAY, payload: { t: 'view' }, headers: { ...h, 'sec-fetch-site': 'same-origin', 'user-agent': DESKTOP_UA } });
      }
    }
    const after = db.prepare('SELECT key, count FROM rate_limits ORDER BY key').all();
    const authEvents = db.prepare('SELECT COUNT(*) n FROM auth_events').get().n;
    await app.close();
    return { out, before, after, authEvents, sent: mailer.sent.length };
  };
  const off = await run(false);
  const on = await run(true);
  assert.deepEqual(on.out, off.out, 'same status codes and bodies on health, estimate, quotes and auth');
  assert.deepEqual(on.after, on.before, 'stats requests never touch rate_limits');
  assert.deepEqual(on.before, off.before, 'rate-limit keys and counts identical to a run without stats');
  assert.equal(on.authEvents, off.authEvents);
  assert.equal(on.sent, off.sent);
});
