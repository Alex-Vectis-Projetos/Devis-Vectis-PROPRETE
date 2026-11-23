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
const { ContentStore } = require('./content');
const PR = require('./pricing');
const { estimateForProperty } = require('./estimate');

const IMAGE_MAX = 10 * 1024 * 1024;
const MAX_PHOTOS_PER_PROP = 10;
const MAX_PROPS = 20;
const MAX_ORIG = 100 * 1024 * 1024;
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
  tooMany: 'Cette demande dépasse le volume de photos autorisé. Réduisez le nombre ou le poids des photos.',
  missing: 'Certaines photos n’ont pas été reçues.',
  busy: 'Envoi déjà en cours. Patientez un instant.',
  mailFailed: 'Votre demande est enregistrée mais n’a pas pu être transmise par e-mail pour le moment. Aucune confirmation n’est donnée : veuillez réessayer.',
  mailDown: 'Le service d’e-mail est momentanément indisponible. Votre demande est enregistrée ; veuillez réessayer dans quelques instants.',
};

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max + 1) : null);
const strML = (v, max) => (typeof v === 'string' ? v.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max + 1) : null);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Pure validation, mirrors the checks of the browser form. Returns { ok:true, value } or { ok:false, field, message }. */
function validateQuote(b, maxPhotos = 40) {
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
    for (const [k, , max] of PR.COUNTERS) {
      if (p[k] == null || p[k] === '') { counts[k] = ''; continue; }
      const n = Number(p[k]); if (!Number.isInteger(n) || n < 0 || n > max) return bad(f(k));
      counts[k] = String(n);
    }
    // Surfaces à nettoyer et services : identifiants du catalogue uniquement (anciens clients : champs absents = listes vides).
    const idList = (k, allowed) => {
      const a = p[k] == null ? [] : p[k];
      return Array.isArray(a) && a.length <= allowed.length && a.every((x) => allowed.includes(x)) && new Set(a).size === a.length ? a : null;
    };
    const surfaces = idList('surfaces', PR.SURFACES.map((x) => x[0])); if (!surfaces) return bad(f('surfaces'));
    const services = idList('services', PR.SERVICE_IDS); if (!services) return bad(f('services'));
    const servicesOther = p.servicesOther == null || p.servicesOther === '' ? '' : strML(p.servicesOther, PR.SERVICES_OTHER_MAX);
    if (servicesOther === null || servicesOther.length > PR.SERVICES_OTHER_MAX) return bad(f('servicesOther'));
    let price = null;
    if (p.price != null && p.price !== '') {
      const pk = p.price && p.price.kind, pv = parseFloat(String((p.price && p.price.value) || '').replace(/\s/g, '').replace(',', '.'));
      if (!PRICE_LABEL[pk] || !(pv > 0) || pv > 1e8) return bad(f('price'), 'Montant invalide.');
      price = { kind: pk, value: pv };
      if (p.price.auto === true) price.auto = true; // suggestion automatique reprise telle quelle par le client
    }
    const np = Number(b.photos[i]);
    if (!Number.isInteger(np) || np < 0 || np > MAX_PHOTOS_PER_PROP) return bad(`photos[${i}]`, 'Maximum 10 photos par propriété.');
    properties.push({ site, num, street, zip, city, type, typeother, surface: surfaceRaw, desc, freq, freqother, visits, days, other, ...counts, surfaces, services, servicesOther, price, photoCount: np });
  }
  if (properties.reduce((n, p) => n + p.photoCount, 0) > maxPhotos) return bad('photos', `Maximum ${maxPhotos} photos par demande.`);
  return { ok: true, value: { submissionId: sid, contact: { name, phone, email }, properties } };
}

