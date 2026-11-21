'use strict';

// Guard rails for the browser collector that need no browser (CI): the page loads it, the quote code is untouched, CSP allows it.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const collect = fs.readFileSync(path.join(ROOT, 'stats-collect.js'), 'utf8');

test('index.html loads stats-collect.js deferred, from the same origin, once', () => {
  assert.equal((html.match(/<script[^>]+src="\/stats-collect\.js\?v=\d+"[^>]*defer/g) || []).length, 1);
});

test('the quote code is untouched: sendQuote() is byte-identical to the production version (823cc53)', () => {
  const m = html.match(/function sendQuote\(\)\{[\s\S]*?\n\}\n/);
  assert.ok(m);
  assert.equal(crypto.createHash('sha256').update(m[0]).digest('hex'), '5cdabf2d88ecc64ca5e4713663bfad5d4529b3eddfb493636b8c75685ac24938',
    'sendQuote() must not change for the statistics module');
});

test('the collector sends only { t, g } to /api/stats/e and never touches quote, upload, auth or storage APIs', () => {
  const code = collect.replace(/\/\*[\s\S]*?\*\//g, '');
  const urls = [...code.matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(urls)], ['/api/stats/e']);
  assert.doesNotMatch(code, /FormData|\.value\b|localStorage|sessionStorage|indexedDB|document\.cookie|sendBeacon|XMLHttpRequest|navigator\.(userAgent|language|plugins)|screen\.|innerHTML|eval\(/);
  assert.doesNotMatch(code, /credentials\s*:\s*['"]omit/, 'cookies must be sent (same-origin) so that administrator traffic is recognised and not counted');
});

test('event types and target format of the collector match the server contract', () => {
  const { TYPES } = require('../src/stats');
  const used = [...collect.matchAll(/send\('([a-z_]+)'/g)].map((m) => m[1]);
  for (const t of used) assert.ok(TYPES.includes(t), t);
  assert.deepEqual([...new Set(used)].sort(), ['category_view', 'email_click', 'form_open', 'form_start', 'gallery_open', 'phone_click', 'view'].sort());
  assert.match(collect, /ID_RE = \/\^\[a-z0-9\]\[a-z0-9_-\]\{0,39\}\$\//);
});

test('the Content-Security-Policy of the site allows the collector (script-src self, connect-src self)', () => {
  const csp = fs.readFileSync(path.join(ROOT, 'deploy', 'nginx-devis-vectis-headers.conf'), 'utf8');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
});
