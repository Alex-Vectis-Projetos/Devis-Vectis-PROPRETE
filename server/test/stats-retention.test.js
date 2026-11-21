'use strict';

// STATISTIQUES retention and roll-up: idempotent, verified before any deletion, never touches other tables.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, testConfig } = require('./helpers');
const { dayOf } = require('../src/stats');
const { buildReport, resolveRange, BUILTIN_CATEGORIES, addDays } = require('../src/stats-report');
const { runRetention, rollupDay, startRetentionJob, dailyKeepFrom, RAW_RETENTION_DAYS, DAILY_RETENTION_MONTHS } = require('../src/stats-retention');

const NOW = Date.UTC(2026, 10, 21, 10, 0, 0);    // 21 Nov 2026 11:00 Paris
const TODAY = dayOf(NOW);
const n = (db, sql, ...a) => db.prepare(sql).get(...a).n;

function db0() { return setup({ config: testConfig() }).db; }
let seq = 0;
function ev(db, day, sid, vkey, type, target, device) {
  const at = new Date(day + 'T12:00:00Z').getTime();
  db.prepare('INSERT INTO stats_events (at, day, sid, vkey, type, target, device) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(at, day, (sid + day).slice(0, 40), (vkey + day).slice(0, 40), type, target, device);
  seq++;
}
function fillDay(db, day) {
  ev(db, day, 'sA', 'vA', 'view', '', 'mobile');
  ev(db, day, 'sA', 'vA', 'category_view', 'bureaux', 'mobile');
  ev(db, day, 'sA', 'vA', 'form_open', '', 'mobile');
  ev(db, day, 'sB', 'vA', 'view', '', 'mobile');          // second session of the same visitor
  ev(db, day, 'sC', 'vC', 'view', '', 'desktop');
  ev(db, day, 'sC', 'vC', 'phone_click', '', 'desktop');
}

test('constants: 90 days raw, 25 months daily; dailyKeepFrom is the 1st of the month 25 months back', () => {
  assert.equal(RAW_RETENTION_DAYS, 90);
  assert.equal(DAILY_RETENTION_MONTHS, 25);
  assert.equal(dailyKeepFrom('2026-11-21'), '2024-10-01');
  assert.equal(dailyKeepFrom('2026-01-05'), '2023-12-01');
  assert.equal(dailyKeepFrom('2026-02-28'), '2024-01-01');
});

test('empty statistics tables: nothing is read into, written or deleted', () => {
  const db = db0();
  const r = runRetention(db, NOW);
  assert.deepEqual(r, { rolledDays: 0, rolledRows: 0, purgedEventDays: 0, purgedEvents: 0, purgedDailyRows: 0, skipped: [] });
  assert.equal(n(db, 'SELECT COUNT(*) n FROM stats_daily'), 0);
});

test('roll-up: closed day aggregated with the same numbers as the live read; today never rolled; idempotent', () => {
  const db = db0();
  const d1 = addDays(TODAY, -1);
  fillDay(db, d1); fillDay(db, TODAY);
  const range = resolveRange({ range: '7d' }, TODAY);
  const labels = new Map(BUILTIN_CATEGORIES);
  const before = buildReport(db, range, { today: TODAY, labels });
  const r = runRetention(db, NOW);
  assert.equal(r.rolledDays, 1);
  assert.equal(n(db, 'SELECT COUNT(*) n FROM stats_daily WHERE day = ?', TODAY), 0, 'today is not closed');
  assert.ok(n(db, 'SELECT COUNT(*) n FROM stats_daily WHERE day = ?', d1) > 0);
  const after = buildReport(db, range, { today: TODAY, labels });
  assert.deepEqual(after, before, 'the dashboard shows exactly the same figures before and after the roll-up');
  const snap = JSON.stringify(db.prepare('SELECT * FROM stats_daily ORDER BY day, type, target, device').all());
  const r2 = runRetention(db, NOW + 1000);
  assert.deepEqual([r2.rolledDays, r2.rolledRows], [0, 0]);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM stats_daily ORDER BY day, type, target, device').all()), snap, 'second run changes nothing, not even updated_at');
  const tot = db.prepare("SELECT SUM(events) e, SUM(sessions) s, SUM(visitors) v FROM stats_daily WHERE day = ? AND type = '*'").get(d1);
  assert.deepEqual({ e: tot.e, s: tot.s, v: tot.v }, { e: 6, s: 3, v: 2 });
  for (const row of db.prepare('SELECT * FROM stats_daily').all()) assert.ok(row.visitors <= row.sessions && row.sessions <= row.events);
});

test('roll-up margin: just after midnight (< 30 min) yesterday is still open', () => {
  const db = db0();
  const d1 = addDays(TODAY, -1);
  fillDay(db, d1);
  const midnight = new Date(TODAY + 'T00:00:00+01:00').getTime();
  assert.equal(runRetention(db, midnight + 10 * 60 * 1000).rolledDays, 0);
  assert.equal(runRetention(db, midnight + 31 * 60 * 1000).rolledDays, 1);
});

test('purge: raw rows older than 90 days are deleted only after their aggregate exists and matches', () => {
  const db = db0();
  const old = addDays(TODAY, -91), edge = addDays(TODAY, -90), recent = addDays(TODAY, -10);
  fillDay(db, old); fillDay(db, edge); fillDay(db, recent);
  const r = runRetention(db, NOW);
  assert.equal(r.purgedEventDays, 1);
  assert.equal(r.purgedEvents, 6);
  assert.equal(n(db, 'SELECT COUNT(*) n FROM stats_events WHERE day = ?', old), 0);
  assert.equal(n(db, 'SELECT COUNT(*) n FROM stats_events WHERE day = ?', edge), 6, 'exactly 90 days back is kept');
  assert.equal(n(db, 'SELECT COUNT(*) n FROM stats_events WHERE day = ?', recent), 6);
  assert.ok(n(db, 'SELECT COUNT(*) n FROM stats_daily WHERE day = ?', old) > 0, 'the aggregate of the purged day is preserved');
  assert.equal(r.skipped.length, 0);
});

test('purge refuses to delete when the existing aggregate does not match the raw rows', () => {
  const db = db0();
  const old = addDays(TODAY, -100);
  fillDay(db, old);
  db.prepare("INSERT INTO stats_daily (day, type, target, device, events, sessions, visitors, updated_at) VALUES (?, '*', '', 'mobile', 1, 1, 1, 1)").run(old);
  const r = runRetention(db, NOW);
  assert.equal(r.purgedEvents, 0);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].day, old);
  assert.equal(n(db, 'SELECT COUNT(*) n FROM stats_events WHERE day = ?', old), 6, 'raw rows are kept');
});

