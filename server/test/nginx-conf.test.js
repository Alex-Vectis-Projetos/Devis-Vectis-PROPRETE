'use strict';

// Static checks of the Nginx snippet. nginx itself is validated on the server (nginx -t) at install time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const conf = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'nginx-devis-vectis-api.conf'), 'utf8');
const code = conf.replace(/^\s*#.*$/gm, '');
const headersConf = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'nginx-devis-vectis-headers.conf'), 'utf8');
const headersCode = headersConf.replace(/^\s*#.*$/gm, '');

test('proxy uses ^~ /api/ and targets the loopback API only', () => {
  assert.match(code, /location\s+\^~\s+\/api\/\s*\{/);
  assert.doesNotMatch(code, /location\s+\/api\//);
  const targets = [...code.matchAll(/proxy_pass\s+([^;]+);/g)].map((m) => m[1]);
  assert.ok(targets.length >= 1);
  assert.ok(targets.every((t) => t === 'http://127.0.0.1:3100'), 'every proxy_pass targets the loopback API');
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

test('security headers live in their own file, included once by the snippet', () => {
  assert.equal((code.match(/include\s+\/etc\/nginx\/snippets\/devis-vectis-headers\.conf;/g) || []).length, 1);
  // no add_header at the snippet's server level: only inside location /api/ (needed because add_header there stops inheritance)
  const outsideLocations = code.replace(/location[^{]*\{[^}]*\}/g, '');
  assert.doesNotMatch(outsideLocations, /add_header/);
});

test('security headers are present and CSP forbids framing', () => {
  for (const h of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Content-Security-Policy', 'Permissions-Policy']) {
    assert.ok(new RegExp(`add_header\\s+${h}\\s`).test(headersCode), h);
  }
  assert.match(headersCode, /frame-ancestors 'none'/);
  assert.match(headersCode, /object-src 'none'/);
  assert.doesNotMatch(headersCode, /includeSubDomains|preload/);
  assert.doesNotMatch(code, /includeSubDomains|preload/);
});

test('each security header appears at most once per scope', () => {
  const names = [...headersCode.matchAll(/add_header\s+([A-Za-z-]+)\s/g)].map((m) => m[1].toLowerCase());
  assert.equal(new Set(names).size, names.length);
  const api = code.match(/location\s+\^~\s+\/api\/\s*\{([^}]*)\}/)[1];
  const apiNames = [...api.matchAll(/add_header\s+([A-Za-z-]+)\s/g)].map((m) => m[1].toLowerCase());
  assert.equal(new Set(apiNames).size, apiNames.length);
});

test('the snippet does not touch the site root, TLS or Certbot settings', () => {
  for (const d of ['root ', 'ssl_certificate', 'listen ', 'server_name', 'return 301']) assert.ok(!code.includes(d), d);
});

test('only the admin content route and the public quote route accept large bodies; the rest of /api/ stays at 8k', () => {
  const sizeOf = (loc) => {
    const m = code.match(new RegExp('location\\s+\\^~\\s+' + loc.replace(/\//g, '\\/') + '\\s*\\{[^}]*client_max_body_size\\s+([^;]+);'));
    return m && m[1];
  };
  assert.equal(sizeOf('/api/'), '8k');
  assert.equal(sizeOf('/api/admin/site/'), '11m');
  assert.equal(sizeOf('/api/quotes'), '11m');
  assert.equal((code.match(/client_max_body_size\s+11m/g) || []).length, 2);
});
