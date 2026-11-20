'use strict';

/**
 * STATISTIQUES VECTIS — step 1: collection only (no read API, no UI, no roll-up).
 *
 * Principles
 *  - OFF by default (config.statsEnabled). When off, registerStatsRoutes() registers nothing and returns null.
 *  - Nothing is stored on the visitor's device. Visitors and sessions are derived on the server:
 *      vkey = truncated HMAC(random salt of the day, ip + '\0' + user-agent)   → PSEUDONYMISED data (RGPD applies)
 *      The IP address and the user-agent exist only in memory during that computation and are NEVER persisted or logged.
 *      The salt is random, stored in `kv` for the current Paris day only and deleted afterwards, so a key cannot be
 *      re-computed or linked from one day to the next.
 *  - A session = consecutive events of one vkey with less than 30 minutes between them. Its id (sid) is random,
 *    generated here and never sent to the browser. The vkey changes with the salt, so a session never spans two days.
 *  - One event per (session, type, target). Enforced in memory AND by a UNIQUE index (target is '' and never NULL).
 *  - The collection can never block or break a quote: the HTTP handler answers 204 immediately; events go through a
 *    bounded in-memory queue and are written in small batches. Any failure is counted, logged (without personal data)
 *    and swallowed.
 *  - IP source: req.ip as resolved by Fastify with TRUST_PROXY (Nginx overwrites X-Forwarded-For with the real client
 *    address). If a CDN such as Cloudflare were ever put in front, Nginx would have to restore the visitor address first
 *    (real_ip), otherwise all visitors would collapse into a few keys.
 */

const crypto = require('node:crypto');
const sec = require('./security');
const { transaction } = require('./db');

const TYPES = ['view', 'category_view', 'gallery_open', 'form_open', 'form_start', 'phone_click', 'email_click'];
const TARGETED = new Set(['category_view', 'gallery_open']);
const DEVICES = ['mobile', 'tablet', 'desktop'];
const TARGET_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

const STATS_PATH = '/api/stats/e';
const SESSION_GAP_MS = 30 * 60 * 1000;
const QUEUE_MAX = 1000;
const BATCH_MAX = 200;
const MAP_MAX = 50000;            // sessions / rate counters kept in memory
const TARGETS_PER_DAY_MAX = 500;  // distinct targets accepted per day (guards against junk targets)
const UA_MAX = 512;

const BOT_RE = new RegExp(
  [
    'bot', 'crawl', 'spider', 'slurp', 'headless', 'lighthouse', 'pagespeed', 'gtmetrix', 'curl\\/', 'wget', 'python', 'java\\/',
    'go-http', 'httpclient', 'libwww', 'scrapy', 'phantom', 'puppeteer', 'playwright', 'selenium', 'facebookexternalhit',
    'preview', 'monitor', 'uptime', 'pingdom', 'okhttp', 'axios', 'node-fetch',
  ].join('|'),
  'i'
);

const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
function dayOf(ms) {
  return parisDay.format(new Date(ms));
}

