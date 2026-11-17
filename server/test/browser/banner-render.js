'use strict';

// Test de rendu RÉEL de la bannière dans un navigateur (Playwright/Chromium). Hors `npm test` (qui ne lit que test/*.test.js) :
//   cd server && npm run test:browser
// Ignoré proprement si Playwright ou Chromium ne sont pas disponibles. N'écrit rien, ne touche aucune base : serveur local
// jetable qui sert le index.html du dépôt + une API simulée avec les mêmes en-têtes de cache que la production.
//
// Ce qui est observé PENDANT le chargement (pas seulement l'état final) : un MutationObserver sur l'<img> du hero (toute affectation
// de src, même entre deux images) + un échantillonnage à chaque frame (requestAnimationFrame) ; l'« ancienne bannière » est l'image
// d'origine embarquée (src data:image/webp...). Elle ne doit être NI affectée NI peinte quand une bannière est publiée.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* ignoré plus bas */ }

const ROOT = process.env.BANNER_TEST_ROOT || path.join(__dirname, '..', '..', '..');   // BANNER_TEST_ROOT : dossier contenant un autre index.html (ex. l'ancienne version, pour prouver que le test détecte le bug)
const OLD = 'b'.repeat(32), NEW = 'c'.repeat(32);   // identifiants d'images publiées (couleurs distinctes)

// ---- PNG uni valide (sans dépendance) -------------------------------------------------------------------------------------
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(r, g, b) {
  const W = 64, H = 20, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = { [OLD]: png(30, 60, 140), [NEW]: png(20, 140, 60) };

// ---- serveur d'instrumentation --------------------------------------------------------------------------------------------
let srv, base, ctl, hits;
const reset = () => { ctl = { api: 0, img: 0, mode: 'ok', published: OLD, noBanner: false }; hits = { content: 0, asset: 0 }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const body = () => {
  const c = { categories: { items: [{ id: 'pharmacie', label: 'Pharmacie', subtitle: '', icon: 'i-pharmacie', active: true }] }, places: { items: [], hideBuiltin: true } };
  if (!ctl.noBanner) c.banner = { imageId: ctl.published, fit: 'cover', zoom: 1, x: 50, y: 50 };
  return JSON.stringify({ ok: true, content: c });
};
test.before(async () => {
  if (!chromium) return;
  reset();
  srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__ctl') { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { Object.assign(ctl, JSON.parse(b || '{}')); res.end('ok'); }); return; }
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }
    if (u.pathname === '/api/site/content') {
      hits.content++; await sleep(ctl.api);
      if (ctl.mode === 'http500') { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"ok":false}'); }
      if (ctl.mode === 'http503') { res.writeHead(503); return res.end(); }
      if (ctl.mode === 'reset') return req.socket.destroy();
      if (ctl.mode === 'badjson') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{oops'); }
      if (ctl.mode === 'empty') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true,"content":{}}'); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(body());
    }
    const m = /^\/api\/site\/assets\/([0-9a-f]{32})$/.exec(u.pathname);
    if (m && PNG[m[1]]) { hits.asset++; await sleep(ctl.img); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' }); return res.end(PNG[m[1]]); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}/`;
});
test.after(() => srv && srv.close());

// ---- observation dans la page (injectée avant tout script du document) ------------------------------------------------------
const SAMPLER = `(() => {
  const log = window.__log = { assigned: [], tl: [], t0: performance.now() };
  const kind = (s) => !s ? 'empty' : s.startsWith('data:image/webp') ? 'DEFAULT' : /\\/api\\/site\\/assets\\/b{32}$/.test(s) ? 'OLD_ID' : /\\/api\\/site\\/assets\\/c{32}$/.test(s) ? 'NEW_ID' : 'other';
  const now = () => Math.round(performance.now() - log.t0);
  const state = () => { const i = document.querySelector('.hero-art img'); if (!i) return 'no-img';
    const cs = getComputedStyle(i), r = i.getBoundingClientRect();
    const painted = i.complete && i.naturalWidth > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0 && r.width > 0 && r.height > 0;
    return kind(i.getAttribute('src') || '') + (painted ? ':PAINTED' : ':notpainted'); };
  let last = '';
  const tick = () => { const s = state(); if (s !== last) { log.tl.push([now(), s]); last = s; } if (now() < 15000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new MutationObserver((ms) => { for (const m of ms) if (m.attributeName === 'src') log.assigned.push([now(), kind(m.target.getAttribute('src') || '')]); })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ['src'] });
})();`;

const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
let browser;
test.before(async () => { if (chromium) { try { browser = await chromium.launch(); } catch { browser = null; } } });
test.after(async () => { if (browser) await browser.close(); });
const skip = () => (!chromium ? 'playwright indisponible' : browser === null ? 'chromium indisponible' : false);
const opened = [];   // contextes à fermer APRÈS chaque test, même en cas d'échec d'assertion (sinon leurs tentatives faussent les compteurs suivants)
test.afterEach(async () => { while (opened.length) await opened.pop().close().catch(() => {}); });

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[opts.vp || 'desktop'] }); opened.push(ctx);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(SAMPLER);
  return { ctx, page, errors, cdp: await ctx.newCDPSession(page) };
}
const snapshot = (page) => page.evaluate(() => ({ tl: window.__log.tl, assigned: window.__log.assigned }));
const NO_OLD = (s, why) => {
  assert.ok(!s.tl.some(([, c]) => c.startsWith('DEFAULT')), `${why} : l'image d'origine n'a JAMAIS été affichée — ${JSON.stringify(s.tl)}`);
  assert.ok(!s.assigned.some(([, c]) => c === 'DEFAULT'), `${why} : l'image d'origine n'a JAMAIS été affectée au src — ${JSON.stringify(s.assigned)}`);
};
const finalOf = (s) => (s.tl.length ? s.tl[s.tl.length - 1][1] : '?');
async function settle(page, want, max = 10000) {   // attend l'état final voulu, puis laisse 700 ms pour attraper un éventuel retour en arrière
  const t0 = Date.now();
  while (Date.now() - t0 < max) { const f = finalOf(await snapshot(page)); if (f === want) break; await sleep(100); }
  await sleep(700);
  return snapshot(page);
}

