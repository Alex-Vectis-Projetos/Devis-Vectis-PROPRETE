'use strict';

/* Les trois modalités de prix (à l'heure, forfait fixe, par service) : estimation automatique et fiche e-mail, bout en bout
   (validation → estimation enregistrée → fiche e-mail). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { validateQuote, buildQuoteMessages } = require('../src/quotes');
const { estimateForProperty } = require('../src/estimate');
const { ContentStore } = require('../src/content');
const P = require('../src/pricing');

const base = { type: 'Atelier', surface: '350 m²' };
const mk = (freq, visits, price, extra = {}) => ({
  submissionId: 'sub-0123456789abcdef',
  contact: { name: 'TESTE Société', phone: '06 12 34 56 78', email: 'client@example.fr' },
  photos: [0],
  properties: [{ site: 'Atelier', num: '8', street: 'Rue Pasteur', zip: '69200', city: 'Vénissieux', typeother: '', desc: 'TESTE', freqother: freq === 'Autre fréquence' ? 'Deux semaines sur trois' : '', days: ['Lundi'], ...base, freq, visits, price, ...extra }],
});
function sheet(q) {
  const s = setup(); const store = new ContentStore(s.db, Date.now);
  const v = validateQuote(q); assert.equal(v.ok, true, JSON.stringify(v));
  const quote = v.value || v.quote || v; const props = quote.properties || v.properties;
  for (const p of props) p.estimate = estimateForProperty(store, p);
  const html = buildQuoteMessages({ quote: quote.properties ? quote : { contact: v.contact, properties: props }, photos: [], to: 'x@y.z', from: null, budget: 1e7, ref: 'REF', id: 'id1', createdAt: Date.now() })[0].html;
  return { est: props[0].estimate, text: html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|') };
}
const line = (text, label) => (text.match(new RegExp(label + '\\|([^|]*)\\|')) || [])[1];

test('à l’heure : le tarif horaire appliqué et l’estimation à l’heure figurent dans la fiche', () => {
  const { est, text } = sheet(mk('Une fois par semaine', '1', { kind: 'hour', value: '45,00' }));
  assert.ok(est.rate > 0 && est.hour === est.rate);
  assert.match(line(text, 'Modalité de prix'), /À l’heure/);
  assert.match(line(text, 'Montant proposé'), /45,00 € HT/);
  assert.equal(line(text, 'Estimation à l’heure'), `${String(est.hour.toFixed(2)).replace('.', ',')} € HT / h`);
});

test('forfait fixe : passages et estimation forfait sont calculés pour toute fréquence chiffrable (jamais un tiret)', () => {
  for (const f of P.FREQS.filter((x) => x !== 'Autre fréquence')) for (const v of ['1', '2', '3']) {
    const { est, text } = sheet(mk(f, v, { kind: 'fixed', value: '600' }));
    assert.ok(est.fixed && est.fixed.value > 0, `${f} / ${v} : forfait calculé`);
    assert.ok(est.visitsPerMonth || est.visitsTotal, `${f} / ${v} : passages calculés`);
    assert.match(line(text, 'Modalité de prix'), /Forfait fixe/);
    assert.match(line(text, 'Montant proposé'), /600,00 € HT/);
    assert.notEqual(line(text, 'Passages estimés'), '—', `${f} / ${v}`);
    assert.notEqual(line(text, 'Estimation forfait'), '—', `${f} / ${v}`);
  }
  const hebdo = sheet(mk('Une fois par semaine', '1', { kind: 'fixed', value: '600' }));
  assert.equal(hebdo.est.fixed.basis, 'mois');
  assert.equal(line(hebdo.text, 'Passages estimés'), '4,33 par mois');
  const ponctuel = sheet(mk('Plusieurs interventions ponctuelles', '3', { kind: 'fixed', value: '600' }));
  assert.equal(ponctuel.est.fixed.basis, 'intervention');
  assert.equal(line(ponctuel.text, 'Passages estimés'), '3 interventions');
});

test('forfait fixe + « Autre fréquence » : cause des tirets — la fréquence libre n’est pas chiffrable ; la fiche le dit au lieu d’un tiret', () => {
  const { est, text } = sheet(mk('Autre fréquence', '1', { kind: 'fixed', value: '600' }));
  assert.equal(est.fixed, null);
  assert.equal(est.visitsPerMonth, null);
  assert.equal(est.visitsTotal, null);
  assert.equal(line(text, 'Passages estimés'), 'Non chiffrable : fréquence libre');
  assert.match(line(text, 'Estimation forfait'), /^Non chiffrable : fréquence libre \(prix d’une visite : \d[\d  ,.]* € HT\)$/);
  assert.ok(!/Autre fréquence/.test(line(text, 'Estimation forfait')));
  assert.match(line(text, 'Montant proposé'), /600,00 € HT/); // le montant du client est conservé tel quel
});

test('par service : seules les tâches cochées sont chiffrées ; sans tâche cochée, aucune estimation par service', () => {
  const id = P.SERVICE_IDS[0];
  const withTask = sheet(mk('Une fois par semaine', '1', { kind: 'service', value: '80' }, { services: [id] }));
  assert.ok(withTask.est.service > 0);
  assert.match(line(withTask.text, 'Modalité de prix'), /Par service/);
  assert.match(line(withTask.text, 'Estimation par service'), /€ HT par visite/);
  const none = sheet(mk('Une fois par semaine', '1', { kind: 'service', value: '80' }));
  assert.equal(none.est.service, null);
  assert.equal(line(none.text, 'Estimation par service'), '—');
});

test('les trois modalités ne se contaminent pas : même estimation, seule la modalité choisie change', () => {
  const a = sheet(mk('Une fois par semaine', '1', { kind: 'hour', value: '40' })).est;
  const b = sheet(mk('Une fois par semaine', '1', { kind: 'fixed', value: '40' })).est;
  const c = sheet(mk('Une fois par semaine', '1', { kind: 'service', value: '40' })).est;
  for (const k of ['hoursPerVisit', 'rate', 'hour', 'visitPrice']) { assert.equal(a[k], b[k]); assert.equal(b[k], c[k]); }
  assert.deepEqual(a.fixed, b.fixed);
});

test('contact administrable : les valeurs correctes passent la validation de la section « contact »', () => {
  const { VALIDATORS } = require('../src/content');
  const v = VALIDATORS.contact({ company: 'VECTIS', address: '8 Rue Pasteur', postalCode: '69200', city: 'Vénissieux', country: 'France', phone: '+33 7 80 25 11 28', email: 'vectis.adm@gmail.com', siren: '107 463 358' }, (f, m) => { throw new Error(f + ': ' + m); });
  assert.equal(v.phone, '+33 7 80 25 11 28');
  assert.equal(v.email, 'vectis.adm@gmail.com');
});
