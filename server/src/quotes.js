'use strict';

/**
 * Public quote requests (devis).
 *
 * Flow (three calls, each idempotent, so a flaky connection never loses or duplicates a request):
 *   1. POST /api/quotes                 JSON  -> validates and STORES the request first, returns { id, token }.
 *   2. POST /api/quotes/:id/photos      raw image, one call per photo -> stored on disk.
 *   3. POST /api/quotes/:id/finalize    JSON { token } -> e-mails VECTIS. Success is reported only when every
 *                                       e-mail was accepted by the mail provider; otherwise the request stays
 *                                       'mail_failed' (still stored) and can be retried without duplicates.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sniff } = require('./site');

const IMAGE_MAX = 10 * 1024 * 1024;
const MAX_PHOTOS_PER_PROP = 10;
const MAX_PROPS = 20;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const PRICE_LABEL = { hour: 'À l’heure', fixed: 'Forfait fixe', service: 'Par service' };
const RE_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const M = {
  invalid: 'Veuillez vérifier les champs du formulaire.',
  rate: 'Trop de demandes. Réessayez dans quelques minutes.',
  notFound: 'Demande introuvable.',
  forbidden: 'Accès refusé.',
  photoBad: 'Format de photo non pris en charge (JPG, PNG ou WEBP).',
  photoBig: 'Photo trop volumineuse (10 Mo maximum).',
  missing: 'Certaines photos n’ont pas été reçues.',
  busy: 'Envoi déjà en cours. Patientez un instant.',
  mailFailed: 'Votre demande est enregistrée mais n’a pas pu être transmise par e-mail pour le moment. Aucune confirmation n’est donnée : veuillez réessayer.',
  mailDown: 'Le service d’e-mail est momentanément indisponible. Votre demande est enregistrée ; veuillez réessayer dans quelques instants.',
};

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max + 1) : null);
const strML = (v, max) => (typeof v === 'string' ? v.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max + 1) : null);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Pure validation, mirrors the checks of the browser form. Returns { ok:true, value } or { ok:false, field, message }. */
function validateQuote(b) {
  const bad = (field, message = M.invalid) => ({ ok: false, field, message });
  if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('body');
  const sid = b.submissionId;
  if (typeof sid !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(sid)) return bad('submissionId');

  const c = b.contact || {};
  const name = str(c.name, 120), phone = str(c.phone, 40), email = str(c.email, 254);
  if (!name || name.length > 120) return bad('contact.name', 'Nom / Société obligatoire.');
  const digits = (phone || '').replace(/\D/g, '');
  if (!phone || !/^[+\d][\d\s().-]{7,}$/.test(phone) || digits.length < 9 || digits.length > 15) return bad('contact.phone', 'Téléphone invalide.');
  if (!email || email.length > 254 || !RE_MAIL.test(email)) return bad('contact.email', 'E-mail invalide.');

  if (!Array.isArray(b.properties) || b.properties.length < 1 || b.properties.length > MAX_PROPS) return bad('properties', 'Ajoutez au moins une propriété.');
  if (!Array.isArray(b.photos) || b.photos.length !== b.properties.length) return bad('photos');

  const properties = [];
  for (let i = 0; i < b.properties.length; i++) {
    const p = b.properties[i] || {};
    const f = (k) => `properties[${i}].${k}`;
    const req = (k, max) => { const v = str(p[k], max); return v && v.length <= max ? v : null; };
    const opt = (k, max) => { const v = p[k] == null || p[k] === '' ? '' : str(p[k], max); return v !== null && v.length <= max ? v : null; };
    const site = req('site', 120); if (!site) return bad(f('site'));
    const street = req('street', 160); if (!street) return bad(f('street'));
    const city = req('city', 100); if (!city) return bad(f('city'));
    const zip = str(p.zip, 5); if (!zip || !/^\d{5}$/.test(zip)) return bad(f('zip'), 'Code postal à 5 chiffres.');
    const type = req('type', 80); if (!type) return bad(f('type'));
    const typeother = opt('typeother', 100); if (typeother === null || (type === 'Autre' && !typeother)) return bad(f('typeother'));
    const surfaceRaw = str(p.surface, 20); const surface = parseFloat(String(surfaceRaw || '').replace(/[^0-9.,]/g, '').replace(',', '.'));
    if (!surfaceRaw || !(surface > 0)) return bad(f('surface'), 'Surface invalide.');
    const desc = strML(p.desc, 1000); if (!desc || desc.length > 1000) return bad(f('desc'));
    const freq = req('freq', 80); if (!freq) return bad(f('freq'));
    const freqother = opt('freqother', 100); if (freqother === null || (freq === 'Autre fréquence' && !freqother)) return bad(f('freqother'));
    const visits = Number(p.visits); if (!Number.isInteger(visits) || visits < 1 || visits > 7) return bad(f('visits'));
    const days = Array.isArray(p.days) ? p.days : [];
    if (days.length > 7 || days.some((d) => !DAYS.includes(d)) || new Set(days).size !== days.length) return bad(f('days'));
    const num = opt('num', 20), other = opt('other', 120);
    if (num === null || other === null) return bad(f('num'));
    const counts = {};
    for (const [k, max] of [['rooms', 999], ['offices', 999], ['wc', 999], ['kitchens', 999], ['halls', 999], ['floors', 99]]) {
      if (p[k] == null || p[k] === '') { counts[k] = ''; continue; }
      const n = Number(p[k]); if (!Number.isInteger(n) || n < 0 || n > max) return bad(f(k));
      counts[k] = String(n);
    }
    let price = null;
    if (p.price != null && p.price !== '') {
      const pk = p.price && p.price.kind, pv = parseFloat(String((p.price && p.price.value) || '').replace(/\s/g, '').replace(',', '.'));
      if (!PRICE_LABEL[pk] || !(pv > 0) || pv > 1e8) return bad(f('price'), 'Montant invalide.');
      price = { kind: pk, value: pv };
    }
    const np = Number(b.photos[i]);
    if (!Number.isInteger(np) || np < 0 || np > MAX_PHOTOS_PER_PROP) return bad(`photos[${i}]`, 'Maximum 10 photos par propriété.');
    properties.push({ site, num, street, zip, city, type, typeother, surface: surfaceRaw, desc, freq, freqother, visits, days, other, ...counts, price, photoCount: np });
  }
  return { ok: true, value: { submissionId: sid, contact: { name, phone, email }, properties } };
}