const NEW_COUNTERS = PR.COUNTERS.filter((c) => !['rooms', 'offices', 'wc', 'kitchens', 'halls', 'floors'].includes(c[0]));
const money = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---- Fiche visuelle (HTML d'e-mail) : tables imbriquées + styles inline, 640 px max, sans <style> ni image de fond (Gmail, mobile). ---- */
const C = { ink: '#111111', gold: '#e0aa27', goldDk: '#8a6a12', mut: '#6b6b6b', line: '#e6e6e6', page: '#f3f1ea', sheet: '#ffffff' };
const FONT = 'Arial,Helvetica,sans-serif';
const MSGID_DOMAIN = 'devis.mrprop.fr';
const fmtDate = (ms) => { try { return new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }); } catch (_) { return ''; } };
const mo = (n) => (n / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';

const fldRow = (k, v, pre) => {
  const empty = v === '' || v == null;
  return `<tr><td width="38%" style="padding:5px 12px 5px 0;font-size:13px;color:${C.mut};vertical-align:top">${esc(k)}</td>` +
    `<td style="padding:5px 0;font-size:14px;color:${empty ? '#aaaaaa' : C.ink};vertical-align:top${pre ? ';white-space:pre-wrap' : ''}">${empty ? '—' : esc(v)}</td></tr>`;
};
const section = (title, inner) =>
  `<tr><td style="padding:12px 20px 4px"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.goldDk};border-bottom:1px solid ${C.line};padding-bottom:4px">${esc(title)}</div>` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px">${inner}</table></td></tr>`;
const photoGrid = (items) => {
  let out = '';
  for (let i = 0; i < items.length; i += 2) {
    out += '<tr>' + [items[i], items[i + 1]].map((it) => it
      ? `<td width="50%" valign="top" style="padding:4px"><img src="cid:${it.cid}" alt="${esc(it.alt)}" width="100%" style="display:block;width:100%;height:auto;border:0;border-radius:4px">` +
        (it.note ? `<div style="font-size:11px;color:#888888;padding-top:2px">${esc(it.note)}</div>` : '') + '</td>'
      : '<td width="50%" style="padding:4px"></td>').join('') + '</tr>';
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${out}</table>`;
};

/**
 * Builds the e-mails: the visual quote sheet (first e-mail) + photo continuations when the attachments exceed `budget` bytes.
 * Every e-mail has the same subject and deterministic Message-ID / In-Reply-To so they stay in ONE Gmail conversation.
 * Photos are attached ONCE (downloadable) and also shown in the sheet through their Content-ID.
 */
function buildQuoteMessages({ quote, photos, to, from, budget, ref, id, createdAt }) {
  const q = quote;
  const key = String(id || ref || 'q').replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || 'q';
  const groups = [[]]; let size = 0;
  photos.forEach((ph, i) => {
    const item = { ph, i, cid: `ph${i}.${key}@${MSGID_DOMAIN}` };
    if (groups[groups.length - 1].length && size + ph.data.length > budget) { groups.push([]); size = 0; }
    groups[groups.length - 1].push(item); size += ph.data.length;
  });
  const total = groups.length;
  const subject = `Demande de devis — ${q.contact.name} — Réf. ${ref}`;
  const msgId = (k) => `<vectis-quote-${key}-${k + 1}@${MSGID_DOMAIN}>`;
  const photoItems = (g, propIdx) => g.filter((x) => x.ph.prop === propIdx).map((x, n) => ({
    cid: x.cid, alt: `Photo ${n + 1} — propriété ${propIdx + 1}`,
    note: x.ph.origBytes && x.ph.origBytes > x.ph.data.length ? `allégée : ${mo(x.ph.origBytes)} → ${mo(x.ph.data.length)}` : '',
  }));
  const banner = (title, sub) =>
    `<tr><td style="background:${C.ink};padding:20px"><div style="font-size:11px;letter-spacing:.16em;color:${C.gold};font-weight:700">VECTIS</div>` +
    `<div style="font-size:20px;font-weight:700;color:#ffffff;margin-top:4px">${esc(title)}</div><div style="font-size:13px;color:#d8d8d8;margin-top:4px">${esc(sub)}</div></td></tr>`;
  const refLine = (extra) => `<tr><td style="padding:12px 20px;background:#faf6e8;border-bottom:1px solid ${C.line};font-size:13px;color:${C.ink}">Référence de la demande : <strong>${esc(ref)}</strong>` +
    `${createdAt ? ` &nbsp;·&nbsp; Date de la demande : <strong>${esc(fmtDate(createdAt))}</strong>` : ''}${extra || ''}</td></tr>`;
  const wrap = (rows) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};font-family:${FONT}"><tr><td align="center" style="padding:16px 8px">` +
    `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:${C.sheet};border:1px solid ${C.line};border-radius:6px">${rows}</table></td></tr></table>`;

  return groups.map((g, k) => {
    let rows;
    if (k === 0) {
      const props = q.properties.map((p, i) => {
        const addr = [
          fldRow('Nom de l’établissement / propriété', p.site), fldRow('Numéro de rue', p.num), fldRow('Nom de la rue', p.street),
          fldRow('Code postal', p.zip), fldRow('Ville', p.city),
          fldRow('Type de propriété', p.type === 'Autre' ? `Autre : ${p.typeother}` : p.type), fldRow('Surface', p.surface ? (/m/i.test(p.surface) ? p.surface : `${p.surface} m²`) : ''),
        ].join('');
        const conf = [fldRow('Nombre de salles', p.rooms), fldRow('Nombre de bureaux', p.offices), fldRow('Autres espaces', p.other),
          fldRow('Nombre de sanitaires', p.wc), fldRow('Nombre de cuisines', p.kitchens), fldRow('Nombre de couloirs', p.halls), fldRow('Nombre d’étages', p.floors),
          // Nouveaux ambiances : affichés seulement s'ils sont renseignés (les anciennes demandes n'ont pas ces champs).
          ...NEW_COUNTERS.filter((c) => p[c[0]] !== undefined && p[c[0]] !== '').map((c) => fldRow(`Nombre : ${c[1].toLowerCase()}`, p[c[0]]))].join('');
        const surf = (p.surfaces || []).map((id) => (PR.SURFACES.find((x) => x[0] === id) || [])[1]).filter(Boolean);
        // Une ligne par élément / tâche cochée (jamais de simple total), regroupées par catégorie comme dans le formulaire.
        const listRow = (k, items) => `<tr><td width="38%" style="padding:5px 12px 5px 0;font-size:13px;color:${C.mut};vertical-align:top">${esc(k)}</td>` +
          `<td style="padding:5px 0;font-size:14px;color:${C.ink};vertical-align:top">${items.map((t) => `<div style="padding:1px 0">&bull; ${esc(t)}</div>`).join('')}</td></tr>`;
        const surfSec = surf.length ? section('Éléments et surfaces à nettoyer', listRow('Sélection', surf)) : '';
        const svcRows = PR.SERVICES.map((cat) => {
          const t = (p.services || []).filter((id) => id.startsWith(cat.id + '.')).map((id) => (cat.tasks.find((x) => `${cat.id}.${x[0]}` === id) || [])[1]).filter(Boolean);
          return t.length ? listRow(cat.label, t) : '';
        }).join('') + (p.servicesOther ? fldRow('Autres services', p.servicesOther, true) : '');
        const svcSec = svcRows ? section('Services à réaliser', svcRows) : '';
        const est = p.estimate;
        const hh = (h) => { const m = Math.round((h - Math.floor(h)) * 60); return `${Math.floor(h)} h${m ? ' ' + String(m).padStart(2, '0') : ''}`; };
        const estSec = est ? section('Estimation indicative (automatique)',
          fldRow('Durée estimée par visite', `${hh(est.hoursPerVisit)}`) +
          fldRow('Passages estimés', est.visitsPerMonth ? `${String(est.visitsPerMonth).replace('.', ',')} par mois` : est.visitsTotal ? `${est.visitsTotal} intervention${est.visitsTotal > 1 ? 's' : ''}` : (p.freq === 'Autre fréquence' ? 'Non chiffrable : fréquence libre' : '')) +
          fldRow('Tarif horaire appliqué', `${money(est.rate)} € HT / h`) +
          fldRow('Estimation à l’heure', `${money(est.hour)} € HT / h`) +
          fldRow('Estimation forfait', est.fixed ? `${money(est.fixed.value)} € HT ${est.fixed.basis === 'mois' ? 'par mois' : 'par intervention'}` : (p.freq === 'Autre fréquence' ? `Non chiffrable : fréquence libre${est.visitPrice ? ` (prix d’une visite : ${money(est.visitPrice)} € HT)` : ''}` : '')) +
          fldRow('Estimation par service', est.service != null ? `${money(est.service)} € HT par visite` : '') +
          fldRow('Contrôle par m²', `${money(est.perM2Visit)} € HT/m² par passage (${est.inRange ? 'dans' : 'hors de'} la fourchette de référence)` +
            (est.perM2Month != null ? ` · ${money(est.perM2Month)} € HT/m²/mois (${est.inRangeMonth ? 'dans' : 'hors de'} la fourchette)` : '')) +
          `<tr><td colspan="2" style="padding:2px 0 5px;font-size:12px;color:${C.mut}">Estimation préliminaire calculée automatiquement avec le barème en vigueur à la date de la demande. Elle n’engage pas VECTIS et ne constitue pas un devis.</td></tr>`) : '';
        const fin = p.price
          ? fldRow('Modalité de prix', PRICE_LABEL[p.price.kind]) + fldRow('Montant proposé', `${money(p.price.value)} € HT`) +
            `<tr><td colspan="2" style="padding:2px 0 5px;font-size:12px;color:${C.mut}">Montant hors taxes (HT) : la TVA applicable s’ajoute à ce montant.${p.price.auto ? ' Montant issu de la suggestion automatique du formulaire, non modifié par le demandeur.' : ''}</td></tr>`
          : fldRow('Modalité de prix', '') + fldRow('Montant proposé', 'Non précisé par le demandeur');
        const freq = fldRow('Fréquence', p.freq === 'Autre fréquence' ? `Autre : ${p.freqother}` : p.freq) + fldRow('Visites par période', p.visits) + fldRow('Jours d’intervention', p.days.join(', '));
        const here = photoItems(g, i), elsewhere = p.photoCount - here.length;
        const ph = p.photoCount
          ? (here.length ? photoGrid(here) : '') +
            (elsewhere > 0 ? `<div style="font-size:12px;color:${C.mut};padding:4px 0">+ ${elsewhere} photo${elsewhere > 1 ? 's' : ''} dans les messages suivants de cette conversation.</div>` : '')
          : `<div style="font-size:13px;color:#aaaaaa;padding:5px 0">—  Aucune photo envoyée</div>`;
        return `<tr><td style="padding:14px 20px 0"><div style="background:${C.ink};color:${C.gold};font-size:12px;font-weight:700;letter-spacing:.1em;padding:7px 12px;border-radius:4px">PROPRIÉTÉ ${i + 1}</div></td></tr>` +
          section('Identification', addr) + section('Configuration du local', conf) + surfSec + svcSec +
          section('Description du service', `<tr><td style="padding:5px 0;font-size:14px;color:${C.ink};white-space:pre-wrap">${esc(p.desc)}</td></tr>`) +
          section('Conditions financières', fin) + estSec + section('Fréquence et organisation', freq) +
          `<tr><td style="padding:12px 20px 4px"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.goldDk};border-bottom:1px solid ${C.line};padding-bottom:4px">Photographies</div>${ph}</td></tr>`;
      }).join('');
      rows = banner('DEMANDE DE DEVIS — VECTIS', 'Nouvelle demande de devis · fiche originale de la demande') + refLine() +
        section('Informations du client', fldRow('Nom / Société', q.contact.name) + fldRow('Téléphone', q.contact.phone) + fldRow('E-mail', q.contact.email)) +
        `<tr><td style="padding:10px 20px 0;font-size:12px;color:${C.mut}">Section « Propriété(s) à nettoyer » : ${q.properties.length} propriété${q.properties.length > 1 ? 's' : ''}.</td></tr>` + props +
        `<tr><td style="padding:16px 20px 18px;font-size:12px;color:${C.mut};border-top:1px solid ${C.line}">Répondre à ce message écrit directement au demandeur. Cette fiche reste la référence de la demande : une contre-proposition figure dans le texte des réponses, jamais dans la fiche.` +
        `${q.properties.some((p) => p.photoCount) ? ' Les photographies sont incluses dans ce message (fichiers d’origine, téléchargeables).' : ''}</td></tr>`;
    } else {
      const blocks = q.properties.map((p, i) => { const it = photoItems(g, i); return it.length ? `<tr><td style="padding:12px 20px 4px"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.goldDk}">Propriété ${i + 1} — ${esc(p.site)}</div>${photoGrid(it)}</td></tr>` : ''; }).join('');
      rows = banner('DEMANDE DE DEVIS — VECTIS', `Photographies (suite ${k + 1}/${total})`) + refLine(` &nbsp;·&nbsp; ${esc(q.contact.name)}`) + blocks;
    }
    return {
      to, from, replyTo: q.contact.email, subject,
      messageId: msgId(k), inReplyTo: k > 0 ? msgId(0) : undefined,
      html: wrap(rows),
      attachments: g.map((x) => ({ name: x.ph.name, mime: x.ph.mime, data: x.ph.data, cid: x.cid })),
    };
  });
}

function registerQuoteRoutes(app, { config, db, auth, mailer, now = Date.now }) {
  const dir = path.join(config.uploadDir, 'quotes');
  const content = new ContentStore(db, now);
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
    const v = validateQuote(req.body, config.quoteMaxPhotos);
    if (!v.ok) return reply.code(422).send({ ok: false, error: 'invalid_quote', field: v.field, message: v.message });
    const q = v.value;
    const existing = db.prepare('SELECT id, status FROM quotes WHERE submission_id = ?').get(q.submissionId);
    if (existing) return { ok: true, id: existing.id, token: tokenFor(existing.id), status: existing.status };
    const id = crypto.randomBytes(16).toString('hex');
    const photoCount = q.properties.reduce((n, p) => n + p.photoCount, 0);
    // Estimation indicative calculée ICI (jamais reprise du navigateur) : VECTIS voit ce que le barème en vigueur donnait à cet instant.
    for (const p of q.properties) { try { const e = estimateForProperty(content, p, now); if (e) p.estimate = e; } catch (_) { /* l'estimation ne bloque jamais une demande */ } }
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
    const origHdr = Number(req.headers['x-photo-original-size']);
    const orig = Number.isInteger(origHdr) && origHdr > 0 && origHdr <= MAX_ORIG ? origHdr : null;
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ ok: false, error: 'bad_request', message: M.invalid });
    if (body.length > IMAGE_MAX) return reply.code(413).send({ ok: false, error: 'too_large', message: M.photoBig });
    const declared = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const real = sniff(body);
    if (!real || real !== declared || !PHOTO_TYPES.includes(real)) return reply.code(415).send({ ok: false, error: 'unsupported_file', message: M.photoBad });
    const used = db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM quote_photos WHERE quote_id = ? AND idx <> ?').get(row.id, idx).n;
    if (used + body.length > config.quoteMaxBytes) return reply.code(413).send({ ok: false, error: 'quote_too_large', message: M.tooMany });
    let name = 'photo';
    try { name = decodeURIComponent(String(req.headers['x-photo-name'] || 'photo')); } catch (_) {}
    name = name.replace(/[\x00-\x1f\\/]/g, '_').slice(0, 120) || 'photo';
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = `${row.id}-${idx}`;
    const final = path.join(dir, file), tmp = final + '.part';
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, final);
    db.prepare('INSERT INTO quote_photos (quote_id, idx, prop, name, mime, bytes, file, orig_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(quote_id, idx) DO UPDATE SET prop = excluded.prop, name = excluded.name, mime = excluded.mime, bytes = excluded.bytes, file = excluded.file, orig_bytes = excluded.orig_bytes')
      .run(row.id, idx, prop, name, real, body.length, file, orig);
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
    const tStart = Date.now();
    try {
      let photos;
      try { photos = rows.map((r) => ({ prop: r.prop, name: r.name, mime: r.mime, data: fs.readFileSync(path.join(dir, r.file)), origBytes: r.orig_bytes })); } catch (e) {
        db.prepare("UPDATE quotes SET status = 'mail_failed', last_error = ?, attempts = attempts + 1 WHERE id = ?").run('photo_file_missing', row.id);
        return reply.code(409).send({ ok: false, error: 'photos_missing', missing: [], message: M.missing });
      }
      const tRead = Date.now();
      const messages = buildQuoteMessages({ id: row.id, createdAt: row.created_at, quote: payload, photos, to: config.quoteRecipient, from: config.mailSender ? { name: `VECTIS — Nouvelle demande de ${payload.contact.name}`, address: config.mailSender } : null, budget: config.quoteMailBudget, ref: row.id.slice(0, 8).toUpperCase() });
      const tBuilt = Date.now();
      db.prepare('UPDATE quotes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      let sent = row.mails_sent;
      // Mesures de durée (aucune donnée personnelle, aucun contenu, aucun jeton) pour situer un éventuel retard :
      // lecture des photos / construction / jeton Gmail / appel API Gmail. Le retard de livraison éventuel se lit ensuite dans les en-têtes « Received ».
      const sends = [];
      // threadId de la conversation Gmail : relu depuis la table kv existante (clé quote_thread:<id>) si un envoi précédent a déjà
      // créé la conversation (reprise après échec ou redémarrage). Aucune migration : pas de nouvelle colonne ni table.
      const THREAD_KEY = 'quote_thread:' + row.id;
      const okThread = (v) => (typeof v === 'string' && /^[A-Za-z0-9]{1,64}$/.test(v) ? v : null);
      let threadId = null;
      if (row.mails_sent > 0) {
        try { const t = db.prepare('SELECT value FROM kv WHERE key = ?').get(THREAD_KEY); threadId = t ? okThread(t.value) : null; } catch (_) { threadId = null; }
      }
      try {
        for (; sent < messages.length; sent++) {
          const msg = threadId ? { ...messages[sent], threadId } : messages[sent];
          const r = await mailer.sendQuote(msg);
          if (r && okThread(r.threadId) && !threadId) {
            threadId = r.threadId;
            // Mémorisé AVANT de compter l'e-mail comme envoyé ; un échec d'écriture ne doit jamais faire échouer ni renvoyer l'e-mail.
            try {
              db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(THREAD_KEY, threadId, now());
            } catch (e) { req.log.warn({ event: 'quote_thread_not_saved', quote: row.id }); }
          }
          sends.push({ n: sent + 1, gmailId: (r && r.id) || null, threadId: (r && r.threadId) || null, tokenMs: r && r.tokenMs, apiMs: r && r.apiMs, mimeBytes: r && r.mimeBytes });
          db.prepare('UPDATE quotes SET mails_sent = ? WHERE id = ?').run(sent + 1, row.id);
        }
      } catch (err) {
        const code = String((err && err.code) || 'mail_error').slice(0, 60);
        db.prepare("UPDATE quotes SET status = 'mail_failed', last_error = ? WHERE id = ?").run(code, row.id);
        req.log.error({ event: 'quote_mail_failed', quote: row.id, code, mailsSent: sent, mailsTotal: messages.length, readMs: tRead - tStart, buildMs: tBuilt - tRead, failedAfterMs: Date.now() - tBuilt, tokenMs: err && err.timings && err.timings.tokenMs, apiMs: err && err.timings && err.timings.apiMs });
        return reply.code(502).send({ ok: false, error: 'mail_failed', message: M.mailFailed });
      }
      db.prepare("UPDATE quotes SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?").run(now(), row.id);
      req.log.info({ event: 'quote_sent', quote: row.id, mails: messages.length, photos: photos.length, sinceCreatedMs: Date.now() - row.created_at, readMs: tRead - tStart, buildMs: tBuilt - tRead, sendMs: Date.now() - tBuilt, totalMs: Date.now() - tStart, sends });
      return { ok: true, status: 'sent', id: row.id };
    } finally { busy.delete(row.id); }
  });
}

module.exports = { registerQuoteRoutes, validateQuote, buildQuoteMessages };