for (const vp of ['desktop', 'mobile']) {
  test(`[${vp}] premier accès (cache froid) : bannière publiée directement, une seule requête de contenu`, { skip: skip() }, async () => {
    reset(); const { ctx, page, errors } = await open({ vp });
    ctl.api = 150; ctl.img = 400; await page.goto(base);
    const s = await settle(page, 'OLD_ID:PAINTED');
    NO_OLD(s, `${vp} premier accès`); assert.equal(finalOf(s), 'OLD_ID:PAINTED');
    assert.equal(hits.content, 1, 'une seule requête /api/site/content'); assert.deepEqual(errors, []); await ctx.close();
  });

  test(`[${vp}] F5 (cache chaud)`, { skip: skip() }, async () => {
    reset(); const { ctx, page } = await open({ vp }); ctl.api = 150; ctl.img = 400;
    await page.goto(base); await settle(page, 'OLD_ID:PAINTED');
    await page.reload({ waitUntil: 'load' }); const s = await settle(page, 'OLD_ID:PAINTED');   // le sampler repart avec le nouveau document
    NO_OLD(s, `${vp} F5`); assert.equal(finalOf(s), 'OLD_ID:PAINTED'); await ctx.close();
  });

  test(`[${vp}] Ctrl+F5 (cache désactivé)`, { skip: skip() }, async () => {
    reset(); const { ctx, page, cdp } = await open({ vp }); ctl.api = 150; ctl.img = 400;
    await page.goto(base); await settle(page, 'OLD_ID:PAINTED');
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.reload({ waitUntil: 'load' }); const s = await settle(page, 'OLD_ID:PAINTED');
    NO_OLD(s, `${vp} Ctrl+F5`); assert.equal(finalOf(s), 'OLD_ID:PAINTED'); await ctx.close();
  });
}

test('API lente (1,5 s) : rien d\'ancien pendant l\'attente, publiée à l\'arrivée', { skip: skip() }, async () => {
  reset(); const { ctx, page } = await open(); ctl.api = 1500; ctl.img = 200; await page.goto(base);
  await sleep(1000); const mid = await snapshot(page); NO_OLD(mid, 'pendant l\'attente'); assert.ok(!finalOf(mid).startsWith('OLD_ID'), 'pas encore d\'image');
  const s = await settle(page, 'OLD_ID:PAINTED'); NO_OLD(s, 'API lente'); assert.equal(finalOf(s), 'OLD_ID:PAINTED'); await ctx.close();
});

test('image lente (2,5 s) : cadre vide puis image publiée, jamais l\'ancienne', { skip: skip() }, async () => {
  reset(); const { ctx, page } = await open(); ctl.api = 100; ctl.img = 2500; await page.goto(base);
  const s = await settle(page, 'OLD_ID:PAINTED'); NO_OLD(s, 'image lente'); assert.equal(finalOf(s), 'OLD_ID:PAINTED'); await ctx.close();
});

for (const mode of ['http500', 'http503', 'reset', 'badjson']) {
  test(`API en échec (${mode}) : jamais l'ancienne bannière, nouvelles tentatives (4 s, 8 s), récupération automatique`, { skip: skip() }, async () => {
    reset(); const { ctx, page } = await open(); ctl.mode = mode; await page.goto(base);
    await sleep(2500); NO_OLD(await snapshot(page), `API ${mode} (2,5 s)`); assert.ok(hits.content >= 1 && hits.content <= 2, `requêtes avant la 1re nouvelle tentative : ${hits.content}`);   // Chromium peut renvoyer lui-même un GET dont la connexion a été coupée
    ctl.mode = 'ok'; ctl.img = 100;                                   // l'API se rétablit avant la 2e tentative (t≈4 s)
    const s = await settle(page, 'OLD_ID:PAINTED', 8000);
    assert.ok(hits.content >= 2 && hits.content <= 3, `tentatives : ${hits.content}`);
    NO_OLD(s, `API ${mode}`); assert.equal(finalOf(s), 'OLD_ID:PAINTED'); await ctx.close();
  });
}

