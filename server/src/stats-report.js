'use strict';

/**
 * STATISTIQUES — read side (report builder). Pure SQL over tables that already exist (migration 5 + quotes); it writes nothing.
 *
 *  - Closed days come from `stats_daily` (roll-up). Days that have no roll-up yet (today, or before the roll-up job exists)
 *    are aggregated on the fly from `stats_events` with the same GROUP BY the roll-up uses.
 *  - The `quotes` table is only READ (server-side facts: request received by the API, e-mail sent).
 *  - Honest units:
 *      visitors  = visiteurs-jours (a visitor is pseudonymised per day with a random daily salt: nobody is recognised from one
 *                  day to the next, so "new vs returning" is NOT measurable and is reported as such);
 *      sessions  = 30-minute sessions computed on the server;
 *      views     = one `view` per session (page views are not collected) → views == sessions by construction;
 *      events    = every accepted event (one per session, type and target).
 *  - Unknown targets (junk sent by anyone to the public endpoint) never appear: only known category ids are listed, the rest is "Autres".
 */

const { dayOf } = require('./stats');

const MAX_DAYS = 366;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Categories shipped with the site (index.html CATEGORIES). A test keeps this list in sync with the page.
const BUILTIN_CATEGORIES = [
  ['atelier', 'Atelier'], ['cartorio', 'Cartório'], ['pharmacie', 'Pharmacie'], ['airbnb', 'Airbnb'],
  ['immeubles', 'Immeubles commerciaux'], ['cabinet', 'Cabinet médical'], ['public', 'Services publics'], ['bureaux', 'Bureaux'],
  ['residences', 'Résidences'], ['usines', 'Usines et industries'], ['commerces', 'Commerces'], ['entrepots', 'Entrepôts'],
  ['pro', 'Établissements professionnels'],
];

function validDay(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function addDays(day, n) {
  return new Date(new Date(day + 'T00:00:00Z').getTime() + n * DAY_MS).toISOString().slice(0, 10);
}
function daysBetween(from, to) {
  return Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / DAY_MS) + 1;
}
function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Resolves `range` (today | 7d | 30d | 90d | custom with from/to) into an inclusive Paris-day interval, or an error string. */
function resolveRange({ range, from, to }, today) {
  let f; let t;
  if (range === 'today') { f = today; t = today; }
  else if (range === '7d' || range === '30d' || range === '90d') { t = today; f = addDays(today, -(parseInt(range, 10) - 1)); }
  else if (range === 'custom') {
    if (!validDay(from) || !validDay(to)) return { error: 'Dates invalides (AAAA-MM-JJ attendu).' };
    f = from; t = to;
  } else return { error: 'Période inconnue.' };
  if (f > t) return { error: 'La date de début doit précéder la date de fin.' };
  if (t > today) t = today;
  if (f > t) return { error: 'La période est entièrement dans le futur.' };
  if (daysBetween(f, t) > MAX_DAYS) return { error: 'Période trop longue (366 jours maximum).' };
  return { from: f, to: t, days: daysBetween(f, t) };
}

/** Rows {day,type,target,device,events,sessions,visitors}; type '*' = totals of the day per device. */
function loadRows(db, from, to) {
  const rolled = db.prepare('SELECT day, type, target, device, events, sessions, visitors FROM stats_daily WHERE day BETWEEN ? AND ?').all(from, to);
  const have = new Set(rolled.map((r) => r.day));
  const rows = rolled.map((r) => ({ ...r }));
  const live = db.prepare(
    `SELECT day, type, target, device, COUNT(*) AS events, COUNT(DISTINCT sid) AS sessions, COUNT(DISTINCT vkey) AS visitors
       FROM stats_events WHERE day BETWEEN ? AND ? GROUP BY day, type, target, device`
  ).all(from, to).filter((r) => !have.has(r.day));
  const liveTotals = db.prepare(
    `SELECT day, '*' AS type, '' AS target, device, COUNT(*) AS events, COUNT(DISTINCT sid) AS sessions, COUNT(DISTINCT vkey) AS visitors
       FROM stats_events WHERE day BETWEEN ? AND ? GROUP BY day, device`
  ).all(from, to).filter((r) => !have.has(r.day));
  return rows.concat(live, liveTotals);
}

