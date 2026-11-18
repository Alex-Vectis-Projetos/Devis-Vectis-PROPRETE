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
  for (const s of ['VECTIS', 'SASU', '100 €', '8, Rue Pasteur, 69200 Vénissieux', 'RCS Lyon 107 463 358', '107 463 358 00013', 'adm@vectis-pro.fr', '+33 7 80 25 11 28', 'Directrice de la publication']) assert.ok(h.includes(s), 'manque : ' + s);
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
