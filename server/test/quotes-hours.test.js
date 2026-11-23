'use strict';

/* Heures par jour (« À l'heure ») de bout en bout : validation serveur → enregistrement SQLite → e-mail ; mêmes chiffres que le formulaire. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup, testConfig, FakeMailer } = require('./helpers');
const { registerQuoteRoutes, validateQuote, buildQuoteMessages } = require('../src/quotes');
const { AuthService } = require('../src/auth');
const { ContentStore } = require('../src/content');
const P = require('../src/pricing');

const NOW = Date.UTC(2026, 10, 23, 12);   // 23/11/2026 : novembre 2026 (30 jours, 5 lundis)
const SCHED = { Lundi: 120, Mardi: 90, Mercredi: 120, Vendredi: 60 };
const DAYS4 = ['Lundi', 'Mardi', 'Mercredi', 'Vendredi'];

function harness(opts = {}) {
  const s = setup({ config: testConfig({ quoteRecipient: 'devis@vectis.test' }), mailer: new FakeMailer({}) });
  const routes = {};
  const app = { post: (url, o, h) => { routes[url] = h; } };
  const auth = new AuthService({ db: s.db, config: s.cfg, keys: s.keys, mailer: s.mailer, now: Date.now, log: () => {} });
  registerQuoteRoutes(app, { config: s.cfg, db: s.db, auth, mailer: s.mailer, now: () => NOW });
  if (opts.pricing) new ContentStore(s.db).save('pricing', opts.pricing, { email: 'admin@vectis.test' });
  const call = async (url, { body, params = {} } = {}) => {
    let code = 200, out; const reply = { code(c) { code = c; return reply; }, header() { return reply; }, send(x) { out = x; return reply; } };
    const r = await routes[url]({ body, headers: {}, params, ip: '203.0.113.9', log: { info() {}, error() {}, warn() {} } }, reply);
    return { code, body: out !== undefined ? out : r };
  };
  return { ...s, call };
}
const prop = (extra = {}) => ({
  site: 'Bureaux TESTE', num: '8', street: 'Rue Pasteur', zip: '69200', city: 'Vénissieux', type: 'Bureau', typeother: '', surface: '350',
  desc: 'TESTE', freq: 'Plusieurs fois par semaine', freqother: '', visits: '4', days: DAYS4, hoursByDay: SCHED, price: { kind: 'hour', value: '35,00' }, ...extra,
});
const quote = (pe = {}) => ({
  submissionId: 'sub-' + crypto.randomBytes(8).toString('hex'),
  contact: { name: 'TESTE Société', phone: '06 12 34 56 78', email: 'client@example.fr' }, properties: [prop(pe)], photos: [0],
});
const cell = (html, label) => (html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|').match(new RegExp(label.replace(/[()]/g, '\\$&') + '\\|([^|]*)\\|')) || [])[1];

test('validation : heures par jour correctes acceptées, enregistrées en minutes', () => {
  const r = validateQuote(quote());
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.properties[0].hoursByDay, SCHED);
});

test('validation : ancien client (sans heures par jour) toujours accepté, aucun champ ajouté', () => {
  const r = validateQuote(quote({ hoursByDay: undefined }));
  assert.equal(r.ok, true);
  assert.equal('hoursByDay' in r.value.properties[0], false);
  assert.equal(validateQuote(quote({ hoursByDay: {} })).ok, true, 'objet vide = comme absent');
});

test('validation : refus avec le nom du champ pour tout horaire invalide', () => {
  const bad = [
    { Lundi: 14, Mardi: 90, Mercredi: 120, Vendredi: 60 }, { ...SCHED, Lundi: 735 }, { ...SCHED, Lundi: 0 }, { ...SCHED, Lundi: '120' }, { ...SCHED, Lundi: 1.5 }, { ...SCHED, Lundi: -15 },
    { ...SCHED, Samedi: 60 },                // jour non coché
    { Lundi: 120, Mardi: 90, Mercredi: 120 }, // jour coché sans horaire
    { ...SCHED, Funday: 60 }, [120], 'texte',
  ];
  for (const hb of bad) {
    const r = validateQuote(quote({ hoursByDay: hb }));
    assert.equal(r.ok, false, JSON.stringify(hb));
    assert.equal(r.field, 'properties[0].hoursByDay', JSON.stringify(hb));
  }
});

test('enregistrement : horaires et calcul de l’estimation dans le JSON de la demande (pas de migration), calcul fait par le SERVEUR', async () => {
  const h = harness();
  const q = quote(); q.properties[0].estimate = { hourly: { ht: 1 } };   // une estimation fournie par le navigateur est ignorée
  const c = await h.call('/api/quotes', { body: q });
  assert.equal(c.code, 200, JSON.stringify(c.body));
  const stored = JSON.parse(h.db.prepare('SELECT payload FROM quotes WHERE id = ?').get(c.body.id).payload).properties[0];
  assert.deepEqual(stored.hoursByDay, SCHED);
  const hy = stored.estimate.hourly;
  assert.equal(hy.month, 'novembre 2026');
  assert.equal(hy.weeklyMinutes, 390);
  assert.equal(hy.totalMinutes, 1680);
  assert.equal(hy.ht, 980);
  assert.equal(hy.vat, null);
  // même résultat que ce que le formulaire reçoit de POST /api/estimate
  const n = P.normalizeInput({ type: 'Bureau', surface: '350', counts: {}, surfaces: [], services: [], freq: 'Plusieurs fois par semaine', visits: '4', hoursByDay: SCHED });
  const form = P.estimate(P.DEFAULT_PRICING, n.value, NOW).hourly;
  assert.deepEqual({ ...hy }, { ...hy, ...form }, 'formulaire = enregistrement');
});

test('e-mail : modalité, fréquence, jours, heures par jour, totaux semaine et mois, tarif, estimation HT, prix par intervention', async () => {
  const h = harness();
  const c = await h.call('/api/quotes', { body: quote() });
  const f = await h.call('/api/quotes/:id/finalize', { params: { id: c.body.id }, body: { token: c.body.token } });
  assert.equal(f.body.status, 'sent');
  const html = h.mailer.quotes[0].html;
  assert.equal(cell(html, 'Modalité de prix'), 'À l’heure');
  assert.equal(cell(html, 'Fréquence'), 'Plusieurs fois par semaine');
  assert.equal(cell(html, 'Jours d’intervention'), 'Lundi, Mardi, Mercredi, Vendredi');
  assert.equal(cell(html, 'Heures par jour'), 'Lundi 2 h · Mardi 1 h 30 · Mercredi 2 h · Vendredi 1 h');
  assert.equal(cell(html, 'Total par semaine'), '6 h 30');
  assert.equal(cell(html, 'Total du mois (novembre 2026)'), '28 h');
  assert.equal(cell(html, 'Occurrences dans le mois'), '5 lundi · 4 mardi · 4 mercredi · 4 vendredi');
  assert.equal(cell(html, 'Tarif horaire'), '35,00 € HT / h');
  assert.equal(cell(html, 'Estimation mensuelle HT').replace(/\s/g, ' '), '980,00 € HT');
  assert.equal(cell(html, 'Prix par intervention').replace(/\s/g, ' '), '157,50 € HT (4 h 30 × 35,00 €)');
  assert.ok(!/TVA \(|Total TTC/.test(html), 'aucune TVA/TTC sans taux configuré');
  assert.match(html, /calendrier réel de novembre 2026/);
});

test('e-mail : avec un taux de TVA configuré dans l’administration, TVA et TTC apparaissent (HT + TVA = TTC)', async () => {
  const h = harness({ pricing: { ...JSON.parse(JSON.stringify(P.DEFAULT_PRICING)), vatPct: 20 } });
  const c = await h.call('/api/quotes', { body: quote() });
  await h.call('/api/quotes/:id/finalize', { params: { id: c.body.id }, body: { token: c.body.token } });
  const html = h.mailer.quotes[0].html;
  assert.equal(cell(html, 'TVA (20 %)').replace(/\s/g, ' '), '196,00 €');
  assert.equal(cell(html, 'Total TTC').replace(/\s/g, ' '), '1 176,00 €');
});

test('e-mail : fréquences estimées (tous les 15 jours) sont identifiées comme estimation ; fréquences rares n’inventent aucun total mensuel', async () => {
  const h1 = harness();
  const c1 = await h1.call('/api/quotes', { body: quote({ freq: 'Tous les 15 jours', visits: '1', days: ['Lundi', 'Jeudi'], hoursByDay: { Lundi: 120, Jeudi: 60 } }) });
  await h1.call('/api/quotes/:id/finalize', { params: { id: c1.body.id }, body: { token: c1.body.token } });
  const a = h1.mailer.quotes[0].html;
  assert.equal(cell(a, 'Total du mois (novembre 2026)'), '3 h (estimation)');
  assert.equal(cell(a, 'Estimation mensuelle HT').replace(/\s/g, ' '), '105,00 € HT (estimation)');
  assert.match(a, /Estimation moyenne/);
  const h2 = harness();
  const c2 = await h2.call('/api/quotes', { body: quote({ freq: 'Tous les 6 mois', visits: '1', days: ['Lundi'], hoursByDay: { Lundi: 180 } }) });
  await h2.call('/api/quotes/:id/finalize', { params: { id: c2.body.id }, body: { token: c2.body.token } });
  const b = h2.mailer.quotes[0].html;
  assert.equal(cell(b, 'Total du mois (novembre 2026)'), undefined);
  assert.equal(cell(b, 'Estimation par visite HT').replace(/\s/g, ' '), '105,00 € HT (moyenne des heures indiquées)');
});

test('e-mail : avertissement quand les heures indiquées sont inférieures à la durée estimée par VECTIS', async () => {
  const h = harness();
  const c = await h.call('/api/quotes', { body: quote({ freq: 'Une fois par semaine', visits: '1', days: ['Lundi'], hoursByDay: { Lundi: 60 } }) });
  await h.call('/api/quotes/:id/finalize', { params: { id: c.body.id }, body: { token: c.body.token } });
  assert.match(h.mailer.quotes[0].html, /inférieures à la durée estimée par VECTIS \(4 h 30\)/);
});

test('e-mail : demande sans heures par jour (ancienne) = aucune section « Heures par jour », rien d’inventé', async () => {
  const h = harness();
  const c = await h.call('/api/quotes', { body: quote({ hoursByDay: undefined, price: { kind: 'fixed', value: '700,00' } }) });
  await h.call('/api/quotes/:id/finalize', { params: { id: c.body.id }, body: { token: c.body.token } });
  const html = h.mailer.quotes[0].html;
  assert.ok(!/Heures par jour/.test(html));
  assert.equal(cell(html, 'Modalité de prix'), 'Forfait fixe');
});

test('e-mail : un enregistrement ancien (instantané sans « hourly », service « par visite ») s’affiche comme avant', () => {
  const p = { ...validateQuote(quote({ hoursByDay: undefined })).value.properties[0], photoCount: 0,
    estimate: { hoursPerVisit: 1, rate: 32.5, visitPrice: 32.5, visitsPerMonth: 4.33, hour: 32.5, fixed: { value: 140.73, basis: 'mois' }, service: 16.25, perM2Visit: 0.09, inRange: false } };
  const html = buildQuoteMessages({ quote: { contact: { name: 'X', phone: '0612345678', email: 'c@example.fr' }, properties: [p] }, photos: [], to: 'a@b.fr', from: 'a@b.fr', budget: 1e9, ref: 'ABCD1234', id: 'a'.repeat(32), createdAt: NOW })[0].html;
  assert.equal(cell(html, 'Estimation par service').replace(/\s/g, ' '), '16,25 € HT par visite', 'ancien libellé conservé');
  assert.ok(!/Heures par jour/.test(html));
});

test('e-mail : texte client échappé dans les nouveaux champs (jours et mois proviennent de listes fermées)', async () => {
  assert.equal(validateQuote(quote({ hoursByDay: { '<b>': 60 } })).ok, false);
});
