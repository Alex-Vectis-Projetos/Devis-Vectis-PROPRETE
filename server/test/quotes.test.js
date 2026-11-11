'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { setup, testConfig, FakeMailer } = require('./helpers');
const { registerQuoteRoutes, validateQuote, buildQuoteMessages } = require('../src/quotes');
const { buildMime } = require('../src/mailer');
const { AuthService } = require('../src/auth');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

const prop = (extra = {}) => ({
  site: 'Atelier Lyon', num: '8', street: 'Rue Pasteur', zip: '69200', city: 'Vénissieux', type: 'Atelier', typeother: '', surface: '350 m²',
  desc: 'Entretien hebdomadaire', freq: 'Une fois par semaine', freqother: '', visits: '1', days: ['Lundi'], price: { kind: 'hour', value: '45,00' }, ...extra,
});
const quote = (extra = {}) => ({
  submissionId: 'sub-' + crypto.randomBytes(8).toString('hex'),
  contact: { name: 'Société Test', phone: '06 12 34 56 78', email: 'client@example.fr' },
  properties: [prop()], photos: [0], ...extra,
});

/* Minimal stand-in for the Fastify surface used by registerQuoteRoutes (the real Fastify stack is exercised in CI below). */
function harness(cfgExtra = {}, mailerOpts) {
  const s = setup({ config: testConfig(cfgExtra), mailer: mailerOpts ? new FakeMailer(mailerOpts) : undefined });
  const routes = {};
  const app = { post: (url, o, h) => { routes[url] = h; } };
  const auth = new AuthService({ db: s.db, config: s.cfg, keys: s.keys, mailer: s.mailer, now: Date.now, log: () => {} });
  registerQuoteRoutes(app, { config: s.cfg, db: s.db, auth, mailer: s.mailer });
  const call = async (url, { body, headers = {}, params = {} } = {}) => {
    let code = 200, out;
    const reply = { code(c) { code = c; return reply; }, header() { return reply; }, send(x) { out = x; return reply; } };
    const req = { body, headers, params, ip: '203.0.113.9', log: { info() {}, error() {}, warn() {} } };
    const r = await routes[url](req, reply);
    return { code, body: out !== undefined ? out : r };
  };
  return { ...s, call };
}
async function create(h, q = quote()) { const r = await h.call('/api/quotes', { body: q }); assert.equal(r.code, 200, JSON.stringify(r.body)); return { ...r.body, q }; }
const upload = (h, c, idx, prop_, buf, type = 'image/png', name = 'photo.png') =>
  h.call('/api/quotes/:id/photos', { params: { id: c.id }, body: buf, headers: { 'x-quote-token': c.token, 'x-photo-index': String(idx), 'x-photo-prop': String(prop_), 'content-type': type, 'x-photo-name': encodeURIComponent(name) } });
const finalize = (h, c) => h.call('/api/quotes/:id/finalize', { params: { id: c.id }, body: { token: c.token } });

test('validation: a complete quote is accepted, missing/invalid fields are rejected with the field name', () => {
  assert.equal(validateQuote(quote()).ok, true);
  const miss = (mut) => { const q = quote(); mut(q); return validateQuote(q); };
  assert.equal(miss((q) => { q.contact.name = ''; }).field, 'contact.name');
  assert.equal(miss((q) => { q.contact.email = 'pas-un-mail'; }).field, 'contact.email');
  assert.equal(miss((q) => { q.contact.phone = '12'; }).field, 'contact.phone');
  assert.equal(miss((q) => { q.properties[0].zip = '6920'; }).field, 'properties[0].zip');
  assert.equal(miss((q) => { q.properties[0].desc = ''; }).field, 'properties[0].desc');
  assert.equal(miss((q) => { q.properties[0].surface = '0'; }).field, 'properties[0].surface');
  assert.equal(miss((q) => { q.properties[0].type = 'Autre'; }).field, 'properties[0].typeother');
  assert.equal(miss((q) => { q.properties[0].freq = 'Autre fréquence'; }).field, 'properties[0].freqother');
  assert.equal(miss((q) => { q.properties[0].days = ['Funday']; }).field, 'properties[0].days');
  assert.equal(miss((q) => { q.properties[0].price = { kind: 'hour', value: '-3' }; }).field, 'properties[0].price');
  assert.equal(miss((q) => { q.properties = []; q.photos = []; }).field, 'properties');
  assert.equal(miss((q) => { q.photos = [11]; }).field, 'photos[0]');
  assert.equal(miss((q) => { q.submissionId = 'x'; }).field, 'submissionId');
  assert.equal(validateQuote(null).ok, false);
});

