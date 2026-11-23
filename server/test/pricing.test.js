'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { setup, testConfig, FakeMailer, ADMIN } = require('./helpers');
const P = require('../src/pricing');
const { ContentStore, ContentError, SECTIONS, PRIVATE_SECTIONS } = require('../src/content');
const { registerEstimateRoutes, currentPricing } = require('../src/estimate');
const { registerQuoteRoutes, validateQuote, buildQuoteMessages } = require('../src/quotes');
const { registerSiteRoutes } = require('../src/site');
const { AuthService } = require('../src/auth');

let fastifyAvailable = true;
try { require.resolve('fastify'); require.resolve('@fastify/cookie'); } catch (_) { fastifyAvailable = false; }
const opts = { skip: fastifyAvailable ? false : 'fastify not installed in this environment' };

const D = P.DEFAULT_PRICING;
const clone = (o) => JSON.parse(JSON.stringify(o));
const base = { type: 'Bureau', surface: 48, counts: {}, surfaces: [], services: [], freq: 'Une fois par semaine', visits: 1 };
const fail = (f, m) => { throw new ContentError(f, m); };

/* ---------- catalogue : la page publique et le serveur ne doivent jamais diverger ---------- */
test('catalogue: the identifiers embedded in index.html are exactly the ones the server accepts', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const m = html.match(/\/\*CATALOG:BEGIN\*\/var CATALOG=([\s\S]*?);\/\*CATALOG:END\*\//);
  assert.ok(m, 'CATALOG block present in index.html');
  const c = JSON.parse(m[1]);
  assert.deepEqual(c.counters.map((x) => [x.k, x.l, x.max]), P.COUNTERS);
  assert.deepEqual(c.surfaces.map((x) => [x.k, x.l]), P.SURFACES);
  assert.deepEqual(c.services.map((x) => ({ id: x.id, label: x.label, tasks: x.tasks.map((t) => [t.id, t.label]) })), P.SERVICES);
  assert.equal(c.otherMax, P.SERVICES_OTHER_MAX);
  // la liste des types et des fréquences du formulaire est celle du serveur
  const arr = (name) => JSON.parse(html.match(new RegExp(`var ${name}=(\\[.*?\\]);`))[1].replace(/'/g, '"'));
  assert.deepEqual(arr('TYPES'), P.TYPES);
  assert.deepEqual(arr('FREQS'), P.FREQS);
});

test('catalogue: historical counter names are preserved and the old fields stay mandatory-compatible', () => {
  for (const k of ['rooms', 'offices', 'wc', 'kitchens', 'halls', 'floors']) assert.ok(P.COUNTER_KEYS.includes(k), k);
  for (const k of ['bedrooms', 'bathrooms', 'stairs', 'balconies', 'yard', 'garage', 'meeting', 'breakrooms', 'common']) assert.ok(P.COUNTER_KEYS.includes(k), k);
  assert.deepEqual(P.SURFACES.map((s) => s[0]), ['carpets', 'handrails', 'glass', 'doors', 'other']);
  assert.deepEqual(P.SERVICES.map((c) => c.id), ['interne', 'sanitaires', 'cuisine', 'vitres', 'communes']);
  assert.equal(P.SERVICES.find((c) => c.id === 'interne').tasks.length, 11);
  assert.equal(P.SERVICES.find((c) => c.id === 'sanitaires').tasks.length, 10);
  assert.equal(P.SERVICES.find((c) => c.id === 'cuisine').tasks.length, 8);
  assert.equal(P.SERVICES.find((c) => c.id === 'vitres').tasks.length, 5);
  assert.equal(P.SERVICES.find((c) => c.id === 'communes').tasks.length, 5);
  assert.equal(new Set(P.SERVICE_IDS).size, P.SERVICE_IDS.length, 'no duplicated task id');
});

/* ---------- fréquence ---------- */
test('frequency: weekly = 4.33 visits/month, twice a week = 8.67, monthly = 1; the client choice is respected', () => {
  assert.equal(P.visitPlan('Une fois par semaine', 1).perMonth, 4.33);
  assert.equal(P.visitPlan('Une fois par semaine', 5).perMonth, 4.33, '"une fois" fixes one visit per week');
  assert.equal(P.visitPlan('Plusieurs fois par semaine', 2).perMonth, 8.67);
  assert.equal(P.visitPlan('Plusieurs fois par semaine', 3).perMonth, 13);
  assert.equal(P.visitPlan('Plusieurs fois par semaine', 1).perMonth, 8.67, 'at least two visits for "plusieurs fois"');
  assert.equal(P.visitPlan('Une fois par mois', 1).perMonth, 1);
  assert.equal(P.visitPlan('Tous les 15 jours', 1).perMonth, 2.17);
  assert.equal(P.visitPlan('Tous les 3 mois', 1).perMonth, 0.33);
  assert.deepEqual(P.visitPlan('Une seule intervention', null), { oneOff: true, total: 1, perMonth: null });
  assert.equal(P.visitPlan('Plusieurs interventions ponctuelles', 3).total, 3);
  assert.equal(P.visitPlan('Autre fréquence', 2), null, 'not priceable');
  assert.equal(P.visitPlan('', 2), null);
});

/* ---------- formules ---------- */
test('formula: 48 m², weekly — hours, hourly price, monthly forfait follow hours × rate × visits per month', () => {
  const e = P.estimate(D, base);
  assert.equal(e.ok, true);
  assert.equal(e.preliminary, true);
  assert.equal(e.hours.area, 0.6);              // 48 / 80
  assert.equal(e.hours.visit, 1);               // minimum 1 h per visit
  assert.equal(e.rate, 32.5);
  assert.equal(e.prices.hour.value, 32.5);
  assert.equal(e.visitsPerMonth, 4.33);
  assert.equal(e.prices.fixed.value, Math.round(1 * 32.5 * 4.33 * 100) / 100);
  assert.equal(e.prices.fixed.basis, 'mois');
  assert.equal(e.prices.service, null, 'nothing selected, nothing charged per service');
  assert.equal(e.perM2.inRangeMonth, true);
});

test('formula: surface alone is never multiplied by a fixed rate — rooms, surfaces and tasks add time', () => {
  const plain = P.estimate(D, { ...base, surface: 400 });
  assert.equal(plain.hours.area, 5);
  const rich = P.estimate(D, { ...base, surface: 400, counts: { wc: 4, kitchens: 1, bathrooms: 2 }, surfaces: ['glass', 'carpets'], services: ['interne.vacuum', 'sanitaires.toilets'] });
  assert.equal(rich.hours.rooms, Math.round((4 * D.roomMinutes.wc + D.roomMinutes.kitchens + 2 * D.roomMinutes.bathrooms) / 60 * 100) / 100);
  assert.equal(rich.hours.surfaces, Math.round((D.surfaceMinutes.glass + D.surfaceMinutes.carpets) / 60 * 100) / 100);
  assert.equal(rich.hours.tasks, Math.round((D.categoryMinutes.interne + D.categoryMinutes.sanitaires) / 60 * 100) / 100);
  assert.ok(rich.hours.visit > plain.hours.visit);
  assert.ok(rich.prices.fixed.value > plain.prices.fixed.value);
});

test('formula: unselected services are never charged; the per-service price counts only ticked items', () => {
  const none = P.estimate(D, base);
  assert.equal(none.prices.service, null);
  const one = P.estimate(D, { ...base, services: ['cuisine.dishes'] });
  assert.equal(one.hours.tasks, Math.round(D.categoryMinutes.cuisine / 60 * 100) / 100);
  assert.ok(one.prices.service.value > 0);
  const two = P.estimate(D, { ...base, services: ['cuisine.dishes', 'cuisine.sink', 'vitres.glass'] });
  assert.ok(two.prices.service.value >= one.prices.service.value);
  // une catégorie sans tâche cochée ne coûte rien, même si la pièce correspondante est déclarée
  const room = P.estimate(D, { ...base, counts: { kitchens: 2 } });
  assert.equal(room.prices.service, null);
});

test('formula: every commercial parameter comes from the configuration (nothing hard-coded)', () => {
  const c = clone(D);
  c.hourlyRate = 40; c.marginPct = 10; c.minHoursPerVisit = 2;
  c.productivity.default = 40; c.productivity.byType = { Bureau: 20 };
  c.frequencyAdjustPct = { 'Une fois par semaine': -10 };
  const e = P.estimate(c, base);
  assert.equal(e.hours.area, 2.4);                      // 48 / 20 (type override)
  assert.equal(e.rate, Math.round(40 * 1.1 * 0.9 * 100) / 100);
  assert.equal(e.hours.visit, 2.5);                     // 2.4 rounded to the quarter hour
  assert.equal(e.prices.fixed.value, Math.round(e.visitPrice * 4.33 * 100) / 100);
  assert.notEqual(P.estimate(c, { ...base, type: 'Maison' }).hours.area, e.hours.area, 'other types use the default productivity');
  const c2 = clone(D); c2.roomMinutes.wc = 60;
  assert.ok(P.estimate(c2, { ...base, counts: { wc: 2 } }).hours.rooms === 2);
});

test('formula: the minimum duration per visit comes from the configuration', () => {
  const c = clone(D); c.minHoursPerVisit = 3;
  assert.equal(P.estimate(c, base).hours.visit, 3);
  c.minHoursPerVisit = 0.5;
  assert.equal(P.estimate(c, base).hours.visit, 0.75, '0.6 h rounded UP to the next quarter hour');
});

test('formula: one-off, rare and free frequencies are priced per intervention (free frequency: period unknown, so no monthly forfait)', () => {
  const once = P.estimate(D, { ...base, freq: 'Une seule intervention', visits: null });
  assert.equal(once.prices.fixed.basis, 'intervention');
  assert.equal(once.prices.fixed.value, once.visitPrice);
  const three = P.estimate(D, { ...base, freq: 'Plusieurs interventions ponctuelles', visits: 3 });
  assert.equal(three.prices.fixed.value, Math.round(three.visitPrice * 3 * 100) / 100);
  const rare = P.estimate(D, { ...base, freq: 'Tous les 3 mois' });
  assert.equal(rare.prices.fixed.basis, 'intervention');
  const other = P.estimate(D, { ...base, freq: 'Autre fréquence' });
  assert.equal(other.prices.fixed.basis, 'intervention');
  assert.equal(other.prices.fixed.value, other.visitPrice);
  assert.deepEqual(other.missing, []);
  assert.deepEqual(P.estimate(D, { ...base, freq: '' }).missing, ['freq']);
  assert.equal(other.prices.hour.value, 32.5, 'hourly price remains available');
});

test('formula: no surface, no estimate', () => {
  assert.deepEqual(P.estimate(D, { ...base, surface: 0 }), { ok: false, reason: 'surface' });
});

test('input normalisation: unknown identifiers and out-of-range counters are refused', () => {
  assert.ok(P.normalizeInput({ ...base, counts: { rooms: 3 } }).value);
  assert.equal(P.normalizeInput({ ...base, counts: { sauna: 1 } }).error, 'counts');
  assert.equal(P.normalizeInput({ ...base, counts: { floors: 100 } }).error, 'counts');
  assert.equal(P.normalizeInput({ ...base, counts: { rooms: -1 } }).error, 'counts');
  assert.equal(P.normalizeInput({ ...base, counts: { rooms: 1.5 } }).error, 'counts');
  assert.equal(P.normalizeInput({ ...base, surfaces: ['lasers'] }).error, 'surfaces');
  assert.equal(P.normalizeInput({ ...base, services: ['interne.fly'] }).error, 'services');
  assert.equal(P.normalizeInput({ ...base, services: ['interne.dust', 'interne.dust'] }).error, 'services');
  assert.equal(P.normalizeInput(null).error, 'body');
  assert.equal(P.normalizeInput({ ...base, surface: '48 m²' }).value.surface, 48);
  assert.equal(P.normalizeInput({ ...base, surface: '48,5' }).value.surface, 48.5);
});

/* ---------- configuration ---------- */
test('config: defaults validate, unknown fields and absurd values are refused, missing groups are filled', () => {
  assert.deepEqual(P.validatePricing(clone(D), fail), D);
  assert.deepEqual(P.validatePricing({}, fail), D);
  const bad = (mut) => { const c = clone(D); mut(c); try { P.validatePricing(c, fail); return null; } catch (e) { return e.field; } };
  assert.equal(bad((c) => { c.hourlyRate = 0; }), 'pricing.hourlyRate');
  assert.equal(bad((c) => { c.hourlyRate = 'cher'; }), 'pricing.hourlyRate');
  assert.equal(bad((c) => { c.marginPct = -1; }), 'pricing.marginPct');
  assert.equal(bad((c) => { c.productivity.default = 0; }), 'pricing.productivity.default');
  assert.equal(bad((c) => { c.productivity.byType = { Licorne: 10 }; }), 'pricing.productivity.byType.Licorne');
  assert.equal(bad((c) => { c.roomMinutes.sauna = 1; }), 'pricing.roomMinutes.sauna');
  assert.equal(bad((c) => { c.categoryMinutes.interne = -3; }), 'pricing.categoryMinutes.interne');
  assert.equal(bad((c) => { c.frequencyAdjustPct = { 'Tous les jours': 5 }; }), 'pricing.frequencyAdjustPct.Tous les jours');
  assert.equal(bad((c) => { c.m2Reference = { min: 2, max: 1 }; }), 'pricing.m2Reference');
  assert.equal(bad((c) => { c.secret = 1; }), 'pricing.secret');
});

test('config: stored in the existing site_content table, versioned, NOT published to the public site', () => {
  const s = setup();
  const store = new ContentStore(s.db);
  assert.ok(SECTIONS.includes('pricing') && PRIVATE_SECTIONS.includes('pricing'));
  const saved = store.save('pricing', { ...clone(D), hourlyRate: 38 }, { email: ADMIN, expectedVersion: 0 });
  assert.equal(saved.version, 1);
  assert.equal(store.get('pricing').value.hourlyRate, 38);
  assert.throws(() => store.save('pricing', { ...clone(D), hourlyRate: 38 }, { email: ADMIN, expectedVersion: 0 }), (e) => e.conflict === true, 'stale version refused');
  assert.throws(() => store.save('pricing', { ...clone(D), hourlyRate: -5 }, { email: ADMIN }), ContentError);
  const cur = currentPricing(store);
  assert.equal(cur.saved, true); assert.equal(cur.cfg.hourlyRate, 38);
  // valeur corrompue en base : retour aux valeurs de départ, jamais d'exception
  s.db.prepare("UPDATE site_content SET value = ? WHERE section = 'pricing'").run(JSON.stringify({ hourlyRate: 'x' }));
  assert.equal(currentPricing(store).cfg.hourlyRate, D.hourlyRate);
});

function fakeApp() {
  const routes = {};
  const reg = (m) => (url, o, h) => { routes[`${m} ${url}`] = h || o; if (h) routes[`${m} ${url}`].opts = o; };
  return { routes, app: { get: reg('GET'), post: reg('POST'), put: reg('PUT'), delete: reg('DELETE'), addContentTypeParser() {} } };
}
const call = async (routes, key, { body, params = {} } = {}) => {
  let code = 200, out; const headers = {};
  const reply = { code(c) { code = c; return reply; }, header(k, v) { headers[k] = v; return reply; }, send(x) { out = x; return reply; } };
  const r = await routes[key]({ body, params, ip: '203.0.113.7', log: { info() {}, warn() {}, error() {} }, admin: { email: ADMIN } }, reply);
  return { code, headers, body: out !== undefined ? out : r };
};

test('public content never exposes the commercial parameters', async () => {
  const s = setup();
  const { routes, app } = fakeApp();
  const auth = new AuthService({ db: s.db, config: s.cfg, keys: s.keys, mailer: s.mailer, now: Date.now, log: () => {} });
  const requireAdmin = async () => {};
  registerSiteRoutes(app, { config: s.cfg, db: s.db, auth, requireAdmin, msg: {} });
  new ContentStore(s.db).save('pricing', { ...clone(D), hourlyRate: 77 }, { email: ADMIN });
  new ContentStore(s.db).save('contact', { company: 'VECTIS', address: 'a', postalCode: '69200', city: 'v', country: 'France', phone: '', email: '', siren: '107 463 358' }, { email: ADMIN });
  const pub = await call(routes, 'GET /api/site/content');
  assert.ok(pub.body.content.contact, 'public sections still published');
  assert.equal(pub.body.content.pricing, undefined);
  assert.ok(!JSON.stringify(pub.body).includes('77'), 'no rate leaks');
  const adm = await call(routes, 'GET /api/admin/site/content');
  assert.equal(adm.body.content.pricing.hourlyRate, 77, 'the administration sees it');
});

/* ---------- routes d'estimation ---------- */
function estimateHarness(cfgExtra = {}) {
  const s = setup({ config: testConfig(cfgExtra) });
  const { routes, app } = fakeApp();
  const auth = new AuthService({ db: s.db, config: s.cfg, keys: s.keys, mailer: s.mailer, now: Date.now, log: () => {} });
  registerEstimateRoutes(app, { config: s.cfg, db: s.db, auth, requireAdmin: async () => {} });
  return { ...s, routes, auth };
}

test('POST /api/estimate: public, uses the saved parameters, refuses unknown identifiers, never cached', async () => {
  const h = estimateHarness();
  const body = { type: 'Bureau', surface: '48 m²', counts: { wc: 1 }, surfaces: [], services: [], freq: 'Une fois par semaine', visits: '1' };
  const a = await call(h.routes, 'POST /api/estimate', { body });
  assert.equal(a.body.ok, true);
  assert.equal(a.body.prices.hour.value, 32.5);
  assert.equal(a.headers['Cache-Control'], 'no-store');
  new ContentStore(h.db).save('pricing', { ...clone(D), hourlyRate: 50 }, { email: ADMIN });
  assert.equal((await call(h.routes, 'POST /api/estimate', { body })).body.prices.hour.value, 50, 'new parameters apply immediately');
  const bad = await call(h.routes, 'POST /api/estimate', { body: { ...body, services: ['x.y'] } });
  assert.equal(bad.code, 422);
  assert.equal((await call(h.routes, 'POST /api/estimate', { body: { ...body, surface: '' } })).body.ok, false);
});

test('POST /api/estimate is rate limited per IP', async () => {
  const h = estimateHarness({ limits: { ...testConfig().limits, estimatePerIp: { limit: 3, windowMs: 3600e3 } } });
  const body = { surface: '48' };
  for (let i = 0; i < 3; i++) assert.equal((await call(h.routes, 'POST /api/estimate', { body })).code, 200);
  assert.equal((await call(h.routes, 'POST /api/estimate', { body })).code, 429);
});

test('admin preview: simulates UNSAVED parameters with the same calculation, validates them, saves nothing', async () => {
  const h = estimateHarness();
  const cfg = { ...clone(D), hourlyRate: 60 };
  const r = await call(h.routes, 'POST /api/admin/pricing/preview', { body: { config: cfg, input: { ...base } } });
  assert.equal(r.body.prices.hour.value, 60);
  assert.equal(new ContentStore(h.db).get('pricing'), null, 'nothing saved');
  const bad = await call(h.routes, 'POST /api/admin/pricing/preview', { body: { config: { ...clone(D), hourlyRate: -1 }, input: base } });
  assert.equal(bad.code, 422);
  const g = await call(h.routes, 'GET /api/admin/pricing');
  assert.equal(g.body.saved, false); assert.deepEqual(g.body.defaults, D); assert.equal(g.body.catalog.counters.length, P.COUNTERS.length);
});

test('admin routes require the administrator guard (same hook as the other admin routes)', () => {
  const h = estimateHarness();
  const guard = async () => {};
  const { routes, app } = fakeApp();
  registerEstimateRoutes(app, { config: h.cfg, db: h.db, auth: h.auth, requireAdmin: guard });
  assert.equal(routes['GET /api/admin/pricing'].opts.preHandler, guard);
  assert.equal(routes['POST /api/admin/pricing/preview'].opts.onRequest, guard);
  assert.equal(routes['POST /api/estimate'].opts.preHandler, undefined, 'the public estimate has no guard');
});

/* ---------- demande de devis : nouveaux champs ---------- */
const prop = (extra = {}) => ({
  site: 'Bureaux Lyon', num: '8', street: 'Rue Pasteur', zip: '69200', city: 'Vénissieux', type: 'Bureau', typeother: '', surface: '48 m²',
  desc: 'Entretien hebdomadaire', freq: 'Une fois par semaine', freqother: '', visits: '1', days: ['Lundi'], price: { kind: 'hour', value: '32,50' }, ...extra,
});
const quote = (extra = {}, pe = {}) => ({
  submissionId: 'sub-' + crypto.randomBytes(8).toString('hex'),
  contact: { name: 'Société Test', phone: '06 12 34 56 78', email: 'client@example.fr' }, properties: [prop(pe)], photos: [0], ...extra,
});

test('quote validation: new counters, surfaces and services are accepted and normalised', () => {
  const r = validateQuote(quote({}, { bedrooms: '2', rooms: '3', bathrooms: '1', stairs: '4', garage: '0', surfaces: ['glass', 'doors'], services: ['interne.vacuum', 'cuisine.dishes'], servicesOther: '  Nettoyage\n\n\n\nverrière ' }));
  assert.equal(r.ok, true);
  const p = r.value.properties[0];
  assert.equal(p.bedrooms, '2'); assert.equal(p.stairs, '4'); assert.equal(p.garage, '0'); assert.equal(p.yard, '');
  assert.deepEqual(p.surfaces, ['glass', 'doors']); assert.deepEqual(p.services, ['interne.vacuum', 'cuisine.dishes']);
  assert.equal(p.servicesOther, 'Nettoyage\n\nverrière');
});

test('quote validation: an old client (no new fields) is still accepted — nothing becomes mandatory', () => {
  const r = validateQuote(quote());
  assert.equal(r.ok, true);
  const p = r.value.properties[0];
  assert.deepEqual(p.surfaces, []); assert.deepEqual(p.services, []); assert.equal(p.servicesOther, ''); assert.equal(p.bedrooms, '');
  assert.equal(p.price.kind, 'hour');
});

test('quote validation: unknown ids, duplicates, bad counters and oversized free text are refused', () => {
  const f = (pe) => validateQuote(quote({}, pe)).field;
  assert.equal(f({ surfaces: ['lasers'] }), 'properties[0].surfaces');
  assert.equal(f({ services: ['interne.fly'] }), 'properties[0].services');
  assert.equal(f({ services: ['interne.dust', 'interne.dust'] }), 'properties[0].services');
  assert.equal(f({ services: 'interne.dust' }), 'properties[0].services');
  assert.equal(f({ stairs: '1000' }), 'properties[0].stairs');
  assert.equal(f({ floors: '100' }), 'properties[0].floors');
  assert.equal(f({ garage: '-1' }), 'properties[0].garage');
  assert.equal(f({ yard: '1.5' }), 'properties[0].yard');
  assert.equal(f({ servicesOther: 'x'.repeat(501) }), 'properties[0].servicesOther');
});

test('quote validation: the manual price keeps working; "auto" is kept only when it is exactly true', () => {
  assert.equal(validateQuote(quote({}, { price: { kind: 'fixed', value: '700,00' } })).value.properties[0].price.auto, undefined);
  assert.equal(validateQuote(quote({}, { price: { kind: 'hour', value: '32,50', auto: true } })).value.properties[0].price.auto, true);
  assert.equal(validateQuote(quote({}, { price: { kind: 'hour', value: '32,50', auto: 'yes' } })).value.properties[0].price.auto, undefined);
  assert.equal(validateQuote(quote({}, { price: null })).value.properties[0].price, null);
  assert.equal(validateQuote(quote({}, { price: { kind: 'hour', value: '0' } })).field, 'properties[0].price');
});

function quoteHarness() {
  const s = setup({ config: testConfig() });
  const routes = {};
  const app = { post: (url, o, h) => { routes[url] = h; } };
  const auth = new AuthService({ db: s.db, config: s.cfg, keys: s.keys, mailer: s.mailer, now: Date.now, log: () => {} });
  registerQuoteRoutes(app, { config: s.cfg, db: s.db, auth, mailer: s.mailer });
  const run = async (url, body) => {
    let code = 200, out; const reply = { code(c) { code = c; return reply; }, header() { return reply; }, send(x) { out = x; return reply; } };
    const r = await routes[url]({ body, headers: {}, params: {}, ip: '203.0.113.9', log: { info() {}, error() {}, warn() {} } }, reply);
    return { code, body: out !== undefined ? out : r };
  };
  return { ...s, run };
}

test('stored request: carries every new field and an estimate computed by the SERVER (a client-supplied estimate is ignored)', async () => {
  const h = quoteHarness();
  const q = quote({ photos: [0] }, { bedrooms: '2', wc: '2', kitchens: '1', stairs: '1', surfaces: ['glass'], services: ['sanitaires.toilets', 'cuisine.dishes'], servicesOther: 'Verrière', price: { kind: 'hour', value: '32,50', auto: true }, estimate: { hour: 1, fixed: { value: 1 } } });
  const r = await h.run('/api/quotes', q);
  assert.equal(r.code, 200);
  const stored = JSON.parse(h.db.prepare('SELECT payload FROM quotes WHERE id = ?').get(r.body.id).payload).properties[0];
  assert.equal(stored.bedrooms, '2'); assert.deepEqual(stored.surfaces, ['glass']); assert.deepEqual(stored.services, ['sanitaires.toilets', 'cuisine.dishes']);
  assert.equal(stored.servicesOther, 'Verrière'); assert.equal(stored.price.auto, true);
  const expected = P.estimateSnapshot(P.DEFAULT_PRICING, JSON.parse(JSON.stringify(validateQuote(q).value.properties[0])));
  assert.equal(stored.estimate.hoursPerVisit, expected.hoursPerVisit);
  assert.equal(stored.estimate.hour, expected.hour);
  assert.notEqual(stored.estimate.hour, 1, 'the client value is not trusted');
  assert.equal(stored.estimate.configVersion, 0); assert.equal(stored.estimate.configSaved, false);
  // paramètres enregistrés puis modifiés : la demande garde l'estimation de son instant
  new ContentStore(h.db).save('pricing', { ...clone(D), hourlyRate: 90 }, { email: ADMIN });
  const r2 = await h.run('/api/quotes', quote({}, { surfaces: [] }));
  const s2 = JSON.parse(h.db.prepare('SELECT payload FROM quotes WHERE id = ?').get(r2.body.id).payload).properties[0];
  assert.equal(s2.estimate.hour, 90); assert.equal(s2.estimate.configVersion, 1);
  assert.equal(JSON.parse(h.db.prepare('SELECT payload FROM quotes WHERE id = ?').get(r.body.id).payload).properties[0].estimate.hour, expected.hour, 'earlier request unchanged');
});

test('a quote with a free frequency is stored with its per-intervention forfait (the request is never blocked)', async () => {
  const h = quoteHarness();
  const r = await h.run('/api/quotes', quote({}, { freq: 'Autre fréquence', freqother: 'Un jour sur trois' }));
  assert.equal(r.code, 200);
  const stored = JSON.parse(h.db.prepare('SELECT payload FROM quotes WHERE id = ?').get(r.body.id).payload).properties[0];
  assert.equal(stored.estimate.fixed.basis, 'intervention');
  assert.equal(stored.estimate.fixed.value, stored.estimate.visitPrice);
  assert.equal(stored.estimate.hour, 32.5);
});

/* ---------- fiche e-mail ---------- */
const sheet = (props, qExtra = {}) => buildQuoteMessages({
  quote: { contact: { name: 'Société Test', phone: '0612345678', email: 'client@example.fr' }, properties: props, ...qExtra },
  photos: [], to: 'vectis.adm@gmail.com', from: 'vectis.adm@gmail.com', budget: 1e9, ref: 'ABCD1234', id: 'a'.repeat(32), createdAt: Date.UTC(2026, 10, 16, 9, 0),
})[0].html;
const full = (extra = {}) => ({ ...validateQuote(quote({}, extra)).value.properties[0], photoCount: 0 });

test('sheet: new counters, surfaces, services and the automatic estimate appear; old sections are unchanged', () => {
  const p = full({ bedrooms: '2', stairs: '3', surfaces: ['glass', 'carpets'], services: ['interne.vacuum', 'interne.dust', 'cuisine.dishes'], servicesOther: 'Nettoyage de la verrière', price: { kind: 'hour', value: '32,50', auto: true } });
  p.estimate = P.estimateSnapshot(D, p);
  const html = sheet([p]);
  for (const t of ['Configuration du local', 'Nombre : chambres', 'Nombre : escaliers', 'Éléments et surfaces à nettoyer', 'Vitres', 'Moquettes / tapis', 'Services à réaliser',
    'Nettoyage intérieur', 'Aspirer les sols', 'Dépoussiérer', 'Cuisine', 'Faire la vaisselle', 'Autres services', 'Nettoyage de la verrière',
    'Estimation indicative (automatique)', 'Durée estimée par visite', 'n’engage pas VECTIS', 'suggestion automatique du formulaire']) assert.ok(html.includes(t), t);
  for (const t of ['Identification', 'Description du service', 'Conditions financières', 'Fréquence et organisation', 'Photographies', 'Nombre de salles', 'Nombre de sanitaires']) assert.ok(html.includes(t), t);
});

test('sheet: an old request (no new fields) renders exactly the previous sections, with no empty new blocks', () => {
  const old = { ...prop(), photoCount: 0, rooms: '', offices: '', other: '', wc: '', kitchens: '', halls: '', floors: '' };
  const html = sheet([old]);
  for (const t of ['Éléments et surfaces à nettoyer', 'Services à réaliser', 'Estimation indicative', 'Nombre : ', 'suggestion automatique']) assert.ok(!html.includes(t), t);
  assert.ok(html.includes('Configuration du local') && html.includes('Conditions financières'));
});

test('sheet: the visitor text is escaped in the new fields too', () => {
  const html = sheet([full({ servicesOther: '<script>alert(1)</script>' })]);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});


test('sheet: every ticked task is listed individually under its category; unticked tasks and empty categories never appear', () => {
  const ids = ['interne.vacuum', 'interne.sweep', 'interne.mop', 'interne.dust', 'interne.tables', 'sanitaires.toilets', 'communes.stairs'];
  const html = sheet([full({ services: ids, surfaces: ['glass', 'doors'], servicesOther: 'Verrière' })]);
  for (const t of ['Aspirer les sols', 'Balayer', 'Laver les sols', 'Dépoussiérer', 'Nettoyer les tables', 'Désinfecter les toilettes', 'Nettoyer les escaliers', 'Vitres', 'Portes', 'Verrière']) assert.ok(html.includes(t), t);
  for (const t of ['Nettoyer les ordinateurs', 'Faire la vaisselle', 'Nettoyer les vitres', 'Nettoyer les salles de réunion', 'Moquettes', 'Rampes']) assert.ok(!html.includes(t), 'absent: ' + t);
  for (const c of ['Nettoyage intérieur', 'Salles de bains et sanitaires', 'Parties communes']) assert.ok(html.includes(c), c);
  for (const c of ['Cuisine</td>', 'Vitres et surfaces']) assert.ok(!html.includes(c), 'empty category hidden: ' + c);
  assert.equal((html.match(/&bull; /g) || []).length, ids.length + 2, 'one line per task and per surface');
  assert.ok(!/\d+ tâches? sélectionnée/.test(html), 'no bare count');
});

test('sheet: task and surface lines are still escaped, and photos/contact/reference remain', () => {
  const html = sheet([full({ services: ['interne.vacuum'] })]);
  assert.ok(html.includes('ABCD1234') && html.includes('Société Test') && html.includes('client@example.fr') && html.includes('Photographies'));
});

/* ---------- détail du calcul (affichage) : les termes reconstruisent exactement les valeurs du calcul ---------- */
test('explanation: the detail terms add up to the exact hours, prices and ratios the system computed', () => {
  const inp = { type: 'Bureau', surface: 102, counts: { wc: 2, kitchens: 1, stairs: 1 }, surfaces: ['glass', 'carpets'], services: ['interne.vacuum', 'interne.dust', 'cuisine.dishes', 'vitres.glass'], freq: 'Plusieurs fois par semaine', visits: 2 };
  const cfg = { ...D, marginPct: 10, frequencyAdjustPct: { 'Plusieurs fois par semaine': -5 } };
  const e = P.estimate(cfg, inp), d = e.detail;
  const min = d.rooms.reduce((s, r) => s + r.min, 0) + d.surfaces.reduce((s, r) => s + r.min, 0) + d.tasks.reduce((s, r) => s + r.min, 0);
  assert.ok(Math.abs(e.hours.area + min / 60 - d.rawHours) < 0.011, 'area + minutes = raw hours');
  assert.equal(d.roundedHours, Math.ceil(d.rawHours * 4 - 1e-9) / 4);
  assert.equal(e.hours.visit, Math.max(d.minHours, d.roundedHours));
  assert.equal(d.surface, 102);
  assert.equal(d.baseRate, cfg.hourlyRate); assert.equal(d.marginPct, 10); assert.equal(d.adjPct, -5);
  assert.equal(e.rate, Math.round(d.baseRate * 1.1 * 0.95 * 100) / 100);
  assert.equal(e.visitPrice, Math.round(e.hours.visit * e.rate * 100) / 100);
  assert.equal(e.prices.fixed.value, Math.round(e.visitPrice * e.visitsPerMonth * 100) / 100);
  assert.equal(e.perM2.month, Math.round(e.visitPrice * e.visitsPerMonth / 102 * 100) / 100);
  const sel = (d.tasks.reduce((s, r) => s + r.min, 0) + d.surfaces.reduce((s, r) => s + r.min, 0)) / 60;
  assert.equal(d.serviceHours, Math.max(0.25, Math.ceil(sel * 4 - 1e-9) / 4));
  assert.equal(e.prices.service.value, Math.round(d.serviceHours * e.rate * 100) / 100);
  assert.equal(e.perM2Service, Math.round(e.prices.service.value / 102 * 100) / 100);
  assert.deepEqual(d.tasks.map((t) => [t.k, t.n]), [['interne', 2], ['cuisine', 1], ['vitres', 1]]);
});

test('explanation: adding the detail changed none of the existing results (same values as before)', () => {
  const e = P.estimate(D, { type: 'Bureau', surface: 48, counts: {}, surfaces: [], services: [], freq: 'Une fois par semaine', visits: 1 });
  assert.equal(e.hours.visit, 1); assert.equal(e.rate, 32.5); assert.equal(e.prices.fixed.value, 140.73); assert.equal(e.prices.service, null); assert.equal(e.perM2Service, null);
});

/* ---------- pile Fastify réelle (CI) ---------- */
test('Fastify: public estimate works, admin pricing needs a session + CSRF, and the public content never contains pricing', opts, async () => {
  const { buildApp } = require('../src/app');
  const s = setup({ config: testConfig() });
  const { app, auth } = await buildApp({ config: s.cfg, db: s.db, mailer: s.mailer, keys: s.keys, logger: false });
  await app.ready();
  const ORIGIN = 'https://devis.test';
  const req = (method, url, payload, headers = {}) => app.inject({ method, url, payload, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers } });
  const est = await req('POST', '/api/estimate', { type: 'Bureau', surface: '48', freq: 'Une fois par semaine', visits: '1' });
  assert.equal(est.statusCode, 200); assert.equal(est.json().ok, true);
  assert.equal((await req('GET', '/api/admin/pricing')).statusCode, 401);
  assert.equal((await req('POST', '/api/admin/pricing/preview', { config: D, input: base })).statusCode, 401);
  assert.equal((await req('PUT', '/api/admin/site/content/pricing', { value: D })).statusCode, 401);
  await req('POST', '/api/admin/auth/request', { email: ADMIN });
  await auth.idle();
  const v = await req('POST', '/api/admin/auth/verify', { email: ADMIN, code: s.mailer.lastCode() });
  const admin = { cookie: `vectis_admin=${v.cookies.find((x) => x.name === 'vectis_admin').value}`, 'x-csrf-token': v.json().csrfToken };
  assert.equal((await req('PUT', '/api/admin/site/content/pricing', { value: D }, { cookie: admin.cookie })).statusCode, 403, 'CSRF required');
  const put = await req('PUT', '/api/admin/site/content/pricing', { value: { ...D, hourlyRate: 41 }, expectedVersion: 0 }, admin);
  assert.equal(put.statusCode, 200);
  assert.equal((await req('GET', '/api/site/content')).json().content.pricing, undefined);
  assert.equal((await req('POST', '/api/estimate', { surface: '48' })).json().prices.hour.value, 41);
  const bad = await req('PUT', '/api/admin/site/content/pricing', { value: { ...D, hourlyRate: -3 } }, admin);
  assert.equal(bad.statusCode, 422);
  await app.close();
});