test('daily aggregates older than 25 months are deleted, the boundary month is kept', () => {
  const db = db0();
  const ins = db.prepare("INSERT INTO stats_daily (day, type, target, device, events, sessions, visitors, updated_at) VALUES (?, '*', '', 'desktop', 1, 1, 1, 1)");
  for (const d of ['2024-09-30', '2024-10-01', '2024-10-31', '2026-11-01']) ins.run(d);
  const r = runRetention(db, NOW);
  assert.equal(r.purgedDailyRows, 1);
  assert.deepEqual(db.prepare('SELECT day FROM stats_daily ORDER BY day').all().map((x) => x.day), ['2024-10-01', '2024-10-31', '2026-11-01']);
});

test('a roll-up that fails halfway leaves no partial aggregate (atomic)', () => {
  const db = db0();
  const d1 = addDays(TODAY, -2);
  fillDay(db, d1);
  db.prepare("INSERT INTO stats_daily (day, type, target, device, events, sessions, visitors, updated_at) VALUES ('1999-01-01', 'view', '', 'mobile', 1, 1, 1, 1)").run();
  const real = db.prepare.bind(db);
  let k = 0;
  db.prepare = (sql) => {
    const st = real(sql);
    if (/INSERT INTO stats_daily/.test(sql)) { const run = st.run.bind(st); st.run = (...a) => { if (++k === 3) throw new Error('disk full'); return run(...a); }; }
    return st;
  };
  assert.throws(() => rollupDay(db, d1, NOW), /disk full/);
  db.prepare = real;
  assert.equal(n(db, 'SELECT COUNT(*) n FROM stats_daily WHERE day = ?', d1), 0);
  assert.equal(n(db, 'SELECT COUNT(*) n FROM stats_events WHERE day = ?', d1), 6);
  assert.equal(runRetention(db, NOW).rolledDays, 1, 'the next run completes it');
});

test('only statistics tables are touched: quotes, kv, site_content and admins are unchanged', () => {
  const db = db0();
  fillDay(db, addDays(TODAY, -120));
  db.prepare("INSERT INTO quotes (id, submission_id, status, payload, photo_count, attempts, mails_sent, last_error, created_at, sent_at) VALUES ('q1', 'q1', 'sent', '{}', 0, 1, 1, NULL, 1, 1)").run();
  const tables = ['quotes', 'kv', 'site_content', 'admins'];
  const snap = () => tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()));
  const before = snap();
  runRetention(db, NOW);
  assert.deepEqual(snap(), before);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'stats-retention.js'), 'utf8');
  assert.doesNotMatch(src, /(DELETE FROM|UPDATE|INSERT INTO)\s+(quotes|kv|site_content|admins|quote_photos|sessions)\b/i);
});

test('job: runs on demand, logs without personal data, survives errors, can be stopped', () => {
  const db = db0();
  fillDay(db, addDays(TODAY, -3));
  const logs = [];
  const job = startRetentionJob({ db, now: () => NOW, log: (o) => logs.push(o), firstMs: 3600e3, everyMs: 3600e3 });
  const r = job.runNow();
  assert.equal(r.rolledDays, 1);
  assert.equal(logs[0].event, 'stats_retention');
  assert.doesNotMatch(JSON.stringify(logs), /vkey|sid|vA20|sA20/i);
  db.exec('DROP TABLE stats_events');
  job.runNow();
  assert.equal(logs[logs.length - 1].event, 'stats_retention_error');
  assert.ok(job.state.error);
  job.stop();
});