test('quote without photos: stored first, one e-mail sent to the configured recipient, then reported as sent', async () => {
  const h = harness({ quoteRecipient: 'devis@vectis.test' });
  const c = await create(h, quote({ photos: [0] }));
  assert.equal(h.db.prepare('SELECT status FROM quotes WHERE id = ?').get(c.id).status, 'received');
  const f = await finalize(h, c);
  assert.deepEqual([f.code, f.body.ok, f.body.status], [200, true, 'sent']);
  assert.equal(h.mailer.quotes.length, 1);
  assert.equal(h.mailer.quotes[0].to, 'devis@vectis.test');
  assert.equal(h.mailer.quotes[0].replyTo, 'client@example.fr');
  assert.match(h.mailer.quotes[0].html, /Société Test/);
  assert.equal(h.mailer.quotes[0].attachments.length, 0);
});

test('quote with one photo: photo stored, attached, and only then sent', async () => {
  const h = harness();
  const c = await create(h, quote({ photos: [1] }));
  assert.equal((await finalize(h, c)).code, 409, 'finalize refuses while a photo is missing');
  assert.deepEqual((await finalize(h, c)).body.missing, [0]);
  assert.equal(h.mailer.quotes, undefined, 'nothing e-mailed yet');
  const u = await upload(h, c, 0, 0, PNG);
  assert.equal(u.code, 200);
  assert.equal((await finalize(h, c)).body.ok, true);
  assert.equal(h.mailer.quotes[0].attachments.length, 1);
  assert.equal(h.mailer.quotes[0].attachments[0].mime, 'image/png');
});

test('several photos over several properties are all attached; extra e-mails are used when over the size budget', async () => {
  const h = harness({ quoteMailBudget: 200 });
  const q = quote({ properties: [prop(), prop({ site: 'Bureau' })], photos: [2, 1] });
  const c = await create(h, q);
  await upload(h, c, 0, 0, PNG, 'image/png', 'a.png'); await upload(h, c, 1, 0, JPG, 'image/jpeg', 'b.jpg'); await upload(h, c, 2, 1, PNG, 'image/png', 'c.png');
  const f = await finalize(h, c);
  assert.equal(f.body.ok, true);
  const all = h.mailer.quotes.flatMap((m) => m.attachments.map((a) => a.name)).sort();
  assert.deepEqual(all, ['a.png', 'b.jpg', 'c.png']);
  assert.ok(h.mailer.quotes.length >= 2, 'split over several e-mails');
  assert.match(h.mailer.quotes[0].subject, /\[1\/\d\]/);
  assert.match(h.mailer.quotes[0].html, /Propriété 2 : Bureau/);
});

test('missing required fields and a bad payload are refused with 422 and nothing is stored', async () => {
  const h = harness();
  const q = quote(); q.contact.email = '';
  const r = await h.call('/api/quotes', { body: q });
  assert.equal(r.code, 422);
  assert.equal(r.body.field, 'contact.email');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM quotes').get().n, 0);
});

