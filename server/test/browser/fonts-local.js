'use strict';

// Aucune requête hors du site pendant le chargement de la page d'accueil, et Montserrat réellement chargée depuis /fonts/.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* ignoré */ }
const ROOT = process.env.BANNER_TEST_ROOT || path.join(__dirname, '..', '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.woff': 'font/woff', '.js': 'application/javascript' };

let srv, base, browser;
test.before(async () => {
  if (!chromium) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname === '/' ? '/index.html' : u.pathname;
    if (p === '/api/site/content') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true,"content":{}}'); }
    const f = path.join(ROOT, p);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile() && TYPES[path.extname(f)]) { res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] }); return res.end(fs.readFileSync(f)); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}`;
  try { browser = await chromium.launch(); } catch { browser = null; }
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

test('page d\'accueil : toutes les requêtes restent sur le site ; Montserrat chargée depuis /fonts/', { skip: !chromium ? 'playwright indisponible' : false }, async () => {
  const page = await browser.newPage(); const hosts = new Set(), urls = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http')) { hosts.add(u.host); urls.push(u.pathname); } });
  await page.goto(base + '/'); await page.waitForTimeout(800);
  const f = await page.evaluate(async () => { await document.fonts.ready; return { check: document.fonts.check('600 16px Montserrat'), loaded: [...document.fonts].filter((x) => x.status === 'loaded').map((x) => x.family + ' ' + x.style) }; });
  assert.deepEqual([...hosts], [new URL(base).host], 'seul l\'hôte du site : ' + [...hosts]);
  assert.ok(urls.includes('/fonts/montserrat-latin.woff'), 'police chargée depuis /fonts/');
  assert.equal(f.check, true); assert.ok(f.loaded.some((x) => /Montserrat normal/.test(x)), JSON.stringify(f.loaded));
  await page.close();
});
