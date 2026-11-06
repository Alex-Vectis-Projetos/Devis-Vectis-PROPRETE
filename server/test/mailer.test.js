'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GraphMailer, loginCodeMessage } = require('../src/mailer');
const { setup } = require('./helpers');

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function make(handler) {
  const s = setup();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls);
  };
  const mailer = new GraphMailer({ db: s.db, config: s.cfg, keys: s.keys, fetchImpl });
  return { ...s, mailer, calls };
}

test('login message contains the code and ttl, escaped HTML', () => {
  const m = loginCodeMessage({ to: 'a@b.c', code: '123456', ttlMinutes: 10 });
  assert.match(m.body.content, /123 456/);
  assert.match(m.body.content, /10 minutes/);
  assert.equal(m.toRecipients[0].emailAddress.address, 'a@b.c');
});

test('device flow connects only the configured sender and stores the token encrypted', async () => {
  const { mailer, db } = make((url) => {
    if (url.endsWith('/devicecode')) return json(200, { device_code: 'dc', user_code: 'ABCD', verification_uri: 'https://www.microsoft.com/link', expires_in: 900, interval: 5 });
    if (url.endsWith('/token')) return json(200, { access_token: 'AT', refresh_token: 'RT-secret', expires_in: 3600 });
    if (url.includes('/me?')) return json(200, { mail: 'Vectis.Adm@hotmail.com' });
    throw new Error('unexpected ' + url);
  });
  assert.equal(mailer.ready(), false);
  const flow = await mailer.startDeviceFlow();
  assert.equal(flow.userCode, 'ABCD');
  const r = await mailer.pollDeviceFlow();
  assert.equal(r.status, 'connected');
  assert.equal(mailer.ready(), true);
  const stored = db.prepare('SELECT value FROM kv').get().value;
  assert.ok(!stored.includes('RT-secret'));
});

test('device flow refuses a different Microsoft account', async () => {
  const { mailer } = make((url) => {
    if (url.endsWith('/devicecode')) return json(200, { device_code: 'dc', user_code: 'ABCD', expires_in: 900 });
    if (url.endsWith('/token')) return json(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    return json(200, { mail: 'someone.else@outlook.com' });
  });
  await mailer.startDeviceFlow();
  const r = await mailer.pollDeviceFlow();
  assert.deepEqual([r.status, r.reason], ['error', 'wrong_account']);
  assert.equal(mailer.ready(), false);
});

test('pending authorization keeps polling', async () => {
  const { mailer } = make((url) => {
    if (url.endsWith('/devicecode')) return json(200, { device_code: 'dc', user_code: 'ABCD', expires_in: 900 });
    return json(400, { error: 'authorization_pending' });
  });
  await mailer.startDeviceFlow();
  assert.equal((await mailer.pollDeviceFlow()).status, 'pending');
});

test('sendLoginCode uses Graph sendMail and requires HTTP 202', async () => {
  let status = 202;
  const { mailer, calls, db, keys } = make((url) => {
    if (url.endsWith('/token')) return json(200, { access_token: 'AT2', expires_in: 3600 });
    if (url.endsWith('/me/sendMail')) return json(status, {});
    throw new Error('unexpected ' + url);
  });
  const sec = require('../src/security');
  db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run(
    'ms_graph_tokens', sec.encryptJson(keys.tokenKey, { refreshToken: 'RT', account: 'vectis.adm@hotmail.com' }), 1);
  await mailer.init();
  assert.equal(mailer.ready(), true);
  await mailer.sendLoginCode({ to: 'vectis.adm@hotmail.com', code: '654321', ttlMinutes: 10 });
  const send = calls.find((c) => c.url.endsWith('/me/sendMail'));
  assert.equal(send.init.headers.Authorization, 'Bearer AT2');
  assert.match(send.init.body, /654 321/);
  status = 500;
  await assert.rejects(() => mailer.sendLoginCode({ to: 'x@y.z', code: '111111', ttlMinutes: 10 }), /graph_send_failed_500/);
});

test('revoked authorization disconnects the mailbox', async () => {
  const { mailer, db, keys } = make((url) => json(400, { error: 'invalid_grant' }));
  const sec = require('../src/security');
  db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)').run(
    'ms_graph_tokens', sec.encryptJson(keys.tokenKey, { refreshToken: 'RT', account: 'a' }), 1);
  await mailer.init();
  await assert.rejects(() => mailer.sendLoginCode({ to: 'x@y.z', code: '111111', ttlMinutes: 10 }), /mail_authorization_revoked/);
  assert.equal(mailer.ready(), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kv').get().n, 0);
});