test('invalid files are refused: wrong signature, wrong declared type, SVG, empty, oversize', async () => {
  const h = harness();
  const c = await create(h, quote({ photos: [1] }));
  assert.equal((await upload(h, c, 0, 0, Buffer.from('<svg onload=alert(1)>'), 'image/png')).code, 415);
  assert.equal((await upload(h, c, 0, 0, PNG, 'image/jpeg')).code, 415);
  assert.equal((await upload(h, c, 0, 0, Buffer.from('%PDF-1.4 x'), 'image/png')).code, 415);
  assert.equal((await upload(h, c, 0, 0, Buffer.alloc(0))).code, 400);
  const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
  assert.equal((await upload(h, c, 0, 0, big)).code, 413);
  assert.equal((await upload(h, c, 5, 0, PNG)).code, 422, 'index beyond the declared photo count');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM quote_photos').get().n, 0);
});

test('a wrong or missing token is refused everywhere', async () => {
  const h = harness();
  const c = await create(h, quote({ photos: [1] }));
  const bad = { ...c, token: 'f'.repeat(64) };
  assert.equal((await upload(h, bad, 0, 0, PNG)).code, 403);
  assert.equal((await finalize(h, bad)).code, 403);
  assert.equal((await h.call('/api/quotes/:id/finalize', { params: { id: c.id }, body: {} })).code, 403);
  assert.equal((await h.call('/api/quotes/:id/finalize', { params: { id: 'zz' }, body: { token: c.token } })).code, 404);
});

test('e-mail failure: client gets an error (never a success), the quote stays stored, a retry sends it exactly once', async () => {
  const h = harness();
  const c = await create(h);
  h.mailer.failQuote = 'gmail_send_failed_500';
  const f1 = await finalize(h, c);
  assert.equal(f1.code, 502);
  assert.equal(f1.body.ok, false);
  assert.equal(f1.body.error, 'mail_failed');
  const row = h.db.prepare('SELECT status, last_error, attempts FROM quotes WHERE id = ?').get(c.id);
  assert.deepEqual([row.status, row.last_error, row.attempts], ['mail_failed', 'gmail_send_failed_500', 1]);
  assert.ok(JSON.parse(h.db.prepare('SELECT payload FROM quotes WHERE id = ?').get(c.id).payload).contact.name, 'data kept');
  h.mailer.failQuote = false;
  assert.equal((await finalize(h, c)).body.ok, true);
  assert.equal((await finalize(h, c)).body.ok, true, 'repeated finalize after success');
  assert.equal(h.mailer.quotes.length, 1, 'no duplicate e-mail');
});

test('partial failure over several e-mails resumes where it stopped (no duplicates)', async () => {
  const h = harness({ quoteMailBudget: 100 });
  const c = await create(h, quote({ photos: [3] }));
  for (let i = 0; i < 3; i++) await upload(h, c, i, 0, PNG, 'image/png', `p${i}.png`);
  const orig = h.mailer.sendQuote.bind(h.mailer); let n = 0;
  h.mailer.sendQuote = async (m) => { if (++n === 2) throw Object.assign(new Error('x'), { code: 'gmail_send_failed_503' }); return orig(m); };
  assert.equal((await finalize(h, c)).code, 502);
  assert.equal(h.mailer.quotes.length, 1);
  assert.equal((await finalize(h, c)).body.ok, true);
  assert.equal(h.mailer.quotes.length, 3, 'one e-mail per photo group, none repeated');
});

test('mailbox not connected: error response, request stays stored', async () => {
  const h = harness({}, { ready: false });
  const c = await create(h);
  const f = await finalize(h, c);
  assert.deepEqual([f.code, f.body.error], [503, 'mail_unavailable']);
  assert.equal(h.db.prepare('SELECT status FROM quotes WHERE id = ?').get(c.id).status, 'mail_failed');
});

test('repeating the first call with the same submissionId never creates a second quote (double click / retry)', async () => {
  const h = harness();
  const q = quote();
  const a = await create(h, q), b = await create(h, q);
  assert.equal(a.id, b.id);
  assert.equal(a.token, b.token);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM quotes').get().n, 1);
  await finalize(h, a);
  const again = await h.call('/api/quotes', { body: q });
  assert.equal(again.body.status, 'sent');
  assert.equal(h.mailer.quotes.length, 1);
});

