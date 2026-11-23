'use strict';

/* Trois modalités de prix × dix fréquences, de bout en bout :
   valeur affichée dans le formulaire (POST /api/estimate = P.estimate) → valeur enregistrée avec la demande (colonne payload)
   → valeur écrite dans l'e-mail envoyé. Les valeurs attendues sont recalculées ici à la main à partir du barème de départ
   (tarif 35,00 € HT/h, atelier de 350 m² + 2 tâches cochées = 4 h 45 par visite), pas avec le code testé. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup, testConfig, FakeMailer } = require('./helpers');
const { registerQuoteRoutes } = require('../src/quotes');
const { AuthService } = require('../src/auth');
const P = require('../src/pricing');

const RATE = 35, HOURS = 4.75, VISIT = 166.25;                      // 350 m² ÷ 80 m²/h = 4,375 h + 2 tâches × 4 min = 4,508 h → quart d'heure supérieur 4 h 45 ; 4,75 × 35 = 166,25
const PERIODS = { 'Une fois par semaine': 52 / 12, 'Tous les 15 jours': 26 / 12, 'Une fois par mois': 1, 'Tous les 3 mois': 1 / 3, 'Tous les 6 mois': 1 / 6, 'Une fois par an': 1 / 12 };
const r2 = (n) => Math.round(n * 100) / 100;
const SERVICES = [P.SERVICE_IDS[0], P.SERVICE_IDS.find((i) => i.startsWith('sanitaires.'))];   // 2 tâches cochées → « Par service » = prix d'une intervention complète (durée estimée × tarif)
const KINDS = ['hour', 'fixed', 'service'];

/** Passages et forfait attendus d'après les règles commerciales du barème. */
function expected(freq, v) {
  const o = { visitsPerMonth: null, visitsTotal: null, visitsPerPeriod: null, fixed: null };
  if (freq === 'Une seule intervention') { o.visitsTotal = 1; o.fixed = { value: VISIT, basis: 'intervention' }; return o; }
  if (freq === 'Plusieurs interventions ponctuelles') { o.visitsTotal = v; o.fixed = { value: r2(VISIT * v), basis: 'intervention' }; return o; }
  if (freq === 'Autre fréquence') { o.visitsPerPeriod = v; o.fixed = { value: VISIT, basis: 'intervention' }; return o; }
  const perPeriod = freq === 'Plusieurs fois par semaine' ? Math.max(2, v) : /^Une fois/.test(freq) ? 1 : v;
  const per = freq === 'Plusieurs fois par semaine' ? 52 / 12 : PERIODS[freq];
  o.visitsPerMonth = r2(perPeriod * per);
  o.fixed = o.visitsPerMonth >= 1 ? { value: r2(VISIT * o.visitsPerMonth), basis: 'mois' } : { value: VISIT, basis: 'intervention' };
  return o;
}

