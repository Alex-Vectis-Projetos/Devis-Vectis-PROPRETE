'use strict';

// Pages juridiques : liens, structure, cohérence avec le système, marqueurs « À COMPLÉTER » explicites.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const PAGES = ['mentions-legales.html', 'politique-de-confidentialite.html'];
const index = read('index.html');

test('index.html: footer links point to both legal pages (no more placeholder buttons for them)', () => {
  assert.match(index, /<a href="mentions-legales\.html">Mentions légales<\/a>/);
  assert.match(index, /<a href="politique-de-confidentialite\.html">Politique de confidentialité<\/a>/);
  assert.ok(!/data-soon>Mentions légales|data-soon>Politique de confidentialité/.test(index));
});

test('legal pages: valid skeleton, French, local assets only, no third-party host except official sources', () => {
  for (const f of PAGES) {
    const h = read(f);
    assert.match(h, /^<!doctype html>/i);
    assert.match(h, /<html lang="fr">/);
    assert.match(h, /<meta name="viewport" content="width=device-width,initial-scale=1/);
    assert.match(h, /<link rel="stylesheet" href="legal\/legal\.css">/);
    assert.ok(!/<script/i.test(h), f + ' : aucun script');
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
  }
});

test('mentions légales: identity data taken from the company documents', () => {
  const h = read('mentions-legales.html');
  for (const s of ['VECTIS', 'SASU', '100 €', '8, Rue Pasteur, 69200 Vénissieux', 'RCS Lyon 107 463 358', '107 463 358 00013', 'vectis.adm@gmail.com', '+33 7 80 25 11 28', 'direction de la publication']) assert.ok(h.includes(s), 'manque : ' + s);
  assert.match(h, /href="tel:\+33780251128"/);
});

test('privacy policy: matches what the code really does (no invented retention, no fake self-service)', () => {
  const h = read('politique-de-confidentialite.html');
  // faits vérifiés dans le code
  assert.match(h, /24 heures/); // auth.js purge sessions/codes/rate_limits
  assert.match(h, /180 jours/); // auth.js purge auth_events
  assert.match(h, /__Host-vectis_admin/);
  assert.match(h, /8 heures/); // sessionTtlMs
  assert.match(h, /Aucun outil en ligne d’export ou de suppression/);
  assert.match(h, /https:\/\/www\.cnil\.fr\/fr\/plaintes/);
  // durées non fournies par le client : doivent rester explicitement en attente
  const retention = h.split('<h2>4.')[1].split('<h2>5.')[0];
  assert.ok((retention.match(/À COMPLÉTER/g) || []).length >= 3, 'durées de conservation devis/photos/e-mails/logs non inventées');
  // aucune promesse de fonctions inexistantes
  assert.ok(!/télécharger vos données|supprimer votre compte|espace personnel|anonymis/i.test(h));
});

test('pending items are explicit, styled, and counted (publication gate: node server/test/legal-ready.check.js)', () => {
  const css = read('legal/legal.css');
  assert.match(css, /\.todo\{/);
  for (const f of PAGES) {
    const h = read(f);
    const marks = h.match(/\[À COMPLÉTER[^\]]*\]/g) || [];
    const spans = h.match(/<span class="todo">\[À COMPLÉTER/g) || [];
    assert.equal(marks.length, spans.length, f + ' : chaque marqueur est dans un span.todo');
    assert.ok(marks.length > 0);
  }
});

test('single official contact e-mail: vectis.adm@gmail.com only (no former or personal addresses anywhere in pages or sources)', () => {
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', 'test', 'tests'].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(html|js|css|md|yml|json|sh|py|conf)$/.test(e.name)) out.push(p); } return out; };
  for (const p of walk(root)) {
    const t = fs.readFileSync(p, 'utf8');
    assert.ok(!/adm@vectis-pro\.fr|vectis\.adm@hotmail\.com/i.test(t), 'adresse non autorisée dans ' + path.relative(root, p));
  }
  for (const f of ['mentions-legales.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html']) {
    const mails = new Set((read(f).match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []));
    for (const m of mails) assert.equal(m, 'vectis.adm@gmail.com', f);
  }
  assert.equal(require('../src/config').QUOTE_RECIPIENT_DEFAULT, 'vectis.adm@gmail.com');
});

test('mentions légales: President (legal representative) and Alex (sole shareholder + delegated agent) are clearly separated, Alex is never presented as a leader', () => {
  const h = read('mentions-legales.html');
  assert.match(h, /Représentante légale<\/dt><dd>Lúcia De Fátima Da Silva, Présidente/);
  assert.match(h, /Alex Da Silva De Souza<\/strong> est l’associé unique/);
  assert.match(h, /délégation de pouvoirs consentie par la Présidente le 13 juillet 2026/);
  assert.match(h, /ni Président, ni dirigeant, ni représentant légal/);
  assert.match(h, /Pour Madame Lúcia De Fátima Da Silva, Présidente de La Société, et par délégation/);
  assert.ok(!/Alex[^<]{0,60}(Président|gérant|dirigeant de VECTIS)/.test(h.replace(/ni Président, ni dirigeant, ni représentant légal/, '')), 'Alex jamais présenté comme dirigeant');
  assert.ok(!/passeport|titre de séjour|née? le|Rio Das Ostras|GD939156|FT439910|Macaé|Muniz/i.test(h), 'aucune donnée personnelle issue des documents internes');
});

test('mentions légales: intellectual property authorship line, third-party carve-outs, no claim on third-party assets', () => {
  const h = read('mentions-legales.html');
  assert.match(h, /Conception, direction artistique et création originale du site : Alex Da Silva De Souza\./);
  assert.match(h, /L111-1/); assert.match(h, /L122-4/); assert.match(h, /L335-2/);
  assert.match(h, /SIL Open Font License 1\.1/);
  assert.match(h, /MR PROP appartiennent à leur titulaire/);
  assert.match(h, /Éléments de tiers, non couverts/);
  assert.match(h, /Titulaire des droits patrimoniaux[^]*À COMPLÉTER/);
});

test('privacy/mentions: TVA, hosting, domain holder, retention, DPO, mediator stay pending (nothing invented)', () => {
  const m = read('mentions-legales.html'), p = read('politique-de-confidentialite.html');
  assert.match(m, /N° de TVA intracommunautaire<\/dt><dd><span class="todo">\[À COMPLÉTER/);
  assert.match(m, /Hébergeur<\/dt><dd><span class="todo">\[À COMPLÉTER/);
  assert.match(m, /Titulaire du nom de domaine : <span class="todo">/);
  assert.match(m, /Médiation de la consommation<\/h2>\s*<p><span class="todo">/);
  assert.match(p, /Délégué à la protection des données : <span class="todo">/);
  assert.match(p, /Aucune suppression automatique n’est en place/);
  assert.ok(!/\b(\d+|un|deux|trois|cinq|dix) (an|ans|mois)\b/i.test(p.split('<h2>4.')[1].split('<h2>5.')[0].replace('180 jours','')), 'aucune durée inventée');
});
