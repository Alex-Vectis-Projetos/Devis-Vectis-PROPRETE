'use strict';

/**
 * Estimation indicative des prix (aucune écriture en base).
 *   POST /api/estimate                 public  : { type, surface, counts, surfaces, services, freq, visits } -> estimation
 *   GET  /api/admin/pricing            admin   : paramètres enregistrés (ou valeurs de départ), valeurs de départ, catalogue, version
 *   POST /api/admin/pricing/preview    admin   : simule avec des paramètres NON enregistrés (aperçu du panneau)
 * L'enregistrement passe par l'API de contenu existante (PUT /api/admin/site/content/pricing : version, journal, CSRF).
 */

const { ContentStore, ContentError } = require('./content');
const P = require('./pricing');

const BODY_MAX = 8 * 1024;

/** Paramètres en vigueur : section `pricing` enregistrée, sinon valeurs de départ. Toujours revalidés (jamais de valeur corrompue utilisée). */
function currentPricing(store) {
  const saved = store.get('pricing');
  if (saved) {
    try { return { cfg: P.validatePricing(saved.value, (f, m) => { throw new Error(`${f}: ${m}`); }), version: saved.version, saved: true }; } catch (_) { /* valeurs de départ */ }
  }
  return { cfg: P.DEFAULT_PRICING, version: 0, saved: false };
}

/** Estimation d'une propriété déjà validée (stockée avec la demande pour que VECTIS voie ce que le client a vu). */
function estimateForProperty(store, p, now = Date.now) {
  const cur = currentPricing(store);
  const snap = P.estimateSnapshot(cur.cfg, p);
  return snap ? { at: now(), configVersion: cur.version, configSaved: cur.saved, ...snap } : null;
}

function registerEstimateRoutes(app, { config, db, auth, requireAdmin, now = Date.now }) {
  const store = new ContentStore(db, now);

  app.post('/api/estimate', { bodyLimit: BODY_MAX }, async (req, reply) => {
    const r = auth.hit('estimate:' + auth.ipHash(req.ip), config.limits.estimatePerIp);
    if (!r.allowed) {
      reply.header('Retry-After', String(r.retryAfterSec));
      return reply.code(429).send({ ok: false, error: 'rate_limited' });
    }
    const n = P.normalizeInput(req.body);
    if (n.error) return reply.code(422).send({ ok: false, error: 'invalid_estimate', field: n.error });
    reply.header('Cache-Control', 'no-store');
    return P.estimate(currentPricing(store).cfg, n.value);
  });

  app.get('/api/admin/pricing', { preHandler: requireAdmin }, async () => {
    const cur = currentPricing(store);
    return { ok: true, config: cur.cfg, saved: cur.saved, version: cur.version, defaults: P.DEFAULT_PRICING, catalog: P.CATALOG, types: P.TYPES, freqs: P.FREQS };
  });

  app.post('/api/admin/pricing/preview', { bodyLimit: 32 * 1024, onRequest: requireAdmin }, async (req, reply) => {
    const body = req.body || {};
    let cfg;
    try {
      cfg = P.validatePricing(body.config, (field, message) => { throw new ContentError(field, message); });
    } catch (e) {
      if (e instanceof ContentError) return reply.code(422).send({ ok: false, error: 'invalid_content', field: e.field, message: e.message });
      throw e;
    }
    const n = P.normalizeInput(body.input);
    if (n.error) return reply.code(422).send({ ok: false, error: 'invalid_estimate', field: n.error });
    return P.estimate(cfg, n.value);
  });
}

module.exports = { registerEstimateRoutes, currentPricing, estimateForProperty };
