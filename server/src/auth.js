'use strict';

const { transaction } = require('./db');
const sec = require('./security');

const GENERIC_ACCEPTED =
  "Si cette adresse est autorisée, un code de connexion vient d'être envoyé. Il est valable 10 minutes.";

/**
 * Administrator authentication by one-time e-mail code.
 * Framework independent: the HTTP layer only translates results into responses.
 */
class AuthService {
  constructor({ db, config, keys, mailer, now = Date.now, log = () => {} }) {
    this.db = db;
    this.config = config;
    this.keys = keys;
    this.mailer = mailer;
    this.now = now;
    this.log = log;
    this.inflight = new Set();
  }

  // ---------- helpers ----------

  ipHash(ip) {
    return sec.hashIp(this.keys.ipPepper, ip);
  }

  subject(email, isAdmin) {
    // Authorized addresses are recorded in clear (audit trail). Others only as a keyed hash.
    return isAdmin ? email : 'h:' + sec.hmac(this.keys.ipPepper, email || '').slice(0, 16);
  }

  isAdmin(email) {
    return !!this.db.prepare('SELECT 1 AS ok FROM admins WHERE email = ?').get(email);
  }

  event(type, { subject = null, ipHash = null, detail = null } = {}) {
    this.db
      .prepare('INSERT INTO auth_events (at, type, subject, ip_hash, detail) VALUES (?, ?, ?, ?, ?)')
      .run(this.now(), type, subject, ipHash, detail);
    this.log({ event: type, ipHash, detail });
  }

