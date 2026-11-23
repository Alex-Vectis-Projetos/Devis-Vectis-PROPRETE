'use strict';

/* Calendrier réel, « À l'heure » par jour, TVA optionnelle, « Par service » = intervention complète, cohérence des trois modalités. */
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/pricing');

const D = P.DEFAULT_PRICING;
const clone = (o) => JSON.parse(JSON.stringify(o));
const NOV = Date.UTC(2026, 10, 23, 12), DEC = Date.UTC(2026, 11, 10, 12);
const base = { type: 'Bureau', surface: 350, counts: {}, surfaces: [], services: [], freq: 'Une fois par semaine', visits: 1 };
const SCHED = { Lundi: 120, Mardi: 90, Mercredi: 120, Vendredi: 60 };   // 2 h, 1 h 30, 2 h, 1 h = 6 h 30 par semaine

test('barème de départ : 35,00 € HT/h, aucune TVA configurée', () => {
  assert.equal(D.hourlyRate, 35);
  assert.equal(D.vatPct, null);
  assert.equal(P.validatePricing({}, () => { throw new Error('x'); }).vatPct, null);
});

test('calendrier : nombre de jours et occurrences réelles (novembre 2026 commence un dimanche)', () => {
  const c = P.monthCalendar(2026, 11);
  assert.equal(c.days, 30);
  assert.deepEqual(c.occurrences, { Lundi: 5, Mardi: 4, Mercredi: 4, Jeudi: 4, Vendredi: 4, Samedi: 4, Dimanche: 5 });
  assert.equal(c.label, 'novembre 2026');
  const d = P.monthCalendar(2026, 12);
  assert.deepEqual([d.occurrences.Lundi, d.occurrences.Mardi, d.occurrences.Mercredi, d.occurrences.Jeudi, d.occurrences.Vendredi], [4, 5, 5, 5, 4]);
});

test('calendrier : sur 36 mois (2026-2028, bissextile 2028 compris) la somme des occurrences = nombre de jours du mois', () => {
  for (let y = 2026; y <= 2028; y++) for (let m = 1; m <= 12; m++) {
    const c = P.monthCalendar(y, m);
    const expected = new Date(Date.UTC(y, m, 0)).getUTCDate();
    assert.equal(c.days, expected);
    assert.equal(Object.values(c.occurrences).reduce((a, b) => a + b, 0), expected, `${y}-${m}`);
    for (const n of Object.values(c.occurrences)) assert.ok(n === 4 || n === 5, `${y}-${m}`);
  }
  assert.equal(P.monthCalendar(2028, 2).days, 29);
  assert.equal(P.monthCalendar(2027, 2).days, 28);
  assert.ok(Object.values(P.monthCalendar(2027, 2).occurrences).every((n) => n === 4), 'février de 28 jours : 4 de chaque');
});

test('mois de référence : mois civil à Paris (jamais l’horloge du navigateur), y compris autour de minuit', () => {
  assert.deepEqual(P.parisYearMonth(Date.UTC(2026, 10, 23, 12)), { year: 2026, month: 11 });
  assert.deepEqual(P.parisYearMonth(Date.UTC(2026, 11, 31, 23, 30)), { year: 2027, month: 1 }, '31/12 23:30 UTC = 01/01 00:30 à Paris');
  assert.deepEqual(P.parisYearMonth(Date.UTC(2026, 9, 31, 23, 30)), { year: 2026, month: 11 });
  assert.deepEqual(P.parisYearMonth(Date.UTC(2026, 5, 30, 22, 30)), { year: 2026, month: 7 }, 'été : UTC+2');
});

test('À l’heure par jour : 6 h 30 par semaine ; novembre 2026 = 28 h = 980,00 € HT ; décembre 2026 = 29,5 h = 1 032,50 € HT', () => {
  const nov = P.estimate(D, { ...base, freq: 'Plusieurs fois par semaine', visits: 4, hoursByDay: SCHED }, NOV).hourly;
  assert.equal(nov.basis, 'calendar'); assert.equal(nov.estimate, false);
  assert.equal(nov.weeklyMinutes, 390);
  assert.equal(nov.totalMinutes, 5 * 120 + 4 * 90 + 4 * 120 + 4 * 60);   // 1 680 min = 28 h
  assert.equal(nov.ht, 980);
  assert.equal(nov.month, 'novembre 2026');
  assert.deepEqual(nov.occurrences, { Lundi: 5, Mardi: 4, Mercredi: 4, Vendredi: 4 });
  assert.equal(nov.vat, null); assert.equal(nov.ttc, null, 'pas de TVA tant qu’aucun taux n’est configuré');
  const dec = P.estimate(D, { ...base, freq: 'Plusieurs fois par semaine', visits: 4, hoursByDay: SCHED }, DEC).hourly;
  assert.equal(dec.totalMinutes, 4 * 120 + 5 * 90 + 5 * 120 + 4 * 60);   // 1 770 min = 29,5 h
  assert.equal(dec.ht, 1032.5);
});

