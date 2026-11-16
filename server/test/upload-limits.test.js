'use strict';

// Cotas de envio : upload administrativo (uploadPerAdmin) × fotos/orçamentos dos clientes (quotePerIp, quotePhotoPerIp).
// Sem Fastify : as rotas reais (registerSiteRoutes / registerQuoteRoutes) são chamadas por um pequeno suporte, como em quotes.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup, testConfig, ADMIN } = require('./helpers');
const { registerSiteRoutes } = require('../src/site');
const { registerQuoteRoutes } = require('../src/quotes');
const { AuthService } = require('../src/auth');

const MSG = { rateLimited: 'Trop de demandes. Réessayez dans quelques minutes.', badRequest: 'Requête invalide.', server: 'Erreur serveur.' };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (n) => Buffer.concat([PNG_SIG, Buffer.from(String(n).padStart(8, '0')), Buffer.alloc(32, 7)]);   // une image différente par n
const IP = '203.0.113.9';

function boot(cfgExtra = {}) {
  const s = setup({ config: testConfig(cfgExtra) });
  const auth = new AuthService({ db: s.db, config: s.cfg, keys: s.keys, mailer: s.mailer, now: Date.now, log: () => {} });
  const routes = {};
  const app = {
    get: () => {}, put: () => {}, delete: () => {}, addContentTypeParser: () => {},
    post: (url, o, h) => { routes[url] = h; },
  };
  registerSiteRoutes(app, { config: s.cfg, db: s.db, auth, requireAdmin: async () => {}, msg: MSG });
  registerQuoteRoutes(app, { config: s.cfg, db: s.db, auth, mailer: s.mailer });
  const call = async (url, { body, headers = {}, params = {}, admin = false } = {}) => {
    let code = 200, out; const hdr = {};
    const reply = { code(c) { code = c; return reply; }, header(k, v) { hdr[k.toLowerCase()] = v; return reply; }, send(x) { out = x; return reply; } };
    const req = { body, headers, params, ip: IP, admin: admin ? { email: ADMIN } : undefined, log: { info() {}, error() {}, warn() {} } };
    const r = await routes[url](req, reply);
    return { code, headers: hdr, body: out !== undefined ? out : r };
  };
  const adminUpload = (n) => call('/api/admin/site/assets', { admin: true, body: png(n), headers: { 'content-type': 'image/png' } });
  const counter = (key) => { const r = s.db.prepare('SELECT count FROM rate_limits WHERE key = ?').get(key); return r ? r.count : 0; };
  return { ...s, auth, call, adminUpload, counter };
}

const quote = () => ({
  submissionId: 'sub-' + crypto.randomBytes(8).toString('hex'),
  contact: { name: 'Société Test', phone: '06 12 34 56 78', email: 'client@example.fr' },
  properties: [{ site: 'Atelier Lyon', num: '8', street: 'Rue Pasteur', zip: '69200', city: 'Vénissieux', type: 'Atelier', typeother: '', surface: '350 m²',
    desc: 'Entretien hebdomadaire', freq: 'Une fois par semaine', freqother: '', visits: '1', days: ['Lundi'], price: { kind: 'hour', value: '45,00' } }],
  photos: [2],
});
const quotePhoto = (h, c, idx, n) => h.call('/api/quotes/:id/photos', { params: { id: c.id }, body: png(n),
  headers: { 'x-quote-token': c.token, 'x-photo-index': String(idx), 'x-photo-prop': '0', 'content-type': 'image/png', 'x-photo-name': encodeURIComponent('p' + n + '.png') } });

test('config: uploadPerAdmin is 300/hour and every other quota keeps its value', () => {
  const { limits } = testConfig();
  const HOUR = 3600 * 1000;
  assert.deepEqual(limits.uploadPerAdmin, { limit: 300, windowMs: HOUR });
  assert.deepEqual(limits.quotePhotoPerIp, { limit: 300, windowMs: HOUR }, 'client photo quota unchanged');
  assert.deepEqual(limits.quotePerIp, { limit: 20, windowMs: HOUR }, 'quote submission quota unchanged');
  assert.deepEqual(limits.estimatePerIp, { limit: 600, windowMs: HOUR });
  assert.deepEqual(limits.requestPerIp, { limit: 10, windowMs: HOUR });
  assert.deepEqual(limits.mailConnectPerIp, { limit: 6, windowMs: HOUR });
});

