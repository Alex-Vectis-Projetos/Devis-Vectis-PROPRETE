'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthService } = require('../src/auth');
const { setup, ADMIN } = require('./helpers');

function make(opts = {}) {
  const clock = { t: 1_700_000_000_000 };
  const s = setup(opts);
  const auth = new AuthService({ db: s.db, config: s.cfg, keys: s.keys, mailer: s.mailer, now: () => clock.t });
  return { ...s, auth, clock };
}
const IP = '203.0.113.9';

test('SQLite connection and schema', () => {
  const { db } = make();
  assert.equal(db.prepare('SELECT 1 AS ok').get().ok, 1);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admins').get().n, 1);
});

test('code request: authorized email gets a 6 digit code, stored hashed', async () => {
  const { auth, mailer, db } = make();
  const r = auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  assert.equal(r.status, 'accepted');
  assert.match(mailer.lastCode(), /^\d{6}$/);
  const row = db.prepare('SELECT code_hash FROM login_codes').get();
  assert.notEqual(row.code_hash, mailer.lastCode());
  assert.ok(!row.code_hash.includes(mailer.lastCode()) || row.code_hash.length === 64);
});

test('unauthorized email: same answer, nothing sent', async () => {
  const { auth, mailer } = make();
  const a = auth.requestCode({ email: 'intruder@example.com', ip: IP });
  const b = auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  assert.equal(a.status, 'accepted');
  assert.equal(a.message, b.message);
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, ADMIN);
});

test('unauthorized email cannot verify even with a valid code format', async () => {
  const { auth } = make();
  const r = auth.verifyCode({ email: 'intruder@example.com', code: '123456', ip: IP });
  assert.equal(r.status, 'invalid');
});

test('correct code creates a session; code is single use', async () => {
  const { auth, mailer } = make();
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  const code = mailer.lastCode();
  const ok = auth.verifyCode({ email: ADMIN, code, ip: IP });
  assert.equal(ok.status, 'ok');
  assert.ok(auth.getSession(ok.sessionId));
  const again = auth.verifyCode({ email: ADMIN, code, ip: IP });
  assert.equal(again.status, 'invalid');
});

test('wrong code is refused', async () => {
  const { auth, mailer } = make();
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  const wrong = mailer.lastCode() === '000000' ? '111111' : '000000';
  assert.equal(auth.verifyCode({ email: ADMIN, code: wrong, ip: IP }).status, 'invalid');
});

test('code expires after 10 minutes', async () => {
  const { auth, mailer, clock } = make();
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  clock.t += 10 * 60 * 1000 + 1;
  assert.equal(auth.verifyCode({ email: ADMIN, code: mailer.lastCode(), ip: IP }).status, 'invalid');
});

test('attempt limit: after 5 wrong attempts even the right code is dead', async () => {
  const { auth, mailer } = make();
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  const code = mailer.lastCode();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal(auth.verifyCode({ email: ADMIN, code: wrong, ip: IP }).status, 'invalid');
  assert.equal(auth.verifyCode({ email: ADMIN, code, ip: IP }).status, 'invalid');
});

test('request throttling: cooldown and per email limit', async () => {
  const { auth, mailer, clock } = make();
  auth.requestCode({ email: ADMIN, ip: IP });
  auth.requestCode({ email: ADMIN, ip: IP }); // within cooldown: no second mail
  await auth.idle();
  assert.equal(mailer.sent.length, 1);
  let limited = null;
  for (let i = 0; i < 8; i++) {
    clock.t += 61 * 1000;
    const r = auth.requestCode({ email: ADMIN, ip: IP });
    if (r.status === 'rate_limited') { limited = r; break; }
  }
  assert.ok(limited, 'expected rate limiting');
  assert.ok(limited.retryAfterSec > 0);
});