test('À l’heure : une fois par semaine = calendrier du jour choisi', () => {
  const h = P.estimate(D, { ...base, hoursByDay: { Lundi: 150 } }, NOV).hourly;
  assert.equal(h.totalMinutes, 5 * 150);
  assert.equal(h.ht, 437.5);   // 12,5 h × 35
});

test('TVA/TTC : seulement avec un taux configuré ; HT + TVA = TTC, arrondis à 2 décimales', () => {
  const cfg = { ...clone(D), vatPct: 20 };
  const h = P.estimate(cfg, { ...base, hoursByDay: { Lundi: 150 } }, NOV).hourly;
  assert.equal(h.ht, 437.5); assert.equal(h.vat, 87.5); assert.equal(h.ttc, 525);
  const odd = P.estimate({ ...clone(D), vatPct: 5.5, hourlyRate: 33.33 }, { ...base, hoursByDay: { Lundi: 45 } }, NOV).hourly;
  assert.equal(odd.ttc, Math.round((odd.ht + odd.vat) * 100) / 100);
  assert.throws(() => P.validatePricing({ vatPct: 31 }, (f, m) => { throw new Error(f + m); }));
  assert.throws(() => P.validatePricing({ vatPct: -1 }, (f, m) => { throw new Error(f + m); }));
  assert.equal(P.validatePricing({ vatPct: 20 }, () => { throw new Error('x'); }).vatPct, 20);
});

test('fréquences : tous les 15 jours = estimation (2 visites/mois × moyenne des heures) ; mensuel ; ponctuelles ; rares ; libre', () => {
  const s = { Lundi: 120, Jeudi: 60 };   // moyenne 90 min
  const q = (freq, visits, hours = s) => P.estimate(D, { ...base, freq, visits, hoursByDay: hours }, NOV).hourly;
  const f15 = q('Tous les 15 jours', 1);
  assert.equal(f15.estimate, true); assert.equal(f15.period, 'mois'); assert.equal(f15.visitsCount, 2); assert.equal(f15.totalMinutes, 180); assert.equal(f15.ht, 105);
  assert.equal(q('Tous les 15 jours', 2).visitsCount, 4, 'visites par quinzaine × 2');
  const m = q('Une fois par mois', 1);
  assert.equal(m.estimate, true); assert.equal(m.totalMinutes, 90); assert.equal(m.ht, 52.5);
  const one = q('Une seule intervention', null, { Lundi: 240 });
  assert.equal(one.period, 'total'); assert.equal(one.ht, 140);
  const many = q('Plusieurs interventions ponctuelles', 3);
  assert.equal(many.period, 'total'); assert.equal(many.totalMinutes, 270);
  for (const fr of ['Tous les 3 mois', 'Tous les 6 mois', 'Une fois par an', 'Autre fréquence']) {
    const r = q(fr, 1);
    assert.equal(r.totalMinutes, null, fr + ' : pas de total mensuel'); assert.equal(r.ht, null);
    assert.equal(r.perVisitHt, 52.5, fr + ' : prix d’une visite');
  }
  assert.equal(P.estimate(D, { ...base, freq: '', hoursByDay: s }, NOV).hourly.totalMinutes, null, 'sans fréquence : rien de mensuel inventé');
});

test('cohérence : si le client indique moins d’heures que la durée estimée par VECTIS, le résultat le signale', () => {
  const e = P.estimate(D, { ...base, hoursByDay: { Lundi: 60 } }, NOV);   // 350 m² ≈ 4 h 30 estimées
  assert.equal(e.hours.visit, 4.5);
  assert.equal(e.hourly.estimatedVisitMinutes, 270);
  assert.equal(e.hourly.belowEstimate, true);
  assert.equal(P.estimate(D, { ...base, hoursByDay: { Lundi: 300 } }, NOV).hourly.belowEstimate, false);
});

test('sans heures par jour : aucun bloc « hourly » (comportement existant inchangé)', () => {
  assert.equal(P.estimate(D, base, NOV).hourly, null);
});

test('validation des heures par jour : jours valides, minutes entières multiples de 15, de 15 à 720', () => {
  assert.equal(P.parseHoursByDay(undefined), null);
  assert.deepEqual(P.parseHoursByDay({ Lundi: 15, Mardi: 720 }), { Lundi: 15, Mardi: 720 });
  for (const bad of [{ Lundi: 0 }, { Lundi: 14 }, { Lundi: 735 }, { Lundi: 1.5 }, { Lundi: '120' }, { Lundi: -15 }, { Funday: 60 }, [60], 'x', { Lundi: null }, { Lundi: NaN }]) assert.equal(P.parseHoursByDay(bad), false, JSON.stringify(bad));
  assert.equal(P.normalizeInput({ surface: '50', hoursByDay: { Lundi: 14 } }).error, 'hoursByDay');
  assert.deepEqual(P.normalizeInput({ surface: '50', hoursByDay: { Lundi: 30 } }).value.hoursByDay, { Lundi: 30 });
  assert.equal('hoursByDay' in P.normalizeInput({ surface: '50' }).value, false);
});