const money = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Builds the e-mails (HTML + attachments). Photos are spread over several e-mails when they exceed `budget` bytes. */
function buildQuoteMessages({ quote, photos, to, budget, ref }) {
  const q = quote;
  const groups = [[]]; let size = 0;
  for (const ph of photos) {
    if (groups[groups.length - 1].length && size + ph.data.length > budget) { groups.push([]); size = 0; }
    groups[groups.length - 1].push(ph); size += ph.data.length;
  }
  const total = groups.length;
  const row = (k, v) => (v === '' || v == null ? '' : `<tr><td style="padding:3px 12px 3px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`);
  const detail = q.properties.map((p, i) => {
    const addr = `${p.num ? p.num + ' ' : ''}${p.street}, ${p.zip} ${p.city}`;
    return `<h3 style="margin:18px 0 6px;font-size:15px">Propriété ${i + 1} : ${esc(p.site)}</h3><table style="font-size:14px;border-collapse:collapse">` +
      row('Adresse', addr) + row('Type', p.type === 'Autre' ? `Autre : ${p.typeother}` : p.type) + row('Surface', p.surface) +
      row('Salles', p.rooms) + row('Bureaux', p.offices) + row('Autres espaces', p.other) + row('Sanitaires', p.wc) + row('Cuisines', p.kitchens) +
      row('Couloirs', p.halls) + row('Étages', p.floors) + row('Description', p.desc).replace('<td style="padding:3px 0">', '<td style="padding:3px 0;white-space:pre-wrap">') +
      row('Prix proposé (HT)', p.price ? `${money(p.price.value)} € — ${PRICE_LABEL[p.price.kind]}` : '') +
      row('Fréquence', p.freq === 'Autre fréquence' ? `Autre : ${p.freqother}` : p.freq) + row('Visites par période', p.visits) +
      row('Jours', p.days.join(', ')) + row('Photos', p.photoCount ? `${p.photoCount} (en pièces jointes)` : 'aucune') + '</table>';
  }).join('');
  return groups.map((g, k) => {
    const files = g.map((ph) => `<li>Propriété ${ph.prop + 1} : ${esc(ph.name)}</li>`).join('');
    const head = k === 0
      ? `<h2 style="margin:0 0 8px;font-size:18px">Nouvelle demande de devis</h2><p style="margin:0 0 6px;font-size:14px"><strong>${esc(q.contact.name)}</strong><br>Tél. ${esc(q.contact.phone)}<br>E-mail : ${esc(q.contact.email)}</p><p style="font-size:12px;color:#777;margin:0">Référence ${esc(ref)}${total > 1 ? ` · e-mail 1/${total}` : ''}</p>${detail}`
      : `<h2 style="margin:0 0 8px;font-size:18px">Demande de devis — photos (suite ${k + 1}/${total})</h2><p style="font-size:14px"><strong>${esc(q.contact.name)}</strong> · Référence ${esc(ref)}</p>`;
    return {
      to, replyTo: q.contact.email,
      subject: `Demande de devis — ${q.contact.name} (${q.properties.length} propriété${q.properties.length > 1 ? 's' : ''})${total > 1 ? ` [${k + 1}/${total}]` : ''}`,
      html: `<div style="font-family:Arial,sans-serif;color:#111;max-width:680px">${head}${files ? `<p style="font-size:13px;margin:14px 0 4px">Photos jointes :</p><ul style="font-size:13px;margin:0">${files}</ul>` : ''}</div>`,
      attachments: g.map((ph) => ({ name: ph.name, mime: ph.mime, data: ph.data })),
    };
  });
}