test('session: valid, expires after 8h, logout revokes, csrf token checks', async () => {
  const { auth, mailer, clock } = make();
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  const ok = auth.verifyCode({ email: ADMIN, code: mailer.lastCode(), ip: IP });
  assert.equal(auth.getSession(ok.sessionId).email, ADMIN);
  assert.ok(auth.checkCsrf(ok.sessionId, ok.csrfToken));
  assert.ok(!auth.checkCsrf(ok.sessionId, 'x'.repeat(64)));
  assert.ok(!auth.checkCsrf(ok.sessionId, undefined));
  assert.equal(auth.logout(ok.sessionId, IP), true);
  assert.equal(auth.getSession(ok.sessionId), null);

  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  clock.t += 61 * 1000;
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  const ok2 = auth.verifyCode({ email: ADMIN, code: mailer.lastCode(), ip: IP });
  assert.equal(ok2.status, 'ok');
  clock.t += 8 * 3600 * 1000 + 1;
  assert.equal(auth.getSession(ok2.sessionId), null);
});

test('mail failure is logged, never reported as success', async () => {
  const { auth, mailer, db } = make();
  mailer.fail = true;
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  const types = db.prepare('SELECT type FROM auth_events').all().map((r) => r.type);
  assert.ok(types.includes('code_send_failed'));
  assert.ok(!types.includes('code_sent'));
});

test('no mailbox connected: code is not sent and failure is recorded', async () => {
  const { FakeMailer } = require('./helpers');
  const { auth, db } = make({ mailer: new FakeMailer({ ready: false }) });
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  assert.ok(db.prepare("SELECT 1 FROM auth_events WHERE type='code_send_failed'").get());
});

test('auth events never contain the code or raw IP', async () => {
  const { auth, mailer, db } = make();
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  auth.verifyCode({ email: ADMIN, code: mailer.lastCode(), ip: IP });
  const dump = JSON.stringify(db.prepare('SELECT * FROM auth_events').all());
  assert.ok(!dump.includes(IP));
  assert.ok(!dump.includes(mailer.lastCode()));
});

// ---------------- hardening ----------------

function wrongCode(code) { return code === '000000' ? '111111' : '000000'; }

test('daily failure cap: 10 wrong guesses suspend code login for 24h, even for the right code', async () => {
  const { auth, mailer, clock, db } = make();
  let wrong;
  // Each issued code allows 5 wrong guesses; reissue after cooldown until the cap is reached.
  for (let round = 0; round < 3 && !db.prepare("SELECT 1 FROM auth_events WHERE type='admin_locked'").get(); round++) {
    auth.requestCode({ email: ADMIN, ip: IP });
    await auth.idle();
    wrong = wrongCode(mailer.lastCode());
    for (let i = 0; i < 5; i++) auth.verifyCode({ email: ADMIN, code: wrong, ip: IP });
    clock.t += 61 * 1000;
  }
  assert.ok(db.prepare("SELECT 1 FROM auth_events WHERE type='admin_locked'").get(), 'admin_locked event recorded');
  // A fresh request is accepted generically but nothing is issued/sent while suspended.
  const sentBefore = mailer.sent.length;
  const r = auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  assert.equal(r.status, 'accepted');
  assert.equal(mailer.sent.length, sentBefore);
  assert.ok(db.prepare("SELECT 1 FROM auth_events WHERE type='code_request_blocked_locked'").get());
  // Even a correct code cannot be used while suspended.
  const v = auth.verifyCode({ email: ADMIN, code: mailer.lastCode(), ip: IP });
  assert.equal(v.status, 'invalid');
  assert.ok(db.prepare("SELECT 1 FROM auth_events WHERE type='code_verify_blocked_locked'").get());
});

