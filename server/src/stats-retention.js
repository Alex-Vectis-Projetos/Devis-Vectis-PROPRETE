'use strict';

/**
 * STATISTIQUES — retention and roll-up (idempotent, never deletes what has not been aggregated and verified).
 *
 *   stats_events  raw rows, kept RAW_RETENTION_DAYS (90) Paris days: today and the 89 days before it.
 *   stats_daily   per-day aggregates, kept DAILY_RETENTION_MONTHS (25) months: from the 1st day of the month 25 months back.
 *
 * Roll-up: a CLOSED day (strictly before today, with a 30-minute margin so late flushes of the collector are in) is aggregated
 * from stats_events with the same GROUP BY the dashboard uses for live days, in ONE transaction, only if stats_daily has no
 * row for that day yet. Running it twice changes nothing.
 *
 * Purge of raw rows, day by day, inside a transaction: (1) the day is rolled up first if needed; (2) the total events of the
 * aggregate ('*' rows) must equal the number of raw rows of that day; only then are the raw rows deleted. A day that fails
 * the check is left untouched and reported in `skipped`.
 *
 * Nothing here touches quotes, uploads, customers, kv, or any other table; with empty statistics tables it does nothing at all.
 */

const { dayOf } = require('./stats');
const { transaction } = require('./db');

const RAW_RETENTION_DAYS = 90;
const DAILY_RETENTION_MONTHS = 25;
const ROLLUP_MARGIN_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(day, n) {
  return new Date(new Date(day + 'T00:00:00Z').getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** First day (YYYY-MM-01) of the oldest month kept in stats_daily. */
function dailyKeepFrom(today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const total = y * 12 + (m - 1) - DAILY_RETENTION_MONTHS;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/** Body of the roll-up: must run inside a transaction (see rollupDay / runRetention). */
function rollupDayInTx(db, day, nowMs) {
  {
    const has = db.prepare('SELECT 1 FROM stats_daily WHERE day = ? LIMIT 1').get(day);
    if (has) return 0;
    const types = db.prepare(
      `SELECT type, target, device, COUNT(*) AS events, COUNT(DISTINCT sid) AS sessions, COUNT(DISTINCT vkey) AS visitors
         FROM stats_events WHERE day = ? GROUP BY type, target, device`
    ).all(day);
    if (!types.length) return 0;
    const totals = db.prepare(
      `SELECT '*' AS type, '' AS target, device, COUNT(*) AS events, COUNT(DISTINCT sid) AS sessions, COUNT(DISTINCT vkey) AS visitors
         FROM stats_events WHERE day = ? GROUP BY device`
    ).all(day);
    const ins = db.prepare('INSERT INTO stats_daily (day, type, target, device, events, sessions, visitors, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of types.concat(totals)) ins.run(day, r.type, r.target, r.device, r.events, r.sessions, r.visitors, nowMs);
    return types.length + totals.length;
  }
}
function rollupDay(db, day, nowMs) {
  return transaction(db, () => rollupDayInTx(db, day, nowMs));
}

function runRetention(db, nowMs = Date.now()) {
  const out = { rolledDays: 0, rolledRows: 0, purgedEventDays: 0, purgedEvents: 0, purgedDailyRows: 0, skipped: [] };
  const today = dayOf(nowMs);
  const lastClosed = dayOf(nowMs - ROLLUP_MARGIN_MS);          // days strictly before this one are closed

  // 1. roll-up of closed days that have raw rows and no aggregate
  const pending = db.prepare(
    `SELECT DISTINCT day FROM stats_events WHERE day < ? AND day NOT IN (SELECT DISTINCT day FROM stats_daily) ORDER BY day`
  ).all(lastClosed);
  for (const { day } of pending) {
    const n = rollupDay(db, day, nowMs);
    if (n) { out.rolledDays++; out.rolledRows += n; }
  }

  // 2. purge of raw rows older than the retention window — only verified days
  const rawCutoff = addDays(today, -RAW_RETENTION_DAYS);
  const old = db.prepare('SELECT day, COUNT(*) AS n FROM stats_events WHERE day < ? GROUP BY day ORDER BY day').all(rawCutoff);
  for (const { day, n } of old) {
    const res = transaction(db, () => {
      rollupDayInTx(db, day, nowMs);
      const agg = db.prepare("SELECT COALESCE(SUM(events), 0) AS e FROM stats_daily WHERE day = ? AND type = '*'").get(day).e;
      if (agg !== n) return { ok: false, reason: `aggregate ${agg} ≠ raw ${n}` };
      return { ok: true, deleted: db.prepare('DELETE FROM stats_events WHERE day = ?').run(day).changes };
    });
    if (res.ok) { out.purgedEventDays++; out.purgedEvents += res.deleted; } else out.skipped.push({ day, reason: res.reason });
  }

  // 3. purge of daily aggregates older than the retention window
  out.purgedDailyRows = db.prepare('DELETE FROM stats_daily WHERE day < ?').run(dailyKeepFrom(today)).changes;
  return out;
}

/** Hourly job (first run shortly after start). Errors are logged without data and never stop the server. */
function startRetentionJob({ db, now = Date.now, log = () => {}, firstMs = 60 * 1000, everyMs = 6 * 60 * 60 * 1000 }) {
  const state = { last: null, error: null };
  const run = () => {
    try {
      const r = runRetention(db, now());
      state.last = { at: now(), ...r };
      state.error = null;
      if (r.rolledDays || r.purgedEventDays || r.purgedDailyRows || r.skipped.length) log({ event: 'stats_retention', ...r });
    } catch (err) {
      state.error = err && err.code ? String(err.code) : 'error';
      log({ event: 'stats_retention_error', code: state.error });
    }
    return state.last;
  };
  const first = setTimeout(run, firstMs);
  const timer = setInterval(run, everyMs);
  first.unref(); timer.unref();
  return { state, runNow: run, stop() { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { runRetention, rollupDay, startRetentionJob, dailyKeepFrom, RAW_RETENTION_DAYS, DAILY_RETENTION_MONTHS, ROLLUP_MARGIN_MS };
