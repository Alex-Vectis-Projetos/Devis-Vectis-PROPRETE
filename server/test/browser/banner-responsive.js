'use strict';

// Bannière : proportions réelles dans un navigateur, du téléphone au grand écran (Playwright, hors `npm test` : `node --test test/browser/banner-responsive.js`).
// Vérifie, pour une bannière publiée large (1600×520) ou portrait (600×900) et pour l'image d'origine : aucune rognure imposée par le cadre
// sur téléphone, aucune déformation, aucune rolagem horizontale, en-tête / logo / bouton de devis visibles et sans chevauchement ;
// bureau et tablette (>760 px) inchangés.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* ignoré */ }
const ROOT = process.env.BANNER_TEST_ROOT || path.join(__dirname, '..', '..', '..');
const WIDE = 'a'.repeat(32), TALL = 'd'.repeat(32);

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(W, H, [r, g, b]) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const IMG = { [WIDE]: { buf: png(1600, 520, [30, 60, 140]), ratio: 1600 / 520 }, [TALL]: { buf: png(600, 900, [20, 140, 60]), ratio: 600 / 900 } };

let srv, base, browser, published = WIDE;
test.before(async () => {
  if (!chromium) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }
    if (u.pathname === '/api/site/content') {
      const c = { categories: { items: [{ id: 'pharmacie', label: 'Pharmacie', subtitle: '', icon: 'i-pharmacie', active: true }] }, places: { items: [], hideBuiltin: true } };
      if (published) c.banner = { imageId: published, fit: 'cover', zoom: 1, x: 50, y: 50 };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(JSON.stringify({ ok: true, content: c }));
    }
    const m = /^\/api\/site\/assets\/([0-9a-f]{32})$/.exec(u.pathname);
    if (m && IMG[m[1]]) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(IMG[m[1]].buf); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}/`;
  try { browser = await chromium.launch(); } catch { browser = null; }
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });
const skip = () => (!chromium ? 'playwright indisponible' : browser === null ? 'chromium indisponible' : false);

const VIEWPORTS = [
  ['desktop 1920', 1920, 1080], ['desktop 1366', 1366, 768], ['tablette verticale 768', 768, 1024], ['tablette horizontale 1024', 1024, 768],
  ['mobile 390', 390, 844], ['mobile 430', 430, 932], ['mobile horizontal 844', 844, 390], ['mobile horizontal 667', 667, 375], ['mobile étroit 360', 360, 740],
];
const DESKTOP_RATIO = 2110 / 690, DEFAULT_PHONE_RATIO = 712 / 1210;

async function measure(w, h, pub) {
  published = pub;
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base); await page.waitForFunction(() => { const i = document.querySelector('.hero-art img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const img = document.querySelector('.hero-art img'), art = img.parentNode, a = art.getBoundingClientRect(), i = img.getBoundingClientRect();
    const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const cs = getComputedStyle(img);
    return { artW: a.width, artH: a.height, imgW: i.width, imgH: i.height, natW: img.naturalWidth, natH: img.naturalHeight, fit: cs.objectFit,
      scrollW: document.documentElement.scrollWidth, inner: innerWidth, brand: rect('.brand'), cta: rect('.header-cta') };
  });
  await ctx.close(); return { m, errs };
}
const overlap = (a, b) => a && b && !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);

for (const [name, w, h] of VIEWPORTS) {
  const phone = w <= 760;
  for (const [kind, pub] of [['publiée large 1600×520', WIDE], ['publiée portrait 600×900', TALL], ['image d\'origine', null]]) {
    test(`[${name}] bannière ${kind}`, { skip: skip() }, async () => {
      const { m, errs } = await measure(w, h, pub);
      assert.deepEqual(errs, []);
      assert.ok(m.scrollW <= m.inner + 1, `rolagem horizontale : ${m.scrollW} > ${m.inner}`);
      const ratio = m.artW / m.artH, tol = 0.03;
      const natural = pub ? IMG[pub].ratio : null;
      if (!phone) assert.ok(Math.abs(ratio / DESKTOP_RATIO - 1) < tol, `bureau/tablette inchangés : cadre ${ratio.toFixed(3)} ≠ ${DESKTOP_RATIO.toFixed(3)}`);
      else if (pub) assert.ok(Math.abs(ratio / natural - 1) < tol, `téléphone : cadre ${ratio.toFixed(3)} ≠ proportions de l'image ${natural.toFixed(3)} (rognure imposée)`);
      else assert.ok(Math.abs(ratio / DEFAULT_PHONE_RATIO - 1) < tol, `image d'origine mobile inchangée : ${ratio.toFixed(3)}`);
      assert.ok(['cover', 'contain'].includes(m.fit), `object-fit ${m.fit}`);
      assert.ok(Math.abs(m.imgW - m.artW) < 2 && Math.abs(m.imgH - m.artH) < 2, 'l\'image occupe exactement son cadre');
      assert.ok(m.brand && m.cta, 'logo et bouton de devis présents');
      assert.ok(m.brand.l >= -1 && m.cta.r <= m.inner + 1, 'logo / bouton dans l\'écran');
      assert.ok(!overlap(m.brand, m.cta), 'logo et bouton ne se chevauchent pas');
    });
  }
}