test('API indisponible en permanence : 3 requêtes au total (1 + 2 tentatives), cadre vide, aucune boucle', { skip: skip() }, async () => {
  reset(); const { ctx, page } = await open(); ctl.mode = 'http503'; await page.goto(base);
  await sleep(13500); const s = await snapshot(page); NO_OLD(s, 'API indisponible');
  assert.equal(hits.content, 3, `requêtes /api/site/content : ${hits.content}`); assert.ok(!finalOf(s).startsWith('DEFAULT')); await ctx.close();
});

test('API qui répond sans bannière publiée (ok:true, contenu vide ou sans banner) : repli sur l\'image d\'origine, sans nouvelle tentative', { skip: skip() }, async () => {
  for (const variant of ['empty', 'noBanner']) {
    reset(); const { ctx, page } = await open();
    if (variant === 'empty') ctl.mode = 'empty'; else ctl.noBanner = true;
    await page.goto(base); const s = await settle(page, 'DEFAULT:PAINTED', 4000);
    assert.equal(finalOf(s), 'DEFAULT:PAINTED', variant); await sleep(4500); assert.equal(hits.content, 1, `${variant} : pas de nouvelle tentative`);
    assert.equal(await page.$eval('.hero-art img', (i) => !!i.getAttribute('alt')), true, 'alt posé avec l\'image'); await ctx.close();
  }
});

test('API pendue (6 s) : rien d\'ancien pendant l\'attente, publiée à la réponse', { skip: skip() }, async () => {
  reset(); const { ctx, page } = await open(); ctl.api = 6000; ctl.img = 100; await page.goto(base);
  await sleep(5000); NO_OLD(await snapshot(page), 'API pendue (5 s)');
  const s = await settle(page, 'OLD_ID:PAINTED', 4000); NO_OLD(s, 'API pendue'); assert.equal(finalOf(s), 'OLD_ID:PAINTED'); await ctx.close();
});

test('banner modifié dans le panneau puis site rouvert : la nouvelle bannière directement, jamais l\'ancienne publiée ni l\'image d\'origine', { skip: skip() }, async () => {
  reset(); const { ctx, page } = await open(); ctl.api = 100; ctl.img = 200;
  await page.goto(base); await settle(page, 'OLD_ID:PAINTED');
  ctl.published = NEW;                                              // = publication depuis le panneau d'administration
  for (const how of ['F5', 'réouverture dans un nouvel onglet']) {
    const p = how === 'F5' ? page : await ctx.newPage(); if (how !== 'F5') await p.addInitScript(SAMPLER);
    if (how === 'F5') await p.reload({ waitUntil: 'load' }); else await p.goto(base);
    const s = await settle(p, 'NEW_ID:PAINTED'); NO_OLD(s, how);
    assert.ok(!s.assigned.some(([, c]) => c === 'OLD_ID'), `${how} : l'ancienne bannière publiée n'est pas ré-affichée`);
    assert.equal(finalOf(s), 'NEW_ID:PAINTED');
  }
  await ctx.close();
});

test('éditeur du panneau : l\'aperçu puis l\'annulation (API vectisApplyBanner utilisée par editBanner) ne ramènent jamais l\'image d\'origine', { skip: skip() }, async () => {
  reset(); const { ctx, page } = await open(); ctl.api = 100; ctl.img = 100; await page.goto(base); await settle(page, 'OLD_ID:PAINTED');
  await page.evaluate((id) => window.vectisApplyBanner({ imageId: id, fit: 'cover', zoom: 1.4, x: 40, y: 40 }), NEW);   // aperçu
  await settle(page, 'NEW_ID:PAINTED');
  await page.evaluate((id) => window.vectisApplyBanner({ imageId: id, fit: 'cover', zoom: 1, x: 50, y: 50 }), OLD);    // annulation = bannière publiée
  const s = await settle(page, 'OLD_ID:PAINTED'); NO_OLD(s, 'aperçu/annulation'); assert.equal(finalOf(s), 'OLD_ID:PAINTED'); await ctx.close();
});

test('navigation entre sections : l\'image reste la publiée (mobile et desktop)', { skip: skip() }, async () => {
  for (const vp of ['desktop', 'mobile']) {
    reset(); const { ctx, page } = await open({ vp }); ctl.api = 100; ctl.img = 100; await page.goto(base); await settle(page, 'OLD_ID:PAINTED');
    for (const h of ['#prestations', '#accueil', '#domaines']) { await page.evaluate((x) => { location.hash = x; }, h); await sleep(300); }
    const s = await snapshot(page); NO_OLD(s, `${vp} navigation`); assert.ok(finalOf(s).startsWith('OLD_ID'), finalOf(s));
    assert.ok((await page.$eval('.hero-art img', (i) => i.getAttribute('src'))).endsWith(OLD), 'src = bannière publiée'); await ctx.close();
  }
});
