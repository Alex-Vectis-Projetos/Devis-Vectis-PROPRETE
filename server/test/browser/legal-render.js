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
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.woff': 'font/woff', '.js': 'text/javascript' };
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
    for (const f of ['qui-sommes-nous.html', 'mentions-legales.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html']) {
      await page.goto(base + '/' + f);
      await page.evaluate(() => document.fonts.ready);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h1: document.querySelector('h1').textContent, todo: document.querySelectorAll('.todo, .lg-banner').length, txt: document.body.innerText }));
      assert.ok(o.sw <= o.cw, f + ' débordement horizontal ' + o.sw + '>' + o.cw);
      assert.equal(o.todo, 0, f + ' : aucun encadré de pendance');
      assert.ok(!/À COMPLÉTER|à renseigner|ne doit pas être publiée/i.test(o.txt), f + ' : aucun marqueur visible');
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
  await page.click('.legal a[href="qui-sommes-nous.html"]');
  await page.waitForURL('**/qui-sommes-nous.html');
  assert.equal(await page.textContent('h1'), 'Qui sommes-nous ?');
  assert.equal(await page.$('.lg-todo'), null);
  await page.click('.lg-nav a[href="index.html"]');
  await page.waitForURL('**/index.html');
  assert.equal(await page.$('#qui-sommes-nous'), null, 'plus de bloc institutionnel sur l’accueil');
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

// Le contenu administrable ne doit pas écraser indûment les informations institutionnelles : coordonnées par défaut quand le champ est vide,
// valeur de l'administrateur quand elle existe, jamais « à renseigner » ; la page Qui sommes-nous est statique.
for (const [label, contact, expPhone, expMail] of [
  ['champs vides', { company: 'VECTIS', address: '8 Rue Pasteur', postalCode: '69200', city: 'Vénissieux', country: 'France', phone: '', email: '', siren: '' }, '+33 7 80 25 11 28', 'vectis.adm@gmail.com'],
  ['valeurs de l’administrateur', { company: 'VECTIS', address: '8 Rue Pasteur', postalCode: '69200', city: 'Vénissieux', country: 'France', phone: '+33 4 00 00 00 00', email: 'contact@exemple.test', siren: '107 463 358' }, '+33 4 00 00 00 00', 'contact@exemple.test'],
]) {
  test('contenu administrable — coordonnées : ' + label, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.route('**/api/site/content', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stats: false, content: { contact } }) }));
    await page.route('**/api/**', (r) => (r.request().url().includes('/api/site/content') ? r.fallback() : r.abort()));
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => document.querySelector('#ft-phone'));
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => ({ foot: document.querySelector('#f-contact').parentNode.innerText, list: document.querySelector('.contact-list').innerText }));
    assert.ok(t.foot.includes(expPhone) && t.foot.includes(expMail), t.foot);
    assert.ok(t.list.includes(expPhone) && t.list.includes(expMail), t.list);
    assert.ok(!/à renseigner/i.test(t.foot + t.list));
    assert.ok(t.foot.includes('SIREN : 107 463 358'));
    await ctx.close();
  });
}

test('Qui sommes-nous : page statique, identique avec ou sans contenu administrable ; aucune requête d’API', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const api = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) api.push(r.url()); });
  await page.goto(base + '/qui-sommes-nous.html');
  const txt = await page.evaluate(() => document.querySelector('main').innerText);
  assert.match(txt, /VECTIS est une entreprise de nettoyage/);
  assert.match(txt, /Alex Da Silva De Souza/);
  assert.ok(!/Lucia|véhicule|conseil/i.test(txt));
  assert.deepEqual(api, []);
  await ctx.close();
});
