'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GmailMailer, loginCodeMessage, SCOPE } = require('../src/mailer');
const { setup } = require('./helpers');
const sec = require('../src/security');

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function make(handler) {
  const s = setup();
  const calls = [];

  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls);
  };

  const clock = { t: 1_700_000_000_000 };
  const mailer = new GmailMailer({
    db: s.db,
    config: s.cfg,
    keys: s.keys,
    fetchImpl,
    now: () => clock.t,
  });

  return { ...s, mailer, calls, clock };
}

test('login message contains the code, ttl and escaped HTML', () => {
  const m = loginCodeMessage({
    to: 'a@b.c',
    code: '123456',
    ttlMinutes: 10,
  });

  assert.equal(m.to, 'a@b.c');
  assert.match(m.subject, /VECTIS/);
  assert.match(m.html, /123 456/);
  assert.match(m.html, /10 minutes/);

  const escaped = loginCodeMessage({
    to: 'a@b.c',
    code: '<123456',
    ttlMinutes: '<10>',
  });

  assert.match(escaped.html, /&lt;12 3456/);
  assert.match(escaped.html, /&lt;10&gt;/);
});

test('OAuth URL uses the configured Google client and callback', () => {
  const { mailer } = make(() => {
    throw new Error('fetch não deveria ser chamado');
  });

  const result = mailer.startOAuthFlow({ state: 'state-test-123' });
  const url = new URL(result.authorizationUrl);

  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.pathname, '/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://devis.test/api/mail/oauth/callback'
  );
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), SCOPE);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'state-test-123');
});

test('OAuth accepts only the configured verified account and stores refresh token encrypted', async () => {
  const { mailer, db, calls, keys } = make((url) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return json(200, {
        access_token: 'ACCESS-secret',
        refresh_token: 'REFRESH-secret',
        expires_in: 3600,
        scope: 'openid email https://www.googleapis.com/auth/gmail.send',
      });
    }

    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      return json(200, {
        email: 'Admin@Example.test',
        email_verified: true,
      });
    }

    throw new Error('unexpected ' + url);
  });

  const result = await mailer.completeOAuthFlow({ code: 'authorization-code' });

  assert.deepEqual(result, {
    status: 'connected',
    account: 'admin@example.test',
  });
  assert.equal(mailer.ready(), true);
  assert.equal(calls.length, 2);

  const tokenCall = calls[0];
  const params = new URLSearchParams(tokenCall.init.body);

  assert.equal(params.get('code'), 'authorization-code');
  assert.equal(params.get('client_id'), 'client-id');
  assert.equal(params.get('client_secret'), 'client-secret');
  assert.equal(params.get('grant_type'), 'authorization_code');

  const stored = db.prepare(
    "SELECT value FROM kv WHERE key = 'google_gmail_tokens'"
  ).get();

  assert.ok(stored);
  assert.ok(!stored.value.includes('REFRESH-secret'));
  assert.deepEqual(
    sec.decryptJson(keys.tokenKey, stored.value),
    {
      refreshToken: 'REFRESH-secret',
      account: 'admin@example.test',
    }
  );
});

test('OAuth rejects missing Gmail send scope and preserves the previous token', async () => {
  const { mailer, db, calls, keys } = make((url) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return json(200, {
        access_token: 'NEW-ACCESS-secret',
        refresh_token: 'NEW-REFRESH-secret',
        expires_in: 3600,
        scope: 'openid email',
      });
    }

    throw new Error('unexpected ' + url);
  });

  mailer.tokens = {
    refreshToken: 'OLD-REFRESH-secret',
    account: 'admin@example.test',
  };
  mailer.persist();

  const before = db.prepare(
    "SELECT value FROM kv WHERE key = 'google_gmail_tokens'"
  ).get();

  await assert.rejects(
    mailer.completeOAuthFlow({ code: 'authorization-code' }),
    (err) => err.code === 'gmail_send_scope_missing'
  );

  const after = db.prepare(
    "SELECT value FROM kv WHERE key = 'google_gmail_tokens'"
  ).get();

  assert.equal(calls.length, 1);
  assert.equal(after.value, before.value);
  assert.equal(mailer.tokens.refreshToken, 'OLD-REFRESH-secret');
  assert.equal(mailer.ready(), true);
  assert.deepEqual(
    sec.decryptJson(keys.tokenKey, after.value),
    {
      refreshToken: 'OLD-REFRESH-secret',
      account: 'admin@example.test',
    }
  );
});
