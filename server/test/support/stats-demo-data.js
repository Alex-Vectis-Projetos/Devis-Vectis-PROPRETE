'use strict';

/**
 * FIXTURE DE TEST UNIQUEMENT — jamais chargée par le serveur (rien dans server/src ne l'importe).
 * Génère des statistiques fictives et cohérentes pour tester le tableau de bord et le rapport (stats-report.js) :
 *  - historique déterministe dans stats_daily + lignes `quotes` marquées démo (base de TEST) ;
 *  - « aujourd'hui » et les simulations passent par le VRAI StatsCollector, avec des adresses de documentation (RFC 5737).
 */

const crypto = require('node:crypto');
const { StatsCollector, dayOf } = require('../../src/stats');
const { buildReport, resolveRange, BUILTIN_CATEGORIES, addDays, daysBetween } = require('../../src/stats-report');

const HISTORY_DAYS = 90;
const SEED_VERSION = '1';

// ---------------------------------------------------------------- deterministic helpers

function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Splits `total` into integer parts proportional to `weights` (largest remainder), so sums are exact. */
function split(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k][1]]++;
  return out;
}

const DEVICE_SHARE = { mobile: 0.58, desktop: 0.35, tablet: 0.07 };
const CATEGORY_WEIGHT = { atelier: 9, cartorio: 5, pharmacie: 8, airbnb: 11, immeubles: 10, cabinet: 9, public: 4, bureaux: 14, residences: 8, usines: 3, commerces: 10, entrepots: 4, pro: 6 };
// per session: share of sessions that reach each step (device adjustments below)
const RATE = { category_view: 0.64, gallery_open: 0.23, form_open: 0.105, form_start: 0.07, phone_click: 0.032, email_click: 0.014 };
const DEVICE_BOOST = { phone_click: { mobile: 1.8, desktop: 0.3, tablet: 0.7 }, email_click: { mobile: 0.7, desktop: 1.6, tablet: 1 } };

/** One closed day of fictitious statistics, as stats_daily rows plus a number of demo quote requests. */
function demoDay(day, today) {
  const rnd = prng(hash32('vectis-demo:' + day));
  const date = new Date(day + 'T00:00:00Z');
  const dow = date.getUTCDay();                                   // 0 = Sunday
  const age = daysBetween(day, today) - 1;
  const trend = 1 + Math.max(0, HISTORY_DAYS - age) / 260;      // slow growth over the window
  const weekday = [0.62, 1.05, 1.12, 1.1, 1.06, 0.95, 0.7][dow];
  const visitors = Math.max(6, Math.round(38 * trend * weekday * (0.82 + rnd() * 0.36)));
  const sessions = Math.max(visitors, Math.round(visitors * (1.22 + rnd() * 0.28)));
  const rows = [];
  const devV = split(visitors, [DEVICE_SHARE.mobile, DEVICE_SHARE.desktop, DEVICE_SHARE.tablet]);
  const devS = split(sessions, [DEVICE_SHARE.mobile, DEVICE_SHARE.desktop, DEVICE_SHARE.tablet]);
  const devices = ['mobile', 'desktop', 'tablet'];
  const formStartSessions = { n: 0 };
  devices.forEach((device, di) => {
    let V = devV[di]; let S = devS[di];
    if (S === 0) return;
    if (V < 1) V = 1;
    if (S < V) S = V;
    const clampV = (s) => Math.max(s > 0 ? 1 : 0, Math.min(s, Math.round((s * V) / S)));
    let events = 0;
    const push = (type, target, s) => {
      if (s <= 0) return;
      rows.push({ day, type, target, device, events: s, sessions: s, visitors: clampV(s) });
      events += s;
    };
    push('view', '', S);
    const rate = (type) => {
      const boost = DEVICE_BOOST[type] ? DEVICE_BOOST[type][device] : 1;
      return Math.min(0.9, RATE[type] * boost * (0.85 + rnd() * 0.3));
    };
    const cv = Math.round(S * rate('category_view'));
    const go = Math.round(S * rate('gallery_open'));
    const ids = BUILTIN_CATEGORIES.map((c) => c[0]);
    const w = ids.map((id) => CATEGORY_WEIGHT[id] * (0.7 + rnd() * 0.6));
    split(cv, w).forEach((s, i) => push('category_view', ids[i], s));
    split(go, w).forEach((s, i) => push('gallery_open', ids[i], Math.min(s, S)));
    push('form_open', '', Math.min(S, Math.round(S * rate('form_open'))));
    const fs = Math.min(S, Math.round(S * rate('form_start')));
    push('form_start', '', fs);
    formStartSessions.n += fs;
    push('phone_click', '', Math.round(S * rate('phone_click')));
    push('email_click', '', Math.round(S * rate('email_click')));
    rows.push({ day, type: '*', target: '', device, events, sessions: S, visitors: V });
  });
  const created = Math.min(formStartSessions.n, Math.round(formStartSessions.n * (0.52 + rnd() * 0.22)));
  const sent = Math.round(created * (0.9 + rnd() * 0.08));
  return { rows, quotes: { created, sent, failed: Math.min(1, created - sent) }, rnd };
}

