'use strict';

// Static checks of the Nginx snippet. nginx itself is validated on the server (nginx -t) at install time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const conf = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'nginx-devis-vectis-api.conf'), 'utf8');
const code = conf.replace(/^\s*#.*$/gm, '');

test('proxy uses ^~ /api/ and targets the loopback API only', () => {
  assert.match(code, /location\s+\^~\s+\/api\/\s*\{/);
  assert.doesNotMatch(code, /location\s+\/api\//);
  const targets = [...code.matchAll(/proxy_pass\s+([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual(targets, ['http://127.0.0.1:3100']);
});

test('the API never receives client-supplied forwarding headers', () => {
  assert.match(code, /proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;/);
  assert.doesNotMatch(code, /\$proxy_add_x_forwarded_for/);
});

test('hidden files, repo, server code, deploy scripts and secrets are denied', () => {
  assert.match(code, /location\s+~\s+\/\\\.\(\?!well-known\/\)\s*\{\s*return 404;/);
  for (const dir of ['/server/', '/deploy/', '/.github/']) {
    assert.ok(code.includes(`location ^~ ${dir} { return 404; }`), dir);
  }
  const ext = code.match(/location\s+~\*\s+\\\.\(([^)]+)\)\$/)[1].split('|');
  for (const e of ['db', 'sqlite', 'env', 'log', 'sh', 'md', 'json', 'lock']) assert.ok(ext.includes(e), e);
});

test('security headers are present and CSP forbids framing', () => {
  for (const h of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Content-Security-Policy', 'Permissions-Policy']) {
    assert.ok(new RegExp(`add_header\\s+${h}\\s`).test(code), h);
  }
  assert.match(code, /frame-ancestors 'none'/);
  assert.match(code, /object-src 'none'/);
  assert.doesNotMatch(code, /includeSubDomains|preload/);
});

test('the snippet does not touch the site root, TLS or Certbot settings', () => {
  for (const d of ['root ', 'ssl_certificate', 'listen ', 'server_name', 'return 301']) assert.ok(!code.includes(d), d);
});
