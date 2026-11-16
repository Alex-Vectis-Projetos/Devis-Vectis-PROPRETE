'use strict';

/**
 * Catalogue du formulaire de devis + paramètres commerciaux + estimation indicative.
 *
 * Tout ce qui est « commercial » vit ICI et dans la section privée `pricing` du panneau d'administration
 * (table site_content existante, jamais exposée par /api/site/content). Rien n'est codé en dur ailleurs.
 * Les fonctions sont pures (aucune E/S) : le serveur, le simulateur d'administration et les tests utilisent le même calcul.
 *
 * IMPORTANT : VECTIS n'a fourni aucune donnée de productivité. Les valeurs ci-dessous sont des valeurs de DÉPART
 * (voir DEFAULT_PRICING), dérivées des fourchettes de marché indiquées par VECTIS, à valider puis ajuster dans l'administration.
 * L'estimation est toujours présentée comme « préliminaire » : ce n'est jamais un devis.
 */

const TYPES = ['Atelier', 'Bureau', 'Cabinet médical', 'Pharmacie', 'Cartório', 'Mairie', 'Établissement public', 'Immeuble commercial', 'Immeuble résidentiel', 'Appartement', 'Maison', 'Airbnb', 'Hôtel', 'Restaurant', 'Commerce', 'Magasin', 'Usine', 'Industrie', 'Entrepôt', 'Garage', 'Local professionnel', 'Établissement scolaire', 'Autre'];
const FREQS = ['Une seule intervention', 'Plusieurs interventions ponctuelles', 'Plusieurs fois par semaine', 'Une fois par semaine', 'Tous les 15 jours', 'Une fois par mois', 'Tous les 3 mois', 'Tous les 6 mois', 'Une fois par an', 'Autre fréquence'];

// [clé, libellé, maximum]. Les 6 premières clés historiques (rooms, offices, wc, kitchens, halls, floors) sont conservées telles quelles.
const COUNTERS = [
  ['bedrooms', 'Chambres', 999], ['rooms', 'Salles', 999], ['offices', 'Bureaux', 999],
  ['wc', 'Sanitaires / WC', 999], ['bathrooms', 'Salles de bains', 999], ['kitchens', 'Cuisines', 999], ['halls', 'Couloirs', 999],
  ['floors', 'Étages', 99], ['stairs', 'Escaliers', 999], ['balconies', 'Balcons / terrasses', 999], ['yard', 'Cour / jardin', 999],
  ['garage', 'Garage', 999], ['meeting', 'Salles de réunion', 999], ['breakrooms', 'Salles de pause', 999], ['common', 'Parties communes', 999],
];
const COUNTER_KEYS = COUNTERS.map((c) => c[0]);

const SURFACES = [
  ['carpets', 'Moquettes / tapis'], ['handrails', 'Rampes / mains courantes'], ['glass', 'Vitres'], ['doors', 'Portes'], ['other', 'Autres surfaces'],
];

const SERVICES = [
  { id: 'interne', label: 'Nettoyage intérieur', tasks: [
    ['vacuum', 'Aspirer les sols'], ['sweep', 'Balayer'], ['mop', 'Laver les sols'], ['dust', 'Dépoussiérer'], ['tables', 'Nettoyer les tables'],
    ['computers', 'Nettoyer les ordinateurs'], ['worktops', 'Nettoyer les plans de travail'], ['waste', 'Ramasser les déchets'],
    ['bags', 'Changer les sacs-poubelle'], ['collect', 'Ramasser verres et vaisselle'], ['dishes', 'Faire la vaisselle'] ] },
  { id: 'sanitaires', label: 'Salles de bains et sanitaires', tasks: [
    ['toilets', 'Désinfecter les toilettes'], ['sinks', 'Nettoyer les lavabos'], ['mirrors', 'Nettoyer les miroirs'], ['sweep', 'Balayer le sol'],
    ['vacuum', 'Aspirer le sol'], ['mop', 'Passer la serpillière'], ['paper', 'Réapprovisionner le papier toilette'], ['soap', 'Réapprovisionner le savon'],
    ['supplies', 'Réapprovisionner les autres consommables d’hygiène'], ['bins', 'Vider les poubelles'] ] },
  { id: 'cuisine', label: 'Cuisine', tasks: [
    ['dishes', 'Faire la vaisselle'], ['counters', 'Nettoyer les plans de travail'], ['tables', 'Nettoyer les tables'], ['appliances', 'Nettoyer les appareils électroménagers'],
    ['sink', 'Nettoyer l’évier'], ['surfaces', 'Nettoyer les surfaces'], ['floor', 'Balayer et laver le sol'], ['waste', 'Ramasser les déchets'] ] },
  { id: 'vitres', label: 'Vitres et surfaces', tasks: [
    ['glass', 'Nettoyer les vitres'], ['doors', 'Nettoyer les portes'], ['partitions', 'Nettoyer les cloisons'], ['glazed', 'Nettoyer les surfaces vitrées'], ['handrails', 'Nettoyer les rampes'] ] },
  { id: 'communes', label: 'Parties communes', tasks: [
    ['halls', 'Nettoyer les couloirs'], ['stairs', 'Nettoyer les escaliers'], ['meeting', 'Nettoyer les salles de réunion'], ['break', 'Nettoyer les salles de pause'], ['common', 'Nettoyer les parties communes'] ] },
];
const SERVICE_IDS = SERVICES.flatMap((c) => c.tasks.map((t) => `${c.id}.${t[0]}`));
const SERVICES_OTHER_MAX = 500;

