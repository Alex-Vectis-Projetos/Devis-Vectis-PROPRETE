// Visionneuse photo : 5 situations d'écran (iPhone portrait/paysage, tablette portrait/paysage, bureau).
// Lancer : node --test test/browser/gallery-lightbox.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const INDEX = path.join(__dirname, '..', '..', '..', 'index.html');

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, rgb) {
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// 8 photos : paysage 16:9, portrait 9:16 et carrée, pour contrôler la proportion
const SHAPES = [[160, 90], [90, 160], [100, 100], [160, 90], [160, 90], [90, 160], [160, 90], [160, 90]];
const ids = SHAPES.map((_, i) => (i.toString(16) + 'e').padEnd(32, 'e').slice(0, 32));
const imgs = {}; ids.forEach((id, i) => { imgs[id] = png(SHAPES[i][0], SHAPES[i][1], [40 + i * 20, 90, 160]); });
const content = { ok: true, content: { categories: { items: [{ id: 'pharmacie', label: 'Pharmacie', subtitle: '', icon: 'i-pharmacie', active: true }] }, places: { items: [{ id: 'l1', category: 'pharmacie', title: 'De la Place', description: 'Texte de test', photos: ids, mainPhoto: ids[0], active: true }], hideBuiltin: true } } };

let srv, base, browser;
test.before(async () => {
  srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/') { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return r.end(fs.readFileSync(INDEX)); }
    if (u.pathname === '/api/site/content') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify(content)); }
    const m = /assets\/([0-9a-f]{32})/.exec(u.pathname);
    if (m && imgs[m[1]]) { r.writeHead(200, { 'Content-Type': 'image/png' }); return r.end(imgs[m[1]]); }
    r.writeHead(404); r.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port + '/';
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); srv.close(); });

const VPS = [
  ['iPhone portrait', { width: 390, height: 844 }, true],
  ['iPhone paysage', { width: 844, height: 390 }, true],
  ['tablette portrait', { width: 768, height: 1024 }, true],
  ['tablette paysage', { width: 1024, height: 768 }, true],
  ['bureau', { width: 1440, height: 900 }, false],
];

async function open(vp, touch) {
  const c = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
  const p = await c.newPage();
  await p.goto(base);
  await p.waitForSelector('#domains .dom');
  await p.click('#domains .dom[data-cat=pharmacie]');
  await p.waitForSelector('#gal .card[data-id]');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.evaluate(() => { const g = document.getElementById('realisations'); window.scrollTo({ top: g.offsetTop + 40, behavior: 'instant' }); });
  await p.evaluate(() => { const e = document.querySelector('#gal .card[data-id]'); document.documentElement.style.scrollBehavior = 'auto'; e.scrollIntoView({ block: 'center' }); document.documentElement.style.scrollBehavior = ''; });
  await p.waitForTimeout(200);
  const y0 = await p.evaluate(() => Math.round(scrollY));
  await p.click('#gal .card[data-id]');
  await p.waitForSelector('#lb:not([hidden])');
  await p.waitForFunction(() => { const i = document.getElementById('lbImg'); return i.complete && i.naturalWidth > 0; });
  await p.waitForTimeout(150);
  return { c, p, y0 };
}

const geom = () => {
  const R = e => e.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight, st = document.querySelector('.lb-stage'), fig = document.querySelector('.lb figure'),
    th = document.getElementById('lbThumbs'), x = document.getElementById('lbClose'), img = document.getElementById('lbImg');
  const xr = R(x), top = document.elementFromPoint(xr.left + xr.width / 2, xr.top + xr.height / 2);
  const ir = R(img);
  const inside = r => r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
  // zone réellement occupée par la photo (object-fit:contain) dans l'élément img
  const k = img.naturalWidth / img.naturalHeight, bk = ir.width / ir.height;
  const pw = bk > k ? ir.height * k : ir.width, ph = bk > k ? ir.height : ir.width / k;
  return {
    figInside: inside(R(fig)), stageInside: inside(R(st)), thumbsInside: inside(R(th)), xInside: inside(xr),
    xOnTop: top === x || x.contains(top), pageScrollW: document.documentElement.scrollWidth <= vw,
    ratioShown: pw / ph, ratioNatural: k, imgBoxRatio: bk, stageW: R(st).width, stageH: R(st).height,
    photoW: pw, photoH: ph,
  };
};