function deviceOf(ua) {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

const REASONS = [
  'invalid', 'fetch_site', 'privacy_signal', 'bot', 'admin', 'no_ip', 'rate_visitor', 'rate_global',
  'duplicate', 'target_cap', 'overflow', 'closed', 'flush_failed', 'error',
];

class StatsCollector {
  /**
   * @param {object} o
   * @param {object} o.db      SQLite handle (same connection as the rest of the API)
   * @param {object} o.config
   * @param {object} [o.auth]  AuthService, used only to recognise an administrator session (their traffic is not counted)
   * @param {function} [o.now]
   * @param {function} [o.log] (object) => void ; never receives personal data
   */
  constructor({ db, config, auth = null, now = Date.now, log = () => {} }) {
    this.db = db;
    this.config = config;
    this.auth = auth;
    this.now = now;
    this.log = log;
    this.queue = [];
    this.sessions = new Map();   // vkey -> { sid, last, seen:Set }
    this.rate = new Map();       // vkey -> { start, count }
    this.globalRate = { start: 0, count: 0 };
    this.targets = { day: '', set: new Set() };
    this.salt = { day: '', value: null };
    this.counters = { accepted: 0, written: 0 };
    for (const r of REASONS) this.counters[r] = 0;
    this.reported = { ...this.counters };
    this.flushing = false;
    this.closed = false;
    this.timer = null;
    this.stmt = null;
    const every = Number(config.statsFlushMs);
    if (every > 0) {
      this.timer = setInterval(() => this.flush(), every);
      if (this.timer.unref) this.timer.unref();
    }
  }

  drop(reason) {
    this.counters[reason] = (this.counters[reason] || 0) + 1;
    return reason;
  }

  /** Random salt for the current Paris day, kept in `kv` for that day only. Memory-only if the database is unavailable. */
  saltFor(day) {
    if (this.salt.day === day && this.salt.value) return this.salt.value;
    const key = 'stats:salt:' + day;
    let value = null;
    try {
      const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      if (row) value = row.value;
      else {
        value = crypto.randomBytes(32).toString('hex');
        this.db.prepare('INSERT OR IGNORE INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, this.now());
        const stored = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
        if (stored) value = stored.value;
      }
      this.db.prepare("DELETE FROM kv WHERE key LIKE 'stats:salt:%' AND key <> ?").run(key);   // previous days are forgotten
    } catch (err) {
      this.log({ event: 'stats_salt_db_failed', code: err && err.code });
      if (!value) value = crypto.randomBytes(32).toString('hex');
    }
    this.salt = { day, value };
    return value;
  }

  /** Validates and queues one event. Returns 'queued' or the reason it was dropped. Never throws. */
  ingest(req) {
    try {
      return this.ingestUnsafe(req);
    } catch (err) {
      this.log({ event: 'stats_ingest_error', code: err && err.code });
      return this.drop('error');
    }
  }

  ingestUnsafe(req) {
    if (this.closed) return this.drop('closed');
    // 1. payload: strict shape, whitelisted type, normalised target ('' and never NULL)
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return this.drop('invalid');
    const keys = Object.keys(b);
    if (keys.some((k) => k !== 't' && k !== 'g')) return this.drop('invalid');
    const type = b.t;
    if (typeof type !== 'string' || !TYPES.includes(type)) return this.drop('invalid');
    let target = b.g === undefined || b.g === null ? '' : b.g;
    if (typeof target !== 'string') return this.drop('invalid');
    if (TARGETED.has(type)) {
      if (!TARGET_RE.test(target)) return this.drop('invalid');
    } else if (target !== '') return this.drop('invalid');

    // 2. request provenance and privacy signals
    const h = req.headers || {};
    if (String(h['sec-fetch-site'] || '').toLowerCase() !== 'same-origin') return this.drop('fetch_site');
    if (h['sec-gpc'] === '1' || h.dnt === '1') return this.drop('privacy_signal');
    const ua = String(h['user-agent'] || '').slice(0, UA_MAX);
    if (ua.length < 10 || BOT_RE.test(ua)) return this.drop('bot');
    const ip = req.ip;
    if (!ip || typeof ip !== 'string') return this.drop('no_ip');

    // 3. administrators are never counted (the cookie only exists for them; visitors cost no lookup)
    const sid = req.cookies && this.config.cookieName ? req.cookies[this.config.cookieName] : null;
    if (sid && this.auth) {
      let admin = null;
      try { admin = this.auth.getSession(sid); } catch (_) { admin = null; }
      if (admin) return this.drop('admin');
    }

    // 4. visitor key (pseudonymised) — ip and ua are not kept
    const now = this.now();
    const day = dayOf(now);
    const vkey = sec.hmac(this.saltFor(day), ip + '\u0000' + ua).slice(0, 24);
    const device = deviceOf(ua);

    // 5. in-memory rate limits (no SQLite write per event)
    if (!this.allow(this.globalRate, now, this.config.limits.statsGlobal)) return this.drop('rate_global');
    let r = this.rate.get(vkey);
    if (!r) {
      if (this.rate.size >= MAP_MAX) this.prune(now);
      if (this.rate.size >= MAP_MAX) return this.drop('rate_global');
      r = { start: now, count: 0 };
      this.rate.set(vkey, r);
    }
    if (!this.allow(r, now, this.config.limits.statsPerVisitor)) return this.drop('rate_visitor');

    // 6. session, then one event per (session, type, target)
    let s = this.sessions.get(vkey);
    if (!s || now - s.last > SESSION_GAP_MS) {
      if (!s && this.sessions.size >= MAP_MAX) this.prune(now);
      if (!s && this.sessions.size >= MAP_MAX) return this.drop('rate_global');
      s = { sid: crypto.randomBytes(12).toString('hex'), last: now, seen: new Set() };
      this.sessions.set(vkey, s);
    }
    s.last = now;
    const dedupe = type + '|' + target;
    if (s.seen.has(dedupe)) return this.drop('duplicate');
    if (target) {
      if (this.targets.day !== day) this.targets = { day, set: new Set() };
      if (!this.targets.set.has(target) && this.targets.set.size >= TARGETS_PER_DAY_MAX) return this.drop('target_cap');
      this.targets.set.add(target);
    }
    s.seen.add(dedupe);

    // 7. bounded queue: the oldest events are sacrificed, the request path never waits
    if (this.queue.length >= QUEUE_MAX) {
      this.queue.shift();
      this.drop('overflow');
    }
    this.queue.push({ at: now, day, sid: s.sid, vkey, type, target, device });
    this.counters.accepted++;
    if (this.queue.length >= 50 && !this.flushing && !this.closed) setImmediate(() => this.flush());
    return 'queued';
  }

  allow(slot, now, { limit, windowMs }) {
    if (now - slot.start >= windowMs) {
      slot.start = now;
      slot.count = 0;
    }
    if (slot.count >= limit) return false;
    slot.count++;
    return true;
  }

  prune(now) {
    for (const [k, s] of this.sessions) if (now - s.last > SESSION_GAP_MS) this.sessions.delete(k);
    const w = this.config.limits.statsPerVisitor.windowMs;
    for (const [k, r] of this.rate) if (now - r.start >= w) this.rate.delete(k);
  }

  /** Writes at most BATCH_MAX queued events in one short transaction. Failures are counted and swallowed. */
  flush() {
    if (this.flushing || this.queue.length === 0) return 0;
    this.flushing = true;
    const batch = this.queue.splice(0, BATCH_MAX);
    let written = 0;
    try {
      if (!this.stmt) {
        this.stmt = this.db.prepare(
          'INSERT OR IGNORE INTO stats_events (at, day, sid, vkey, type, target, device) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
      }
      transaction(this.db, () => {
        for (const e of batch) {
          const res = this.stmt.run(e.at, e.day, e.sid, e.vkey, e.type, e.target, e.device);
          if (res && res.changes) written++;
          else this.drop('duplicate');
        }
      });
      this.counters.written += written;
    } catch (err) {
      this.stmt = null;   // re-prepare next time (the handle may have been closed or the schema changed)
      this.counters.flush_failed += batch.length;
      this.log({ event: 'stats_flush_failed', events: batch.length, code: err && err.code, message: err && String(err.message).slice(0, 120) });
    } finally {
      this.flushing = false;
    }
    this.report();
    if (this.queue.length > 0 && !this.closed) setImmediate(() => this.flush());
    return written;
  }

  /** Logs what changed since the previous report: counts only, never personal data. */
  report() {
    const delta = {};
    let any = false;
    for (const k of Object.keys(this.counters)) {
      const d = this.counters[k] - (this.reported[k] || 0);
      if (d) { delta[k] = d; any = true; }
    }
    this.reported = { ...this.counters };
    if (any) this.log({ event: 'stats_flush', ...delta });
  }

  snapshot() {
    return { ...this.counters, queued: this.queue.length, sessions: this.sessions.size };
  }

  /** Normal shutdown: stop the timer and write what is still queued (bounded in time). */
  close() {
    this.closed = true;   // no new event is accepted and no follow-up flush is scheduled
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const deadline = Date.now() + 2000;
    while (this.queue.length > 0 && Date.now() < deadline) {
      const before = this.queue.length;
      this.flush();
      if (this.queue.length >= before) break;   // flush failed: do not loop
    }
    const lost = this.queue.length;
    this.queue.length = 0;
    if (lost) this.counters.flush_failed += lost;
    this.report();
  }
}

/**
 * Registers POST /api/stats/e. Returns the collector, or null when statistics are disabled (nothing is registered:
 * the route answers 404 exactly as before this module existed).
 */
function registerStatsRoutes(app, { config, db, auth = null, now = Date.now }) {
  if (!config.statsEnabled) return null;
  const collector = new StatsCollector({
    db, config, auth, now,
    log: (o) => { try { if (app.log && app.log.info) app.log.info(o); } catch (_) { /* logging must never fail the request */ } },
  });
  // Write-only: always 204 with an empty body, whatever happened. Validation is done by the collector (bodyLimit keeps it tiny).
  // Log policy: Fastify's default request serializer writes the client address (remoteAddress = req.ip), the Host and the
  // remote port into the request log lines. For this route only, log the method and the constant path: no IP, no query
  // string, no headers, no body. Every other route keeps the default serializer (and the redaction set in app.js).
  const statsLogSerializers = { req: (r) => ({ method: r.method, url: STATS_PATH }) };
  app.post(STATS_PATH, { bodyLimit: 512, logSerializers: statsLogSerializers }, async (req, reply) => {
    collector.ingest(req);
    return reply.code(204).send();
  });
  if (typeof app.addHook === 'function') app.addHook('onClose', async () => collector.close());
  return collector;
}

module.exports = { StatsCollector, registerStatsRoutes, TYPES, DEVICES, deviceOf, dayOf, SESSION_GAP_MS, QUEUE_MAX };