function harness() {
  const s = setup({ config: testConfig({ quoteRecipient: 'devis@vectis.test' }), mailer: new FakeMailer({}) });
  const routes = {};
  const app = { post: (url, o, h) => { routes[url] = h; } };
  const auth = new AuthService({ db: s.db, config: s.cfg, keys: s.keys, mailer: s.mailer, now: Date.now, log: () => {} });
  registerQuoteRoutes(app, { config: s.cfg, db: s.db, auth, mailer: s.mailer });
  const call = async (url, { body, headers = {}, params = {} } = {}) => {
    let code = 200, out;
    const reply = { code(c) { code = c; return reply; }, header() { return reply; }, send(x) { out = x; return reply; } };
    const r = await routes[url]({ body, headers, params, ip: '203.0.113.9', log: { info() {}, error() {}, warn() {} } }, reply);
    return { code, body: out !== undefined ? out : r };
  };
  return { ...s, call };
}
const money = (n) => n.toFixed(2).replace('.', ',');
const cell = (html, label) => (html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|').match(new RegExp(label + '\\|([^|]*)\\|')) || [])[1];

const DAYS = ['Lundi', 'Mardi', 'Mercredi'];
function quote(freq, visits, kind, price) {
  return {
    submissionId: 'sub-' + crypto.randomBytes(8).toString('hex'),
    contact: { name: 'TESTE Société', phone: '06 12 34 56 78', email: 'client@example.fr' },
    photos: [0],
    properties: [{ site: 'Atelier TESTE', num: '8', street: 'Rue Pasteur', zip: '69200', city: 'Vénissieux', type: 'Atelier', typeother: '', surface: '350',
      desc: 'TESTE', freq, freqother: freq === 'Autre fréquence' ? 'Deux semaines sur trois' : '', visits: String(visits), days: DAYS.slice(0, 2),
      services: SERVICES, price: { kind, value: price } }],
  };
}

for (const freq of P.FREQS) {
  for (const visits of [1, 2, 3]) {
    test(`${freq} · ${visits} visite(s) · trois modalités : formulaire = enregistré = e-mail, valeurs conformes au barème`, async () => {
      const exp = expected(freq, visits);
      // 1. ce que le formulaire affiche (même appel que POST /api/estimate)
      const n = P.normalizeInput({ type: 'Atelier', surface: '350', counts: {}, surfaces: [], services: SERVICES, freq, visits: String(visits) });
      const form = P.estimate(P.DEFAULT_PRICING, n.value);
      assert.equal(form.ok, true);
      assert.deepEqual(form.missing, [], 'aucune donnée manquante');
      assert.equal(form.hours.visit, HOURS, 'durée estimée par visite');
      assert.equal(form.prices.hour.value, RATE, 'à l’heure');
      assert.equal(form.visitsPerMonth, exp.visitsPerMonth, 'passages par mois');
      assert.equal(form.visitsTotal, exp.visitsTotal, 'interventions');
      assert.equal(form.visitsPerPeriod, exp.visitsPerPeriod, 'visites par période (fréquence libre)');
      assert.deepEqual(form.prices.fixed, exp.fixed, 'forfait');
      assert.equal(form.prices.service.value, VISIT, 'par service = intervention complète');
      assert.equal(form.prices.service.unit, 'intervention');

      // 2. chaque modalité : le montant proposé = la suggestion du formulaire ; la demande enregistre l'estimation ; l'e-mail la reprend
      for (const kind of KINDS) {
        const h = harness();
        const suggested = kind === 'hour' ? form.prices.hour.value : kind === 'fixed' ? form.prices.fixed.value : form.prices.service.value;
        const q = quote(freq, visits, kind, money(suggested));
        q.properties[0].price.auto = true;
        const c = await h.call('/api/quotes', { body: q });
        assert.equal(c.code, 200, JSON.stringify(c.body));
        const stored = JSON.parse(h.db.prepare('SELECT payload FROM quotes WHERE id = ?').get(c.body.id).payload).properties[0];
        assert.equal(stored.price.kind, kind);
        assert.equal(stored.price.value, suggested, `${kind} : montant enregistré`);
        const e = stored.estimate;
        assert.ok(e, 'estimation enregistrée');
        assert.equal(e.hoursPerVisit, HOURS);
        assert.equal(e.hour, RATE);
        assert.equal(e.visitsPerMonth, exp.visitsPerMonth);
        assert.equal(e.visitsTotal, exp.visitsTotal);
        assert.equal(e.visitsPerPeriod, exp.visitsPerPeriod);
        assert.deepEqual(e.fixed, exp.fixed);
        assert.equal(e.service, VISIT);
        assert.equal(e.serviceBasis, 'intervention');
        assert.deepEqual(stored.days, DAYS.slice(0, 2), 'jours d’intervention enregistrés');

        const f = await h.call('/api/quotes/:id/finalize', { params: { id: c.body.id }, body: { token: c.body.token } });
        assert.equal(f.body.status, 'sent');
        assert.equal(h.mailer.quotes.length, 1, 'un seul e-mail');
        const html = h.mailer.quotes[0].html;
        assert.equal(cell(html, 'Durée estimée par visite'), '4 h 45');
        assert.equal(cell(html, 'Estimation à l’heure'), '35,00 € HT / h');
        assert.equal(cell(html, 'Estimation par service'), '166,25 € HT par intervention');
        assert.equal(cell(html, 'Estimation forfait').replace(/\s/g, ' '), `${money(exp.fixed.value).replace(/(\d)(?=(\d{3})+,)/, '$1 ')} € HT ${exp.fixed.basis === 'mois' ? 'par mois' : 'par intervention'}`.replace(/\s/g, ' '));
        const pas = cell(html, 'Passages estimés');
        if (exp.visitsPerMonth) assert.equal(pas, `${String(exp.visitsPerMonth).replace('.', ',')} par mois`);
        else if (exp.visitsTotal) assert.equal(pas, `${exp.visitsTotal} intervention${exp.visitsTotal > 1 ? 's' : ''}`);
        else assert.equal(pas, `${visits} visite${visits > 1 ? 's' : ''} par période (fréquence libre : Deux semaines sur trois)`);
        assert.match(cell(html, 'Modalité de prix'), kind === 'hour' ? /À l’heure/ : kind === 'fixed' ? /Forfait fixe/ : /Par service/);
        assert.ok(!/—/.test(['Passages estimés', 'Estimation forfait', 'Durée estimée par visite'].map((l) => cell(html, l)).join('')), 'aucun tiret sur durée, passages, forfait');
      }
    });
  }
}

test('donnée manquante nommée : sans fréquence → « freq » ; fréquence sans nombre de visites → « visits » ; rien ne manque sinon', () => {
  const run = (freq, visits) => P.estimate(P.DEFAULT_PRICING, P.normalizeInput({ type: 'Atelier', surface: '350', freq, visits }).value);
  assert.deepEqual(run('', '').missing, ['freq']);
  assert.deepEqual(run('Une fois par semaine', '').missing, [] , 'hebdomadaire : 1 passage par semaine, le nombre de visites n’est pas nécessaire');
  assert.deepEqual(run('Tous les 15 jours', '').missing, ['visits']);
  assert.deepEqual(run('Tous les 3 mois', '').missing, ['visits']);
  assert.deepEqual(run('Plusieurs interventions ponctuelles', '').missing, ['visits']);
  assert.deepEqual(run('Autre fréquence', '').missing, [], 'fréquence libre : forfait d’une intervention');
  assert.equal(run('Autre fréquence', '').visitsPerPeriod, null);
  assert.equal(run('Autre fréquence', '').prices.fixed.value, 157.5, 'sans service coché : 4 h 30 × 35');
});

test('par service : aucun service ni élément coché → pas d’estimation, et la fiche le dit (la surface ne compte pas dans ce mode)', async () => {
  const n = P.normalizeInput({ type: 'Atelier', surface: '350', freq: 'Une fois par semaine', visits: '1' });
  assert.equal(P.estimate(P.DEFAULT_PRICING, n.value).prices.service, null);
  const h = harness();
  const q = quote('Une fois par semaine', 1, 'service', '80'); q.properties[0].services = [];
  const c = await h.call('/api/quotes', { body: q });
  await h.call('/api/quotes/:id/finalize', { params: { id: c.body.id }, body: { token: c.body.token } });
  assert.equal(cell(h.mailer.quotes[0].html, 'Estimation par service'), 'Aucun service ni élément coché : rien à chiffrer');
});

test('contact administrable : les valeurs correctes passent la validation de la section « contact »', () => {
  const { VALIDATORS } = require('../src/content');
  const v = VALIDATORS.contact({ company: 'VECTIS', address: '8 Rue Pasteur', postalCode: '69200', city: 'Vénissieux', country: 'France', phone: '+33 7 80 25 11 28', email: 'vectis.adm@gmail.com', siren: '107 463 358' }, (f, m) => { throw new Error(f + ': ' + m); });
  assert.equal(v.phone, '+33 7 80 25 11 28');
  assert.equal(v.email, 'vectis.adm@gmail.com');
});