const CATALOG = { counters: COUNTERS, surfaces: SURFACES, services: SERVICES, servicesOtherMax: SERVICES_OTHER_MAX };

const WEEKS_PER_MONTH = 52 / 12;

/** Valeurs de départ : à valider par VECTIS et à ajuster dans l'administration (onglet « Tarifs et estimation »). */
const DEFAULT_PRICING = {
  hourlyRate: 32.5,            // € HT / heure (milieu de la fourchette de marché 20–45 € HT/h indiquée par VECTIS)
  marginPct: 0,                // marge commerciale (%), appliquée à tous les modèles
  minHoursPerVisit: 1,         // durée minimale facturée par passage (heures)
  productivity: { default: 80, byType: {} }, // m² nettoyés par heure ; byType = valeurs propres à un type de local
  roomMinutes: {               // minutes SUPPLÉMENTAIRES par unité et par passage (sanitaires, cuisines… demandent plus que le sol)
    bedrooms: 0, rooms: 0, offices: 0, wc: 8, bathrooms: 12, kitchens: 15, halls: 0, floors: 0, stairs: 6, balconies: 5, yard: 10,
    garage: 10, meeting: 5, breakrooms: 5, common: 5,
  },
  surfaceMinutes: { carpets: 10, handrails: 5, glass: 15, doors: 5, other: 5 }, // minutes par élément coché et par passage
  categoryMinutes: { interne: 4, sanitaires: 4, cuisine: 4, vitres: 6, communes: 4 }, // minutes par tâche cochée et par passage
  frequencyAdjustPct: {},      // ajustement (%) du tarif horaire selon la fréquence, ex. { "Une fois par mois": 10 }
  m2Reference: { min: 0.3, max: 0.6 },      // € HT/m² par passage : fourchette de contrôle (indicateur, jamais un plafond)
  m2MonthReference: { min: 1.5, max: 4 },   // € HT/m² par mois (contrats récurrents) : même usage
};