function registerQuoteRoutes(app, { config, db, auth, mailer, now = Date.now }) {
  const dir = path.join(config.uploadDir, 'quotes');
  const busy = new Set();
  const tokenFor = (id) => crypto.createHmac('sha256', config.sessionSecret).update('quote:' + id).digest('hex');
  const tokenOk = (id, given) => {
    if (typeof given !== 'string' || given.length !== 64) return false;
    return crypto.timingSafeEqual(Buffer.from(tokenFor(id)), Buffer.from(given));
  };
  const limited = (req, reply, name) => {
    const r = auth.hit(name + ':' + auth.ipHash(req.ip), config.limits[name]);
    if (r.allowed) return false;
    reply.header('Retry-After', String(r.retryAfterSec));
    reply.code(429).send({ ok: false, error: 'rate_limited', message: M.rate });
    return true;
  };
  const load = (id) => (/^[0-9a-f]{32}$/.test(String(id)) ? db.prepare('SELECT * FROM quotes WHERE id = ?').get(id) : null);

  app.post('/api/quotes', { bodyLimit: 128 * 1024 }, async (req, reply) => {
    if (limited(req, reply, 'quotePerIp')) return;
    const v = validateQuote(req.body);
    if (!v.ok) return reply.code(422).send({ ok: false, error: 'invalid_quote', field: v.field, message: v.message });
    const q = v.value;
    const existing = db.prepare('SELECT id, status FROM quotes WHERE submission_id = ?').get(q.submissionId);
    if (existing) return { ok: true, id: existing.id, token: tokenFor(existing.id), status: existing.status };
    const id = crypto.randomBytes(16).toString('hex');
    const photoCount = q.properties.reduce((n, p) => n + p.photoCount, 0);
    db.prepare('INSERT INTO quotes (id, submission_id, status, payload, photo_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, q.submissionId, 'received', JSON.stringify({ contact: q.contact, properties: q.properties }), photoCount, now());
    req.log.info({ event: 'quote_received', quote: id, properties: q.properties.length, photos: photoCount });
    return { ok: true, id, token: tokenFor(id), status: 'received' };
  });

  app.post('/api/quotes/:id/photos', { bodyLimit: IMAGE_MAX + 1024 }, async (req, reply) => {
    if (limited(req, reply, 'quotePhotoPerIp')) return;
    const row = load(req.params.id);
    if (!row) return reply.code(404).send({ ok: false, error: 'not_found', message: M.notFound });
    if (!tokenOk(row.id, req.headers['x-quote-token'])) return reply.code(403).send({ ok: false, error: 'forbidden', message: M.forbidden });
    if (row.status === 'sent') return { ok: true, status: 'sent' };
    const idx = Number(req.headers['x-photo-index']), prop = Number(req.headers['x-photo-prop']);
    const payload = JSON.parse(row.payload);
    if (!Number.isInteger(idx) || idx < 0 || idx >= row.photo_count || !Number.isInteger(prop) || prop < 0 || prop >= payload.properties.length) {
      return reply.code(422).send({ ok: false, error: 'invalid_photo', message: M.invalid });
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ ok: false, error: 'bad_request', message: M.invalid });
    if (body.length > IMAGE_MAX) return reply.code(413).send({ ok: false, error: 'too_large', message: M.photoBig });
    const declared = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const real = sniff(body);
    if (!real || real !== declared || !PHOTO_TYPES.includes(real)) return reply.code(415).send({ ok: false, error: 'unsupported_file', message: M.photoBad });
    let name = 'photo';
    try { name = decodeURIComponent(String(req.headers['x-photo-name'] || 'photo')); } catch (_) {}
    name = name.replace(/[\x00-\x1f\\/]/g, '_').slice(0, 120) || 'photo';
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = `${row.id}-${idx}`;
    const final = path.join(dir, file), tmp = final + '.part';
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, final);
    db.prepare('INSERT INTO quote_photos (quote_id, idx, prop, name, mime, bytes, file) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(quote_id, idx) DO UPDATE SET prop = excluded.prop, name = excluded.name, mime = excluded.mime, bytes = excluded.bytes, file = excluded.file')
      .run(row.id, idx, prop, name, real, body.length, file);
    return { ok: true, idx };
  });

  app.post('/api/quotes/:id/finalize', { bodyLimit: 2048 }, async (req, reply) => {
    const row = load(req.params.id);
    if (!row) return reply.code(404).send({ ok: false, error: 'not_found', message: M.notFound });
    if (!tokenOk(row.id, req.body && req.body.token)) return reply.code(403).send({ ok: false, error: 'forbidden', message: M.forbidden });
    if (row.status === 'sent') return { ok: true, status: 'sent', id: row.id };
    if (busy.has(row.id)) return reply.code(409).send({ ok: false, error: 'busy', message: M.busy });

    const payload = JSON.parse(row.payload);
    const rows = db.prepare('SELECT * FROM quote_photos WHERE quote_id = ? ORDER BY idx').all(row.id);
    const have = new Set(rows.map((r) => r.idx));
    const missing = [];
    for (let i = 0; i < row.photo_count; i++) if (!have.has(i)) missing.push(i);
    if (missing.length) return reply.code(409).send({ ok: false, error: 'photos_missing', missing, message: M.missing });

    if (!mailer.ready()) {
      db.prepare("UPDATE quotes SET status = 'mail_failed', last_error = ?, attempts = attempts + 1 WHERE id = ?").run('mail_not_connected', row.id);
      req.log.error({ event: 'quote_mail_failed', quote: row.id, code: 'mail_not_connected' });
      return reply.code(503).send({ ok: false, error: 'mail_unavailable', message: M.mailDown });
    }
    busy.add(row.id);
    try {
      let photos;
      try { photos = rows.map((r) => ({ prop: r.prop, name: r.name, mime: r.mime, data: fs.readFileSync(path.join(dir, r.file)) })); } catch (e) {
        db.prepare("UPDATE quotes SET status = 'mail_failed', last_error = ?, attempts = attempts + 1 WHERE id = ?").run('photo_file_missing', row.id);
        return reply.code(409).send({ ok: false, error: 'photos_missing', missing: [], message: M.missing });
      }
      const messages = buildQuoteMessages({ quote: payload, photos, to: config.quoteRecipient, budget: config.quoteMailBudget, ref: row.id.slice(0, 8).toUpperCase() });
      db.prepare('UPDATE quotes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      let sent = row.mails_sent;
      try {
        for (; sent < messages.length; sent++) {
          await mailer.sendQuote(messages[sent]);
          db.prepare('UPDATE quotes SET mails_sent = ? WHERE id = ?').run(sent + 1, row.id);
        }
      } catch (err) {
        const code = String((err && err.code) || 'mail_error').slice(0, 60);
        db.prepare("UPDATE quotes SET status = 'mail_failed', last_error = ? WHERE id = ?").run(code, row.id);
        req.log.error({ event: 'quote_mail_failed', quote: row.id, code, mailsSent: sent, mailsTotal: messages.length });
        return reply.code(502).send({ ok: false, error: 'mail_failed', message: M.mailFailed });
      }
      db.prepare("UPDATE quotes SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?").run(now(), row.id);
      req.log.info({ event: 'quote_sent', quote: row.id, mails: messages.length });
      return { ok: true, status: 'sent', id: row.id };
    } finally { busy.delete(row.id); }
  });
}

module.exports = { registerQuoteRoutes, validateQuote, buildQuoteMessages };
