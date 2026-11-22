'use strict';

// Pages juridiques et institutionnelle : liens, structure, cohérence avec le système, aucun marqueur interne visible du public.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const PAGES = ['mentions-legales.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html', 'qui-sommes-nous.html'];
const index = read('index.html');

test('index.html: footer links point to the institutional page and the legal pages (no more placeholder buttons)', () => {
  assert.match(index, /<a href="qui-sommes-nous\.html">Qui sommes-nous \?<\/a>/);
  assert.match(index, /<a href="mentions-legales\.html">Mentions légales<\/a>/);
  assert.match(index, /<a href="politique-de-confidentialite\.html">Politique de confidentialité<\/a>/);
  assert.ok(!/data-soon/.test(index.replace(/\$\$\('\[data-soon\]'\)[^\n]*\n/, '')), 'plus aucun bouton provisoire dans le pied de page');
});

test('legal pages: valid skeleton, French, local assets only, no third-party host except official sources', () => {
  for (const f of PAGES) {
    const h = read(f);
    assert.match(h, /^<!doctype html>/i);
    assert.match(h, /<html lang="fr">/);
    assert.match(h, /<meta name="viewport" content="width=device-width,initial-scale=1/);
    assert.match(h, /<link rel="stylesheet" href="legal\/legal\.css">/);
    assert.ok(!/<script(?![^>]*\ssrc=)/i.test(h), f + ' : aucun script en ligne');
    for (const m of h.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) assert.ok(/^(stats-consent\.js|legal\/consent-panel\.js)(\?v=\d+)?$/.test(m[1]), f + ' : script inattendu ' + m[1]);
    assert.ok(!/fonts\.googleapis|fonts\.gstatic|google-analytics|googletagmanager/.test(h), f);
    const hosts = new Set([...h.matchAll(/https?:\/\/([^/"'\s]+)/g)].map((m) => m[1]));
    for (const host of hosts) assert.ok(['www.legifrance.gouv.fr', 'www.cnil.fr', 'eur-lex.europa.eu'].includes(host), f + ' : hôte inattendu ' + host);
  }
  const css = read('legal/legal.css');
  assert.ok(!/url\(\s*https?:|@import/.test(css));
});

test('legal pages: every internal link resolves to an existing file and pages link to each other', () => {
  for (const f of PAGES) {
    const h = read(f);
    for (const m of h.matchAll(/href="([^"#]+)"/g)) {
      const u = m[1];
      if (/^(https?:|mailto:|tel:)/.test(u)) continue;
      assert.ok(fs.existsSync(path.join(root, u)), f + ' : lien interne cassé ' + u);
    }
    assert.match(h, /href="index\.html"/);
    assert.match(h, /href="mentions-legales\.html"/);
    assert.match(h, /href="politique-de-confidentialite\.html"/);
    assert.match(h, /href="qui-sommes-nous\.html"/);
  }
});

test('mentions légales: identity data taken from the company documents and confirmed by VECTIS', () => {
  const h = read('mentions-legales.html');
  for (const s of ['VECTIS', 'SASU', '100 €', '8, Rue Pasteur, 69200 Vénissieux', 'RCS Lyon 107 463 358', '107 463 358 00013', 'adm@vectis-pro.fr', 'vectis.adm@gmail.com', 'Directrice de la publication', 'devis.mrprop.fr']) assert.ok(h.includes(s), 'manque : ' + s);
  assert.match(h, /Téléphone<\/dt><dd><a href="tel:\+33780251128">\+33 7 80 25 11 28<\/a>/);
  assert.match(h, /Titulaire du nom de domaine : VECTIS\./);
  assert.match(h, /Dernière mise à jour : 22 novembre 2026/);
});

test('no public page shows an internal marker, a pending box or a "do not publish" warning', () => {
  for (const f of [...PAGES, 'index.html']) {
    const h = read(f);
    assert.ok(!/À COMPLÉTER|À COMPLETAR|À SER PREENCHIDO|PREENCHER|à renseigner|ne doit pas être publiée|class="(todo|lg-banner)"/i.test(h), f + ' : marqueur ou avertissement interne visible');
  }
  assert.ok(!/\.todo\{|\.lg-banner\{/.test(read('legal/legal.css')), 'plus de style de marqueur dans legal.css');
  assert.ok(!/\[[^\]]{0,40}(COMPL|REMPL|TODO)/i.test(PAGES.map(read).join('')));
});

test('privacy policy: matches what the code really does (no invented retention, no fake self-service)', () => {
  const h = read('politique-de-confidentialite.html');
  assert.match(h, /24 heures/); // auth.js purge sessions/codes/rate_limits
  assert.match(h, /180 jours/); // auth.js purge auth_events
  assert.match(h, /__Host-vectis_admin/);
  assert.match(h, /8 heures/); // sessionTtlMs
  assert.match(h, /Aucun outil en ligne d’export ou de suppression/);
  assert.match(h, /https:\/\/www\.cnil\.fr\/fr\/plaintes/);
  const retention = h.split('<h2>4.')[1].split('<h2>5.')[0].replace(/180 jours|90 jours|25 mois|24 heures/g, '');
  assert.ok(!/\b(\d+|un|deux|trois|cinq|dix) (an|ans|mois|jours|semaines)\b/i.test(retention), 'aucune durée inventée (seules : 24 h, 180 j, 90 j, 25 mois, issues du code)');
  assert.match(retention, /Aucune suppression automatique n’est en place à ce jour/);
  assert.ok(!/télécharger vos données|supprimer votre compte|espace personnel/i.test(h));
  assert.ok(!/(données|statistiques|mesure)[^.<]{0,60}(sont|est|restent) anonymes?/i.test(h), 'jamais présenter la pseudonymisation comme de l’anonymisation');
});

test('two official e-mails with distinct roles: adm@vectis-pro.fr (legal/privacy), vectis.adm@gmail.com (administrative/operational); no former or personal address', () => {
  const ALLOWED = new Set(['adm@vectis-pro.fr', 'vectis.adm@gmail.com']);
  for (const f of PAGES) {
    const mails = new Set((read(f).match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []));
    for (const m of mails) assert.ok(ALLOWED.has(m), f + ' : adresse non autorisée ' + m);
  }
  const m = read('mentions-legales.html');
  assert.match(m, /E-mail juridique et confidentialité<\/dt><dd><a href="mailto:adm@vectis-pro\.fr">/);
  assert.match(m, /E-mail administratif et opérationnel<\/dt><dd><a href="mailto:vectis\.adm@gmail\.com">/);
  // les droits RGPD et la confidentialité passent par l'adresse juridique, jamais par la boîte opérationnelle
  const p = read('politique-de-confidentialite.html');
  assert.ok(!p.includes('vectis.adm@gmail.com'), 'politique de confidentialité : uniquement l’adresse juridique');
  assert.ok((p.match(/mailto:adm@vectis-pro\.fr/g) || []).length >= 3);
  assert.ok(!read('gestion-des-cookies.html').includes('vectis.adm@gmail.com'));
  // aucune adresse personnelle ou ancienne ailleurs dans les sources du site
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', 'test', 'tests'].includes(e.name)) continue; const q = path.join(d, e.name); if (e.isDirectory()) walk(q, out); else if (/\.(html|js|css|md|json|yml|conf)$/.test(e.name)) out.push(q); } return out; };
  for (const q of walk(root)) assert.ok(!/vectis\.adm@hotmail\.com/i.test(fs.readFileSync(q, 'utf8')), 'ancienne adresse dans ' + path.relative(root, q));
  assert.equal(require('../src/config').QUOTE_RECIPIENT_DEFAULT, 'vectis.adm@gmail.com');
});

test('mentions légales: the publication director is named once (legal duty); no “legal representative” line; Alex is presented by delegation, never as a leader', () => {
  const h = read('mentions-legales.html');
  // art. 1-1, I, 3° LCEN : le nom du directeur de la publication, de droit le représentant légal (art. 93-2 loi 82-652) : une seule mention
  assert.match(h, /<dt>Directrice de la publication<\/dt><dd>Lucia DE FATIMA DA SILVA<\/dd>/);
  assert.equal((h.match(/Lucia/g) || []).length, 1, 'le nom n’apparaît qu’une fois');
  assert.ok(!/Représentante? légale?|Représentation légale|identité telle qu’inscrite|Présidente de VECTIS|Kbis/.test(h), 'plus de ligne ni de paragraphe « représentant légal »');
  assert.match(h, /<h2>2\. Gestion de la société<\/h2>\s*<h3>Associé unique, responsable de la gestion administrative et représentant par délégation<\/h3>/);
  assert.match(h, /Alex Da Silva De Souza<\/strong> est l’associé unique de VECTIS et responsable de la gestion administrative de la société\. Il agit en qualité de représentant par délégation, dans les limites des pouvoirs qui lui ont été conférés\./);
  const gest = h.split('<h2>2. Gestion de la société</h2>')[1].split('<h2>3.')[0];
  assert.ok(!/ni Président|n’est pas|ni dirigeant|directeur|directrice|dirigeant|Président|gérant|représentant légal|statutaire/i.test(gest), 'aucune négation ni qualité de dirigeant');
  assert.ok(!/passeport|titre de séjour|née? le|Rio Das Ostras|GD939156|FT439910|Macaé|Muniz/i.test(h), 'aucune donnée personnelle issue des documents internes');
  // la Présidente n'apparaît nulle part ailleurs dans les pages publiques
  for (const f of ['index.html', 'qui-sommes-nous.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html']) assert.ok(!/Lucia|FATIMA|Lúcia|Présidente/i.test(read(f)), f + ' : la Présidente n’est pas présentée');
  assert.ok(!/représentation légale/i.test(read('politique-de-confidentialite.html')));
});

 test('mentions légales: intellectual property authorship line, third-party carve-outs, no claim of assignment, no claim on third-party assets', () => {
  const h = read('mentions-legales.html');
  assert.match(h, /Conception, direction artistique et création originale du site : Alex Da Silva De Souza\./);
  assert.match(h, /L111-1/); assert.match(h, /L122-4/); assert.match(h, /L335-2/);
  assert.match(h, /SIL Open Font License 1\.1/);
  assert.match(h, /MR PROP appartiennent à leur titulaire/);
  assert.match(h, /Éléments de tiers, non couverts/);
  assert.match(h, /photographies et visuels de la galerie restent soumis aux droits de leurs titulaires respectifs/);
  assert.ok(!/\bcessions?\b|\bcédés?\b|titulaire des droits patrimoniaux|VECTIS est titulaire|propriété exclusive de VECTIS/i.test(h), 'aucune cession ni titularité affirmée sans document');
  assert.ok(!/dépôt de marque|INPI/i.test(h.replace(/<ul class="lg-note">[^]*$/, '')));
});

test('hosting names Hostinger VPS only; mediator, DPO and legal pending items are not displayed nor invented', () => {
  const m = read('mentions-legales.html'), p = read('politique-de-confidentialite.html');
  assert.match(m, /N° de TVA intracommunautaire<\/dt><dd>FR13 107463358<\/dd>/, 'TVA fournie par VECTIS, reproduite à l’identique');
  assert.equal((12 + 3 * (107463358 % 97)) % 97, 13, 'clé de contrôle du n° de TVA cohérente avec le SIREN (contrôle de forme uniquement)');
  const host = m.split('<h2>3. Hébergement</h2>')[1].split('<h2>4.')[0];
  assert.match(host, /Hébergeur<\/dt><dd>Hostinger — Serveur privé virtuel \(VPS\)<\/dd>/);
  assert.equal((host.match(/<dt>/g) || []).length, 1, 'ni adresse ni téléphone inventés pour l’hébergeur');
  assert.ok(!/UAB|Ltd|Limited|Kaunas|Vilnius|Lituanie|Chypre|Cyprus|Lithuania|\+\d{2,3} ?\d/.test(host));
  assert.ok(!/Médiation|médiateur/i.test(m), 'aucun médiateur ni rubrique de médiation affichée tant que rien n’est contracté');
  assert.ok(!/Délégué à la protection des données/.test(p));
  assert.ok(!/Droit applicable[^]*juridiction/i.test(m));
});