  /** Fixed-window counter in SQLite. Returns { allowed, retryAfterSec }. */
  hit(key, { limit, windowMs }) {
    const now = this.now();
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').get(key);
      if (!row || now - row.window_start >= windowMs) {
        this.db
          .prepare(
            'INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ' +
              'ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1'
          )
          .run(key, now);
        return { allowed: true, retryAfterSec: 0 };
      }
      if (row.count >= limit) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000)) };
      }
      this.db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
      return { allowed: true, retryAfterSec: 0 };
    });
  }

  checkLimits(checks) {
    let worst = null;
    for (const [key, rule] of checks) {
      const r = this.hit(key, rule);
      if (!r.allowed && (!worst || r.retryAfterSec > worst.retryAfterSec)) worst = r;
    }
    return worst;
  }

  // ---------- code request ----------

  /**
   * Always answers "accepted" for a well formed address, whether or not it is authorized,
   * and delivers the e-mail in the background so the response time does not reveal anything.
   */
  requestCode({ email: rawEmail, ip }) {
    const email = sec.normalizeEmail(rawEmail);
    if (!email) return { status: 'invalid' };

    const ipHash = this.ipHash(ip);
    const L = this.config.limits;
    const limited = this.checkLimits([
      ['req:ip:' + ipHash, L.requestPerIp],
      ['req:email:' + sec.hmac(this.keys.ipPepper, email).slice(0, 24), L.requestPerEmail],
    ]);
    if (limited) {
      this.event('code_request_rate_limited', { ipHash });
      return { status: 'rate_limited', retryAfterSec: limited.retryAfterSec };
    }

    if (!this.isAdmin(email)) {
      this.event('code_request_unauthorized', { subject: this.subject(email, false), ipHash });
      return { status: 'accepted', message: GENERIC_ACCEPTED };
    }

    const now = this.now();
    const recent = this.db
      .prepare(
        'SELECT created_at FROM login_codes WHERE email = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1'
      )
      .get(email, now);
    if (recent && now - recent.created_at < this.config.codeResendCooldownMs) {
      this.event('code_request_cooldown', { subject: email, ipHash });
      return { status: 'accepted', message: GENERIC_ACCEPTED };
    }

    const code = sec.randomCode();
    transaction(this.db, () => {
      this.db.prepare('UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL').run(now, email);
      this.db
        .prepare(
          'INSERT INTO login_codes (email, code_hash, created_at, expires_at, ip_hash) VALUES (?, ?, ?, ?, ?)'
        )
        .run(email, sec.hashCode(this.keys.codePepper, email, code), now, now + this.config.codeTtlMs, ipHash);
    });
    this.event('code_issued', { subject: email, ipHash });

    const job = this.deliver(email, code, ipHash).finally(() => this.inflight.delete(job));
    this.inflight.add(job);
    return { status: 'accepted', message: GENERIC_ACCEPTED };
  }

  async deliver(email, code, ipHash) {
    try {
      if (!this.mailer.ready()) {
        this.event('code_send_failed', { subject: email, ipHash, detail: 'mail_not_connected' });
        return;
      }
      await this.mailer.sendLoginCode({ to: email, code, ttlMinutes: Math.round(this.config.codeTtlMs / 60000) });
      this.event('code_sent', { subject: email, ipHash });
    } catch (err) {
      this.event('code_send_failed', { subject: email, ipHash, detail: String(err && err.code ? err.code : 'send_error') });
    }
  }

  /** Test helper: waits for background deliveries. */
  async idle() {
    await Promise.allSettled([...this.inflight]);
  }

  // ---------- code verification ----------

  verifyCode({ email: rawEmail, code: rawCode, ip }) {
    const email = sec.normalizeEmail(rawEmail);
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    const ipHash = this.ipHash(ip);
    const fail = (reason) => ({ status: 'invalid', reason });

    const L = this.config.limits;
    const limited = this.checkLimits([
      ['ver:ip:' + ipHash, L.verifyPerIp],
      ['ver:email:' + sec.hmac(this.keys.ipPepper, email || '').slice(0, 24), L.verifyPerEmail],
    ]);
    if (limited) {
      this.event('code_verify_rate_limited', { ipHash });
      return { status: 'rate_limited', retryAfterSec: limited.retryAfterSec };
    }

    const wellFormed = !!email && /^\d{6}$/.test(code);
    const now = this.now();
    // Always compute the HMAC so the work done does not depend on the input being valid.
    const candidate = sec.hashCode(this.keys.codePepper, email || '', wellFormed ? code : '000000');

    if (!wellFormed) {
      this.event('code_verify_failed', { subject: this.subject(email, false), ipHash, detail: 'malformed' });
      return fail('malformed');
    }
    if (!this.isAdmin(email)) {
      this.event('code_verify_failed', { subject: this.subject(email, false), ipHash, detail: 'unauthorized' });
      return fail('unauthorized');
    }

    const outcome = transaction(this.db, () => {
      const row = this.db
        .prepare(
          'SELECT id, code_hash, attempts FROM login_codes ' +
            'WHERE email = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1'
        )
        .get(email, now);
      if (!row) return { ok: false, reason: 'no_active_code' };

      if (row.attempts >= this.config.codeMaxAttempts) {
        this.db.prepare('UPDATE login_codes SET consumed_at = ? WHERE id = ?').run(now, row.id);
        return { ok: false, reason: 'locked' };
      }
      // The attempt is counted before the comparison, so a failed or interrupted check can never be free.
      this.db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);

      if (!sec.safeEqualHex(candidate, row.code_hash)) {
        const locked = row.attempts + 1 >= this.config.codeMaxAttempts;
        if (locked) this.db.prepare('UPDATE login_codes SET consumed_at = ? WHERE id = ?').run(now, row.id);
        return { ok: false, reason: locked ? 'locked' : 'wrong_code' };
      }
      const used = this.db
        .prepare('UPDATE login_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
        .run(now, row.id);
      if (used.changes !== 1) return { ok: false, reason: 'already_used' };
      return { ok: true };
    });

    if (!outcome.ok) {
      this.event(outcome.reason === 'locked' ? 'code_locked' : 'code_verify_failed', {
        subject: email,
        ipHash,
        detail: outcome.reason,
      });
      return fail(outcome.reason);
    }

    const sessionId = sec.randomToken(32);
    const expiresAt = now + this.config.sessionTtlMs;
    this.db
      .prepare('INSERT INTO sessions (id_hash, email, created_at, expires_at, ip_hash) VALUES (?, ?, ?, ?, ?)')
      .run(sec.sha256(sessionId), email, now, expiresAt, ipHash);
    this.event('login_success', { subject: email, ipHash });
    return { status: 'ok', email, sessionId, expiresAt, csrfToken: this.csrfFor(sessionId) };
  }

  // ---------- sessions ----------

  csrfFor(sessionId) {
    return sec.hmac(this.keys.csrfKey, sessionId);
  }

  getSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length < 20 || sessionId.length > 128) return null;
    const row = this.db
      .prepare(
        'SELECT s.email AS email, s.expires_at AS expires_at FROM sessions s JOIN admins a ON a.email = s.email ' +
          'WHERE s.id_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?'
      )
      .get(sec.sha256(sessionId), this.now());
    if (!row) return null;
    return { email: row.email, expiresAt: row.expires_at, csrfToken: this.csrfFor(sessionId) };
  }

  checkCsrf(sessionId, token) {
    return typeof token === 'string' && sec.safeEqualHex(this.csrfFor(sessionId), token);
  }

  logout(sessionId, ip) {
    const res = this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL')
      .run(this.now(), sec.sha256(sessionId));
    if (res.changes) this.event('logout', { ipHash: this.ipHash(ip) });
    return res.changes > 0;
  }

  /** Removes expired material. Authentication events are kept for 180 days. */
  cleanup() {
    const now = this.now();
    this.db.prepare('DELETE FROM login_codes WHERE expires_at < ?').run(now - 24 * 3600 * 1000);
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now - 24 * 3600 * 1000);
    this.db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(now - 24 * 3600 * 1000);
    this.db.prepare('DELETE FROM auth_events WHERE at < ?').run(now - 180 * 24 * 3600 * 1000);
  }
}

module.exports = { AuthService, GENERIC_ACCEPTED };
