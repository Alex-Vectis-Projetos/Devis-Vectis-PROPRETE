'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { setup, testConfig, FakeMailer } = require('./helpers');
const { registerQuoteRoutes, validateQuote, buildQuoteMessages } = require('../src/quotes');
const { buildMime, GmailMailer } = require('../src/mailer');
const { AuthService } = require('../src/auth');
const { loadConfig } = require('../src/config');

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
  const logs = [];
  const call = async (url, { body, headers = {}, params = {} } = {}) => {
    let code = 200, out;
    const reply = { code(c) { code = c; return reply; }, header() { return reply; }, send(x) { out = x; return reply; } };
    const req = { body, headers, params, ip: '203.0.113.9', log: { info(o) { logs.push(o); }, error(o) { logs.push(o); }, warn() {} } };
    const r = await routes[url](req, reply);
    return { code, body: out !== undefined ? out : r };
  };
  return { ...s, call, logs };
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
  const subjects = new Set(h.mailer.quotes.map((m) => m.subject));
  assert.equal(subjects.size, 1, 'same subject for every e-mail of the request (one Gmail conversation)');
  assert.match([...subjects][0], /Réf\. [0-9A-F]{8}$/);
  assert.match(h.mailer.quotes[0].html, /PROPRIÉTÉ 2/);
  assert.match(h.mailer.quotes[0].html, /Bureau/);
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


/* ---- visual quote sheet, inline photos, conversation threading, timings ---- */
const txt = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const ph = (prop_, name, n = 100, extra = {}) => ({ prop: prop_, name, mime: 'image/jpeg', data: Buffer.alloc(n, 7), ...extra });