/* ---------- validation (utilisée par ContentStore ; `fail(field, message)` lève l'erreur) ---------- */
function validatePricing(v, fail) {
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const exact = (o, allowed, where) => {
    if (!isObj(o)) fail(where, 'Objet attendu.');
    for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${where}.${k}`, 'Champ inconnu.');
  };
  const num = (x, where, min, max) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) fail(where, 'Nombre attendu.');
    if (x < min || x > max) fail(where, `Valeur entre ${min} et ${max} attendue.`);
    return Math.round(x * 10000) / 10000;
  };
  const map = (o, keys, where, min, max, dflt) => {
    exact(o === undefined ? {} : o, keys, where);
    const out = {};
    for (const k of keys) out[k] = o && o[k] !== undefined ? num(o[k], `${where}.${k}`, min, max) : dflt[k];
    return out;
  };
  exact(v, ['hourlyRate', 'marginPct', 'minHoursPerVisit', 'productivity', 'roomMinutes', 'surfaceMinutes', 'categoryMinutes', 'frequencyAdjustPct', 'm2Reference', 'm2MonthReference'], 'pricing');
  const D = DEFAULT_PRICING;
  const out = {
    hourlyRate: num(v.hourlyRate === undefined ? D.hourlyRate : v.hourlyRate, 'pricing.hourlyRate', 1, 500),
    marginPct: num(v.marginPct === undefined ? D.marginPct : v.marginPct, 'pricing.marginPct', 0, 300),
    minHoursPerVisit: num(v.minHoursPerVisit === undefined ? D.minHoursPerVisit : v.minHoursPerVisit, 'pricing.minHoursPerVisit', 0, 24),
  };
  const pr = v.productivity === undefined ? D.productivity : v.productivity;
  exact(pr, ['default', 'byType'], 'pricing.productivity');
  const byTypeIn = pr.byType === undefined ? {} : pr.byType;
  exact(byTypeIn, TYPES, 'pricing.productivity.byType');
  const byType = {};
  for (const k of Object.keys(byTypeIn)) byType[k] = num(byTypeIn[k], `pricing.productivity.byType.${k}`, 1, 2000);
  out.productivity = { default: num(pr.default === undefined ? D.productivity.default : pr.default, 'pricing.productivity.default', 1, 2000), byType };
  out.roomMinutes = map(v.roomMinutes, COUNTER_KEYS, 'pricing.roomMinutes', 0, 240, D.roomMinutes);
  out.surfaceMinutes = map(v.surfaceMinutes, SURFACES.map((s) => s[0]), 'pricing.surfaceMinutes', 0, 480, D.surfaceMinutes);
  out.categoryMinutes = map(v.categoryMinutes, SERVICES.map((c) => c.id), 'pricing.categoryMinutes', 0, 240, D.categoryMinutes);
  const fa = v.frequencyAdjustPct === undefined ? {} : v.frequencyAdjustPct;
  exact(fa, FREQS, 'pricing.frequencyAdjustPct');
  out.frequencyAdjustPct = {};
  for (const k of Object.keys(fa)) out.frequencyAdjustPct[k] = num(fa[k], `pricing.frequencyAdjustPct.${k}`, -50, 200);
  const m2 = v.m2Reference === undefined ? D.m2Reference : v.m2Reference;
  exact(m2, ['min', 'max'], 'pricing.m2Reference');
  out.m2Reference = { min: num(m2.min, 'pricing.m2Reference.min', 0, 100), max: num(m2.max, 'pricing.m2Reference.max', 0, 100) };
  if (out.m2Reference.min > out.m2Reference.max) fail('pricing.m2Reference', 'Le minimum dépasse le maximum.');
  const mm = v.m2MonthReference === undefined ? D.m2MonthReference : v.m2MonthReference;
  exact(mm, ['min', 'max'], 'pricing.m2MonthReference');
  out.m2MonthReference = { min: num(mm.min, 'pricing.m2MonthReference.min', 0, 1000), max: num(mm.max, 'pricing.m2MonthReference.max', 0, 1000) };
  if (out.m2MonthReference.min > out.m2MonthReference.max) fail('pricing.m2MonthReference', 'Le minimum dépasse le maximum.');
  return out;
}

/* ---------- fréquence → nombre de passages ---------- */
// Périodes par mois : une « période » est la semaine, la quinzaine, le mois, etc.
const PERIODS_PER_MONTH = {
  'Plusieurs fois par semaine': WEEKS_PER_MONTH, 'Une fois par semaine': WEEKS_PER_MONTH, 'Tous les 15 jours': WEEKS_PER_MONTH / 2,
  'Une fois par mois': 1, 'Tous les 3 mois': 1 / 3, 'Tous les 6 mois': 1 / 6, 'Une fois par an': 1 / 12,
};
const ONE_OFF = ['Une seule intervention', 'Plusieurs interventions ponctuelles'];

/**
 * Passages estimés. Le nombre de visites choisi par le client est respecté ; seules les fréquences qui disent « une fois »
 * imposent 1 passage par période (comme la limite de jours déjà appliquée par le formulaire).
 * Renvoie null quand la fréquence n'est pas chiffrable (« Autre fréquence », vide).
 */
function visitPlan(freq, visits) {
  const v = Number.isInteger(visits) && visits >= 1 && visits <= 7 ? visits : null;
  if (freq === 'Une seule intervention') return { oneOff: true, total: 1, perMonth: null };
  if (freq === 'Plusieurs interventions ponctuelles') return v ? { oneOff: true, total: v, perMonth: null } : null;
  if (!(freq in PERIODS_PER_MONTH)) return null;
  const perPeriod = /^Une fois/.test(freq) ? 1 : freq === 'Plusieurs fois par semaine' ? Math.max(2, v || 2) : v;
  if (!perPeriod) return null;
  return { oneOff: false, total: null, perMonth: Math.round(perPeriod * PERIODS_PER_MONTH[freq] * 100) / 100 };
}

const r2 = (n) => Math.round(n * 100) / 100;
const q4 = (h) => Math.ceil(h * 4 - 1e-9) / 4; // quart d'heure supérieur

/**
 * Estimation indicative. `input` = { type, surface (m²), counts:{clé:entier}, surfaces:[id], services:['cat.tâche'], freq, visits }.
 *   heures/visite  = max(minimum, surface/productivité(type) + Σ unités×minutes/60 + Σ éléments×minutes/60 + Σ tâches×minutes/60)
 *   tarif effectif = tarif horaire × (1 + marge) × (1 + ajustement fréquence)
 *   À l'heure      = tarif effectif
 *   Forfait        = heures/visite × tarif effectif × visites par mois (ou × interventions pour les fréquences ponctuelles)
 *   Par service    = (tâches cochées + éléments cochés) × tarif effectif  — rien n'est facturé pour ce qui n'est pas coché
 */
function estimate(cfg, input) {
  const c = cfg || DEFAULT_PRICING;
  const surface = Number(input && input.surface);
  if (!(surface > 0)) return { ok: false, reason: 'surface' };
  const counts = (input && input.counts) || {};
  const surfaces = (input && input.surfaces) || [];
  const services = (input && input.services) || [];

  const perHour = (input.type && c.productivity.byType[input.type]) || c.productivity.default;
  const hArea = surface / perHour;
  const hRooms = COUNTER_KEYS.reduce((s, k) => s + (Number(counts[k]) > 0 ? Number(counts[k]) * (c.roomMinutes[k] || 0) : 0), 0) / 60;
  const hSurfaces = surfaces.reduce((s, k) => s + (c.surfaceMinutes[k] || 0), 0) / 60;
  const hTasks = services.reduce((s, id) => s + (c.categoryMinutes[String(id).split('.')[0]] || 0), 0) / 60;
  const raw = hArea + hRooms + hSurfaces + hTasks;
  const hours = Math.max(c.minHoursPerVisit, q4(raw));

  const plan = visitPlan(input.freq, Number(input.visits));
  const adj = (input.freq && c.frequencyAdjustPct[input.freq]) || 0;
  const rate = r2(c.hourlyRate * (1 + c.marginPct / 100) * (1 + adj / 100));
  const visitPrice = r2(hours * rate);

  const prices = { hour: { value: rate, unit: 'heure' } };
  let monthly = null;
  if (plan) {
    if (plan.oneOff) prices.fixed = { value: r2(visitPrice * plan.total), basis: 'intervention' };
    else if (plan.perMonth >= 1) { monthly = r2(visitPrice * plan.perMonth); prices.fixed = { value: monthly, basis: 'mois' }; }
    else prices.fixed = { value: visitPrice, basis: 'intervention' };
  }
  const hSel = hTasks + hSurfaces;
  prices.service = hSel > 0 ? { value: r2(Math.max(0.25, q4(hSel)) * rate), unit: 'visite' } : null;

  /* Détail du calcul (affichage uniquement) : reprend les termes déjà calculés ci-dessus, n'ajoute aucune seconde formule. */
  const nz = (a) => a.filter((x) => x.min > 0);
  const serviceHours = hSel > 0 ? Math.max(0.25, q4(hSel)) : null;
  const detail = {
    surface, perHour, minHours: c.minHoursPerVisit, rawHours: r2(raw), roundedHours: q4(raw),
    rooms: nz(COUNTER_KEYS.filter((k) => Number(counts[k]) > 0).map((k) => ({ k, n: Number(counts[k]), each: c.roomMinutes[k] || 0, min: Number(counts[k]) * (c.roomMinutes[k] || 0) }))),
    surfaces: nz(surfaces.map((k) => ({ k, each: c.surfaceMinutes[k] || 0, min: c.surfaceMinutes[k] || 0 }))),
    tasks: nz(SERVICES.map((cat) => {
      const n = services.filter((id) => String(id).split('.')[0] === cat.id).length;
      return { k: cat.id, n, each: c.categoryMinutes[cat.id] || 0, min: n * (c.categoryMinutes[cat.id] || 0) };
    }).filter((x) => x.n > 0)),
    baseRate: c.hourlyRate, marginPct: c.marginPct, adjPct: adj,
    serviceHours, serviceRawHours: r2(hSel),
  };

  const perM2Visit = r2(visitPrice / surface);
  const perM2Month = plan && plan.perMonth ? r2(visitPrice * plan.perMonth / surface) : null;
  const mref = c.m2MonthReference || DEFAULT_PRICING.m2MonthReference;
  return {
    ok: true,
    preliminary: true,
    hours: { area: r2(hArea), rooms: r2(hRooms), surfaces: r2(hSurfaces), tasks: r2(hTasks), raw: r2(raw), visit: hours },
    rate, visitPrice, detail,
    perM2Service: prices.service ? r2(prices.service.value / surface) : null,
    visitsPerMonth: plan && !plan.oneOff ? plan.perMonth : null,
    visitsTotal: plan && plan.oneOff ? plan.total : null,
    monthly,
    prices,
    perM2: {
      visit: perM2Visit, month: perM2Month, ref: c.m2Reference, monthRef: mref,
      inRange: perM2Visit >= c.m2Reference.min && perM2Visit <= c.m2Reference.max,
      inRangeMonth: perM2Month === null ? null : perM2Month >= mref.min && perM2Month <= mref.max,
    },
    missing: plan ? [] : ['freq'],
  };
}

/** Entrée « brute » (formulaire public ou propriété validée) → entrée normalisée de estimate(), ou { error } si un identifiant est inconnu. */
function normalizeInput(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'body' };
  const surface = parseFloat(String(b.surface == null ? '' : b.surface).replace(/[^0-9.,]/g, '').replace(',', '.'));
  const counts = {};
  const rc = b.counts && typeof b.counts === 'object' && !Array.isArray(b.counts) ? b.counts : {};
  for (const k of Object.keys(rc)) if (!COUNTER_KEYS.includes(k)) return { error: 'counts' };
  for (const [k, , max] of COUNTERS) {
    if (rc[k] == null || rc[k] === '') continue;
    const n = Number(rc[k]);
    if (!Number.isInteger(n) || n < 0 || n > max) return { error: 'counts' };
    counts[k] = n;
  }
  const ids = (a, allowed, name) => {
    if (a == null) return [];
    if (!Array.isArray(a) || a.length > allowed.length || a.some((x) => !allowed.includes(x)) || new Set(a).size !== a.length) return null;
    return a;
  };
  const surfaces = ids(b.surfaces, SURFACES.map((s) => s[0]));
  const services = ids(b.services, SERVICE_IDS);
  if (!surfaces) return { error: 'surfaces' };
  if (!services) return { error: 'services' };
  const type = typeof b.type === 'string' && TYPES.includes(b.type) ? b.type : '';
  const freq = typeof b.freq === 'string' && FREQS.includes(b.freq) ? b.freq : '';
  const visits = b.visits === '' || b.visits == null ? null : Number(b.visits);
  return { value: { type, surface: surface > 0 && surface <= 1e7 ? surface : 0, counts, surfaces, services, freq, visits } };
}

/** Instantané d'estimation d'une propriété déjà validée (ce qui est enregistré avec la demande). null si non chiffrable. */
function estimateSnapshot(cfg, p) {
  const counts = {};
  for (const k of COUNTER_KEYS) if (p[k] !== undefined && p[k] !== '') counts[k] = Number(p[k]);
  const n = normalizeInput({ type: p.type, surface: p.surface, counts, surfaces: p.surfaces, services: p.services, freq: p.freq, visits: p.visits });
  if (n.error) return null;
  const e = estimate(cfg, n.value);
  if (!e.ok) return null;
  return {
    hoursPerVisit: e.hours.visit, rate: e.rate, visitPrice: e.visitPrice, visitsPerMonth: e.visitsPerMonth, visitsTotal: e.visitsTotal,
    hour: e.prices.hour.value, fixed: e.prices.fixed || null, service: e.prices.service ? e.prices.service.value : null,
    perM2Visit: e.perM2.visit, inRange: e.perM2.inRange, perM2Month: e.perM2.month, inRangeMonth: e.perM2.inRangeMonth,
  };
}

module.exports = {
  TYPES, FREQS, COUNTERS, COUNTER_KEYS, SURFACES, SERVICES, SERVICE_IDS, SERVICES_OTHER_MAX, CATALOG, DEFAULT_PRICING, WEEKS_PER_MONTH,
  validatePricing, visitPlan, estimate, estimateSnapshot, normalizeInput,
};
