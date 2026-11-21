'use strict';

/**
 * STATISTIQUES — administrator read API (production). READ ONLY: no route here writes anything.
 *
 *   GET /api/admin/stats/status    → is the collection on, which day is "today", first day with data, retention policy
 *   GET /api/admin/stats/overview  → the whole dashboard (stats-report.js): ?range=today|7d|30d|90d|custom[&from=&to=]
 *
 * - Both routes require an administrator session (requireAdmin) and answer `Cache-Control: no-store`.
 * - They exist whether or not STATS_ENABLED is on: with the collection off the dashboard simply shows zeros and says why.
 * - Quotes come from the `quotes` table through stats-report.js (created_at + status only: no name, e-mail, phone or content).
 * - Not registered in PREVIEW_MODE: the demonstration site has its own variants of the same two routes (stats-preview.js).
 */

const { dayOf } = require('./stats');
const { ContentStore } = require('./content');
const { buildReport, resolveRange, BUILTIN_CATEGORIES } = require('./stats-report');

const RAW_RETENTION_DAYS = 90;
const DAILY_RETENTION_MONTHS = 25;

/** Known category ids → display names: shipped categories, overridden by the ones the administrator publishes. */
function categoryLabels(db, now = Date.now) {
  const m = new Map(BUILTIN_CATEGORIES);
  try {
    const g = new ContentStore(db, now).get('categories');
    if (g && g.value && Array.isArray(g.value.items)) {
      for (const it of g.value.items) if (it && typeof it.id === 'string' && typeof it.label === 'string') m.set(it.id, it.label);
    }
  } catch (_) { /* the shipped list is enough */ }
  return m;
}

function registerStatsAdminRoutes(app, { config, db, requireAdmin, now = Date.now }) {
  if (config.previewMode) return null;

  app.get('/api/admin/stats/status', { preHandler: requireAdmin }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const first = db.prepare('SELECT MIN(day) AS d FROM (SELECT MIN(day) AS day FROM stats_daily UNION ALL SELECT MIN(day) FROM stats_events)').get();
    return {
      ok: true,
      mode: 'live',
      simulated: false,
      collectionEnabled: config.statsEnabled === true,
      today: dayOf(now()),
      firstDay: first && first.d ? first.d : null,
      retention: { rawDays: RAW_RETENTION_DAYS, dailyMonths: DAILY_RETENTION_MONTHS },
    };
  });

  app.get('/api/admin/stats/overview', { preHandler: requireAdmin }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const q = req.query || {};
    const today = dayOf(now());
    const range = resolveRange({ range: String(q.range || '30d'), from: q.from, to: q.to }, today);
    if (range.error) return reply.code(400).send({ ok: false, error: 'bad_range', message: range.error });
    const report = buildReport(db, range, { today, labels: categoryLabels(db, now) });
    return { ...report, mode: 'live', simulated: false, collectionEnabled: config.statsEnabled === true };
  });

  return { categoryLabels: () => categoryLabels(db, now) };
}

module.exports = { registerStatsAdminRoutes, categoryLabels, RAW_RETENTION_DAYS, DAILY_RETENTION_MONTHS };