function loadQuotes(db, from, to) {
  const lo = new Date(from + 'T00:00:00Z').getTime() - DAY_MS;
  const hi = new Date(to + 'T00:00:00Z').getTime() + 2 * DAY_MS;
  const out = new Map();
  for (const r of db.prepare('SELECT created_at, status FROM quotes WHERE created_at BETWEEN ? AND ?').all(lo, hi)) {
    const d = dayOf(r.created_at);
    if (d < from || d > to) continue;
    const e = out.get(d) || { created: 0, sent: 0, failed: 0 };
    e.created++;
    if (r.status === 'sent') e.sent++;
    else if (r.status === 'mail_failed') e.failed++;
    out.set(d, e);
  }
  return out;
}

function period(db, from, to) {
  const rows = loadRows(db, from, to);
  const quotes = loadQuotes(db, from, to);
  const days = eachDay(from, to);
  const daily = new Map(days.map((d) => [d, { day: d, visitors: 0, sessions: 0, views: 0, events: 0, quotes: 0, quotesSent: 0 }]));
  const devices = new Map();
  const types = new Map();       // type -> {events, sessions, visitors}
  const categories = new Map();  // target -> {views, galleryOpens, visitors}
  for (const r of rows) {
    const d = daily.get(r.day);
    if (!d) continue;
    if (r.type === '*') {
      d.visitors += r.visitors; d.sessions += r.sessions; d.events += r.events;
      const dv = devices.get(r.device) || { device: r.device, visitors: 0, sessions: 0, events: 0 };
      dv.visitors += r.visitors; dv.sessions += r.sessions; dv.events += r.events;
      devices.set(r.device, dv);
      continue;
    }
    if (r.type === 'view') d.views += r.events;
    const t = types.get(r.type) || { events: 0, sessions: 0, visitors: 0 };
    t.events += r.events; t.sessions += r.sessions; t.visitors += r.visitors;
    types.set(r.type, t);
    if (r.type === 'category_view' || r.type === 'gallery_open') {
      const c = categories.get(r.target) || { id: r.target, views: 0, galleryOpens: 0, visitors: 0 };
      if (r.type === 'category_view') { c.views += r.events; c.visitors += r.visitors; } else c.galleryOpens += r.events;
      categories.set(r.target, c);
    }
  }
  let q = { created: 0, sent: 0, failed: 0 };
  for (const [day, e] of quotes) {
    const d = daily.get(day);
    d.quotes = e.created; d.quotesSent = e.sent;
    q.created += e.created; q.sent += e.sent; q.failed += e.failed;
  }
  const list = [...daily.values()];
  const visitors = list.reduce((s, d) => s + d.visitors, 0);
  const sessions = list.reduce((s, d) => s + d.sessions, 0);
  const events = list.reduce((s, d) => s + d.events, 0);
  const views = list.reduce((s, d) => s + d.views, 0);
  const ty = (k) => types.get(k) || { events: 0, sessions: 0, visitors: 0 };
  return {
    daily: list, devices, categories, quotes: q, types,
    totals: { visitors, sessions, events, views, sessionsPerVisitor: visitors ? Math.round((sessions / visitors) * 100) / 100 : null },
    sessionsOf: (k) => ty(k).sessions, visitorsOf: (k) => ty(k).visitors,
  };
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const delta = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

/**
 * @param {object} db
 * @param {{from:string,to:string}} range  inclusive Paris days
 * @param {{today:string, labels:Map<string,string>}} o  labels = the KNOWN category ids → display name
 */
function buildReport(db, range, { today, labels }) {
  const { from, to } = range;
  const n = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -n);
  const cur = period(db, from, to);
  const prev = period(db, prevFrom, prevTo);

  const deviceTotal = [...cur.devices.values()].reduce((s, d) => s + d.visitors, 0);
  const devices = ['mobile', 'desktop', 'tablet'].map((k) => {
    const d = cur.devices.get(k) || { device: k, visitors: 0, sessions: 0, events: 0 };
    return { device: k, visitors: d.visitors, sessions: d.sessions, sharePct: pct(d.visitors, deviceTotal) };
  });

  let others = 0;
  const cats = [];
  for (const c of cur.categories.values()) {
    if (labels.has(c.id)) cats.push({ id: c.id, label: labels.get(c.id), views: c.views, galleryOpens: c.galleryOpens, visitors: c.visitors });
    else others += c.views;
  }
  cats.sort((a, b) => b.views - a.views || b.galleryOpens - a.galleryOpens || a.label.localeCompare(b.label, 'fr'));

  const sess = cur.totals.sessions;
  const funnel = [
    { key: 'visitors', label: 'Visiteurs', unit: 'visiteurs-jours', value: cur.totals.visitors },
    { key: 'sessions', label: 'Sessions', unit: 'sessions', value: sess },
    { key: 'form_open', label: 'Formulaire ouvert', unit: 'sessions', value: cur.sessionsOf('form_open') },
    { key: 'form_start', label: 'Remplissage commencé', unit: 'sessions', value: cur.sessionsOf('form_start') },
    { key: 'quote_created', label: 'Demandes reçues par l’API', unit: 'demandes', value: cur.quotes.created },
    { key: 'quote_sent', label: 'Devis envoyés par e-mail', unit: 'demandes', value: cur.quotes.sent },
  ].map((s, i, a) => ({ ...s, // visitor-days → sessions changes unit (a ratio above 100 % would mislead): no percentage for that step
    pctOfPrevious: i > 1 ? pct(s.value, a[i - 1].value) : null, pctOfSessions: i ? pct(s.value, sess) : null }));

  const prevTotals = prev.totals;
  const have = cur.daily.filter((d) => d.sessions > 0 || d.visitors > 0).length;
  const first = db.prepare('SELECT MIN(day) AS d FROM (SELECT MIN(day) AS day FROM stats_daily UNION ALL SELECT MIN(day) FROM stats_events)').get();

  return {
    ok: true,
    today,
    range: { from, to, days: n },
    previous: { from: prevFrom, to: prevTo },
    totals: cur.totals,
    previousTotals: prevTotals,
    deltas: {
      visitors: delta(cur.totals.visitors, prevTotals.visitors),
      sessions: delta(cur.totals.sessions, prevTotals.sessions),
      events: delta(cur.totals.events, prevTotals.events),
      quotes: delta(cur.quotes.created, prev.quotes.created),
    },
    daily: cur.daily,
    previousDaily: prev.daily.map((d) => ({ day: d.day, visitors: d.visitors, sessions: d.sessions, quotes: d.quotes })),
    devices,
    categories: cats,
    categoriesOthersViews: others,
    interactions: {
      galleryOpens: cur.sessionsOf('gallery_open'),
      formOpens: cur.sessionsOf('form_open'),
      formStarts: cur.sessionsOf('form_start'),
      phoneClicks: cur.sessionsOf('phone_click'),
      emailClicks: cur.sessionsOf('email_click'),
    },
    funnel,
    quotes: { created: cur.quotes.created, sent: cur.quotes.sent, failed: cur.quotes.failed, previousCreated: prev.quotes.created },
    conversion: { rate: pct(cur.quotes.sent, sess), numerator: cur.quotes.sent, denominator: sess, definition: 'devis envoyés ÷ sessions' },
    coverage: { firstDay: first && first.d ? first.d : null, daysWithData: have, daysInRange: n },
    notMeasured: [
      { key: 'new_vs_returning', label: 'Visiteurs nouveaux / récurrents', reason: 'Non mesurable : un sel aléatoire quotidien empêche de reconnaître un visiteur d’un jour à l’autre (choix de confidentialité).' },
      { key: 'origin', label: 'Origine des accès', reason: 'Non collectée : aucun référent n’est enregistré (respect de la vie privée).' },
      { key: 'form_submit_click', label: 'Clic sur « Envoyer »', reason: 'Non collecté côté navigateur : la demande reçue par l’API est le signal fiable.' },
    ],
  };
}

module.exports = { buildReport, resolveRange, validDay, addDays, daysBetween, eachDay, BUILTIN_CATEGORIES, MAX_DAYS };
