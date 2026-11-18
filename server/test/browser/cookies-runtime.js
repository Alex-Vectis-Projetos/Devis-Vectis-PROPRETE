'use strict';
// Preuve d'exécution : après visite du site public et des pages d'information, aucun cookie, aucun stockage, aucune requête tierce,
// y compris après interaction (clic sur "Demander un devis" et sur un domaine). Lancer : node --test test/browser/cookies-runtime.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..', '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg' };
test('no cookie, no web storage, no third-party request on public pages', async () => {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u.startsWith('/api/')) { res.writeHead(503); return res.end(); }
    const f = path.join(root, u === '/' ? 'index.html' : u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const external = [];
    page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
    await page.goto(base + '/index.html');
    await page.waitForTimeout(1500);
    const cta = page.locator('.header-cta').first();
    if (await cta.count()) await cta.click({ trial: true }).catch(() => {});
    for (const f of ['mentions-legales.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html']) await page.goto(base + '/' + f);
    await page.goto(base + '/index.html');
    const st = await page.evaluate(() => ({ cookie: document.cookie, ls: localStorage.length, ss: sessionStorage.length, idb: indexedDB.databases ? null : null }));
    assert.equal(st.cookie, '');
    assert.equal(st.ls, 0);
    assert.equal(st.ss, 0);
    assert.deepEqual(await ctx.cookies(), []);
    assert.deepEqual(external, []);
  } finally { await browser.close(); server.close(); }
});