test('MIME: header injection is neutralised and attachments are base64 multipart', () => {
  const raw = buildMime({ to: 'a@b.fr\r\nBcc: x@y.z', replyTo: 'c@d.fr', subject: 'Sujet\r\nBcc: evil@x.y', html: '<p>é</p>', attachments: [{ name: 'a"b\r\n.png', mime: 'image/png', data: PNG }] });
  assert.ok(!/^Bcc:/mi.test(raw), 'no injected header');
  assert.match(raw, /Content-Type: multipart\/mixed; boundary=/);
  assert.match(raw, /Content-Disposition: attachment; filename="a_b _?\.png"/);
  const raw2 = buildMime({ to: 'a@b.fr', subject: 's', html: 'x', attachments: [{ name: 'é.png', mime: 'image/png', data: PNG }] });
  assert.match(raw2, /filename="=\?UTF-8\?B\?/);
  assert.ok(raw.endsWith('--\r\n'));
});

test('e-mail body escapes HTML from the visitor', () => {
  const q = validateQuote(quote({ contact: { name: '<script>alert(1)</script>', phone: '0612345678', email: 'a@b.fr' } })).value;
  const [m] = buildQuoteMessages({ quote: q, photos: [], to: 'x@y.z', budget: 1e6, ref: 'REF' });
  assert.ok(!m.html.includes('<script>'));
  assert.match(m.html, /&lt;script&gt;/);
});

/* ---- real Fastify stack: hooks (Origin, content types), body limits, routing. Runs in CI where fastify is installed. ---- */
let fastifyAvailable = true;
try { require.resolve('fastify'); require.resolve('@fastify/cookie'); } catch (_) { fastifyAvailable = false; }
const opts = { skip: fastifyAvailable ? false : 'fastify not installed in this environment' };

async function boot(mailerOpts) {
  const { buildApp } = require('../src/app');
  const s = setup({ config: testConfig({ quoteRecipient: 'devis@vectis.test' }), mailer: mailerOpts ? new FakeMailer(mailerOpts) : undefined });
  const { app } = await buildApp({ config: s.cfg, db: s.db, mailer: s.mailer, keys: s.keys, logger: false });
  await app.ready();
  const req = (method, url, payload, headers = {}, ct = 'application/json') => app.inject({ method, url, payload, headers: { origin: 'https://devis.test', 'content-type': ct, ...headers } });
  return { app, req, s };
}

test('Fastify: full public flow works with the real hooks and limits', opts, async () => {
  const { req, s } = await boot();
  const q = quote({ photos: [1] });
  const r = await req('POST', '/api/quotes', q);
  assert.equal(r.statusCode, 200, r.body);
  const { id, token } = r.json();
  const up = await req('POST', `/api/quotes/${id}/photos`, PNG, { 'x-quote-token': token, 'x-photo-index': '0', 'x-photo-prop': '0', 'x-photo-name': 'p.png' }, 'image/png');
  assert.equal(up.statusCode, 200, up.body);
  const f = await req('POST', `/api/quotes/${id}/finalize`, { token });
  assert.equal(f.statusCode, 200, f.body);
  assert.equal(s.mailer.quotes.length, 1);
  assert.equal((await req('POST', '/api/quotes', q, { origin: 'https://evil.test' })).statusCode, 403, 'foreign origin refused');
  assert.equal((await req('POST', '/api/quotes', 'x', {}, 'text/plain')).statusCode, 415);
});

test('Fastify: an e-mail failure is returned as 502 with ok:false (never a success)', opts, async () => {
  const { req, s } = await boot({ ready: true });
  s.mailer.failQuote = true;
  const { id, token } = (await req('POST', '/api/quotes', quote())).json();
  const f = await req('POST', `/api/quotes/${id}/finalize`, { token });
  assert.equal(f.statusCode, 502);
  assert.equal(f.json().ok, false);
});