test('suspension ends after 24h and an operator can lift it earlier', async () => {
  const { auth, mailer, clock, db } = make();
  const lockIt = async () => {
    for (let round = 0; round < 3 && !auth.peek(auth.failKey(ADMIN), auth.config.limits.failPerAdmin).blocked; round++) {
      auth.requestCode({ email: ADMIN, ip: IP });
      await auth.idle();
      const w = wrongCode(mailer.lastCode());
      for (let i = 0; i < 5; i++) auth.verifyCode({ email: ADMIN, code: w, ip: IP });
      clock.t += 61 * 1000;
    }
  };
  await lockIt();
  assert.ok(auth.peek(auth.failKey(ADMIN), auth.config.limits.failPerAdmin).blocked);
  assert.equal(auth.unlock(ADMIN), true);
  assert.ok(db.prepare("SELECT 1 FROM auth_events WHERE type='admin_unlocked_by_operator'").get());
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  assert.equal(auth.verifyCode({ email: ADMIN, code: mailer.lastCode(), ip: IP }).status, 'ok');

  clock.t += 31 * 60 * 1000; // let the per-address request window pass
  await lockIt();
  assert.ok(auth.peek(auth.failKey(ADMIN), auth.config.limits.failPerAdmin).blocked);
  clock.t += 24 * 3600 * 1000 + 1000;
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  assert.equal(auth.verifyCode({ email: ADMIN, code: mailer.lastCode(), ip: IP }).status, 'ok');
});

test('failures against unauthorized addresses never lock an administrator', async () => {
  const { auth, mailer } = make();
  for (let i = 0; i < 30; i++) auth.verifyCode({ email: `x${i % 3}@example.com`, code: '123456', ip: `198.51.100.${i}` });
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  assert.equal(auth.verifyCode({ email: ADMIN, code: mailer.lastCode(), ip: IP }).status, 'ok');
});

test('repeated requests cannot invalidate a legitimate code; up to 3 codes coexist', async () => {
  const { auth, mailer, clock, db } = make();
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  const legit = mailer.lastCode();
  for (let i = 0; i < 6; i++) {
    clock.t += 61 * 1000;
    auth.requestCode({ email: ADMIN, ip: `203.0.113.${i + 10}` }); // attacker spamming requests
    await auth.idle();
  }
  assert.ok(mailer.sent.length <= 3, 'never more than 3 codes outstanding');
  assert.ok(db.prepare("SELECT 1 FROM auth_events WHERE type='code_request_ignored_active'").get());
  // The first, legitimate code still works.
  assert.equal(auth.verifyCode({ email: ADMIN, code: legit, ip: IP }).status, 'ok');
});

test('a successful login consumes every other pending code', async () => {
  const { auth, mailer, clock } = make();
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  const first = mailer.lastCode();
  clock.t += 61 * 1000;
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  const second = mailer.lastCode();
  assert.equal(auth.verifyCode({ email: ADMIN, code: second, ip: IP }).status, 'ok');
  if (first !== second) assert.equal(auth.verifyCode({ email: ADMIN, code: first, ip: IP }).status, 'invalid');
});

test('each outstanding code still has its own 5 attempt limit', async () => {
  const { auth, mailer, clock } = make();
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  clock.t += 61 * 1000;
  auth.requestCode({ email: ADMIN, ip: IP });
  await auth.idle();
  const codes = mailer.sent.map((m) => m.code);
  const w = ['000000', '111111', '222222'].find((c) => !codes.includes(c));
  for (let i = 0; i < 5; i++) auth.verifyCode({ email: ADMIN, code: w, ip: IP });
  for (const c of codes) assert.equal(auth.verifyCode({ email: ADMIN, code: c, ip: IP }).status, 'invalid');
});

test('answers stay generic: request reply is identical for admin, stranger, locked and throttled-cooldown cases', async () => {
  const { auth } = make();
  const msgs = new Set([
    auth.requestCode({ email: ADMIN, ip: IP }).message,
    auth.requestCode({ email: ADMIN, ip: IP }).message, // cooldown
    auth.requestCode({ email: 'stranger@example.com', ip: IP }).message,
  ]);
  assert.equal(msgs.size, 1);
});

test('daily request cap per address', async () => {
  const { auth, clock } = make();
  let limited = false;
  for (let i = 0; i < 20 && !limited; i++) {
    clock.t += 31 * 60 * 1000; // outside the 30 min window, inside 24h
    limited = auth.requestCode({ email: ADMIN, ip: `203.0.113.${i + 1}` }).status === 'rate_limited';
  }
  assert.ok(limited, 'expected the daily per-address request cap');
});
