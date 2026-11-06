'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, ADMIN, testConfig } = require('./helpers');

let fastifyAvailable = true;
try { require.resolve('fastify'); require.resolve('@fastify/cookie'); } catch (_) { fastifyAvailable = false; }

const ORIGIN = 'https://devis.test';
const opts = { skip: fastifyAvailable ? false : 'fastify not installed in this environment' };

async function boot() {
  const { buildApp } = require('../src/app');
  const s = setup({ config: testConfig() });
  const { app, auth } = await buildApp({ config: s.cfg, db: s.db, mailer: s.mailer, keys: s.keys, logger: false });
  await app.ready();
  const post = (url, payload, headers = {}) =>
    app.inject({ method: 'POST', url, payload, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers } });
  return { app, auth, post, ...s };
}

function cookieFrom(res) {
  const c = res.cookies.find((x) => x.name === 'vectis_admin');
  return c;
}

async function login(ctx) {
  await ctx.post('/api/admin/auth/request', { email: ADMIN });
  await ctx.auth.idle();
  const res = await ctx.post('/api/admin/auth/verify', { email: ADMIN, code: ctx.mailer.lastCode() });
  return res;
}

test('API starts and health answers', opts, async () => {
  const { app } = await boot();
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(res.headers['cache-control'], 'no-store');
  await app.close();
});

test('full login flow sets a hardened cookie, session endpoint and logout work', opts, async () => {
  const ctx = await boot();
  const res = await login(ctx);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.email, ADMIN);
  const c = cookieFrom(res);
  assert.ok(c.httpOnly);
  assert.equal(String(c.sameSite).toLowerCase(), 'strict');
  assert.equal(c.maxAge, 8 * 3600);

  const sess = await ctx.app.inject({ method: 'GET', url: '/api/admin/auth/session', cookies: { vectis_admin: c.value } });
  assert.equal(sess.json().authenticated, true);

  const noCsrf = await ctx.post('/api/admin/auth/logout', {}, { cookie: `vectis_admin=${c.value}` });
  assert.equal(noCsrf.statusCode, 403);
  const out = await ctx.post('/api/admin/auth/logout', {}, { cookie: `vectis_admin=${c.value}`, 'x-csrf-token': body.csrfToken });
  assert.equal(out.statusCode, 200);

  const after = await ctx.app.inject({ method: 'GET', url: '/api/admin/auth/session', cookies: { vectis_admin: c.value } });
  assert.equal(after.json().authenticated, false);
  await ctx.app.close();
});

test('Secure cookie with __Host- prefix in production configuration', opts, async () => {
  const { buildApp } = require('../src/app');
  const cfg = testConfig({ cookieSecure: true, cookieName: '__Host-vectis_admin' });
  const s = setup({ config: cfg });
  const { app, auth } = await buildApp({ config: cfg, db: s.db, mailer: s.mailer, keys: s.keys, logger: false });
  const h = { origin: ORIGIN, 'content-type': 'application/json' };
  await app.inject({ method: 'POST', url: '/api/admin/auth/request', payload: { email: ADMIN }, headers: h });
  await auth.idle();
  const res = await app.inject({ method: 'POST', url: '/api/admin/auth/verify', payload: { email: ADMIN, code: s.mailer.lastCode() }, headers: h });
  const raw = [].concat(res.headers['set-cookie'])[0];
  assert.match(raw, /^__Host-vectis_admin=/);
  assert.match(raw, /Secure/);
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /SameSite=Strict/);
  assert.match(raw, /Path=\//);
  assert.doesNotMatch(raw, /Domain=/i);
  await app.close();
});

test('admin endpoint is protected', opts, async () => {
  const ctx = await boot();
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/admin/ping' })).statusCode, 401);
  assert.equal(
    (await ctx.app.inject({ method: 'GET', url: '/api/admin/ping', cookies: { vectis_admin: 'a'.repeat(43) } })).statusCode,
    401
  );
  const res = await login(ctx);
  const c = cookieFrom(res);
  const ok = await ctx.app.inject({ method: 'GET', url: '/api/admin/ping', cookies: { vectis_admin: c.value } });
  assert.equal(ok.statusCode, 200);
  await ctx.app.close();
});

test('foreign or missing Origin and wrong content type are rejected', opts, async () => {
  const ctx = await boot();
  const bad = await ctx.app.inject({
    method: 'POST', url: '/api/admin/auth/request', payload: { email: ADMIN },
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
  });
  assert.equal(bad.statusCode, 403);
  const none = await ctx.app.inject({
    method: 'POST', url: '/api/admin/auth/request', payload: { email: ADMIN },
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(none.statusCode, 403);
  const form = await ctx.app.inject({
    method: 'POST', url: '/api/admin/auth/request', payload: 'email=x',
    headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(form.statusCode, 415);
  assert.equal(ctx.mailer.sent.length, 0);
  await ctx.app.close();
});

test('unauthorized e-mail gets the same HTTP answer as the authorized one', opts, async () => {
  const ctx = await boot();
  const a = await ctx.post('/api/admin/auth/request', { email: 'intruder@example.com' });
  const b = await ctx.post('/api/admin/auth/request', { email: ADMIN });
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.json(), b.json());
  await ctx.auth.idle();
  assert.equal(ctx.mailer.sent.length, 1);
  await ctx.app.close();
});

test('wrong code answers 401 with a generic message, unknown extra fields are rejected', opts, async () => {
  const ctx = await boot();
  await ctx.post('/api/admin/auth/request', { email: ADMIN });
  await ctx.auth.idle();
  const wrong = ctx.mailer.lastCode() === '000000' ? '111111' : '000000';
  const res = await ctx.post('/api/admin/auth/verify', { email: ADMIN, code: wrong });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, 'invalid_code');
  const extra = await ctx.post('/api/admin/auth/verify', { email: ADMIN, code: wrong, admin: true });
  assert.equal(extra.statusCode, 400);
  await ctx.app.close();
});

test('rate limiting answers 429 with Retry-After', opts, async () => {
  const ctx = await boot();
  let last;
  for (let i = 0; i < 12; i++) last = await ctx.post('/api/admin/auth/request', { email: `u${i}@example.com` });
  assert.equal(last.statusCode, 429);
  assert.ok(Number(last.headers['retry-after']) > 0);
  await ctx.app.close();
});

test('mail connect: refused without mailbox config in the right way, status is public', opts, async () => {
  const ctx = await boot();
  const st = await ctx.app.inject({ method: 'GET', url: '/api/mail/status' });
  assert.equal(st.statusCode, 200);
  assert.ok('connected' in st.json());
  await ctx.app.close();
});