test('admin upload: 300 distinct uploads succeed inside the window, the 301st is refused with 429 + Retry-After', async () => {
  const h = boot();
  for (let i = 1; i <= 300; i++) {
    const r = await h.adminUpload(i);
    if (r.code !== 200) assert.fail('upload ' + i + ' answered ' + r.code);
    assert.equal(r.body.ok, true);
  }
  const over = await h.adminUpload(301);
  assert.equal(over.code, 429);
  assert.equal(over.body.error, 'rate_limited');
  assert.equal(over.body.message, MSG.rateLimited);
  assert.ok(Number(over.headers['retry-after']) > 0 && Number(over.headers['retry-after']) <= 3600);
  assert.equal(h.counter('upload:' + ADMIN), 300, 'a refused request does not push the counter further');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assets').get().n, 300, 'nothing is stored once the quota is reached');
});

test('admin upload: the quota is released when the window ends', async () => {
  let t = Date.now();
  const s = setup({ config: testConfig() });
  const auth = new AuthService({ db: s.db, config: s.cfg, keys: s.keys, mailer: s.mailer, now: () => t, log: () => {} });
  for (let i = 0; i < 300; i++) assert.equal(auth.hit('upload:' + ADMIN, s.cfg.limits.uploadPerAdmin).allowed, true);
  assert.equal(auth.hit('upload:' + ADMIN, s.cfg.limits.uploadPerAdmin).allowed, false);
  t += 3600 * 1000;
  assert.equal(auth.hit('upload:' + ADMIN, s.cfg.limits.uploadPerAdmin).allowed, true);
});

test('quotas are independent: an exhausted admin quota does not touch quote submission or client photos', async () => {
  const h = boot();
  for (let i = 1; i <= 300; i++) assert.equal((await h.adminUpload(i)).code, 200);
  assert.equal((await h.adminUpload(999)).code, 429, 'admin is blocked');
  const created = await h.call('/api/quotes', { body: quote() });
  assert.equal(created.code, 200, JSON.stringify(created.body));
  const c = created.body;
  assert.equal((await quotePhoto(h, c, 0, 1)).code, 200, 'client photo still accepted');
  assert.equal((await quotePhoto(h, c, 1, 2)).code, 200);
  const fin = await h.call('/api/quotes/:id/finalize', { params: { id: c.id }, body: { token: c.token } });
  assert.equal(fin.code, 200, JSON.stringify(fin.body));
  assert.equal(fin.body.ok, true);
  assert.equal(h.counter('upload:' + ADMIN), 300, 'client activity never moved the admin counter');
});

test('quotas are independent: an exhausted client photo quota does not touch admin uploads, and each operation only moves its own counter', async () => {
  const h = boot();
  const ipKey = h.auth.ipHash(IP);
  const lim = h.cfg.limits.quotePhotoPerIp;
  // le client épuise SA cote (300 photos/heure/IP)
  for (let i = 0; i < lim.limit; i++) assert.equal(h.auth.hit('quotePhotoPerIp:' + ipKey, lim).allowed, true);
  const created = await h.call('/api/quotes', { body: quote() });
  assert.equal(created.code, 200);
  const blocked = await quotePhoto(h, created.body, 0, 1);
  assert.equal(blocked.code, 429, 'client photo quota still enforced');
  assert.equal(blocked.body.error, 'rate_limited');
  // l'administrateur n'est pas touché
  assert.equal(h.counter('upload:' + ADMIN), 0);
  for (let i = 1; i <= 5; i++) assert.equal((await h.adminUpload(i)).code, 200);
  assert.equal(h.counter('upload:' + ADMIN), 5);
  assert.equal(h.counter('quotePhotoPerIp:' + ipKey), lim.limit, 'admin uploads did not consume the client quota');
});

test('an admin upload and a client photo each consume only their own counter', async () => {
  const h = boot();
  const ipKey = h.auth.ipHash(IP);
  assert.equal((await h.adminUpload(1)).code, 200);
  assert.equal(h.counter('upload:' + ADMIN), 1);
  assert.equal(h.counter('quotePhotoPerIp:' + ipKey), 0);
  const created = await h.call('/api/quotes', { body: quote() });
  assert.equal(h.counter('quotePerIp:' + ipKey), 1);
  assert.equal((await quotePhoto(h, created.body, 0, 2)).code, 200);
  assert.equal(h.counter('quotePhotoPerIp:' + ipKey), 1);
  assert.equal(h.counter('upload:' + ADMIN), 1, 'unchanged by the client operations');
});