const INSERT_DAILY = 'INSERT OR IGNORE INTO stats_daily (day, type, target, device, events, sessions, visitors, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
const INSERT_QUOTE = 'INSERT OR IGNORE INTO quotes (id, submission_id, status, payload, photo_count, attempts, mails_sent, last_error, created_at, sent_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)';
const DEMO_PAYLOAD = JSON.stringify({ demo: true, note: 'DÉMO — donnée fictive, aucun client réel' });

function insertDemoQuote(db, id, status, createdAt, sentAt) {
  db.prepare(INSERT_QUOTE).run(id, id, status, DEMO_PAYLOAD, status === 'sent' ? 1 : 0, status === 'sent' ? 1 : 0, status === 'mail_failed' ? 'demo_mail_failed' : null, createdAt, sentAt);
}

/** Writes any missing past day of the window (idempotent: INSERT OR IGNORE) and, once per day, today's live journeys. */
function ensureSeed(db, config, now) {
  const today = dayOf(now);
  const upd = now;
  const last = db.prepare("SELECT value FROM kv WHERE key = 'preview:seed'").get();
  if (last && last.value === SEED_VERSION + ':' + today) return false;
  const ins = db.prepare(INSERT_DAILY);
  db.exec('BEGIN');
  try {
    for (let i = HISTORY_DAYS; i >= 1; i--) {
      const day = addDays(today, -i);
      const d = demoDay(day, today);
      for (const r of d.rows) ins.run(r.day, r.type, r.target, r.device, r.events, r.sessions, r.visitors, upd);
      const base = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), 8, 0, 0);
      for (let k = 0; k < d.quotes.created; k++) {
        const at = base + Math.floor(d.rnd() * 10 * 3600 * 1000);
        const status = k < d.quotes.sent ? 'sent' : (k < d.quotes.sent + d.quotes.failed ? 'mail_failed' : 'received');
        insertDemoQuote(db, `demo-${day}-${k}`, status, at, status === 'sent' ? at + 90 * 1000 : null);
      }
    }
    db.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('preview:seed', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(SEED_VERSION + ':' + today, upd);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
    throw err;
  }
  // today: a few journeys through the real collector (only if today has no live events yet)
  const has = db.prepare('SELECT COUNT(*) AS n FROM stats_events WHERE day = ?').get(today).n;
  if (!has) simulate(db, config, { journey: 'mix', device: 'mixed', visitorType: 'mixed', count: 36 }, now);
  return true;
}

// ---------------------------------------------------------------- simulator (real collector, documentation IPs)

const UA = {
  mobile: ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'],
  desktop: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'],
  tablet: ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'],
};
const GAP31 = 31 * 60 * 1000;   // just above the 30-minute session gap
const DOC_NETS = ['192.0.2.', '198.51.100.', '203.0.113.'];   // RFC 5737: reserved for documentation, never a real visitor
const JOURNEYS = ['view', 'browse', 'form', 'phone', 'email', 'quote', 'mix'];
const DEVICES = ['mobile', 'desktop', 'tablet'];

function pick(list, r) { return list[Math.floor(r() * list.length) % list.length]; }

