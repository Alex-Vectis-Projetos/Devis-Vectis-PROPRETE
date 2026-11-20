'use strict';

// Static checks of the preview deployment files (nothing here is applied anywhere): they must stay isolated from production.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', '..', 'deploy', 'preview');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const strip = (t) => t.replace(/^\s*#.*$/gm, '');
const compose = strip(read('docker-compose.preview.yml'));
const prod = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'docker-compose.yml'), 'utf8'));
const nginx = strip(read('nginx-preview-stats.conf'));
const env = read('preview.env.example');

test('preview compose shares nothing with the production compose', () => {
  const val = (t, re) => [...t.matchAll(re)].map((m) => m[1]);
  assert.match(compose, /^name:\s*vectis-preview$/m);
  for (const re of [/container_name:\s*(\S+)/g, /^\s+name:\s*(\S+)/gm, /"127\.0\.0\.1:(\d+):\d+"/g, /^\s+- (\/etc\/\S+)/gm, /subnet:\s*(\S+)/g]) {
    const a = val(compose, re); const b = val(prod, re);
    assert.ok(a.length > 0, String(re));
    for (const x of a) assert.ok(!b.includes(x), `${x} is also used by production`);
  }
  assert.match(compose, /127\.0\.0\.1:3101:3100/);
  assert.match(compose, /PREVIEW_MODE:\s*"1"/);
  assert.match(compose, /PUBLIC_ORIGIN:\s*https:\/\/preview-stats\.mrprop\.fr/);
  assert.doesNotMatch(compose, /\/etc\/devis-vectis\/|devis_vectis_|devis\.mrprop\.fr|3100:3100/);
  assert.doesNotMatch(compose, /GOOGLE|MAIL_|STATS_ENABLED/);
  assert.match(compose, /TRUST_PROXY:\s*172\.28\.77\.1/);
  assert.match(compose, /gateway:\s*172\.28\.77\.1/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
});

test('preview env example holds no real secret and no Google/mail setting', () => {
  assert.match(env, /ADMIN_EMAILS=preview-admin@preview\.invalid/);
  assert.doesNotMatch(strip(env), /GOOGLE|MAIL_SETUP|MAIL_SENDER|QUOTE_RECIPIENT/);
  assert.doesNotMatch(env, /SESSION_SECRET=[0-9a-f]{32,}/);
});

test('preview nginx vhost: own host, basic auth, noindex, proxy to 3101 only, no production snippet', () => {
  assert.equal([...nginx.matchAll(/server_name\s+([^;]+);/g)].every((m) => m[1].trim() === 'preview-stats.mrprop.fr'), true);
  assert.doesNotMatch(nginx, /devis\.mrprop\.fr|snippets\/devis-vectis|127\.0\.0\.1:3100/);
  assert.match(nginx, /auth_basic\s+"VECTIS preview";/);
  assert.match(nginx, /auth_basic_user_file\s+\/etc\/nginx\/preview-stats\.htpasswd;/);
  assert.match(nginx, /X-Robots-Tag\s+"noindex, nofollow, noarchive"/);
  assert.deepEqual([...nginx.matchAll(/proxy_pass\s+([^;]+);/g)].map((m) => m[1]), ['http://127.0.0.1:3101']);
  assert.match(nginx, /proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;/);
  assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for/);
  assert.match(nginx, /location\s+\^~\s+\/api\/\s*\{/);
  for (const d of ['/server/', '/deploy/', '/.github/']) assert.ok(nginx.includes(`location ^~ ${d} { return 404; }`), d);
  const ext = nginx.match(/location\s+~\*\s+\\\.\(([^)]+)\)\$/)[1].split('|');
  for (const e of ['db', 'env', 'sh', 'md', 'json', 'yml', 'example']) assert.ok(ext.includes(e), e);
});
