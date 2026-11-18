'use strict';
// Rendu des pages juridiques (Chromium) : pas de débordement horizontal, liens du pied de page, navigation, aucune requête externe.
// Lancer : node --test test/browser/legal-render.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..', '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.woff': 'font/woff' };
let server, base, browser;

test.before(async () => {
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(root, u === '/' ? 'index.html' : u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); server.close(); });

for (const [name, vp] of [['mobile 390', { width: 390, height: 800 }], ['desktop 1440', { width: 1440, height: 900 }]]) {
  test('legal pages render without horizontal overflow — ' + name, async () => {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const external = [];
    page.on('request', (r) => { if (!r.url().startsWith(base)) external.push(r.url()); });
    for (const f of ['mentions-legales.html', 'politique-de-confidentialite.html']) {
      await page.goto(base + '/' + f);
      await page.evaluate(() => document.fonts.ready);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h1: document.querySelector('h1').textContent, todo: document.querySelectorAll('.todo').length }));
      assert.ok(o.sw <= o.cw, f + ' débordement horizontal ' + o.sw + '>' + o.cw);
      assert.ok(o.todo > 0);
      const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      assert.match(font, /Montserrat/);
    }
    assert.deepEqual(external, [], 'aucune requête externe');
    await ctx.close();
  });
}

test('footer links navigate between index and legal pages and back', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.route('**/api/**', (r) => r.abort());
  await page.goto(base + '/index.html');
  await page.click('.legal a[href="mentions-legales.html"]');
  await page.waitForURL('**/mentions-legales.html');
  assert.equal(await page.textContent('h1'), 'Mentions légales');
  await page.click('.lg-nav a[href="politique-de-confidentialite.html"]');
  await page.waitForURL('**/politique-de-confidentialite.html');
  assert.equal(await page.textContent('h1'), 'Politique de confidentialité');
  assert.equal(await page.getAttribute('.lg-nav a[aria-current="page"]', 'href'), 'politique-de-confidentialite.html');
  await page.click('.lg-head a.lg-brand');
  await page.waitForURL('**/index.html');
  await ctx.close();
});