function journeyEvents(kind, r, ids) {
  const cat = pick(ids, r);
  switch (kind) {
    case 'view': return [{ t: 'view' }];
    case 'browse': return [{ t: 'view' }, { t: 'category_view', g: cat }, ...(r() < 0.6 ? [{ t: 'gallery_open', g: cat }] : [])];
    case 'form': return [{ t: 'view' }, { t: 'category_view', g: cat }, { t: 'form_open' }, ...(r() < 0.7 ? [{ t: 'form_start' }] : [])];
    case 'phone': return [{ t: 'view' }, { t: 'phone_click' }];
    case 'email': return [{ t: 'view' }, { t: 'email_click' }];
    case 'quote': return [{ t: 'view' }, { t: 'category_view', g: cat }, { t: 'gallery_open', g: cat }, { t: 'form_open' }, { t: 'form_start' }];
    default: {
      const x = r();
      return journeyEvents(x < 0.28 ? 'view' : x < 0.62 ? 'browse' : x < 0.72 ? 'form' : x < 0.8 ? 'phone' : x < 0.85 ? 'email' : x < 0.9 ? 'quote' : 'browse', r, ids);
    }
  }
}

/**
 * Plays `count` visitor journeys through a real StatsCollector writing to the preview database.
 * "returning": the same visitor opens a second session 31 minutes later (the 30-minute gap rule makes it a new session
 * for the same pseudonymous key, never a recognition across days).
 */
function simulate(db, config, { journey = 'mix', device = 'mixed', visitorType = 'mixed', count = 1 }, nowMs = Date.now()) {
  const n = Math.max(1, Math.min(50, Math.floor(count)));
  const ids = BUILTIN_CATEGORIES.map((c) => c[0]);
  const r = prng(hash32(crypto.randomBytes(8).toString('hex')));
  let accepted = 0; let quotes = 0; let sessionsStarted = 0;
  for (let i = 0; i < n; i++) {
    const dev = device === 'mixed' ? pickDevice(r) : device;
    const ua = pick(UA[dev], r);
    const ip = pick(DOC_NETS, r) + (1 + Math.floor(r() * 253));
    const returning = visitorType === 'returning' || (visitorType === 'mixed' && r() < 0.3);
    // The two sessions of a returning visitor must fall on the SAME Paris day (the 30-minute gap rule). Early in the day the
    // first session cannot be placed 31 minutes in the past, so the second one is placed 31 minutes ahead instead.
    const back = dayOf(nowMs - GAP31) === dayOf(nowMs);
    const clock = { t: returning && back ? nowMs - GAP31 : nowMs };
    const c = new StatsCollector({ db, config: { ...config, statsFlushMs: 0 }, now: () => clock.t });
    let startedForm = false;
    const send = (kind) => {
      for (const ev of journeyEvents(kind, r, ids)) {
        const res = c.ingest({ body: ev, ip, cookies: {}, headers: { 'sec-fetch-site': 'same-origin', 'user-agent': ua } });
        if (res === 'queued') { accepted++; if (ev.t === 'form_start') startedForm = true; }
      }
      sessionsStarted++;
    };
    send(returning ? 'browse' : journey);
    if (returning) { clock.t = back ? nowMs : nowMs + GAP31; send(journey); }
    for (let k = 0; k < 20 && c.queue.length; k++) c.flush();
    c.close();
    // a demo quote request only follows a journey that really started the form (keeps the funnel coherent)
    if (startedForm && (journey === 'quote' || r() < 0.6)) {
      const id = 'demo-live-' + crypto.randomBytes(6).toString('hex');
      const sent = r() < 0.92;
      insertDemoQuote(db, id, sent ? 'sent' : 'received', nowMs, sent ? nowMs + 60 * 1000 : null);
      quotes++;
    }
  }
  return { accepted, quotes, journeys: n, sessions: sessionsStarted };
}
function pickDevice(r) {
  const x = r();
  return x < DEVICE_SHARE.mobile ? 'mobile' : x < DEVICE_SHARE.mobile + DEVICE_SHARE.desktop ? 'desktop' : 'tablet';
}

function resetDemo(db) {
  db.exec('BEGIN');
  try {
    db.exec("DELETE FROM stats_events; DELETE FROM stats_daily; DELETE FROM quotes WHERE id LIKE 'demo-%'; DELETE FROM kv WHERE key = 'preview:seed' OR key LIKE 'stats:salt:%';");
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
    throw err;
  }
}

// ---------------------------------------------------------------- mailer without any network

module.exports = { ensureSeed, simulate, resetDemo, demoDay, HISTORY_DAYS, split, JOURNEYS };