test('sheet: header, reference, date, client section and one block per property with every field', () => {
  const q = validateQuote(quote({
    contact: { name: 'Alex Souza', phone: '06 12 34 56 78', email: 'alex@client.fr' },
    properties: [
      prop({ site: 'Pharmacie du Parc', type: 'Pharmacie', surface: '48', rooms: '1', offices: '1', wc: '1', kitchens: '1', halls: '2', floors: '3', other: 'Réserve', desc: 'Ligne 1\nLigne 2 « complète »', price: { kind: 'fixed', value: '950' }, freq: 'Autre fréquence', freqother: 'Tous les 15 jours', visits: '2', days: ['Lundi', 'Jeudi'] }),
      prop({ site: 'Cabinet Rive Gauche', num: '', price: null, photos: undefined }),
    ], photos: [0, 0],
  })).value;
  const [m] = buildQuoteMessages({ quote: q, photos: [], to: 'x@y.z', budget: 1e6, ref: 'FAFD1587', id: 'a'.repeat(32), createdAt: Date.UTC(2026, 10, 15, 21, 30) });
  const t = txt(m.html);
  for (const s of ['DEMANDE DE DEVIS — VECTIS', 'Nouvelle demande de devis', 'Référence de la demande : FAFD1587', 'Date de la demande : 15 novembre 2026', 'Informations du client',
    'Alex Souza', '06 12 34 56 78', 'alex@client.fr', 'PROPRIÉTÉ 1', 'PROPRIÉTÉ 2', 'Pharmacie du Parc', 'Cabinet Rive Gauche', 'Rue Pasteur', '69200', 'Vénissieux',
    'Surface 48 m²', 'Nombre de salles 1', 'Nombre de bureaux 1', 'Autres espaces Réserve', 'Nombre de sanitaires 1', 'Nombre de cuisines 1', 'Nombre de couloirs 2', 'Nombre d’étages 3',
    'Ligne 1 Ligne 2 « complète »', 'Modalité de prix Forfait fixe', 'Montant proposé 950,00 € HT', 'TVA applicable', 'Autre : Tous les 15 jours', 'Visites par période 2', 'Lundi, Jeudi']) {
    assert.ok(t.includes(s), 'missing in sheet: ' + s);
  }
  assert.match(m.html, /white-space:pre-wrap">Ligne 1\nLigne 2/, 'description kept integrally with its line breaks');
  assert.ok(t.indexOf('Pharmacie du Parc') < t.indexOf('Cabinet Rive Gauche'));
});

test('sheet: empty optional fields show a dash, nothing is invented, properties are never mixed', () => {
  const q = validateQuote(quote({ properties: [prop({ price: null, num: '' }), prop({ site: 'Autre site', price: { kind: 'hour', value: '45' }, rooms: '4' })], photos: [0, 0] })).value;
  const [m] = buildQuoteMessages({ quote: q, photos: [], to: 'x@y.z', budget: 1e6, ref: 'R' });
  const t = txt(m.html);
  assert.match(t, /Montant proposé Non précisé par le demandeur/);
  assert.match(t, /Numéro de rue —/);
  const [p1, p2] = t.split('PROPRIÉTÉ 2');
  assert.ok(!/Nombre de salles 4/.test(p1) && /Nombre de salles 4/.test(p2), 'values of property 2 stay in property 2');
  assert.ok(!/45,00/.test(p1) && /45,00/.test(p2));
});

test('photos: shown in the sheet grouped by property, attached once, file names never displayed', () => {
  const q = validateQuote(quote({ properties: [prop({ site: 'A' }), prop({ site: 'B' })], photos: [2, 1] })).value;
  const photos = [ph(0, 'WhatsApp Image 2026-11-09 at 15.56.51 (4).jpeg'), ph(0, 'WhatsApp Image 2026-11-09 at 15.56.51 (5).jpeg'), ph(1, 'IMG_0001.jpg')];
  const [m] = buildQuoteMessages({ quote: q, photos, to: 'x@y.z', budget: 1e6, ref: 'R', id: 'b'.repeat(32) });
  assert.equal(m.attachments.length, 3, 'one copy of each photo, as a real attachment');
  assert.ok(m.attachments.every((a) => /^ph\d\.[a-z0-9]+@devis\.mrprop\.fr$/.test(a.cid)));
  assert.ok(!/WhatsApp|IMG_0001|\.jpe?g/i.test(m.html), 'no technical file name in the visible sheet');
  assert.ok(!/Photos jointes/.test(m.html));
  const imgs = [...m.html.matchAll(/<img src="cid:([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(imgs, m.attachments.map((a) => a.cid), 'each attachment is referenced once, in order');
  const cut = m.html.indexOf('PROPRIÉTÉ 2');
  assert.equal([...m.html.slice(0, cut).matchAll(/<img /g)].length, 2, 'property 1 shows its 2 photos');
  assert.equal([...m.html.slice(cut).matchAll(/<img /g)].length, 1, 'property 2 shows its 1 photo');
  assert.match(m.html, /Aucune photo|<img/);
});

test('MIME: photo = attachment + Content-ID (single copy); conversation headers; hostile ids ignored', () => {
  const q = validateQuote(quote({ photos: [1] })).value;
  const [m] = buildQuoteMessages({ quote: q, photos: [ph(0, 'a.jpg')], to: 'v@g.com', budget: 1e6, ref: 'R', id: 'c'.repeat(32) });
  const raw = buildMime(m);
  assert.match(raw, /^Message-ID: <vectis-quote-c+-1@devis\.mrprop\.fr>$/m);
  assert.ok(!/^In-Reply-To:/m.test(raw), 'first message starts the conversation');
  assert.match(raw, /Content-Disposition: attachment; filename="a\.jpg"\r\nContent-ID: <ph0\.c+@devis\.mrprop\.fr>/);
  assert.equal((raw.match(/Content-Disposition: attachment/g) || []).length, 1, 'photo present once');
  const hostile = buildMime({ to: 'a@b.fr', subject: 's', html: 'x', messageId: '<a@b>\r\nBcc: evil@x.y', inReplyTo: 'x\r\nBcc: evil@x.y', attachments: [{ name: 'a.png', mime: 'image/png', data: PNG, cid: 'x y@z\r\nBcc: e@e.e' }] });
  assert.ok(!/Bcc/i.test(hostile) && !/^Message-ID/m.test(hostile) && !/Content-ID/.test(hostile), 'invalid ids are dropped, never injected');
});

test('conversation: split e-mails keep ONE subject, reference the first message and reuse Gmail threadId; photos stay with their property', async () => {
  const h = harness({ quoteMailBudget: 250 });
  const c = await create(h, quote({ properties: [prop({ site: 'A' }), prop({ site: 'B' })], photos: [1, 2] }));
  const big = (n) => Buffer.concat([PNG, Buffer.alloc(n, 3)]);
  await upload(h, c, 0, 0, big(120)); await upload(h, c, 1, 1, big(120)); await upload(h, c, 2, 1, big(120));
  assert.equal((await finalize(h, c)).body.ok, true);
  const ms = h.mailer.quotes;
  assert.equal(ms.length, 3, 'one photo per e-mail within the tiny budget');
  assert.equal(new Set(ms.map((m) => m.subject)).size, 1);
  assert.equal(ms[0].threadId, undefined, 'first message: Gmail creates the conversation');
  assert.equal(ms[1].threadId, 'thread1'); assert.equal(ms[2].threadId, 'thread1', 'next messages join it through threadId');
  assert.equal(ms[1].inReplyTo, ms[0].messageId); assert.equal(ms[2].inReplyTo, ms[0].messageId);
  assert.match(txt(ms[0].html), /\+ 2 photos dans les messages suivants/, 'sheet says where the other photos are (property B)');
  assert.match(txt(ms[1].html), /suite 2\/3/); assert.match(ms[2].html, /Propriété 2 — B/);
  assert.ok(!/PROPRIÉTÉ 1/.test(ms[2].html), 'continuations carry photos only, never a second copy of the sheet');
});

test('timings: quote_sent log has durations and Gmail ids, and no personal data', async () => {
  const h = harness();
  const c = await create(h, quote({ contact: { name: 'Marie Secrète', phone: '06 99 88 77 66', email: 'marie.secrete@client.fr' } }));
  await finalize(h, c);
  const ev = h.logs.find((l) => l.event === 'quote_sent');
  assert.ok(ev, 'quote_sent logged');
  for (const k of ['sinceCreatedMs', 'readMs', 'buildMs', 'sendMs', 'totalMs']) assert.equal(typeof ev[k], 'number', k);
  assert.equal(ev.sends[0].gmailId, 'm1'); assert.equal(ev.sends[0].threadId, 'thread1'); assert.equal(typeof ev.sends[0].apiMs, 'number');
  const dump = JSON.stringify(ev);
  assert.ok(!/Secr|marie|06 99|client\.fr|ph0\./i.test(dump), 'no name, phone, e-mail, photo id or content in the log');
});

test('timings: a failing send logs where it failed and still stores the request for a retry', async () => {
  const h = harness({}, {});
  h.mailer.failQuote = true;
  const c = await create(h);
  const f = await finalize(h, c);
  assert.equal(f.code, 502);
  const ev = h.logs.find((l) => l.event === 'quote_mail_failed');
  assert.ok(ev && typeof ev.buildMs === 'number' && typeof ev.failedAfterMs === 'number');
});

test('GmailMailer._send: returns Gmail ids and timings, sends threadId only when valid', async () => {
  const calls = [];
  const m = new GmailMailer({ db: null, config: { googleClientId: 'x', googleClientSecret: 'y', mailSender: 'v@g.com' }, keys: {}, fetchImpl: async (url, o) => { calls.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ id: 'abc123', threadId: 'thr456', labelIds: ['SENT'] }) }; } });
  m.accessToken = async () => 'SECRET-TOKEN-VALUE';
  const r = await m.sendQuote({ to: 'a@b.fr', subject: 's', html: 'x', threadId: 'thr456' });
  assert.equal(r.id, 'abc123'); assert.equal(r.threadId, 'thr456');
  for (const k of ['tokenMs', 'apiMs', 'totalMs', 'mimeBytes']) assert.equal(typeof r[k], 'number', k);
  assert.equal(calls[0].threadId, 'thr456');
  await m.sendQuote({ to: 'a@b.fr', subject: 's', html: 'x', threadId: 'bad id"; drop' });
  assert.equal('threadId' in calls[1], false, 'invalid threadId is not forwarded');
  assert.equal(JSON.stringify(r).includes('SECRET-TOKEN-VALUE'), false, 'no token in the result');
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

test('recipient: the official VECTIS address is explicit and never derived from MAIL_SENDER / ADMIN_EMAILS', () => {
  const base = { ADMIN_EMAILS: 'admin@example.test', SESSION_SECRET: 'x'.repeat(48), COOKIE_SECURE: 'false', MAIL_SENDER: 'robot@gmail.test' };
  assert.equal(loadConfig(base).quoteRecipient, 'vectis.adm@gmail.com');
  assert.equal(loadConfig({ ...base, QUOTE_RECIPIENT: ' Autre@Vectis.Test ' }).quoteRecipient, 'autre@vectis.test', 'explicit override still possible');
  assert.equal(loadConfig({ ...base, QUOTE_RECIPIENT: 'pas une adresse' }).quoteRecipient, 'vectis.adm@gmail.com', 'invalid value never routes quotes elsewhere');
  assert.equal(loadConfig({ ...base, QUOTE_RECIPIENT: 'a@b.fr,c@d.fr' }).quoteRecipient, 'vectis.adm@gmail.com', 'no multiple recipients injected via env');
});

test('sender identity: no From header is forged; Gmail uses the authenticated mailbox, Reply-To is the customer', () => {
  const raw = buildMime({ to: 'vectis.adm@gmail.com', replyTo: 'client@example.fr', subject: 's', html: 'x' });
  assert.ok(!/^From:/mi.test(raw));
  assert.match(raw, /^To: vectis\.adm@gmail\.com$/m);
  assert.match(raw, /^Reply-To: client@example\.fr$/m);
});

/* ---- upload policy, photo volumes and sender identity (step 2) ---- */
const sized = (n, sig = PNG) => { const b = Buffer.alloc(n); sig.copy(b, 0, 0, Math.min(sig.length, n)); return b; };

test('photos: 1, 3 and 10 photos are stored, attached and sent; success only after Gmail accepted', async () => {
  for (const n of [1, 3, 10]) {
    const h = harness();
    const c = await create(h, quote({ photos: [n] }));
    for (let i = 0; i < n; i++) assert.equal((await upload(h, c, i, 0, sized(2000 + i), 'image/png', `p${i}.png`)).code, 200);
    const f = await finalize(h, c);
    assert.deepEqual([f.code, f.body.status], [200, 'sent']);
    assert.equal(h.mailer.quotes.flatMap((m) => m.attachments).length, n, `${n} photo(s) attached`);
  }
});

test('photos: exactly 10 MB is accepted, 10 MB + 1 byte is refused (HTTP 413, never stored)', async () => {
  const h = harness();
  const c = await create(h, quote({ photos: [2] }));
  const MAX = 10 * 1024 * 1024;
  assert.equal((await upload(h, c, 0, 0, sized(MAX))).code, 200);
  const over = await upload(h, c, 1, 0, sized(MAX + 1));
  assert.equal(over.code, 413);
  assert.equal(over.body.error, 'too_large');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM quote_photos').get().n, 1);
});

test('photos near the limit are spread over several e-mails (each within the budget) and none is lost', async () => {
  const h = harness({ quoteMailBudget: 12 * 1024 * 1024 });
  const c = await create(h, quote({ photos: [4] }));
  for (let i = 0; i < 4; i++) assert.equal((await upload(h, c, i, 0, sized(9.5 * 1024 * 1024), 'image/png', `big${i}.png`)).code, 200);
  assert.equal((await finalize(h, c)).body.ok, true);
  assert.equal(h.mailer.quotes.length, 4);
  for (const m of h.mailer.quotes) assert.ok(m.attachments.reduce((n, a) => n + a.data.length, 0) <= 12 * 1024 * 1024);
  assert.deepEqual(h.mailer.quotes.flatMap((m) => m.attachments.map((a) => a.name)).sort(), ['big0.png', 'big1.png', 'big2.png', 'big3.png']);
});

test('per-quote limits: total photo count (validation) and total stored size (upload) are enforced', async () => {
  const h = harness({ quoteMaxPhotos: 5, quoteMaxBytes: 5000 });
  assert.equal((await h.call('/api/quotes', { body: quote({ properties: [prop(), prop()], photos: [3, 3] }) })).code, 422, 'more than the allowed photos');
  const c = await create(h, quote({ properties: [prop()], photos: [3] }));
  assert.equal((await upload(h, c, 0, 0, sized(2400))).code, 200);
  assert.equal((await upload(h, c, 1, 0, sized(2400))).code, 200);
  const r = await upload(h, c, 2, 0, sized(2400));
  assert.deepEqual([r.code, r.body.error], [413, 'quote_too_large']);
  assert.equal((await upload(h, c, 1, 0, sized(2500))).code, 200, 'replacing a photo does not count twice');
});

test('upload interrupted then resumed: re-sending photos is idempotent, nothing duplicated, one e-mail', async () => {
  const h = harness();
  const c = await create(h, quote({ photos: [3] }));
  await upload(h, c, 0, 0, sized(1000)); await upload(h, c, 1, 0, sized(1000));
  assert.equal((await finalize(h, c)).code, 409, 'refused while the third photo is missing');
  assert.deepEqual((await finalize(h, c)).body.missing, [2]);
  await upload(h, c, 0, 0, sized(1000)); await upload(h, c, 1, 0, sized(1000)); await upload(h, c, 2, 0, sized(1000));
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM quote_photos').get().n, 3);
  assert.equal((await finalize(h, c)).body.ok, true);
  assert.equal((await finalize(h, c)).body.ok, true);
  assert.equal(h.mailer.quotes.length, 1);
});

test('e-mail failure with photos: error, photos and quote kept on the server, retry sends once', async () => {
  const h = harness();
  const c = await create(h, quote({ photos: [2] }));
  await upload(h, c, 0, 0, sized(1000)); await upload(h, c, 1, 0, sized(1000));
  h.mailer.failQuote = true;
  assert.equal((await finalize(h, c)).code, 502);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM quote_photos').get().n, 2);
  h.mailer.failQuote = false;
  assert.equal((await finalize(h, c)).body.ok, true);
  assert.equal(h.mailer.quotes.length, 1);
  assert.equal(h.mailer.quotes[0].attachments.length, 2);
});

test('optimised photos: the e-mail says so and shows the original size; bad size header is ignored', async () => {
  const h = harness();
  const c = await create(h, quote({ photos: [2] }));
  const u = (idx, hdr) => h.call('/api/quotes/:id/photos', { params: { id: c.id }, body: sized(1500), headers: { 'x-quote-token': c.token, 'x-photo-index': String(idx), 'x-photo-prop': '0', 'content-type': 'image/png', 'x-photo-name': 'a.png', ...hdr } });
  await u(0, { 'x-photo-original-size': String(6 * 1024 * 1024) }); await u(1, { 'x-photo-original-size': 'abc' });
  await finalize(h, c);
  const html = h.mailer.quotes[0].html;
  assert.match(html, /allégée : 6 Mo/);
  assert.equal((html.match(/allégée :/g) || []).length, 1);
});

test('sender identity: From shows "VECTIS — Nouvelle demande de <name>" on the authenticated address only; Reply-To is the customer; body carries their data', async () => {
  const h = harness({ mailSender: 'vectis.adm@gmail.test', quoteRecipient: 'vectis.adm@gmail.com' });
  const c = await create(h, quote({ contact: { name: 'Marie Dupont', phone: '0612345678', email: 'marie@client.fr' } }));
  await finalize(h, c);
  const m = h.mailer.quotes[0];
  assert.deepEqual(m.from, { name: 'VECTIS — Nouvelle demande de Marie Dupont', address: 'vectis.adm@gmail.test' });
  assert.equal(m.to, 'vectis.adm@gmail.com');
  assert.equal(m.replyTo, 'marie@client.fr');
  assert.match(m.html, /Marie Dupont/); assert.match(m.html, /marie@client\.fr/); assert.match(m.html, /0612345678/);
  assert.ok(!/qwork/i.test(m.html), 'no foreign identity in the body');
  const raw = buildMime(m);
  assert.match(raw, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <vectis\.adm@gmail\.test>$/m);
  const decoded = Buffer.from(raw.match(/^From: =\?UTF-8\?B\?([^?]+)\?=/m)[1], 'base64').toString('utf8');
  assert.equal(decoded, 'VECTIS — Nouvelle demande de Marie Dupont');
});

test('sender identity: a hostile customer name cannot inject headers or change the From address', () => {
  const raw = buildMime({ to: 'vectis.adm@gmail.com', from: { name: 'VECTIS — Nouvelle demande de X>\r\nBcc: evil@x.y <boss@evil.test', address: 'vectis.adm@gmail.test' }, replyTo: 'c@d.fr', subject: 's', html: 'x' });
  assert.ok(!/^Bcc:/mi.test(raw));
  assert.equal((raw.match(/^From:/gm) || []).length, 1);
  assert.match(raw, / <vectis\.adm@gmail\.test>$/m);
  assert.ok(!/boss@evil/.test(raw.split('\r\n\r\n')[0].replace(/=\?UTF-8\?B\?[^?]*\?=/g, '')), 'no foreign address in clear in the headers');
});

test('without a configured sender no From header is written (Gmail uses the authenticated account)', () => {
  assert.ok(!/^From:/mi.test(buildMime({ to: 'a@b.fr', replyTo: 'c@d.fr', subject: 's', html: 'x' })));
});
