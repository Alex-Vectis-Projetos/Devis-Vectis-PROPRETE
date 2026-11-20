'use strict';
// Code de connexion admin : e-mail (séquence continue, sélection/copie) + collage avec espaces (Playwright, hors `npm test` :
// `node --test test/browser/login-code-paste.js`). L'API d'authentification est simulée : code valide 123456, usage unique.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { loginCodeMessage } = require('../../src/mailer');

const INDEX = path.join(__dirname, '..', '..', '..', 'index.html');
let srv, base, browser, verifyCalls, used;
test.before(async () => {
  srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    const json = (o, s = 200) => { r.writeHead(s, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (u.pathname === '/') { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return r.end(fs.readFileSync(INDEX)); }
    if (u.pathname === '/mail') { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return r.end(loginCodeMessage({ to: 'a@b.c', code: '123456', ttlMinutes: 10 }).html); }
    if (u.pathname === '/api/site/content') return json({ ok: true, content: { categories: { items: [] }, places: { items: [], hideBuiltin: true } } });
    if (u.pathname === '/api/admin/auth/session') return json({ ok: true, authenticated: false });
    if (u.pathname === '/api/admin/auth/request') return json({ ok: true });
    if (u.pathname === '/api/admin/auth/verify') {
      let b = ''; q.on('data', d => b += d); q.on('end', () => {
        const { code } = JSON.parse(b || '{}'); verifyCalls.push(code);
        if (code === '123456' && !used) { used = true; return json({ ok: true, authenticated: true, csrfToken: 'x', email: 'a@b.c' }); }
        json({ ok: false, message: 'Code invalide ou expiré.' }, 401);
      }); return;
    }
    r.writeHead(404); r.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); srv.close(); });

async function waitCalls(n) { for (let i = 0; i < 100 && verifyCalls.length < n; i++) await new Promise(r => setTimeout(r, 50)); }

async function toCodeStep(ctx) {
  verifyCalls = []; used = false;
  const p = await ctx.newPage();
  await p.goto(base + '/');
  await p.waitForSelector('#adminKey', { state: 'attached' });
  await p.evaluate(() => document.getElementById('adminKey').click());
  await p.waitForSelector('#adm-mail', { state: 'visible' });
  await p.fill('#adm-mail', 'a@b.c');
  await p.click('#admSend');
  await p.waitForSelector('#adm-code', { state: 'visible' });
  return p;
}

test('e-mail : le code est une seule séquence de texte, sélection et copie complètes', async () => {
  const c = await browser.newContext(); const p = await c.newPage();
  await p.goto(base + '/mail');
  const r = await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div')).find(d => /^\d+$/.test(d.textContent.trim()));
    const sel = getSelection(); sel.removeAllRanges(); const rg = document.createRange(); rg.selectNodeContents(el); sel.addRange(rg);
    return { text: el.textContent, selected: sel.toString(), children: el.children.length, userSelect: getComputedStyle(el).userSelect };
  });
  assert.equal(r.text, '123456'); assert.equal(r.selected, '123456'); assert.equal(r.children, 0);
  // double-clic sur le code : sélectionne les six chiffres d'un coup
  const box = await p.evaluate(() => { const el = Array.from(document.querySelectorAll('div')).find(d => /^\d+$/.test(d.textContent.trim())); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await p.mouse.dblclick(box.x, box.y);
  assert.equal(await p.evaluate(() => getSelection().toString().trim()), '123456');
  await c.close();
});

for (const [label, pasted] of [['code collé tel quel', '123456'], ['avec un espace au milieu', '123 456'], ['avec espaces autour', '  123456  '], ['avec saut de ligne et espace insécable', '123 456\n']]) {
  test(`login : collage « ${label} » garde les six chiffres, dernier inclus, et se connecte`, async () => {
    const c = await browser.newContext(); const p = await toCodeStep(c);
    await p.focus('#adm-code'); await p.keyboard.insertText(pasted);
    assert.equal(await p.inputValue('#adm-code'), '123456');
    await p.click('#admVerify');
    await waitCalls(1);
    assert.deepEqual(verifyCalls, ['123456']);
    await c.close();
  });
}

test('login : code incomplet ou invalide rejeté, usage unique conservé', async () => {
  const c = await browser.newContext(); const p = await toCodeStep(c);
  await p.focus('#adm-code'); await p.keyboard.insertText('12345');
  await p.click('#admVerify');
  assert.match(await p.textContent('#admErr'), /6 chiffres/);
  assert.deepEqual(verifyCalls, [], 'rien n’est envoyé au serveur avec 5 chiffres');
  await p.fill('#adm-code', ''); await p.keyboard.insertText('12a-345 6789');
  assert.equal(await p.inputValue('#adm-code'), '123456', 'lettres et tirets retirés, plafonné à 6 chiffres');
  await p.fill('#adm-code', ''); await p.keyboard.insertText('654321');
  await p.click('#admVerify');
  await p.waitForFunction(() => /invalide/i.test(document.getElementById('admErr').textContent));
  assert.deepEqual(verifyCalls, ['654321'], 'le code invalide est refusé par le serveur');
  await p.fill('#adm-code', ''); await p.keyboard.insertText('123456');
  await p.click('#admVerify');
  await waitCalls(2);
  assert.deepEqual(verifyCalls, ['654321', '123456']);
  assert.equal(used, true, 'code accepté une seule fois');
  await c.close();
});