for (const [name, vp, touch] of VPS) {
  test(`visionneuse — ${name}`, async () => {
    const { c, p, y0 } = await open(vp, touch);
    try {
      let g = await p.evaluate(geom);
      assert.ok(g.figInside, 'la visionneuse ne dépasse pas l’écran');
      assert.ok(g.stageInside && g.thumbsInside, 'cadre et miniatures dans l’écran');
      assert.ok(g.xInside && g.xOnTop, 'le bouton X est visible et cliquable');
      assert.ok(g.pageScrollW, 'pas de débordement horizontal');
      assert.ok(Math.abs(g.ratioShown - g.ratioNatural) < 0.02, 'proportion préservée');
      // fond verrouillé
      const lock = await p.evaluate(() => ({ pos: getComputedStyle(document.body).position, cls: document.documentElement.classList.contains('lb-open') }));
      assert.equal(lock.pos, 'fixed'); assert.ok(lock.cls);
      await p.mouse.move(vp.width / 2, vp.height / 2); await p.mouse.wheel(0, 600);
      await p.waitForTimeout(100);
      assert.equal(await p.evaluate(() => Math.round(-document.body.getBoundingClientRect().top)), y0, 'la page ne défile pas derrière la visionneuse');

      // précédent / suivant sur les 8 photos, chacune avec sa proportion
      const n = SHAPES.length;
      for (let i = 1; i < n; i++) {
        await p.click('.lb-nav .next');
        await p.waitForFunction(i2 => /\/(\w{2})e+$/.test(document.getElementById('lbImg').src) || true, i);
        await p.waitForTimeout(60);
        g = await p.evaluate(geom);
        assert.ok(g.figInside && g.xOnTop && g.xInside, `photo ${i + 1} : mise en page dans l’écran`);
        assert.ok(Math.abs(g.ratioShown - g.ratioNatural) < 0.02, `photo ${i + 1} : proportion préservée`);
      }
      // dernière miniature sélectionnée et visible
      const lastSel = await p.evaluate(() => {
        const th = document.getElementById('lbThumbs'), b = th.querySelector('.lb-th[aria-selected=true]'), tr = th.getBoundingClientRect(), br = b.getBoundingClientRect();
        return { idx: Array.from(th.children).indexOf(b), total: th.children.length, visible: br.left >= tr.left - 1 && br.right <= tr.right + 1 && br.right <= innerWidth };
      });
      assert.equal(lastSel.idx, n - 1); assert.equal(lastSel.total, n); assert.ok(lastSel.visible, 'dernière miniature accessible');
      await p.click('.lb-nav .prev'); await p.click('.lb-nav .prev');
      assert.equal(await p.evaluate(() => Array.from(document.getElementById('lbThumbs').children).findIndex(b => b.getAttribute('aria-selected') === 'true')), n - 3);
      // miniature cliquée directement (la dernière) puis fermeture par X
      await p.evaluate(() => { document.getElementById('lbThumbs').scrollLeft = 99999; });
      await p.click('#lbThumbs .lb-th:last-child');
      assert.equal(await p.evaluate(() => Array.from(document.getElementById('lbThumbs').children).findIndex(b => b.getAttribute('aria-selected') === 'true')), n - 1);
      await p.click('#lbClose');
      assert.equal(await p.evaluate(() => document.getElementById('lb').hidden), true);
      const after = await p.evaluate(() => ({ pos: getComputedStyle(document.body).position, y: Math.round(scrollY), cls: document.documentElement.classList.contains('lb-open') }));
      assert.equal(after.cls, false); assert.notEqual(after.pos, 'fixed'); assert.equal(after.y, y0, 'rolagem restaurée');
    } finally { await c.close(); }
  });
}

test('visionneuse — rotation de l’écran pendant l’ouverture', async () => {
  const { c, p } = await open({ width: 390, height: 844 }, true);
  try {
    await p.setViewportSize({ width: 844, height: 390 });
    await p.waitForTimeout(250);
    const g = await p.evaluate(geom);
    assert.ok(g.figInside && g.xInside && g.xOnTop && g.thumbsInside);
    assert.ok(Math.abs(g.ratioShown - g.ratioNatural) < 0.02);
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(250);
    const g2 = await p.evaluate(geom);
    assert.ok(g2.figInside && g2.xInside && g2.xOnTop && g2.thumbsInside);
  } finally { await c.close(); }
});

test('visionneuse — Échap et clic sur le fond ferment et restaurent la rolagem', async () => {
  const { c, p, y0 } = await open({ width: 1024, height: 768 }, false);
  try {
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(() => document.getElementById('lb').hidden), true);
    assert.equal(await p.evaluate(() => Math.round(scrollY)), y0);
  } finally { await c.close(); }
});