test('par service = intervention complète : 4 h → 140 €, 4 h 30 → 157,50 €, 5 h → 175 €, 5 h 30 → 192,50 €, 6 h → 210 € (35 € HT/h)', () => {
  const cfg = clone(D); cfg.categoryMinutes = { interne: 0, sanitaires: 0, cuisine: 0, vitres: 0, communes: 0 };   // durée = surface ÷ 80 m²/h
  for (const [surface, h, price] of [[320, 4, 140], [360, 4.5, 157.5], [400, 5, 175], [440, 5.5, 192.5], [480, 6, 210]]) {
    const e = P.estimate(cfg, { ...base, surface, services: ['interne.vacuum'] });
    assert.equal(e.hours.visit, h, `${surface} m²`);
    assert.equal(e.prices.service.value, price);
    assert.equal(e.prices.service.unit, 'intervention');
  }
});

test('350 m², 7 tâches, ~5 h : par service ≈ 175 € HT par intervention (et non 16,25 €)', () => {
  const e = P.estimate(D, { ...base, services: ['interne.vacuum', 'interne.sweep', 'interne.mop', 'interne.dust', 'interne.tables', 'interne.computers', 'interne.waste'] });
  assert.equal(e.hours.visit, 5);
  assert.equal(e.prices.service.value, 175);
});

test('par service : aucun service ni élément coché → rien à chiffrer (demande de cocher)', () => {
  assert.equal(P.estimate(D, base).prices.service, null);
  assert.deepEqual(P.estimate(D, base).detail.serviceHours, null);
});

test('cohérence des trois modalités : même base (durée estimée × tarif) pour À l’heure, Forfait et Par service', () => {
  for (const freq of P.FREQS) for (const visits of [1, 2, 3]) {
    const e = P.estimate(D, { ...base, freq, visits, services: ['interne.vacuum', 'sanitaires.toilets'] });
    assert.equal(e.prices.hour.value, e.rate);
    assert.equal(e.visitPrice, Math.round(e.hours.visit * e.rate * 100) / 100, freq);
    assert.equal(e.prices.service.value, e.visitPrice, `${freq}: par service = prix d'une visite complète`);
    if (e.prices.fixed.basis === 'intervention' && e.visitsTotal === null) assert.equal(e.prices.fixed.value, e.visitPrice, `${freq}: forfait par intervention = prix de la visite`);
    if (e.visitsPerMonth >= 1) assert.equal(e.prices.fixed.value, Math.round(e.visitPrice * e.visitsPerMonth * 100) / 100, freq);
  }
});

test('forfait fixe préservé : passer de 32,50 à 35 € multiplie uniquement par 35/32,5 (aucune autre règle modifiée)', () => {
  const old = { ...clone(D), hourlyRate: 32.5 };
  for (const freq of P.FREQS) for (const visits of [1, 2, 3]) for (const services of [[], ['interne.vacuum', 'cuisine.dishes']]) {
    const inp = { ...base, freq, visits, services };
    const a = P.estimate(old, inp), b = P.estimate(D, inp);
    assert.equal(a.hours.visit, b.hours.visit, 'durée inchangée');
    assert.equal(a.visitsPerMonth, b.visitsPerMonth); assert.equal(a.visitsTotal, b.visitsTotal);
    assert.equal(a.prices.fixed.basis, b.prices.fixed.basis);
    assert.ok(Math.abs(b.visitPrice - a.visitPrice * 35 / 32.5) <= 0.011, `${freq} visite`);
    assert.ok(Math.abs(b.prices.fixed.value - a.prices.fixed.value * 35 / 32.5) <= 0.12 * (1 + (b.visitsPerMonth || b.visitsTotal || 1)), `${freq} forfait`);
  }
});

test('instantané enregistré : porte les heures par jour, le calcul à l’heure et la base « intervention » du par service', () => {
  const p = { surface: '350', type: 'Bureau', freq: 'Une fois par semaine', visits: '1', services: ['interne.vacuum'], surfaces: [], hoursByDay: { Lundi: 150 } };
  const s = P.estimateSnapshot(D, p, NOV);
  assert.equal(s.hourly.ht, 437.5);
  assert.equal(s.serviceBasis, 'intervention');
  assert.equal(s.service, s.visitPrice);
  assert.equal(P.estimateSnapshot(D, { ...p, hoursByDay: undefined }, NOV).hourly, null);
});
